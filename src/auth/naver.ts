/**
 * Naver-specific login-form logic.
 *
 * Reads NAVER_ID / NAVER_PW from process.env (ONLY here — no other auth
 * module touches env vars, so redaction behavior is localized).
 *
 * Fills and submits the login form given a typed `Page`. Pure Playwright
 * page operations — does NOT decide whether the login succeeded; that is
 * `detect.ts`'s job post-submit.
 *
 * SECURITY (T-03-04 mitigation): credential values NEVER appear in thrown
 * error messages. The only places `creds.id` / `creds.pw` are read are the
 * two `page.fill` calls — the boundary is enforced by test #6 and by the
 * `auth_failed` error path explicitly avoiding any interpolation of the
 * credentials object.
 */

import type { Page } from 'playwright';

import { CrawlError } from '../crawler/errors';

/** Locked in 03-CONTEXT.md §Captcha / 2FA Detection & Headed Fallback. */
export const NAVER_LOGIN_URL = 'https://nid.naver.com/nidlogin.login';

/**
 * Tolerant submit-button selector chain. Naver's button id contains a dot
 * (`log.login`) which is escaped for CSS; we try several shapes because
 * 03-CONTEXT.md §Claude's Discretion flags Naver UI drift as acceptable.
 * The commas make this a CSS selector-list — Playwright picks the first
 * match.
 */
export const NAVER_SUBMIT_SELECTOR =
  '#log\\.login, .btn_login, button[type=submit], input[type=submit]';

export interface NaverCredentials {
  readonly id: string;
  readonly pw: string;
}

/**
 * Read credentials from env. Throws `CrawlError('auth_missing_credentials')`
 * if either var is unset or empty.
 *
 * SECURITY: error messages never include the ID or PW values — only names.
 */
export function readNaverCredentials(
  env: NodeJS.ProcessEnv = process.env,
): NaverCredentials {
  const id = env.NAVER_ID;
  const pw = env.NAVER_PW;
  const missing: string[] = [];
  if (id === undefined || id.length === 0) missing.push('NAVER_ID');
  if (pw === undefined || pw.length === 0) missing.push('NAVER_PW');
  if (missing.length > 0) {
    throw new CrawlError(
      'auth_missing_credentials',
      'missing env var' + (missing.length === 1 ? '' : 's') + ': ' + missing.join(', '),
    );
  }
  // id and pw are defined and non-empty here — narrow with non-null
  // assertion at the return site (safe because of the checks above).
  return { id: id!, pw: pw! };
}

/**
 * Navigate a typed `Page` to the Naver login URL and submit the form with
 * the supplied credentials. Does NOT verify success — the caller inspects
 * cookies / URL via `detect.classifyPostLogin` after this resolves.
 *
 * The method is deliberately tolerant of Naver UI drift (selector fallback
 * chains) and uses `page.fill` / `page.click` (which have their own small
 * Playwright timeouts — relying on the default here is fine since this is
 * a guarded step inside the overall `rules.timeout` budget).
 *
 * SECURITY: the `auth_failed` error wraps only the underlying operation
 * message, NEVER the credential values themselves.
 */
export async function submitNaverLoginForm(
  page: Page,
  creds: NaverCredentials,
  opts?: { timeout?: number },
): Promise<void> {
  const timeout = opts?.timeout;
  try {
    // Explicit timeout passed through only when defined — exactOptional-
    // PropertyTypes forbids `{ timeout: undefined }`.
    const gotoOpts: Parameters<Page['goto']>[1] = {};
    if (timeout !== undefined) gotoOpts.timeout = timeout;
    await page.goto(NAVER_LOGIN_URL, gotoOpts);

    await page.fill('#id', creds.id);
    await page.fill('#pw', creds.pw);
    await page.click(NAVER_SUBMIT_SELECTOR);
    // Give the navigation/XHR a chance to settle before the caller samples
    // cookies. We tolerate a race here — `detect.classifyPostLogin` is the
    // source of truth, this is just a best-effort settle.
    await page.waitForLoadState('networkidle').catch(() => {
      /* tolerate races */
    });
  } catch (err) {
    const e = err as Error;
    // NEVER include creds.id or creds.pw in the error — the boundary is:
    // credentials live only in the NaverCredentials value; error messages
    // report only the operation that failed.
    throw new CrawlError(
      'auth_failed',
      'login form submission failed: ' + (e?.message ?? String(err)),
    );
  }
}
