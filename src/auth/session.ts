/**
 * Session-file helpers for Naver auth (Phase 3).
 *
 * Playwright's storageState JSON round-trips through
 * `context.storageState({ path })` and `browser.newContext({ storageState })`.
 * This module owns path resolution, existence checks, validation, and the
 * atomic write ceremony ONLY — it does NOT import Playwright (keeps unit
 * tests zero-browser and keeps the module safe to import from any layer).
 *
 * The session file lives at the REPO ROOT — resolved from `process.cwd()`
 * at call time (not at module import), so tests can `chdir` into a tmp
 * directory and get a clean session slate without mutating globals.
 *
 * H-02 / M-03 hardening (2026-04-18 review):
 *   - `writeSession` writes via a caller-supplied callback to a tmp path and
 *     renames into place — a crash mid-write can no longer leave a truncated
 *     `.crawl-session.json` that poisons the next run. The tmp is cleaned up
 *     on failure.
 *   - `sessionLooksValid` checks the file is non-empty and parses to a JSON
 *     object with a `cookies` array. Zero-byte and garbage-JSON files are
 *     rejected so the runner's fast path can treat them as "no session"
 *     rather than hand them to Playwright (which throws a non-specific
 *     parse error the runner maps to `code: 'unknown'`).
 */

import { access, readFile, rename, unlink } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

/** Locked by 03-CONTEXT.md §Session file path: ".crawl-session.json" at repo root. */
export const SESSION_FILENAME = '.crawl-session.json';

/** Absolute path to the session file, resolved against cwd at call time. */
export function sessionFilePath(cwd: string = process.cwd()): string {
  return resolvePath(cwd, SESSION_FILENAME);
}

/** True iff the session file exists and is readable; never throws. */
export async function sessionExists(cwd: string = process.cwd()): Promise<boolean> {
  try {
    await access(sessionFilePath(cwd));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the raw session-file bytes as UTF-8. Returns `undefined` when the
 * file is missing; otherwise propagates the underlying fs error (permission,
 * EIO, etc.) for the caller to classify.
 *
 * We deliberately return the raw string — Playwright consumes the file via
 * its own `{ storageState: path }` option, so this module never has to
 * parse the JSON. Returning a string keeps the surface narrow.
 */
export async function readSession(cwd: string = process.cwd()): Promise<string | undefined> {
  try {
    return await readFile(sessionFilePath(cwd), 'utf8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e && e.code === 'ENOENT') return undefined;
    throw err;
  }
}

/**
 * M-03: `true` iff the session file exists, is non-empty, parses as a JSON
 * object, and has a `cookies` array field — Playwright's `storageState`
 * shape. Zero-byte files, invalid JSON, and JSON that isn't an object with
 * `cookies: []` all return `false`. Never throws.
 *
 * The runner's session-reuse fast path gates on this (not on bare
 * `sessionExists`) so a corrupt or truncated file is transparently
 * treated as "no session" instead of being handed to Playwright — which
 * otherwise throws a parse error the runner maps to `code: 'unknown'`
 * with no hint about the remedy.
 */
export async function sessionLooksValid(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const raw = await readFile(sessionFilePath(cwd), 'utf8');
    if (raw.length === 0) return false;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return false;
    // narrow-cast: check `cookies` is array
    const obj = parsed as { cookies?: unknown };
    return Array.isArray(obj.cookies);
  } catch {
    return false;
  }
}

/**
 * H-02: write the session file atomically via the caller-supplied `write`
 * callback.
 *
 *   1. Compute a tmp path adjacent to the final file (same directory so
 *      rename is atomic on POSIX same-filesystem operations).
 *   2. Invoke `write(tmpPath)` — the caller hands the tmp path to Playwright
 *      via `context.storageState({ path: tmpPath })`.
 *   3. `rename(tmp, final)` — atomic swap.
 *   4. On ANY failure in steps 2 or 3, best-effort `unlink(tmp)` and
 *      rethrow the original error. The final file is never left in a
 *      half-written state.
 *
 * Prior behavior (`context.storageState({ path: finalPath })` directly) wrote
 * in-place; a crash mid-serialize produced a truncated file that poisoned
 * the next run's `launchBrowser({ storageState })` call.
 */
export async function writeSession(
  cwd: string,
  write: (tmpPath: string) => Promise<unknown>,
): Promise<void> {
  const final = sessionFilePath(cwd);
  const tmp = final + '.tmp-' + process.pid + '-' + Date.now();
  try {
    await write(tmp);
    await rename(tmp, final);
  } catch (err) {
    // Best-effort tmp cleanup. The tmp may not exist (write() threw before
    // creating it); swallow ENOENT silently. Any other unlink failure is
    // also swallowed — surfacing the ORIGINAL write/rename error is more
    // useful than shadowing it with a cleanup error.
    try {
      await unlink(tmp);
    } catch {
      /* best-effort */
    }
    throw err;
  }
}
