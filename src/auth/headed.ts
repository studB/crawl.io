/**
 * Headed-fallback polling helpers.
 *
 * The actual browser-close / browser-relaunch / session-save dance is
 * orchestrated by auth/index.ts (Plan 03-03). This module owns the **pure
 * polling logic**: resolve the wait ceiling, poll a supplied probe every
 * 2000ms, throw `captcha_unresolved` on timeout.
 *
 * NON-INTERACTIVE by contract (03-CONTEXT.md D9) — this module NEVER reads
 * stdin. User resolution is signaled by the probe returning `true` (cookies
 * appeared, URL changed, etc.), not by a key press.
 *
 * Deterministic test hooks: `sleep` and `now` are injectable so unit tests
 * exercise the immediate-success, eventually-success, and timeout paths
 * without any real timers or browser.
 */

import { CrawlError } from '../crawler/errors';

/** Locked default — 5 minutes. */
export const HEADED_TIMEOUT_DEFAULT_MS = 300_000;

/** Locked poll cadence — every 2 seconds. */
export const HEADED_POLL_INTERVAL_MS = 2_000;

/** Env var that overrides the ceiling at runtime. */
export const HEADED_TIMEOUT_ENV_VAR = 'CRAWL_HEADED_TIMEOUT_MS';

/**
 * Resolve the effective headed-timeout ceiling.
 *
 *   - If `env[HEADED_TIMEOUT_ENV_VAR]` parses to a positive finite integer, use it.
 *   - Otherwise fall back to `HEADED_TIMEOUT_DEFAULT_MS`.
 *
 * Malformed values (non-numeric, ≤0, NaN, Infinity, non-integer) SILENTLY
 * fall back to the default — misconfiguration must not block the crawl.
 */
export function resolveHeadedTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[HEADED_TIMEOUT_ENV_VAR];
  if (raw === undefined || raw.length === 0) return HEADED_TIMEOUT_DEFAULT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return HEADED_TIMEOUT_DEFAULT_MS;
  }
  return parsed;
}

export interface PollOptions {
  /** Probe the "is user done?" signal. Called immediately, then every `intervalMs`. */
  readonly isLoggedIn: () => Promise<boolean>;
  /** Total ceiling in ms. Default: `resolveHeadedTimeoutMs()`. */
  readonly timeoutMs?: number;
  /** Poll cadence in ms. Default: `HEADED_POLL_INTERVAL_MS`. */
  readonly intervalMs?: number;
  /** Deterministic `setTimeout` replacement for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Deterministic clock for tests. Default: `() => Date.now()`. */
  readonly now?: () => number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll `isLoggedIn()` every `intervalMs` until it returns true OR
 * `timeoutMs` elapses. Throws `CrawlError('captcha_unresolved', detail)` on
 * timeout; resolves silently on success.
 *
 * NEVER reads stdin. NEVER prints. NEVER throws anything except
 * `CrawlError('captcha_unresolved', ...)` on timeout — probe failures
 * propagate unchanged so the runner can classify them.
 */
export async function pollUntilLoggedIn(opts: PollOptions): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? resolveHeadedTimeoutMs();
  const intervalMs = opts.intervalMs ?? HEADED_POLL_INTERVAL_MS;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? ((): number => Date.now());
  const deadline = now() + timeoutMs;

  // Immediate probe — if the user resolved before we got here, don't wait.
  if (await opts.isLoggedIn()) return;

  while (now() < deadline) {
    await sleep(intervalMs);
    if (await opts.isLoggedIn()) return;
  }
  throw new CrawlError(
    'captcha_unresolved',
    'headed login did not complete within ' + timeoutMs + 'ms',
  );
}
