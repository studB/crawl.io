/**
 * Session-file helpers for Naver auth (Phase 3).
 *
 * Playwright's storageState JSON round-trips through
 * `context.storageState({ path })` and `browser.newContext({ storageState })`.
 * This module owns path resolution and existence checks ONLY — it does NOT
 * import Playwright (keeps unit tests zero-browser and keeps the module
 * safe to import from any layer).
 *
 * The session file lives at the REPO ROOT — resolved from `process.cwd()`
 * at call time (not at module import), so tests can `chdir` into a tmp
 * directory and get a clean session slate without mutating globals.
 */

import { access, readFile } from 'node:fs/promises';
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
