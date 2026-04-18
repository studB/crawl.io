/**
 * Internal barrel for the auth subsystem.
 *
 * Exposes a SINGLE entry point — `ensureAuthenticated` — that composes the
 * four pieces landed by Plans 03-01 and 03-02:
 *
 *   - session.ts  — session-file path + existence (Plan 03-01)
 *   - detect.ts   — URL + selector + cookie classifiers (Plan 03-02)
 *   - naver.ts    — credential reader + login-form filler (Plan 03-02)
 *   - headed.ts   — non-interactive polling orchestrator (Plan 03-02)
 *
 * Contract (03-CONTEXT.md):
 *   - Public API unchanged — this module is NOT re-exported from
 *     `src/crawler/index.ts` or `src/index.ts`.
 *   - Non-interactive — captcha resolution is signaled by cookie appearance
 *     via polling, never by any keyboard/terminal input.
 *   - Path-like strings passed through `scrubPaths` before becoming error
 *     messages.
 *   - Credentials never appear in thrown error messages (redaction boundary
 *     is owned upstream by naver.ts; this module only rethrows its errors).
 *
 * The function returns a `Page`:
 *   - Non-Naver host                         → the SAME page.
 *   - Naver host + existing session cookies  → the SAME page (session reuse).
 *   - Naver host + creds + classify=logged_in → the SAME page (session saved to disk).
 *   - Naver host + creds + classify=captcha  → a FRESH page rooted on a new
 *     headless Browser (the original was closed). The caller MUST detect the
 *     swap (page-identity check) and rebind its handle — see runner.ts.
 */

import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';

import { CrawlError } from '../crawler/errors';
import { scrubPaths } from '../crawler/output';
import {
  CAPTCHA_SELECTORS,
  classifyPostLogin,
  hasNaverSessionCookies,
  isNaverHost,
  type CookieLike,
} from './detect';
import {
  HEADED_POLL_INTERVAL_MS,
  pollUntilLoggedIn,
  resolveHeadedTimeoutMs,
} from './headed';
import {
  NAVER_LOGIN_URL,
  readNaverCredentials,
  submitNaverLoginForm,
} from './naver';
import { sessionExists, sessionFilePath, writeSession } from './session';

/** Shape returned by a custom browser launcher (tests inject fakes here). */
export interface AuthLaunchHandle {
  readonly browser: Browser;
  readonly context: BrowserContext;
  readonly page: Page;
}

/**
 * Injection surface for `ensureAuthenticated`. Every field is optional —
 * production supplies sensible defaults. Tests inject fakes to avoid a real
 * Chromium launch.
 */
export interface AuthContextOptions {
  /** Override for tests; default `process.env`. */
  readonly env?: NodeJS.ProcessEnv;
  /** Override for tests; default `process.cwd()`. */
  readonly cwd?: string;
  /** Override for tests; default launches real headless Chromium. */
  readonly launchHeadless?: (storageStatePath?: string) => Promise<AuthLaunchHandle>;
  /** Override for tests; default launches real headed Chromium. */
  readonly launchHeaded?: (storageStatePath?: string) => Promise<AuthLaunchHandle>;
  /** Override for tests; default writes a single line to stderr. */
  readonly onHeadedOpened?: (timeoutMs: number) => void;
}

/**
 * Probe each CAPTCHA_SELECTORS entry for **visible** presence on a Page
 * within a tight internal budget. Never throws — failures are reported as
 * false.
 *
 * M-02 hardening (2026-04-18 review): a bare `count() > 0` check fires on
 * any node matching the substring selector (e.g. `[id*=captcha]` hitting an
 * innocuous `<div id="captcha-help-link">`). We now require the FIRST match
 * to also be visible — hidden disclaimer / tracking nodes no longer drag the
 * user into a headed session. `locator().first().isVisible()` is the cheap
 * visibility check Playwright recommends; we catch its rejections (closed
 * page, detached element) and report `false`.
 */
async function probeCaptchaSelectors(page: Page): Promise<boolean[]> {
  const hits: boolean[] = [];
  for (const sel of CAPTCHA_SELECTORS) {
    hits.push(await isCaptchaSelectorPresent(page, sel));
  }
  return hits;
}

/**
 * `true` iff `selector` matches a VISIBLE element on the page. Any failure
 * (closed page, locator rejection, timeout) reports `false` — the caller
 * classifies missing-signal as not-captcha, which is the safe direction per
 * 03-CONTEXT.md §Claude's Discretion ("false positives are worse than false
 * negatives").
 */
export async function isCaptchaSelectorPresent(
  page: Page,
  selector: string,
): Promise<boolean> {
  try {
    const count = await page.locator(selector).count();
    if (count === 0) return false;
    // Visibility gate — a matching-but-hidden node must NOT classify as
    // captcha. `.first()` is safe because `count > 0` established at least
    // one match. `.isVisible()` does not wait; it is a snapshot probe.
    return await page
      .locator(selector)
      .first()
      .isVisible()
      .catch(() => false);
  } catch {
    return false;
  }
}

/**
 * Read cookies from a BrowserContext and project them onto CookieLike.
 * Playwright's Cookie type is a superset of CookieLike — this adapter
 * decouples us from the full Playwright shape.
 */
async function readCookies(context: BrowserContext): Promise<CookieLike[]> {
  const raw = await context.cookies();
  return raw.map((c) => ({ name: c.name, value: c.value }));
}

/**
 * Ensure the current Page/BrowserContext is authenticated for the target URL.
 *
 * Returns the Page the caller should continue with. In the non-headed paths
 * this is the SAME page that was passed in; in the headed-fallback path the
 * original browser is closed and a fresh headless browser is launched — the
 * caller MUST detect this (page-identity check) and rebind its own handle.
 *
 * Throws `CrawlError` with one of:
 *   - `auth_missing_credentials` — env vars unset + no session on disk.
 *   - `auth_failed`              — post-submit classification is not logged-in.
 *   - `captcha_unresolved`       — propagated from `pollUntilLoggedIn`.
 */
export async function ensureAuthenticated(
  page: Page,
  targetUrl: string,
  browser: Browser,
  contextOpts?: AuthContextOptions,
): Promise<Page> {
  const env = contextOpts?.env ?? process.env;
  const cwd = contextOpts?.cwd ?? process.cwd();

  // Fast path: non-Naver host. Session reuse (if any) is already in effect
  // via launchBrowser({ storageState }); we do NOT attempt a Naver login for
  // a non-Naver URL.
  if (!isNaverHost(targetUrl)) {
    return page;
  }

  const context = page.context();

  // Session-reuse fast path: if NID_AUT + NID_SES are already present in the
  // context, trust it — the runner's goto will prove / disprove validity.
  const preCookies = await readCookies(context);
  if (hasNaverSessionCookies(preCookies)) {
    return page;
  }

  // Session did not carry the cookies. Try a login only if BOTH creds are
  // present; otherwise defer to the runner's post-goto redirect detection.
  const idPresent = typeof env.NAVER_ID === 'string' && env.NAVER_ID.length > 0;
  const pwPresent = typeof env.NAVER_PW === 'string' && env.NAVER_PW.length > 0;
  if (!idPresent || !pwPresent) {
    if (await sessionExists(cwd)) {
      // Stale session + no creds → let the runner see the redirect, which
      // (for a login-gated Naver URL) surfaces via a later classification
      // pass — Phase 4 decides how to report it. Here we simply proceed.
      return page;
    }
    throw new CrawlError(
      'auth_missing_credentials',
      'NAVER_ID and NAVER_PW must both be set to log into ' + scrubPaths(targetUrl),
    );
  }

  // Attempt a headless login. readNaverCredentials enforces the redaction
  // boundary; submitNaverLoginForm's `auth_failed` errors never include creds.
  const creds = readNaverCredentials(env);
  await submitNaverLoginForm(page, creds);

  // Classify post-submit state from URL + cookies + selector probes.
  const postUrl = page.url();
  const postCookies = await readCookies(context);
  const selectorHits = await probeCaptchaSelectors(page);
  const cls = classifyPostLogin({
    currentUrl: postUrl,
    cookies: postCookies,
    captchaSelectorHits: selectorHits,
  });

  if (cls === 'logged_in') {
    // Persist the fresh session for next-run reuse. The file path is under
    // cwd — tests pass a tmpdir-derived cwd so no repo pollution.
    // H-02: atomic write via writeSession (tmp → rename) so a crash mid-
    // serialize cannot leave a truncated session file behind.
    await writeSession(cwd, (tmp) => context.storageState({ path: tmp }));
    return page;
  }

  if (cls === 'captcha') {
    return await runHeadedFallback(browser, targetUrl, contextOpts);
  }

  // login_required / unknown after a submit — credentials were wrong or the
  // form shape changed. Classify as auth_failed. NEVER include the creds in
  // the message — only the classification name.
  throw new CrawlError(
    'auth_failed',
    'login did not produce NID_AUT/NID_SES cookies (classification=' + cls + ')',
  );
}

/**
 * Headed-fallback orchestrator. Closes the headless browser, relaunches
 * Chromium with `headless: false`, polls until the user resolves the
 * captcha/2FA, saves the fresh session, tears down the headed browser, and
 * relaunches headless with the now-fresh session file. Returns the new page
 * rooted on the new headless browser — the caller must detect the identity
 * swap and rebind its handle.
 *
 * Propagates `CrawlError('captcha_unresolved', ...)` unchanged from
 * `pollUntilLoggedIn` on timeout.
 */
async function runHeadedFallback(
  origBrowser: Browser,
  targetUrl: string,
  opts?: AuthContextOptions,
): Promise<Page> {
  const env = opts?.env ?? process.env;
  const cwd = opts?.cwd ?? process.cwd();
  const timeoutMs = resolveHeadedTimeoutMs(env);
  const sessionPath = sessionFilePath(cwd);
  const onOpened =
    opts?.onHeadedOpened ??
    ((ms: number): void => {
      process.stderr.write(
        '\u26A0 Captcha/2FA detected — resolve it in the visible browser window. ' +
          'Waiting up to ' +
          Math.floor(ms / 1000) +
          's...\n',
      );
    });

  // Close headless best-effort — we never want a close error to shadow the
  // auth flow.
  try {
    await origBrowser.close();
  } catch {
    /* swallow */
  }

  const launchHeaded =
    opts?.launchHeaded ??
    (async (storage?: string): Promise<AuthLaunchHandle> => {
      const b = await chromium.launch({ headless: false });
      const ctxInit: Parameters<Browser['newContext']>[0] = {};
      if (storage !== undefined) ctxInit.storageState = storage;
      const ctx = await b.newContext(ctxInit);
      const pg = await ctx.newPage();
      return { browser: b, context: ctx, page: pg };
    });

  // Reuse the on-disk session if one exists so a PARTIAL session (e.g., only
  // a short-lived login token) carries over; otherwise a fully fresh context.
  const seedPath = (await sessionExists(cwd)) ? sessionPath : undefined;
  const headed = await launchHeaded(seedPath);

  try {
    onOpened(timeoutMs);
    await headed.page.goto(NAVER_LOGIN_URL);

    await pollUntilLoggedIn({
      isLoggedIn: async () => {
        const cookies = await readCookies(headed.context);
        if (hasNaverSessionCookies(cookies)) return true;
        // Generous additional signal: navigated away from nid.naver.com back
        // to a Naver main surface. Covers 2FA flows that don't land cookies
        // via the login endpoint directly.
        try {
          const u = new URL(headed.page.url());
          if (u.host.endsWith('naver.com') && !u.host.startsWith('nid.')) return true;
        } catch {
          /* ignore */
        }
        return false;
      },
      timeoutMs,
      intervalMs: HEADED_POLL_INTERVAL_MS,
    });

    // Persist fresh session BEFORE tearing down the headed browser — the
    // file is the source of truth for the relaunch that follows.
    // H-02: atomic write via writeSession (tmp → rename) so a crash mid-
    // serialize cannot leave a truncated session file behind.
    await writeSession(cwd, (tmp) => headed.context.storageState({ path: tmp }));
  } finally {
    try {
      await headed.page.close();
    } catch {
      /* swallow */
    }
    try {
      await headed.context.close();
    } catch {
      /* swallow */
    }
    try {
      await headed.browser.close();
    } catch {
      /* swallow */
    }
  }

  // Relaunch HEADLESS with the fresh session (03-CONTEXT.md §specifics — file
  // is source of truth; do NOT reuse the headed context in memory).
  const launchHeadless =
    opts?.launchHeadless ??
    (async (storage?: string): Promise<AuthLaunchHandle> => {
      const b = await chromium.launch({ headless: true });
      const ctxInit: Parameters<Browser['newContext']>[0] = {};
      if (storage !== undefined) ctxInit.storageState = storage;
      const ctx = await b.newContext(ctxInit);
      const pg = await ctx.newPage();
      return { browser: b, context: ctx, page: pg };
    });
  const fresh = await launchHeadless(sessionPath);

  // Explicit tie-in with targetUrl for future logging (e.g., "relaunched
  // headless to resume " + targetUrl). Currently unused but reserved.
  void targetUrl;
  return fresh.page;
}
