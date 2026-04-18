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

import { readFile, writeFile } from 'node:fs/promises';

import type { CrawlResult } from './types';

// Avoid triple-backtick escape-sequence drama in TS source strings.
const FENCE = '\u0060\u0060\u0060';

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
    // Conditional spread keeps `stack` out of the serialized payload entirely
    // when src.stack is undefined (exactOptionalPropertyTypes compliance).
    const error = {
      code: src.code,
      message: src.message,
      ...(src.stack !== undefined ? { stack: src.stack } : {}),
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
 * Append a rendered entry to the end of a markdown source string.
 *
 * Contract (append-only):
 *   - If the source already contains a `# Output` H1 (case-insensitive), we
 *     do NOT add a duplicate header. The new entry is appended at EOF.
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
  const hasOutputHeader = /^# Output\s*$/im.test(src);
  if (hasOutputHeader) {
    return src + nl + normalizedEntry;
  }
  return src + nl + '# Output' + nl + nl + normalizedEntry;
}

/**
 * Read the markdown config file, append a new entry, write it back.
 *
 * Native fs errors propagate unchanged (the runner in Plan 04 decides whether
 * to wrap them as CrawlError).
 */
export async function writeOutputToFile(configPath: string, entry: string): Promise<void> {
  const source = await readFile(configPath, 'utf8');
  const next = appendOutput(source, entry);
  await writeFile(configPath, next, 'utf8');
}
