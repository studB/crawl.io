/**
 * Pure classifiers for the auth subsystem.
 *
 * Everything here is a function of its arguments — no Playwright imports
 * (not even type-only), no I/O, no env vars. Callers (runner.ts via
 * auth/index.ts) gather the facts with Playwright and hand them in.
 *
 * The priority ordering in `classifyPostLogin` is deliberate (see function
 * doc). Per 03-CONTEXT.md §Claude's Discretion: captcha false POSITIVES are
 * worse than false negatives because a false positive drags the user into
 * an unnecessary headed session — hence the regex is intentionally narrow
 * and the selector list is kept small + specific.
 */

/** Cookie shape we need — subset of Playwright's Cookie; avoids the import. */
export interface CookieLike {
  readonly name: string;
  readonly value: string;
}

/** Result of classifying a post-goto page state. */
export type AuthClassification =
  | 'logged_in'
  | 'captcha'
  | 'login_required'
  | 'unknown';

/** Selectors whose presence indicates a captcha/2FA challenge (multi-signal OR). */
export const CAPTCHA_SELECTORS: readonly string[] = [
  'img[src*=captcha]',
  '#captcha',
  '[id*=captcha]',
  'iframe[src*=captcha]',
];

/**
 * URL-path regex for captcha/2FA routes. Case-insensitive; conservative —
 * per 03-CONTEXT.md §Claude's Discretion, false positives are worse than
 * false negatives because a false positive drags the user into an
 * unnecessary headed session.
 *
 * H-01 narrowing (2026-04-18 review): each sub-pattern is now anchored to a
 * path-segment boundary so legitimate paths like `/capture-tutorial`,
 * `?tag=smstoday`, or `/asmspace/` do NOT match. The prior `\/cap` alias was
 * dropped (subsumed by `\/captcha`) and the bare `sms` anchor was replaced
 * with segment-anchored shapes that cover the real SMS-verify route space:
 *
 *   - `/captcha`, `/captcha/x`, `/captcha?x=1`, `/captcha` at EOL
 *   - `/otp`,     `/otp/x`,     `/otp?x=1`,     `/otp`     at EOL
 *   - `/login-verify` (followed by anything or EOL)
 *   - `/sms`,     `/sms/x`,     `/sms?x=1`,     `/sms`     at EOL
 */
export const CAPTCHA_URL_REGEX =
  /\/captcha(?:[/?]|$)|\/otp(?:[/?]|$)|\/login-verify|\/sms(?:[/?]|$)/i;

/** Success cookie names — BOTH must be present (locked in 03-CONTEXT.md). */
export const NAVER_AUTH_COOKIES = ['NID_AUT', 'NID_SES'] as const;

/** `true` iff the URL's host ends with `naver.com` (exact lock from 03-CONTEXT.md §When to Attempt Login). */
export function isNaverHost(url: string): boolean {
  try {
    return new URL(url).host.endsWith('naver.com');
  } catch {
    return false;
  }
}

/** `true` iff BOTH `NID_AUT` and `NID_SES` cookies are present and non-empty. */
export function hasNaverSessionCookies(cookies: readonly CookieLike[]): boolean {
  const names = new Set(cookies.filter((c) => c.value.length > 0).map((c) => c.name));
  return NAVER_AUTH_COOKIES.every((n) => names.has(n));
}

/** `true` iff the URL matches the captcha route regex. */
export function urlLooksLikeCaptcha(url: string): boolean {
  try {
    const u = new URL(url);
    return CAPTCHA_URL_REGEX.test(u.pathname + u.search);
  } catch {
    return CAPTCHA_URL_REGEX.test(url);
  }
}

/** `true` iff the URL suggests we were redirected to the Naver login page. */
export function urlLooksLikeNaverLogin(url: string): boolean {
  try {
    const u = new URL(url);
    return u.host === 'nid.naver.com' && u.pathname.includes('/nidlogin');
  } catch {
    return false;
  }
}

export interface ClassifyInput {
  readonly currentUrl: string;
  readonly cookies: readonly CookieLike[];
  /** For each selector in CAPTCHA_SELECTORS, was the selector present on the page? */
  readonly captchaSelectorHits: readonly boolean[];
}

/**
 * Classify the post-goto / post-submit page state. Priority order:
 *   1. Captcha URL OR any captcha selector hit → 'captcha'.
 *   2. Both Naver session cookies present → 'logged_in'.
 *   3. URL looks like the Naver login page → 'login_required'.
 *   4. Otherwise → 'unknown' (caller decides whether to treat as logged_in).
 */
export function classifyPostLogin(input: ClassifyInput): AuthClassification {
  if (urlLooksLikeCaptcha(input.currentUrl)) return 'captcha';
  if (input.captchaSelectorHits.some((hit) => hit)) return 'captcha';
  if (hasNaverSessionCookies(input.cookies)) return 'logged_in';
  if (urlLooksLikeNaverLogin(input.currentUrl)) return 'login_required';
  return 'unknown';
}
