/**
 * Unit coverage for `ensureAuthenticated` — the auth subsystem's single
 * entry point.
 *
 * Every test uses fake Playwright shapes (Page / BrowserContext / Browser)
 * type-cast through `unknown`. The fakes only implement the surface
 * `ensureAuthenticated` actually reaches for — cookies(), url(), locator,
 * storageState(), context(). No real Chromium is launched here, enforced at
 * the plan level by a negative grep acceptance gate over this file.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ensureAuthenticated, type AuthContextOptions, type AuthLaunchHandle } from './index';
import { CrawlError } from '../crawler/errors';
import { SESSION_FILENAME } from './session';

// --- Fake factories ---------------------------------------------------------

interface CookieRecord {
  readonly name: string;
  readonly value: string;
}

interface FakeState {
  url: string;
  cookies: CookieRecord[];
  /** Per-selector presence map for locator().count(). Defaults to 0. */
  selectorCounts: Map<string, number>;
  /**
   * Per-selector visibility map for locator().first().isVisible(). M-02:
   * a selector that matches a hidden element must NOT classify as captcha.
   * Defaults to `true` when the selector has a non-zero count — preserving
   * the pre-M-02 test semantics for all non-opting-in tests.
   */
  selectorVisible: Map<string, boolean>;
  /** Recorded storageState call paths. */
  storageStateCalls: Array<{ path: string | undefined }>;
  /** Incremented each time newPage/newContext/close is called on the browser side. */
  browserClosed: boolean;
}

/** Build a fake Page + BrowserContext + Browser tied to a shared FakeState. */
function makeFakeTrio(initial: Partial<FakeState> = {}): {
  page: import('playwright').Page;
  context: import('playwright').BrowserContext;
  browser: import('playwright').Browser;
  state: FakeState;
} {
  const state: FakeState = {
    url: initial.url ?? 'about:blank',
    cookies: initial.cookies ?? [],
    selectorCounts: initial.selectorCounts ?? new Map<string, number>(),
    selectorVisible: initial.selectorVisible ?? new Map<string, boolean>(),
    storageStateCalls: [],
    browserClosed: false,
  };

  const fakeLocator = (selector: string): unknown => ({
    count: async (): Promise<number> => state.selectorCounts.get(selector) ?? 0,
    // M-02: isCaptchaSelectorPresent now gates on visibility. Default visible
    // when not explicitly overridden — preserves prior positive-path tests.
    first: (): unknown => ({
      isVisible: async (): Promise<boolean> => {
        const explicit = state.selectorVisible.get(selector);
        if (explicit !== undefined) return explicit;
        return (state.selectorCounts.get(selector) ?? 0) > 0;
      },
    }),
  });

  const fakeContext = {
    cookies: async (): Promise<CookieRecord[]> => state.cookies.slice(),
    storageState: async (opts?: { path?: string }): Promise<unknown> => {
      state.storageStateCalls.push({ path: opts?.path });
      return {};
    },
  } as unknown as import('playwright').BrowserContext;

  const fakePage = {
    context: (): import('playwright').BrowserContext => fakeContext,
    url: (): string => state.url,
    locator: (selector: string): unknown => fakeLocator(selector),
    // submitNaverLoginForm / goto-style surface not needed for these tests —
    // we stub via the injectable launchers and the cookies-after-submit
    // fixture. But Playwright's `submitNaverLoginForm` IS called in the
    // success path; we satisfy its surface here (goto/fill/click/waitForLoadState).
    goto: async (): Promise<unknown> => ({}),
    fill: async (): Promise<void> => {
      /* no-op */
    },
    click: async (): Promise<void> => {
      /* no-op */
    },
    waitForLoadState: async (): Promise<void> => {
      /* no-op */
    },
    close: async (): Promise<void> => {
      /* no-op */
    },
  } as unknown as import('playwright').Page;

  const fakeBrowser = {
    close: async (): Promise<void> => {
      state.browserClosed = true;
    },
  } as unknown as import('playwright').Browser;

  return { page: fakePage, context: fakeContext, browser: fakeBrowser, state };
}

/**
 * Make a fake Page whose post-submit state (cookies + url) is driven by a
 * `onSubmit` hook. `submitNaverLoginForm` clicks the tolerant selector chain
 * — our fake `click` calls the hook, which flips the FakeState.
 */
function makeSubmittingTrio(onSubmit: (s: FakeState) => void): {
  page: import('playwright').Page;
  context: import('playwright').BrowserContext;
  browser: import('playwright').Browser;
  state: FakeState;
} {
  const trio = makeFakeTrio();
  const origClick = (trio.page as unknown as { click: () => Promise<void> }).click;
  // Replace click to also mutate the state AFTER the "click".
  (trio.page as unknown as { click: () => Promise<void> }).click = async (): Promise<void> => {
    await origClick();
    onSubmit(trio.state);
  };
  return trio;
}

// --- Test body --------------------------------------------------------------

describe('ensureAuthenticated', () => {
  const tmpDirs: string[] = [];

  afterEach(async () => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop() as string;
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  async function makeTmpCwd(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'auth-index-test-'));
    tmpDirs.push(dir);
    return dir;
  }

  it('returns the same page unchanged for a non-Naver host (fast path)', async () => {
    const { page, browser } = makeFakeTrio({
      url: 'https://example.com/x',
      cookies: [],
    });
    const cwd = await makeTmpCwd();

    const out = await ensureAuthenticated(page, 'https://example.com/x', browser, {
      env: {}, // no creds
      cwd,
    });
    expect(out).toBe(page);
  });

  it('session-reuse: returns the same page when NID_AUT + NID_SES are already present (no login attempted)', async () => {
    // If submitNaverLoginForm were called, it would navigate to NAVER_LOGIN_URL
    // via the fake page.goto. We assert on NOT mutating the url + NOT calling
    // storageState — indirect proof submit was not invoked.
    const { page, browser, state } = makeFakeTrio({
      url: 'https://cafe.naver.com/foo',
      cookies: [
        { name: 'NID_AUT', value: 'aaa' },
        { name: 'NID_SES', value: 'bbb' },
      ],
    });
    const cwd = await makeTmpCwd();

    const out = await ensureAuthenticated(page, 'https://cafe.naver.com/foo', browser, {
      env: {
        NAVER_ID: 'user@x.com',
        NAVER_PW: 'pw',
      },
      cwd,
    });
    expect(out).toBe(page);
    // No login submitted = no storageState save call (save happens only on
    // post-submit logged_in classification).
    expect(state.storageStateCalls.length).toBe(0);
  });

  it('throws CrawlError(auth_missing_credentials) when creds are missing AND no session file exists', async () => {
    const { page, browser } = makeFakeTrio({
      url: 'https://cafe.naver.com/foo',
      cookies: [],
    });
    const cwd = await makeTmpCwd(); // empty tmpdir — no session file

    await expect(
      ensureAuthenticated(page, 'https://cafe.naver.com/foo', browser, {
        env: {},
        cwd,
      }),
    ).rejects.toBeInstanceOf(CrawlError);

    try {
      await ensureAuthenticated(page, 'https://cafe.naver.com/foo', browser, {
        env: {},
        cwd,
      });
      throw new Error('should not reach here');
    } catch (e) {
      expect(e).toBeInstanceOf(CrawlError);
      const err = e as CrawlError;
      expect(err.code).toBe('auth_missing_credentials');
    }
  });

  it('returns the same page when creds are missing BUT a session file already exists (stale-session branch)', async () => {
    const { page, browser } = makeFakeTrio({
      url: 'https://cafe.naver.com/foo',
      cookies: [],
    });
    const cwd = await makeTmpCwd();
    // Plant a pre-existing session file.
    await writeFile(
      path.join(cwd, SESSION_FILENAME),
      JSON.stringify({ cookies: [], origins: [] }),
      'utf8',
    );

    const out = await ensureAuthenticated(page, 'https://cafe.naver.com/foo', browser, {
      env: {},
      cwd,
    });
    expect(out).toBe(page);
  });

  it('successful submit: writes session atomically via tmp → rename; final file lands at sessionFilePath(cwd)', async () => {
    const cwd = await makeTmpCwd();
    // After the fake "submit" (the click), flip cookies to include NID_AUT+NID_SES.
    const { page, browser, state } = makeSubmittingTrio((s) => {
      s.cookies = [
        { name: 'NID_AUT', value: 'aaa' },
        { name: 'NID_SES', value: 'bbb' },
      ];
    });
    state.url = 'https://cafe.naver.com/foo';

    // H-02 harness: the fake storageState call records its path arg, AND
    // actually writes a tiny payload to that path so writeSession can
    // rename it into place. This exercises the full tmp → rename ceremony
    // and lets us assert on the FINAL file location post-rename.
    const origStorageState = state.storageStateCalls;
    void origStorageState;
    const fakeCtxAsUnknown = (page.context() as unknown as {
      storageState: (opts?: { path?: string }) => Promise<unknown>;
    });
    fakeCtxAsUnknown.storageState = async (opts?: { path?: string }) => {
      state.storageStateCalls.push({ path: opts?.path });
      if (opts?.path !== undefined) {
        const { writeFile: wf } = await import('node:fs/promises');
        await wf(opts.path, '{"cookies":[],"origins":[]}', 'utf8');
      }
      return {};
    };

    const out = await ensureAuthenticated(page, 'https://cafe.naver.com/foo', browser, {
      env: { NAVER_ID: 'u', NAVER_PW: 'p' },
      cwd,
    });
    expect(out).toBe(page);
    // storageState was called once with a TMP path (not the final path).
    expect(state.storageStateCalls.length).toBe(1);
    const saved = state.storageStateCalls[0]?.path;
    expect(saved).toBeDefined();
    expect(saved).not.toBe(path.join(cwd, SESSION_FILENAME));
    expect(saved!.startsWith(path.join(cwd, SESSION_FILENAME) + '.tmp-')).toBe(true);
    // …and the FINAL file landed at the canonical path after rename.
    const { access } = await import('node:fs/promises');
    await expect(access(path.join(cwd, SESSION_FILENAME))).resolves.toBeUndefined();
  });

  it('auth_failed classification: post-submit cookies empty + URL not captcha → throws CrawlError(auth_failed)', async () => {
    const cwd = await makeTmpCwd();
    // Click does NOT flip cookies — submit happened but no session cookies
    // appeared. URL stays on nid.naver.com/nidlogin (login_required).
    const { page, browser, state } = makeSubmittingTrio((s) => {
      s.url = 'https://nid.naver.com/nidlogin.login';
    });
    state.url = 'https://cafe.naver.com/foo';

    let thrown: unknown;
    try {
      await ensureAuthenticated(page, 'https://cafe.naver.com/foo', browser, {
        env: { NAVER_ID: 'u', NAVER_PW: 'p' },
        cwd,
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(CrawlError);
    expect((thrown as CrawlError).code).toBe('auth_failed');
    // Storage state MUST NOT be saved on failed classification.
    expect(state.storageStateCalls.length).toBe(0);
  });

  it('M-02: captcha selector present but HIDDEN on a non-captcha URL → no headed fallback (classifies as unknown → auth_failed, not captcha)', async () => {
    const cwd = await makeTmpCwd();
    // Fake submit flips URL to a non-captcha Cafe page AND reports that
    // [id*=captcha] matches exactly one element BUT that element is NOT
    // visible (e.g., a hidden disclaimer div). Under M-02 the visibility
    // gate should suppress the captcha classification → the flow falls to
    // login_required/unknown → auth_failed, never triggering a headed
    // relaunch. Pre-M-02, the bare count()-gated probe would have classed
    // this as captcha and spun up a headed browser (the false-positive
    // 03-CONTEXT.md flagged).
    const { page, browser, state } = makeSubmittingTrio((s) => {
      s.url = 'https://cafe.naver.com/innocent-post';
      s.selectorCounts = new Map([['[id*=captcha]', 1]]);
      s.selectorVisible = new Map([['[id*=captcha]', false]]);
    });
    state.url = 'https://cafe.naver.com/innocent-post';

    // Sentinel launchers — if M-02 regresses and we DO enter the headed
    // fallback, these will be invoked and the assertion after will fail.
    const launchHeaded = vi.fn(
      async (_storage?: string): Promise<AuthLaunchHandle> => {
        throw new Error('headed fallback should NOT have been entered (M-02)');
      },
    );
    const launchHeadless = vi.fn(
      async (_storage?: string): Promise<AuthLaunchHandle> => {
        throw new Error('headless relaunch should NOT have been entered (M-02)');
      },
    );

    let thrown: unknown;
    try {
      await ensureAuthenticated(page, 'https://cafe.naver.com/innocent-post', browser, {
        env: { NAVER_ID: 'u', NAVER_PW: 'p' },
        cwd,
        launchHeaded,
        launchHeadless,
        onHeadedOpened: (): void => {
          /* silence */
        },
      });
    } catch (e) {
      thrown = e;
    }
    // Classification is NOT captcha → falls through to the auth_failed
    // branch (cookies empty after submit, URL not login). The critical
    // assertion is that launchHeaded was never called.
    expect(thrown).toBeInstanceOf(CrawlError);
    expect((thrown as CrawlError).code).toBe('auth_failed');
    expect(launchHeaded).toHaveBeenCalledTimes(0);
    expect(launchHeadless).toHaveBeenCalledTimes(0);
  });

  it('captcha classification: triggers headed fallback — launchHeaded then launchHeadless called once each', async () => {
    const cwd = await makeTmpCwd();
    // Fake submit flips URL to a captcha path → classifyPostLogin returns 'captcha'.
    const { page, browser } = makeSubmittingTrio((s) => {
      s.url = 'https://nid.naver.com/captcha/challenge';
    });
    // Sanity: page still reports the original URL to begin with (until click).
    // Fakes for the headed / headless relaunch:
    const headedCookies: CookieRecord[] = [
      { name: 'NID_AUT', value: 'fresh' },
      { name: 'NID_SES', value: 'fresh' },
    ];
    const fakeHeadedContext = {
      cookies: async (): Promise<CookieRecord[]> => headedCookies,
      // H-02: writeSession invokes this with a tmp path and expects the
      // callback to create the file so the subsequent rename succeeds.
      storageState: async (opts?: { path?: string }): Promise<unknown> => {
        if (opts?.path !== undefined) {
          const { writeFile: wf } = await import('node:fs/promises');
          await wf(opts.path, '{"cookies":[],"origins":[]}', 'utf8');
        }
        return {};
      },
      close: async (): Promise<void> => {
        /* no-op */
      },
    } as unknown as import('playwright').BrowserContext;
    const fakeHeadedPage = {
      context: (): import('playwright').BrowserContext => fakeHeadedContext,
      url: (): string => 'https://nid.naver.com/nidlogin.login',
      goto: async (): Promise<unknown> => ({}),
      close: async (): Promise<void> => {
        /* no-op */
      },
    } as unknown as import('playwright').Page;
    const fakeHeadedBrowser = {
      close: async (): Promise<void> => {
        /* no-op */
      },
    } as unknown as import('playwright').Browser;

    const fakeHeadlessContext = {
      cookies: async (): Promise<CookieRecord[]> => headedCookies,
    } as unknown as import('playwright').BrowserContext;
    const fakeHeadlessPage = {
      context: (): import('playwright').BrowserContext => fakeHeadlessContext,
      url: (): string => 'about:blank',
    } as unknown as import('playwright').Page;
    const fakeHeadlessBrowser = {} as import('playwright').Browser;

    const launchHeaded = vi.fn(
      async (_storage?: string): Promise<AuthLaunchHandle> => ({
        browser: fakeHeadedBrowser,
        context: fakeHeadedContext,
        page: fakeHeadedPage,
      }),
    );
    const launchHeadless = vi.fn(
      async (_storage?: string): Promise<AuthLaunchHandle> => ({
        browser: fakeHeadlessBrowser,
        context: fakeHeadlessContext,
        page: fakeHeadlessPage,
      }),
    );
    const onHeadedOpened = vi.fn((_ms: number) => {
      /* silence stderr */
    });

    const opts: AuthContextOptions = {
      env: { NAVER_ID: 'u', NAVER_PW: 'p' },
      cwd,
      launchHeaded,
      launchHeadless,
      onHeadedOpened,
    };

    const out = await ensureAuthenticated(
      page,
      'https://cafe.naver.com/foo',
      browser,
      opts,
    );

    // launchHeaded and launchHeadless each called exactly ONCE.
    expect(launchHeaded).toHaveBeenCalledTimes(1);
    expect(launchHeadless).toHaveBeenCalledTimes(1);
    // Called in order: headed first (captcha resolve), then headless (resume).
    // Compare invocationCallOrder for ordering proof.
    expect((launchHeaded.mock.invocationCallOrder[0] as number) <
      (launchHeadless.mock.invocationCallOrder[0] as number)).toBe(true);
    // onHeadedOpened called once with a finite timeout.
    expect(onHeadedOpened).toHaveBeenCalledTimes(1);
    const arg = onHeadedOpened.mock.calls[0]?.[0];
    expect(typeof arg).toBe('number');
    expect(arg).toBeGreaterThan(0);
    // Returned page is the NEW headless page — not the original one.
    expect(out).toBe(fakeHeadlessPage);
    expect(out).not.toBe(page);
  });
});
