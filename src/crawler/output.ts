/**
 * JSON file writer for crawl results.
 *
 * Each run produces a standalone JSON file under
 *   <configDir>/output/<YYYYMMDD>/run_<YYYY-MM-DD-HH-mm-ss>.json
 * where the date/time components are LOCAL time. The job markdown file is
 * no longer mutated — it describes the job only; results live alongside.
 *
 * JSON payload shape:
 *   success: { fields: {...}, meta: { url, status: "ok",    startedAt, durationMs } }
 *   error:   { error: { code, message, stack? }, meta: { url, status: "error", startedAt, durationMs } }
 *
 * `startedAt` is always an ISO-8601 UTC string (toISOString) so the payload
 * itself is timezone-unambiguous; the filename/directory use local time for
 * operator convenience.
 *
 * `stack` is included ONLY when `result.error.stack` is a string — under
 * exactOptionalPropertyTypes we cannot assign `stack: undefined`, so we
 * spread it in conditionally.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type { CrawlResult } from './types';

/**
 * MD-04: replace absolute filesystem path prefixes that identify the user or
 * their home directory with a `<HOME>` placeholder, so stack traces and error
 * messages written to disk do not leak the home layout / username.
 *
 * Substitutions (earliest matches win — most-specific first):
 *   - `os.homedir()` exact prefix → `<HOME>`
 *   - POSIX `/home/<user>/...`   → `<HOME>/...`
 *   - macOS `/Users/<user>/...`  → `<HOME>/...`
 *   - Windows `C:\Users\<user>\...` (any drive letter) → `<HOME>\...`
 *
 * Pure function, safe for `undefined` input (returns `undefined`).
 */
export function scrubPaths(text: string): string;
export function scrubPaths(text: undefined): undefined;
export function scrubPaths(text: string | undefined): string | undefined;
export function scrubPaths(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let out = text;

  const home = homedir();
  if (home && home.length > 0) {
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'g'), '<HOME>');
  }
  out = out.replace(/\/home\/[^/\s:()]+/g, '<HOME>');
  out = out.replace(/\/Users\/[^/\s:()]+/g, '<HOME>');
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s:()]+/g, '<HOME>');

  return out;
}

/**
 * Format a Date as a LOCAL-time directory name `YYYYMMDD`.
 */
export function formatDateDir(date: Date): string {
  const Y = date.getFullYear().toString().padStart(4, '0');
  const M = (date.getMonth() + 1).toString().padStart(2, '0');
  const D = date.getDate().toString().padStart(2, '0');
  return `${Y}${M}${D}`;
}

/**
 * Format a Date as a LOCAL-time filename stem `YYYY-MM-DD-HH-mm-ss`.
 * Second precision is intentional — back-to-back runs on the same config
 * within a single second are rare, and the writer falls back to a `-N`
 * suffix when the file already exists.
 */
export function formatRunTimestamp(date: Date): string {
  const Y = date.getFullYear().toString().padStart(4, '0');
  const M = (date.getMonth() + 1).toString().padStart(2, '0');
  const D = date.getDate().toString().padStart(2, '0');
  const h = date.getHours().toString().padStart(2, '0');
  const m = date.getMinutes().toString().padStart(2, '0');
  const s = date.getSeconds().toString().padStart(2, '0');
  return `${Y}-${M}-${D}-${h}-${m}-${s}`;
}

/**
 * Build the JSON payload for a run result.
 *
 *   success: { fields, meta: { url, status, startedAt, durationMs } }
 *   error:   { error: { code, message, stack? }, meta: { ... } }
 *
 * MD-04: error.message and error.stack are scrubbed before inclusion.
 */
export function buildPayload(result: CrawlResult): Record<string, unknown> {
  const meta = {
    url: result.url,
    status: result.status,
    startedAt: result.startedAt.toISOString(),
    durationMs: result.durationMs,
  };

  if (result.status === 'ok') {
    // Success envelopes carry exactly one of `fields` / `actions` (mirrors the
    // collectors-XOR-actions contract on CrawlJob). Empty-collectors jobs fall
    // back to `{ fields: {} }` to preserve the Phase-2 payload shape.
    if (result.actions !== undefined) return { actions: result.actions, meta };
    return { fields: result.fields ?? {}, meta };
  }

  const src = result.error ?? { code: 'unknown' as const, message: 'no error detail' };
  const scrubbedStack = scrubPaths(src.stack);
  const error = {
    code: src.code,
    message: scrubPaths(src.message),
    ...(scrubbedStack !== undefined ? { stack: scrubbedStack } : {}),
  };
  return { error, meta };
}

/**
 * Resolve the target directory and filename stem for a run. Exposed for
 * tests and for callers that want to know where the JSON will land without
 * performing the write.
 */
export function resolveOutputTarget(
  configPath: string,
  startedAt: Date,
): { dir: string; stem: string } {
  const dir = join(dirname(configPath), 'output', formatDateDir(startedAt));
  const stem = `run_${formatRunTimestamp(startedAt)}`;
  return { dir, stem };
}

/**
 * Write a crawl result to disk as JSON. Creates the `output/YYYYMMDD/`
 * directory tree if missing. Returns the absolute-ish path that was written.
 *
 * Collision handling: uses `wx` (exclusive create) so two writes racing on
 * the same second-precision filename cannot clobber each other — the loser
 * retries with `run_<stem>-2.json`, `-3.json`, etc. This also serves as the
 * concurrency primitive; no in-process lock needed.
 *
 * Native fs errors (EACCES, ENOENT on parent, etc.) propagate unchanged —
 * the runner in crawler/runner.ts wraps writeback in a try/catch so its
 * failure does not mask the CrawlResult envelope.
 */
export async function writeOutputToFile(
  configPath: string,
  result: CrawlResult,
): Promise<string> {
  const { dir, stem } = resolveOutputTarget(configPath, result.startedAt);
  await mkdir(dir, { recursive: true });

  const payload = JSON.stringify(buildPayload(result), null, 2) + '\n';

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const name = attempt === 0 ? `${stem}.json` : `${stem}-${attempt + 1}.json`;
    const full = join(dir, name);
    try {
      await writeFile(full, payload, { encoding: 'utf8', flag: 'wx' });
      return full;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  throw new Error(`writeOutputToFile: exhausted retry attempts for ${stem} in ${dir}`);
}
