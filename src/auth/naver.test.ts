import { describe, it, expect } from 'vitest';
import type { Page } from 'playwright';

import { CrawlError } from '../crawler/errors';
import {
  NAVER_LOGIN_URL,
  NAVER_SUBMIT_SELECTOR,
  readNaverCredentials,
  submitNaverLoginForm,
} from './naver';

// --- Fake Page helpers (type-only Playwright import; no browser involved). ---

type Call = { fn: string; args: unknown[] };
type FakeOverrides = Partial<
  Record<
    'fill' | 'click' | 'goto' | 'waitForLoadState',
    (...args: unknown[]) => Promise<unknown>
  >
>;

function makeFakePage(overrides: FakeOverrides = {}): { page: Page; calls: Call[] } {
  const calls: Call[] = [];
  const rec = (fn: string, args: unknown[]): void => {
    calls.push({ fn, args });
  };
  const impl = {
    goto:
      overrides.goto ??
      (async (...a: unknown[]) => {
        rec('goto', a);
        return null;
      }),
    fill:
      overrides.fill ??
      (async (...a: unknown[]) => {
        rec('fill', a);
      }),
    click:
      overrides.click ??
      (async (...a: unknown[]) => {
        rec('click', a);
      }),
    waitForLoadState:
      overrides.waitForLoadState ??
      (async (...a: unknown[]) => {
        rec('waitForLoadState', a);
      }),
  };
  // Cast through unknown — we only exercise the four methods above.
  return { page: impl as unknown as Page, calls };
}

describe('naver', () => {
  it('NAVER_LOGIN_URL equals the locked Naver endpoint', () => {
    expect(NAVER_LOGIN_URL).toBe('https://nid.naver.com/nidlogin.login');
  });

  it('readNaverCredentials: both vars missing → throws auth_missing_credentials mentioning BOTH names', () => {
    let threw: unknown;
    try {
      readNaverCredentials({});
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(CrawlError);
    const e = threw as CrawlError;
    expect(e.code).toBe('auth_missing_credentials');
    expect(e.message).toContain('NAVER_ID');
    expect(e.message).toContain('NAVER_PW');
  });

  it('readNaverCredentials: only NAVER_PW missing → error mentions NAVER_PW only', () => {
    let threw: unknown;
    try {
      readNaverCredentials({ NAVER_ID: 'x' });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(CrawlError);
    const e = threw as CrawlError;
    expect(e.code).toBe('auth_missing_credentials');
    expect(e.message).toContain('NAVER_PW');
    expect(e.message).not.toContain('NAVER_ID');
  });

  it('readNaverCredentials: NAVER_ID empty string → error mentions NAVER_ID only (empty counts as missing)', () => {
    let threw: unknown;
    try {
      readNaverCredentials({ NAVER_ID: '', NAVER_PW: 'y' });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(CrawlError);
    const e = threw as CrawlError;
    expect(e.code).toBe('auth_missing_credentials');
    expect(e.message).toContain('NAVER_ID');
    expect(e.message).not.toContain('NAVER_PW');
    // T-03-04 redaction: the secret value 'y' must NEVER appear in the
    // error message, even though NAVER_PW was set in the input env.
    expect(e.message).not.toContain('y');
  });

  it('readNaverCredentials: both set → returns {id, pw} unchanged', () => {
    const creds = readNaverCredentials({ NAVER_ID: 'xUser', NAVER_PW: 'yPass' });
    expect(creds).toEqual({ id: 'xUser', pw: 'yPass' });
  });

  it('submitNaverLoginForm: records goto → fill(#id) → fill(#pw) → click(NAVER_SUBMIT_SELECTOR) in order', async () => {
    const { page, calls } = makeFakePage();
    await submitNaverLoginForm(page, { id: 'u', pw: 'p' });

    // Filter out any trailing waitForLoadState — contract only pins the
    // first four calls' order.
    const fnOrder = calls.map((c) => c.fn);
    expect(fnOrder.slice(0, 4)).toEqual(['goto', 'fill', 'fill', 'click']);

    // goto target
    const call0 = calls[0];
    expect(call0).toBeDefined();
    expect(call0!.args[0]).toBe(NAVER_LOGIN_URL);

    // fill selectors
    const call1 = calls[1];
    const call2 = calls[2];
    expect(call1).toBeDefined();
    expect(call2).toBeDefined();
    expect(call1!.args[0]).toBe('#id');
    expect(call1!.args[1]).toBe('u');
    expect(call2!.args[0]).toBe('#pw');
    expect(call2!.args[1]).toBe('p');

    // click selector matches the exported constant
    const call3 = calls[3];
    expect(call3).toBeDefined();
    expect(call3!.args[0]).toBe(NAVER_SUBMIT_SELECTOR);
  });

  it('submitNaverLoginForm: fill() rejection → throws auth_failed without leaking credentials', async () => {
    const SECRET_ID = 'sekret-user-12345';
    const SECRET_PW = 'sekret-pass-67890';
    const { page } = makeFakePage({
      // Simulate Playwright's selector-not-found failure during fill.
      fill: async () => {
        throw new Error('selector #id not found');
      },
    });

    let threw: unknown;
    try {
      await submitNaverLoginForm(page, { id: SECRET_ID, pw: SECRET_PW });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(CrawlError);
    const e = threw as CrawlError;
    expect(e.code).toBe('auth_failed');
    // The underlying operation message is included for debugging…
    expect(e.message).toContain('login form submission failed');
    // …but the credential values themselves must never leak.
    expect(e.message).not.toContain(SECRET_ID);
    expect(e.message).not.toContain(SECRET_PW);
  });
});
