/**
 * Integration tests for browser + frame + extract.
 *
 * These tests drive a real Chromium instance against the three local HTML
 * fixtures under `test/fixtures/nested-iframes/`. The fixtures form a two-
 * level iframe chain (index → level-1 → level-2) and the deepest page holds
 * the `DEEP_CONTENT_SENTINEL` text — the assertion target for CRWL-06.
 *
 * CRWL requirement coverage:
 *   Test 1 — CRWL-04, CRWL-07 (top-level CSS extraction)
 *   Test 2 — CRWL-05, CRWL-07 (top-level XPath extraction of the SAME element)
 *   Test 3 — CRWL-06       (2-level nested iframe descent with CSS; the headline CRWL-06 test)
 *   Test 4 — CRWL-06       (2-level nested iframe descent with XPath)
 *   Test 5 — frame_not_found throw-site invariant (key_links)
 *   Test 6 — CRWL-03       (waitForReady timeout with selector + timeout in detail)
 *
 * Each test spins up its own browser handle to keep test isolation simple; 60s
 * testTimeout (vitest.config.ts) leaves ample headroom.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';

import { launchBrowser, closeBrowser } from './browser';
import { extractFields, waitForReady } from './extract';
import { CrawlError } from './errors';
import type { SelectorSpec } from '../config/types';

// Repo-relative fixture URL — independent of cwd because __dirname is resolved by
// the test runner and path.resolve handles the `../..` climb from src/crawler/.
const fixtureUrl =
  'file://' + path.resolve(__dirname, '../../test/fixtures/nested-iframes/index.html');

describe('extract integration — real Chromium + file:// fixtures', () => {
  it('extracts a top-level element via CSS (CRWL-04, CRWL-07)', async () => {
    const handle = await launchBrowser();
    try {
      await handle.page.goto(fixtureUrl, { timeout: 10_000 });
      const selectors: Record<string, SelectorSpec> = {
        title: { selector: '#top-title', engine: 'css' },
      };
      const result = await extractFields(handle.page, selectors);
      expect(result).toEqual({ title: 'Top Level' });
    } finally {
      await closeBrowser(handle);
    }
  });

  it('extracts the SAME top-level element via XPath (CRWL-05 cross-check)', async () => {
    const handle = await launchBrowser();
    try {
      await handle.page.goto(fixtureUrl, { timeout: 10_000 });
      const selectors: Record<string, SelectorSpec> = {
        title: { selector: '//*[@id="top-title"]', engine: 'xpath' },
      };
      const result = await extractFields(handle.page, selectors);
      expect(result).toEqual({ title: 'Top Level' });
    } finally {
      await closeBrowser(handle);
    }
  });

  it('descends two iframe levels and extracts the deep sentinel via CSS (CRWL-06)', async () => {
    const handle = await launchBrowser();
    try {
      await handle.page.goto(fixtureUrl, { timeout: 10_000 });
      const selectors: Record<string, SelectorSpec> = {
        deep: {
          selector: '#deep-target',
          engine: 'css',
          frame: ['iframe#level-1-frame', 'iframe#level-2-frame'],
        },
      };
      const result = await extractFields(handle.page, selectors);
      expect(result).toEqual({ deep: 'DEEP_CONTENT_SENTINEL' });
    } finally {
      await closeBrowser(handle);
    }
  });

  it('descends two iframe levels and extracts the deep sentinel via XPath (CRWL-06 XPath variant)', async () => {
    const handle = await launchBrowser();
    try {
      await handle.page.goto(fixtureUrl, { timeout: 10_000 });
      const selectors: Record<string, SelectorSpec> = {
        deep: {
          selector: '//*[@id="deep-target"]',
          engine: 'xpath',
          frame: ['iframe#level-1-frame', 'iframe#level-2-frame'],
        },
      };
      const result = await extractFields(handle.page, selectors);
      expect(result).toEqual({ deep: 'DEEP_CONTENT_SENTINEL' });
    } finally {
      await closeBrowser(handle);
    }
  });

  it('throws CrawlError("frame_not_found", ...) when a declared iframe is missing (extract.ts sole throw site)', async () => {
    const handle = await launchBrowser();
    try {
      await handle.page.goto(fixtureUrl, { timeout: 10_000 });
      const selectors: Record<string, SelectorSpec> = {
        deep: {
          selector: '#deep-target',
          engine: 'css',
          frame: ['iframe#does-not-exist'],
        },
      };

      let caught: unknown;
      try {
        await extractFields(handle.page, selectors);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CrawlError);
      const cerr = caught as CrawlError;
      expect(cerr.code).toBe('frame_not_found');
      // Detail should attribute the field and include the offending frame path.
      expect(cerr.detail).toContain('deep');
      expect(cerr.detail).toContain('iframe#does-not-exist');
    } finally {
      await closeBrowser(handle);
    }
  });

  it('waitForReady maps Playwright timeout to CrawlError("timeout", ...) with selector + timeout value in detail (CRWL-03)', async () => {
    const handle = await launchBrowser();
    try {
      // A page that will never render `#never` — waitForReady must reject.
      await handle.page.goto('data:text/html,<h1>hi</h1>', { timeout: 10_000 });

      let caught: unknown;
      try {
        await waitForReady(handle.page, '#never', 2_000);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CrawlError);
      const cerr = caught as CrawlError;
      expect(cerr.code).toBe('timeout');
      expect(cerr.detail).toContain('#never');
      expect(cerr.detail).toContain('2000ms');
    } finally {
      await closeBrowser(handle);
    }
  });
});
