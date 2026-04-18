import { describe, it, expect } from 'vitest';

import { CrawlError } from '../crawler/errors';
import {
  HEADED_POLL_INTERVAL_MS,
  HEADED_TIMEOUT_DEFAULT_MS,
  HEADED_TIMEOUT_ENV_VAR,
  pollUntilLoggedIn,
  resolveHeadedTimeoutMs,
} from './headed';

describe('headed — resolveHeadedTimeoutMs', () => {
  it('empty env → default 300_000ms', () => {
    expect(resolveHeadedTimeoutMs({})).toBe(300_000);
  });

  it('empty string → default 300_000ms', () => {
    expect(resolveHeadedTimeoutMs({ [HEADED_TIMEOUT_ENV_VAR]: '' })).toBe(300_000);
  });

  it('valid positive integer string → parsed value', () => {
    expect(resolveHeadedTimeoutMs({ [HEADED_TIMEOUT_ENV_VAR]: '60000' })).toBe(60_000);
  });

  it('non-numeric string → default fallback', () => {
    expect(resolveHeadedTimeoutMs({ [HEADED_TIMEOUT_ENV_VAR]: 'abc' })).toBe(300_000);
  });

  it('negative value → default fallback', () => {
    expect(resolveHeadedTimeoutMs({ [HEADED_TIMEOUT_ENV_VAR]: '-5' })).toBe(300_000);
  });

  it('non-integer (1.5) → default fallback', () => {
    expect(resolveHeadedTimeoutMs({ [HEADED_TIMEOUT_ENV_VAR]: '1.5' })).toBe(300_000);
  });

  it('zero → default fallback', () => {
    expect(resolveHeadedTimeoutMs({ [HEADED_TIMEOUT_ENV_VAR]: '0' })).toBe(300_000);
  });

  it('locked constants match 03-CONTEXT.md', () => {
    expect(HEADED_POLL_INTERVAL_MS).toBe(2000);
    expect(HEADED_TIMEOUT_DEFAULT_MS).toBe(300_000);
    expect(HEADED_TIMEOUT_ENV_VAR).toBe('CRAWL_HEADED_TIMEOUT_MS');
  });
});

describe('headed — pollUntilLoggedIn', () => {
  it('immediate success: isLoggedIn returns true on first call → sleep never invoked', async () => {
    let sleepCalls = 0;
    let probeCalls = 0;
    await pollUntilLoggedIn({
      isLoggedIn: async () => {
        probeCalls += 1;
        return true;
      },
      timeoutMs: 10_000,
      intervalMs: 100,
      sleep: async () => {
        sleepCalls += 1;
      },
      now: () => 0,
    });
    expect(probeCalls).toBe(1);
    expect(sleepCalls).toBe(0);
  });

  it('eventual success: resolves after N failed probes (deterministic clock)', async () => {
    const results = [false, false, true];
    let idx = 0;
    let fakeNow = 0;
    const intervalMs = 100;

    await pollUntilLoggedIn({
      isLoggedIn: async () => {
        const r = results[idx] ?? false;
        idx += 1;
        return r;
      },
      timeoutMs: 10_000,
      intervalMs,
      sleep: async (ms: number) => {
        fakeNow += ms;
      },
      now: () => fakeNow,
    });

    expect(idx).toBe(3); // called 3 times: false, false, true
  });

  it('timeout: deadline elapses before isLoggedIn returns true → CrawlError captcha_unresolved', async () => {
    const intervalMs = 100;
    const timeoutMs = 10_000;
    let fakeNow = 0;

    let threw: unknown;
    try {
      await pollUntilLoggedIn({
        isLoggedIn: async () => false,
        timeoutMs,
        intervalMs,
        sleep: async (ms: number) => {
          fakeNow += ms;
        },
        now: () => fakeNow,
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeInstanceOf(CrawlError);
    const e = threw as CrawlError;
    expect(e.code).toBe('captcha_unresolved');
    expect(e.message).toContain('10000ms');
  });

  it('non-interactive contract: source references no stdin / readline', () => {
    // Runtime-level proof: the compiled function body does not reference
    // `process.stdin` or `readline`. This complements the grep check in
    // the plan's acceptance criteria.
    expect(pollUntilLoggedIn.toString()).not.toContain('stdin');
    expect(pollUntilLoggedIn.toString()).not.toContain('readline');
  });
});
