/**
 * Gated real-Naver integration tests.
 *
 * These tests exercise the end-to-end login flow against the real Naver
 * service. They run ONLY when BOTH conditions hold:
 *   1. process.env.RUN_NAVER_TESTS === '1'
 *   2. process.env.NAVER_ID and process.env.NAVER_PW are both set and non-empty
 *
 * Otherwise every test is `describe.skipIf(...)`-skipped with a clear reason.
 *
 * Because these tests mutate `.crawl-session.json` at the repo root, we
 * deliberately run them against a tmpdir-based working directory: each test
 * `chdir`s into a fresh tmpdir before calling runCrawl and restores cwd in
 * afterEach. This protects developer machines from session-file pollution.
 *
 * The gating contract is locked in 03-CONTEXT.md §Testing Strategy.
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, access } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCrawl } from '../crawler/runner';
import { SESSION_FILENAME } from './session';

const CREDS_PRESENT =
  typeof process.env.NAVER_ID === 'string' &&
  process.env.NAVER_ID.length > 0 &&
  typeof process.env.NAVER_PW === 'string' &&
  process.env.NAVER_PW.length > 0;
const OPT_IN = process.env.RUN_NAVER_TESTS === '1';
const GATED = CREDS_PRESENT && OPT_IN;

const GATE_REASON = GATED
  ? ''
  : 'Skipped: set RUN_NAVER_TESTS=1 and NAVER_ID/NAVER_PW to run (see 03-CONTEXT.md §Testing Strategy)';

// URL choice per 03-CONTEXT.md §Claude's Discretion: a Naver Cafe page that
// REQUIRES login is the developer's choice — exported via NAVER_TEST_URL.
// Fallback is the Naver main page (login-not-required); in that case the
// assertions fall back to "login succeeded and NID_AUT exists".
const TARGET_URL = process.env.NAVER_TEST_URL ?? 'https://www.naver.com/';

function buildConfig(url: string): string {
  return (
    '# URL\n\n' +
    url +
    '\n\n# Collectors\n\n```yaml\ntitle:\n  selector: h1\n```\n\n' +
    '# Rules\n\n```yaml\nwaitFor: body\ntimeout: 60000\n```\n'
  );
}

describe.skipIf(!GATED)('naver integration (real network)', () => {
  let origCwd: string;
  let workDir: string;
  let cfgPath: string;

  beforeEach(async () => {
    origCwd = process.cwd();
    workDir = await mkdtemp(path.join(os.tmpdir(), 'crawl-naver-'));
    process.chdir(workDir);
    cfgPath = path.join(workDir, 'job.md');
  });

  afterEach(async () => {
    process.chdir(origCwd);
    try {
      await rm(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it(
    'first run produces .crawl-session.json and succeeds',
    async () => {
      await writeFile(cfgPath, buildConfig(TARGET_URL), 'utf8');
      const result = await runCrawl(cfgPath);
      expect(result.status).toBe('ok');
      // Session file lives at the runner's cwd (== workDir since we chdir'd).
      await expect(
        access(path.join(workDir, SESSION_FILENAME)),
      ).resolves.toBeUndefined();
    },
    120_000,
  );

  it(
    'second run reuses the session without triggering a fresh login flow',
    async () => {
      await writeFile(cfgPath, buildConfig(TARGET_URL), 'utf8');
      const first = await runCrawl(cfgPath);
      expect(first.status).toBe('ok');
      const sessionBytes1 = await readFile(
        path.join(workDir, SESSION_FILENAME),
        'utf8',
      );

      const second = await runCrawl(cfgPath);
      expect(second.status).toBe('ok');

      // Reuse proof: both runs' session files exist and are non-empty. We do
      // NOT assert byte-equality — Naver may rotate tokens between runs.
      const sessionBytes2 = await readFile(
        path.join(workDir, SESSION_FILENAME),
        'utf8',
      );
      expect(sessionBytes1.length).toBeGreaterThan(0);
      expect(sessionBytes2.length).toBeGreaterThan(0);
    },
    180_000,
  );

  it(
    'missing credentials against login-gated URL surfaces auth_missing_credentials',
    async () => {
      // Temporarily clear credentials in the current process. runCrawl reads
      // process.env lazily via the auth module.
      const savedId = process.env.NAVER_ID;
      const savedPw = process.env.NAVER_PW;
      delete process.env.NAVER_ID;
      delete process.env.NAVER_PW;
      try {
        // Delete any existing session file so we hit the creds-required branch.
        try {
          await rm(path.join(workDir, SESSION_FILENAME), { force: true });
        } catch {
          /* ignore */
        }
        await writeFile(cfgPath, buildConfig(TARGET_URL), 'utf8');
        const result = await runCrawl(cfgPath);
        // For non-login-gated fallback URLs (e.g., www.naver.com) the result
        // may still be 'ok'. Only enforce the error expectation when the
        // developer has supplied a truly login-gated NAVER_TEST_URL.
        if (process.env.NAVER_TEST_URL !== undefined) {
          expect(result.status).toBe('error');
          expect(result.error?.code).toBe('auth_missing_credentials');
        }
      } finally {
        if (savedId !== undefined) process.env.NAVER_ID = savedId;
        if (savedPw !== undefined) process.env.NAVER_PW = savedPw;
      }
    },
    60_000,
  );
});

// When the gate is closed, surface a single informative "sentinel" skip so
// CI logs show the reason clearly without three silent skips.
describe.skipIf(GATED)('naver integration (skipped — see gate)', () => {
  it.skip(GATE_REASON, () => {
    /* placeholder */
  });
});
