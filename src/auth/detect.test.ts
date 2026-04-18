import { describe, it, expect } from 'vitest';

import {
  CAPTCHA_SELECTORS,
  CAPTCHA_URL_REGEX,
  NAVER_AUTH_COOKIES,
  classifyPostLogin,
  hasNaverSessionCookies,
  isNaverHost,
  urlLooksLikeCaptcha,
  urlLooksLikeNaverLogin,
} from './detect';

describe('detect', () => {
  // --- isNaverHost ---

  it('isNaverHost: cafe.naver.com is a Naver host', () => {
    expect(isNaverHost('https://cafe.naver.com/x')).toBe(true);
  });

  it('isNaverHost: www.naver.com is a Naver host', () => {
    expect(isNaverHost('https://www.naver.com/')).toBe(true);
  });

  it('isNaverHost: legitimate subdomain (evil.naver.com) is a Naver host', () => {
    // This is a legitimate Naver subdomain — `host.endsWith('naver.com')` must
    // return true so Naver's own subdomains (cafe., blog., nid., etc.) work.
    expect(isNaverHost('https://evil.naver.com/')).toBe(true);
  });

  it('isNaverHost: suffix-attack domain (evil-naver.com.example) is NOT a Naver host', () => {
    // `URL.host` parses to `evil-naver.com.example`, which does NOT end with
    // `naver.com` — the hyphen makes the second-to-last label different.
    expect(isNaverHost('https://evil-naver.com.example/')).toBe(false);
  });

  it('isNaverHost: malformed / non-Naver URLs return false', () => {
    // `https://malformed` parses to a valid URL with host `malformed`, which
    // does not end with `naver.com` — returns false via the non-match path.
    expect(isNaverHost('https://malformed')).toBe(false);
    // Truly unparseable strings hit the try/catch and return false.
    expect(isNaverHost('not a url at all')).toBe(false);
    expect(isNaverHost('')).toBe(false);
  });

  // --- urlLooksLikeCaptcha ---

  it('urlLooksLikeCaptcha: /captcha path matches', () => {
    expect(urlLooksLikeCaptcha('https://nid.naver.com/captcha/foo')).toBe(true);
  });

  it('urlLooksLikeCaptcha: /login/otp path matches', () => {
    expect(urlLooksLikeCaptcha('https://nid.naver.com/login/otp')).toBe(true);
  });

  it('urlLooksLikeCaptcha: normal post URL does NOT match', () => {
    expect(urlLooksLikeCaptcha('https://cafe.naver.com/post/123')).toBe(false);
  });

  it('urlLooksLikeCaptcha: "sms" fragment and /login-verify match (intentional)', () => {
    expect(urlLooksLikeCaptcha('https://x/sms-verify')).toBe(true);
    expect(urlLooksLikeCaptcha('https://x/login-verify')).toBe(true);
  });

  // --- urlLooksLikeNaverLogin ---

  it('urlLooksLikeNaverLogin: nid.naver.com/nidlogin.login matches', () => {
    expect(urlLooksLikeNaverLogin('https://nid.naver.com/nidlogin.login')).toBe(true);
  });

  it('urlLooksLikeNaverLogin: unrelated URL does NOT match', () => {
    expect(urlLooksLikeNaverLogin('https://cafe.naver.com/post/1')).toBe(false);
  });

  // --- hasNaverSessionCookies ---

  it('hasNaverSessionCookies: both NID_AUT and NID_SES present → true', () => {
    expect(
      hasNaverSessionCookies([
        { name: 'NID_AUT', value: 'a' },
        { name: 'NID_SES', value: 'b' },
      ]),
    ).toBe(true);
  });

  it('hasNaverSessionCookies: only NID_AUT present → false', () => {
    expect(hasNaverSessionCookies([{ name: 'NID_AUT', value: 'a' }])).toBe(false);
  });

  it('hasNaverSessionCookies: empty-value cookie does NOT count', () => {
    expect(
      hasNaverSessionCookies([
        { name: 'NID_AUT', value: '' },
        { name: 'NID_SES', value: 'b' },
      ]),
    ).toBe(false);
  });

  it('hasNaverSessionCookies: empty cookie list → false', () => {
    expect(hasNaverSessionCookies([])).toBe(false);
  });

  // --- classifyPostLogin ---

  it('classifyPostLogin: captcha URL → "captcha"', () => {
    expect(
      classifyPostLogin({
        currentUrl: 'https://nid.naver.com/captcha',
        cookies: [],
        captchaSelectorHits: [false, false, false, false],
      }),
    ).toBe('captcha');
  });

  it('classifyPostLogin: both session cookies on a regular page → "logged_in"', () => {
    expect(
      classifyPostLogin({
        currentUrl: 'https://cafe.naver.com/x',
        cookies: [
          { name: 'NID_AUT', value: 'a' },
          { name: 'NID_SES', value: 'b' },
        ],
        captchaSelectorHits: [false, false, false, false],
      }),
    ).toBe('logged_in');
  });

  it('classifyPostLogin: redirected to nidlogin.login with no cookies → "login_required"', () => {
    expect(
      classifyPostLogin({
        currentUrl: 'https://nid.naver.com/nidlogin.login',
        cookies: [],
        captchaSelectorHits: [false, false, false, false],
      }),
    ).toBe('login_required');
  });

  it('classifyPostLogin: selector hit takes priority even without captcha URL', () => {
    expect(
      classifyPostLogin({
        currentUrl: 'https://cafe.naver.com/x',
        cookies: [],
        captchaSelectorHits: [true, false, false, false],
      }),
    ).toBe('captcha');
  });

  it('classifyPostLogin: no signals at all → "unknown"', () => {
    expect(
      classifyPostLogin({
        currentUrl: 'https://cafe.naver.com/x',
        cookies: [],
        captchaSelectorHits: [false, false, false, false],
      }),
    ).toBe('unknown');
  });

  // --- Locked constants ---

  it('CAPTCHA_SELECTORS contains exactly the four locked strings', () => {
    expect(CAPTCHA_SELECTORS.length).toBe(4);
    expect(new Set(CAPTCHA_SELECTORS)).toEqual(
      new Set(['img[src*=captcha]', '#captcha', '[id*=captcha]', 'iframe[src*=captcha]']),
    );
  });

  it('NAVER_AUTH_COOKIES contains exactly ["NID_AUT", "NID_SES"]', () => {
    expect([...NAVER_AUTH_COOKIES]).toEqual(['NID_AUT', 'NID_SES']);
  });

  it('CAPTCHA_URL_REGEX is case-insensitive', () => {
    expect(CAPTCHA_URL_REGEX.flags).toContain('i');
    expect(CAPTCHA_URL_REGEX.test('/CAPTCHA')).toBe(true);
    expect(CAPTCHA_URL_REGEX.test('/OTP')).toBe(true);
  });
});
