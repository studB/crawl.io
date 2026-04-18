/**
 * Unit coverage for the runner's auth wiring.
 *
 * These tests stub `../auth/index` + `../auth/session` + `./browser` at the
 * module boundary — no real Chromium launch, no filesystem session file.
 *
 * What the runner owes us in Phase 3:
 *
 *   1. Auth errors thrown by `ensureAuthenticated` surface through the
 *      existing CrawlResult envelope unchanged (code + message + scrubbed).
 *   2. `ensureAuthenticated` is called with the SAME url the config declared.
 *   3. Happy path: when auth resolves with the same page, runCrawl proceeds
 *      to goto + waitForReady + extractFields and returns `{ status: 'ok' }`.
 *   4. scrubPaths is applied to the envelope error.message so home-dir paths
 *      in an upstream error do not reach the committed markdown.
 *   5. No `process.exit` — runCrawl returns for every path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { CrawlError } from './errors';

// ---------------------------------------------------------------------------
// Module mocks — MUST be registered before `import { runCrawl }` below.
// Vitest hoists `vi.mock` calls so this works at file scope.
// ---------------------------------------------------------------------------

vi.mock('../auth/index', () => ({
  ensureAuthenticated: vi.fn(),
}));

vi.mock('../auth/session', () => ({
  sessionExists: vi.fn(async () => false),
  sessionFilePath: vi.fn((cwd?: string) =>
    path.join(cwd ?? process.cwd(), '.crawl-session.json'),
  ),
}));

vi.mock('./browser', () => {
  // Build a generic fake BrowserHandle whose page / context / browser shapes
  // are rich enough for waitForReady + extractFields + goto to resolve.
  return {
    launchBrowser: vi.fn(async () => {
      const fakeContext = {
        cookies: async () => [],
        storageState: async () => ({}),
      };
      const fakePage = {
        context: () => fakeContext,
        url: () => 'about:blank',
        goto: vi.fn(async () => ({})),
        waitForSelector: vi.fn(async () => ({})),
        locator: vi.fn((_sel: string) => ({
          first: () => ({
            textContent: async () => 'extracted-text',
            evaluate: async () => 'extracted-text',
          }),
          count: async () => 1,
        })),
        frameLocator: vi.fn(() => ({})),
        close: async () => {},
      };
      const fakeBrowser = { close: async () => {} };
      return { browser: fakeBrowser, context: fakeContext, page: fakePage };
    }),
    closeBrowser: vi.fn(async () => {}),
  };
});

// Also stub `./extract` so a happy-path test does not require the full
// Playwright-driven extraction logic to work against our fake Page.
vi.mock('./extract', () => ({
  waitForReady: vi.fn(async () => {}),
  extractFields: vi.fn(async () => ({ title: 'Top Level' })),
}));

// Now import the runner and the mocked modules (after the vi.mock calls).
import { runCrawl } from './runner';
import * as authModule from '../auth/index';

// Utility — build a minimal well-formed markdown config.
function buildConfig(url: string): string {
  return (
    '# URL\n\n' +
    url +
    '\n\n# Selectors\n\n```yaml\ntitle:\n  selector: "#top-title"\n  engine: css\n```\n\n' +
    '# Rules\n\n```yaml\nwaitFor: "#top-title"\ntimeout: 10000\n```\n'
  );
}

describe('runCrawl — auth integration (Phase 3 wiring)', () => {
  let tmpDir: string;
  let cfgPath: string;
  const NAVER_URL = 'https://cafe.naver.com/fake-cafe/123';

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'runner-auth-test-'));
    cfgPath = path.join(tmpDir, 'job.md');
    vi.clearAllMocks();
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('auth_missing_credentials thrown by ensureAuthenticated surfaces through the envelope', async () => {
    await writeFile(cfgPath, buildConfig(NAVER_URL), 'utf8');
    vi.mocked(authModule.ensureAuthenticated).mockRejectedValueOnce(
      new CrawlError(
        'auth_missing_credentials',
        'NAVER_ID and NAVER_PW must both be set to log into ' + NAVER_URL,
      ),
    );

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('auth_missing_credentials');
    expect(result.error?.message).toContain('NAVER_ID');
    expect(result.error?.message).toContain('NAVER_PW');
    expect(result.url).toBe(NAVER_URL);
  });

  it('auth_failed thrown by ensureAuthenticated surfaces as code=auth_failed', async () => {
    await writeFile(cfgPath, buildConfig(NAVER_URL), 'utf8');
    vi.mocked(authModule.ensureAuthenticated).mockRejectedValueOnce(
      new CrawlError('auth_failed', 'login form submission failed: net::ERR_ABORTED'),
    );

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('auth_failed');
    expect(result.error?.message).toContain('login form submission failed');
  });

  it('captcha_unresolved thrown by ensureAuthenticated surfaces as code=captcha_unresolved', async () => {
    await writeFile(cfgPath, buildConfig(NAVER_URL), 'utf8');
    vi.mocked(authModule.ensureAuthenticated).mockRejectedValueOnce(
      new CrawlError(
        'captcha_unresolved',
        'headed login did not complete within 300000ms',
      ),
    );

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('captcha_unresolved');
    expect(result.error?.message).toContain('300000ms');
  });

  it('scrubPaths is applied to the envelope error.message — home-dir paths become <HOME>', async () => {
    await writeFile(cfgPath, buildConfig(NAVER_URL), 'utf8');
    // Plant a home-dir path inside the thrown error message. scrubPaths
    // recognizes /home/<user>/... unconditionally (see src/crawler/output.ts
    // substitution #2), regardless of what homedir() returns on this host.
    vi.mocked(authModule.ensureAuthenticated).mockRejectedValueOnce(
      new CrawlError(
        'auth_failed',
        'session write failed at /home/alice/secret/.crawl-session.json',
      ),
    );

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('auth_failed');
    // The scrubbed envelope must NOT contain the literal user path prefix,
    // and MUST contain the <HOME> placeholder.
    expect(result.error?.message).toContain('<HOME>');
    expect(result.error?.message).not.toContain('/home/alice');
  });

  it('ensureAuthenticated receives the exact URL string from the parsed config', async () => {
    await writeFile(cfgPath, buildConfig(NAVER_URL), 'utf8');
    // Make the happy path: return the SAME page the runner handed us.
    vi.mocked(authModule.ensureAuthenticated).mockImplementationOnce(
      async (page, _url, _browser) => page,
    );

    await runCrawl(cfgPath);

    expect(vi.mocked(authModule.ensureAuthenticated)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(authModule.ensureAuthenticated).mock.calls[0];
    // Arg 2 is the targetUrl; it must equal the config's URL.
    expect(call?.[1]).toBe(NAVER_URL);
  });

  it('happy path: ensureAuthenticated resolves with the same page → runCrawl returns status=ok with fields', async () => {
    await writeFile(cfgPath, buildConfig(NAVER_URL), 'utf8');
    vi.mocked(authModule.ensureAuthenticated).mockImplementationOnce(
      async (page, _url, _browser) => page,
    );

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('ok');
    expect(result.url).toBe(NAVER_URL);
    // extractFields is stubbed to return { title: 'Top Level' }.
    expect(result.fields).toEqual({ title: 'Top Level' });
    expect(result.error).toBeUndefined();
  });
});
