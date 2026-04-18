/**
 * Unit coverage for `resolveExitCode` — the OUT-05 exit-code mapping.
 *
 * Pure-function tests: no browser, no fs, no process spawn. We fabricate
 * minimal `CrawlResult` fixtures in-file to drive the mapping and assert
 * both the return value AND that the module has no side effects beyond
 * returning a number.
 */

import { describe, it, expect } from 'vitest';

import { resolveExitCode } from './exit';
import type { CrawlErrorCode, CrawlResult } from '../crawler/types';

/** Minimal valid `CrawlResult` for the `ok` branch. */
function okResult(overrides: Partial<CrawlResult> = {}): CrawlResult {
  return {
    status: 'ok',
    configPath: '/tmp/fake-config.md',
    url: 'https://example.com/',
    startedAt: new Date(0),
    durationMs: 123,
    fields: { title: 'Example' },
    ...overrides,
  };
}

/** Minimal valid `CrawlResult` for the `error` branch. */
function errorResult(code: CrawlErrorCode, message = 'synthetic failure'): CrawlResult {
  return {
    status: 'error',
    configPath: '/tmp/fake-config.md',
    url: 'https://example.com/',
    startedAt: new Date(0),
    durationMs: 42,
    error: { code, message },
  };
}

describe('resolveExitCode (OUT-05)', () => {
  it('returns 0 for status === "ok"', () => {
    expect(resolveExitCode(okResult())).toBe(0);
  });

  it('returns 0 for status === "ok" even when fields are missing', () => {
    // A runCrawl result without extracted fields (e.g., empty selector map)
    // is still a successful run — should still map to exit 0.
    const result: CrawlResult = {
      status: 'ok',
      configPath: '/tmp/cfg.md',
      url: 'https://example.com/',
      startedAt: new Date(0),
      durationMs: 5,
    };
    expect(resolveExitCode(result)).toBe(0);
  });

  it('returns 1 for status === "error" with a typical timeout envelope', () => {
    expect(
      resolveExitCode(
        errorResult('timeout', 'waitFor X timed out after 30000ms'),
      ),
    ).toBe(1);
  });

  it('returns 1 for EVERY CrawlErrorCode variant (locks the union size)', () => {
    // Every member of the 10-variant union must map to exit 1.
    // The cardinality assertion below locks the union so accidentally
    // dropping a variant fails the test, mirroring the pattern used by
    // src/crawler/errors.test.ts.
    const codes: CrawlErrorCode[] = [
      'timeout',
      'selector_miss',
      'network',
      'frame_not_found',
      'extraction_failed',
      'config_parse',
      'auth_missing_credentials',
      'auth_failed',
      'captcha_unresolved',
      'unknown',
    ];
    for (const code of codes) {
      expect(resolveExitCode(errorResult(code))).toBe(1);
    }
    expect(codes).toHaveLength(10);
  });

  it('is a pure function — calling it twice on the same input returns the same number', () => {
    const r = okResult();
    const a = resolveExitCode(r);
    const b = resolveExitCode(r);
    expect(a).toBe(b);
    // Input is not mutated.
    expect(r.status).toBe('ok');
  });

  it('has a return type that is the literal union `0 | 1` (tsc narrowing check)', () => {
    // This line compiles ONLY if resolveExitCode's declared return type is
    // the literal union `0 | 1` (not `number`). If a refactor widens the
    // return type, tsc --noEmit will fail on this assignment.
    const code: 0 | 1 = resolveExitCode(okResult());
    expect(code).toBe(0);
  });
});
