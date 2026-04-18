import { describe, it, expect, vi } from 'vitest';
import type { Page } from 'playwright';

import { toPlaywrightSelector, waitForReady } from './extract';
import { CrawlError } from './errors';

// These tests are PURE — we cast minimal `{ waitForSelector: vi.fn() }` objects
// to `Page` to exercise the error-mapping without launching a browser. The
// `import type { Page }` is a compile-time-only import (erased at runtime).

describe('toPlaywrightSelector', () => {
  it('returns a CSS selector unchanged', () => {
    expect(toPlaywrightSelector({ selector: '.title', engine: 'css' })).toBe('.title');
  });

  it('returns engine:css output verbatim even when the string looks like XPath (engine, not shape, decides)', () => {
    expect(toPlaywrightSelector({ selector: '//h1', engine: 'css' })).toBe('//h1');
  });

  it('prefixes an XPath selector with `xpath=`', () => {
    expect(toPlaywrightSelector({ selector: '//h1[@id="x"]', engine: 'xpath' })).toBe(
      'xpath=//h1[@id="x"]',
    );
  });

  it('does NOT validate selector content — empty XPath becomes `xpath=`', () => {
    expect(toPlaywrightSelector({ selector: '', engine: 'xpath' })).toBe('xpath=');
  });
});

describe('waitForReady', () => {
  it('maps Playwright TimeoutError to CrawlError("timeout", ...) with detail containing selector AND timeout value', async () => {
    const waitForSelector = vi.fn().mockImplementation(async () => {
      const err = new Error('timeout exceeded');
      err.name = 'TimeoutError';
      throw err;
    });
    const fakePage = { waitForSelector } as unknown as Page;

    let caught: unknown;
    try {
      await waitForReady(fakePage, '#post', 30_000);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CrawlError);
    const cerr = caught as CrawlError;
    expect(cerr.code).toBe('timeout');
    expect(cerr.detail).toBeDefined();
    // CONTEXT.md: detail must name BOTH the selector and the timeout value.
    expect(cerr.detail).toContain('#post');
    expect(cerr.detail).toContain('30000ms');
  });

  it('is a no-op when waitFor is undefined (never calls page.waitForSelector)', async () => {
    const waitForSelector = vi.fn();
    const fakePage = { waitForSelector } as unknown as Page;

    await waitForReady(fakePage, undefined, 30_000);

    expect(waitForSelector).toHaveBeenCalledTimes(0);
  });

  it('maps a non-TimeoutError to CrawlError("unknown", ...) carrying the original message', async () => {
    const waitForSelector = vi.fn().mockImplementation(async () => {
      const err = new Error('ERR_CONNECTION_REFUSED');
      // Explicit default name — this is NOT a TimeoutError.
      err.name = 'Error';
      throw err;
    });
    const fakePage = { waitForSelector } as unknown as Page;

    let caught: unknown;
    try {
      await waitForReady(fakePage, '#post', 5_000);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CrawlError);
    const cerr = caught as CrawlError;
    expect(cerr.code).toBe('unknown');
    expect(cerr.detail).toContain('ERR_CONNECTION_REFUSED');
  });
});
