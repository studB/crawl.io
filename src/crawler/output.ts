/**
 * Markdown writeback for crawl results.
 *
 * Pure string transformations plus one thin async fs wrapper — independently
 * unit-testable without ever launching a browser.
 *
 * appendOutput assumes `# Output` is the last H1 in the config file (true for
 * every config this tool produces). New entries are ALWAYS appended at EOF;
 * the `# Output` header detect is solely to avoid creating a duplicate header.
 *
 * JSON shape is locked by 02-CONTEXT.md:
 *   success: { fields: {...}, meta: { url, status: "ok",    durationMs } }
 *   error:   { error: { code, message, stack? }, meta: { url, status: "error", durationMs } }
 *
 * `stack` is included ONLY when `result.error.stack` is a string — under
 * exactOptionalPropertyTypes we cannot assign `stack: undefined`; we use a
 * conditional spread to omit the key entirely when absent.
 */

import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve as resolvePath } from 'node:path';

import type { CrawlResult } from './types';

// Avoid triple-backtick escape-sequence drama in TS source strings.
const FENCE = '\u0060\u0060\u0060';

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
 * The repo portion AFTER the home segment is preserved verbatim (e.g.,
 * `/home/alice/work/crawl.io/src/runner.ts:42` → `<HOME>/work/crawl.io/src/runner.ts:42`).
 * This keeps stack traces useful for debugging while stripping the
 * identifiable username / layout.
 *
 * Pure function, safe for `undefined` input (returns `undefined`).
 */
export function scrubPaths(text: string): string;
export function scrubPaths(text: undefined): undefined;
export function scrubPaths(text: string | undefined): string | undefined;
export function scrubPaths(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  let out = text;

  // 1. Exact os.homedir() prefix — most specific, apply first. Guard against
  //    homedir being falsy (rare — CI containers without HOME set).
  const home = homedir();
  if (home && home.length > 0) {
    // Escape regex metacharacters in the concrete home string.
    const esc = home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'g'), '<HOME>');
  }

  // 2. POSIX `/home/<user>/...` — <user> is any path segment that is NOT `/`.
  out = out.replace(/\/home\/[^/\s:()]+/g, '<HOME>');

  // 3. macOS `/Users/<user>/...`
  out = out.replace(/\/Users\/[^/\s:()]+/g, '<HOME>');

  // 4. Windows `C:\Users\<user>\...` (any drive letter, case-insensitive drive).
  //    Note: Node may also report such paths with forward slashes under some
  //    tooling — case (2) already covers the `/Users/…` shape there.
  out = out.replace(/[A-Za-z]:\\Users\\[^\\\s:()]+/g, '<HOME>');

  return out;
}

/**
 * Format a Date as UTC `YYYY-MM-DD HH:MM` — no seconds, zero-padded,
 * independent of `process.env.TZ`.
 */
export function formatTimestamp(date: Date): string {
  const Y = date.getUTCFullYear().toString().padStart(4, '0');
  const M = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const D = date.getUTCDate().toString().padStart(2, '0');
  const h = date.getUTCHours().toString().padStart(2, '0');
  const m = date.getUTCMinutes().toString().padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}`;
}

/**
 * Render a single run entry (H2 heading + italic meta line + fenced ```json
 * block) terminated by a trailing newline.
 *
 * The em dash in `## Run —` is U+2014.
 */
export function renderEntry(result: CrawlResult): string {
  const meta = {
    url: result.url,
    status: result.status,
    durationMs: result.durationMs,
  };

  let payload: Record<string, unknown>;
  let italic: string;

  if (result.status === 'ok') {
    const fields = result.fields ?? {};
    payload = { fields, meta };
    italic = `_count: ${Object.keys(fields).length}, duration: ${result.durationMs}ms_`;
  } else {
    const src = result.error ?? { code: 'unknown' as const, message: 'no error detail' };
    // MD-04: scrub absolute home-directory paths from user-facing strings
    // BEFORE serializing them into the committed markdown. The conditional
    // spread keeps `stack` out of the payload entirely when src.stack is
    // undefined (exactOptionalPropertyTypes compliance).
    const scrubbedStack = scrubPaths(src.stack);
    const error = {
      code: src.code,
      message: scrubPaths(src.message),
      ...(scrubbedStack !== undefined ? { stack: scrubbedStack } : {}),
    };
    payload = { error, meta };
    italic = `_error: ${src.code}, duration: ${result.durationMs}ms_`;
  }

  return (
    '## Run \u2014 ' + formatTimestamp(result.startedAt) + '\n\n' +
    italic + '\n\n' +
    FENCE + 'json\n' +
    JSON.stringify(payload, null, 2) + '\n' +
    FENCE + '\n'
  );
}

/**
 * MD-02: detect whether the source contains a `# Output` H1 that is NOT
 * inside a fenced code block. A user config that documents the format itself
 * may include a ```markdown``` example containing `# Output`; such a line
 * must not be treated as the real header, or subsequent runs would write
 * entries with no owning `# Output` H1 preceding them on disk.
 *
 * Fence detection toggles on any line beginning with three backticks (opening
 * or closing). Nesting is not supported — standard CommonMark disallows it.
 */
function hasOutputHeaderOutsideFences(src: string): boolean {
  let inFence = false;
  // Split on either \n or \r\n — we compare line CONTENT, not separator bytes.
  for (const line of src.split(/\r?\n/)) {
    if (/^```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^# Output\s*$/i.test(line)) {
      return true;
    }
  }
  return false;
}

/**
 * Append a rendered entry to the end of a markdown source string.
 *
 * Contract (append-only):
 *   - If the source already contains a `# Output` H1 (case-insensitive) that
 *     is NOT inside a fenced code block, we do NOT add a duplicate header.
 *     The new entry is appended at EOF. (MD-02: fence-aware detection.)
 *   - If the source has no `# Output` H1, we create one at EOF before the
 *     entry.
 *   - The source is otherwise preserved BYTE-FOR-BYTE — prior entries, config
 *     sections, trailing non-output sections are all untouched.
 *   - Line-ending preservation (MD-01): if the source uses `\r\n` (CRLF) at
 *     least once, every newline we add AND every `\n` inside the rendered
 *     entry is promoted to `\r\n` so the file stays single-encoding after
 *     writeback. A source without any `\r\n` keeps `\n` semantics.
 *   - Result always ends with the source's dominant newline; a source missing
 *     a trailing newline is normalized first.
 */
export function appendOutput(source: string, entry: string): string {
  // MD-01: detect the source's dominant newline style ONCE and thread it
  // through every inserted separator. Presence of a single `\r\n` classifies
  // the file as CRLF — mixed-ending files become uniform CRLF after
  // writeback, which is strictly better than the pre-fix "preserve the worst
  // of both worlds" behavior.
  const nl = source.includes('\r\n') ? '\r\n' : '\n';
  const src = source.endsWith(nl) ? source : source + nl;
  const normalizedEntry = nl === '\r\n' ? entry.replace(/\r?\n/g, '\r\n') : entry;
  if (hasOutputHeaderOutsideFences(src)) {
    return src + nl + normalizedEntry;
  }
  return src + nl + '# Output' + nl + nl + normalizedEntry;
}

/**
 * MD-03: in-process serialization map for writeOutputToFile.
 *
 * Two `runCrawl` invocations targeting the SAME config path would otherwise
 * race on read→append→write: both read the pre-run source, each appends
 * their own entry, and the later writer would clobber the earlier one.
 *
 * The lock is keyed by the ABSOLUTE, resolved path so `./cfg.md` and
 * `/home/u/cfg.md` (same file) share a single queue. The lock is an in-
 * process promise chain — it does NOT protect against other OS processes
 * writing the same file simultaneously (that requires an fs-level flock,
 * which v1 OOS rules out). Phase-4 CLI is one-shot per run, so in-process
 * serialization is the right scope for v1.
 */
const writeLocks = new Map<string, Promise<void>>();

/**
 * Build a best-effort-unique tmp path next to the target. Using the same
 * directory is important so `fs.rename` is atomic (cross-filesystem rename
 * would fall back to copy+unlink and defeat the atomicity guarantee).
 */
function tmpPathFor(configPath: string): string {
  const pid = process.pid;
  const ts = Date.now();
  const rnd = Math.random().toString(36).slice(2, 10);
  return configPath + '.tmp-' + pid + '-' + ts + '-' + rnd;
}

/**
 * Read the markdown config file, append a new entry, write it back atomically.
 *
 * Atomicity (MD-03):
 *   1. Acquire the per-path in-process lock so concurrent callers on the
 *      SAME path serialize (no lost updates).
 *   2. readFile → appendOutput → writeFile(tmp) → rename(tmp, configPath).
 *   3. rename is atomic on POSIX same-filesystem operations — readers
 *      either see the pre-write file or the post-write file, never a
 *      half-written state.
 *   4. On rename failure, retry once (transient EACCES/EPERM during
 *      concurrent writers on some platforms). Remaining tmp file is
 *      cleaned up on final failure.
 *
 * Native fs errors on the underlying readFile / writeFile / rename
 * propagate unchanged (the runner in Plan 04 decides whether to wrap them
 * as CrawlError).
 */
export async function writeOutputToFile(configPath: string, entry: string): Promise<void> {
  const key = resolvePath(configPath);
  const prev = writeLocks.get(key) ?? Promise.resolve();
  // Chain the new write behind any in-flight write on the same path.
  // `.catch` swallows prior errors so one failing writer does not poison
  // the queue; each writer still sees its own success/failure.
  const next = prev.catch(() => undefined).then(() => doAtomicWrite(configPath, entry));
  writeLocks.set(key, next);
  try {
    await next;
  } finally {
    // Only clear the map entry if we are still the tail (nobody else queued
    // behind us). Otherwise the tail lives on and will clear itself.
    if (writeLocks.get(key) === next) {
      writeLocks.delete(key);
    }
  }
}

async function doAtomicWrite(configPath: string, entry: string): Promise<void> {
  const source = await readFile(configPath, 'utf8');
  const nextContent = appendOutput(source, entry);
  const tmp = tmpPathFor(configPath);
  await writeFile(tmp, nextContent, 'utf8');
  try {
    await rename(tmp, configPath);
  } catch (err) {
    // Retry once (transient rename failure on contended filesystems).
    try {
      await rename(tmp, configPath);
    } catch (retryErr) {
      // Clean up the orphan tmp before surfacing the error.
      try {
        await unlink(tmp);
      } catch {
        /* swallow — best-effort cleanup */
      }
      throw retryErr ?? err;
    }
  }
}
