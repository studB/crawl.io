/**
 * Per-field extraction against a Playwright Page / FrameLocator.
 *
 * This module is the **sole Phase-2 throw site** for `CrawlError('frame_not_found', ...)`
 * (02-03-PLAN.md key_links invariant). `frame.ts` is pure; frame-presence failures only
 * surface when a downstream `.textContent()` against a descended locator times out.
 *
 * Timeout semantics:
 *   - `rules.timeout` (config) is the page-load / waitFor budget — passed by the Plan-04
 *     runner to `page.goto` and to `waitForReady` here.
 *   - Per-field extraction uses a tight internal cap (DEFAULT_DEFAULT_EXTRACT_TIMEOUT_MS, 5000ms).
 *     A rendered page should return text in well under a second; keeping extraction isolated
 *     from the (much larger) page-load budget gives cleaner error attribution.
 *
 * Error classification when a per-field extraction call times out:
 *   - `spec.frame` declared and non-empty → `frame_not_found` (a frame along the path is
 *     missing — otherwise the locator would have resolved within the frame).
 *   - `spec.frame` not declared → `selector_miss` (element on the top page simply didn't match).
 *   - Any other caught error → `extraction_failed`.
 */

import type { Page } from 'playwright';

import type { SelectorSpec } from '../config/types';
import { CrawlError } from './errors';
import { descendToFrame } from './frame';

/**
 * Default per-field extraction budget (ms). Intentionally decoupled from
 * `rules.timeout` (which is the page-load / waitFor budget) — a rendered page
 * should return text in well under a second, so 5000ms is a generous ceiling
 * that still gives crisp error attribution when a selector truly misses.
 *
 * Exported (LW-02) so the runner JSDoc and any Phase-3 config surface can
 * reference the concrete value instead of repeating the magic number.
 * Renamed from `EXTRACT_TIMEOUT_MS` so the "default" nature is explicit at
 * the call site.
 */
export const DEFAULT_EXTRACT_TIMEOUT_MS = 5000;

/**
 * Compose the Playwright selector string for a given `SelectorSpec`.
 *
 *   - CSS  → selector passed through unchanged (Playwright's default engine).
 *   - XPath → prefixed with `xpath=` (Playwright's built-in XPath engine selector).
 *
 * Pure function. Does NOT validate the selector shape — a caller who marks an
 * XPath-looking string as `engine: 'css'` gets CSS behavior. Validation is the
 * Phase-1 Zod layer's job.
 */
export function toPlaywrightSelector(spec: SelectorSpec): string {
  if (spec.engine === 'xpath') {
    return 'xpath=' + spec.selector;
  }
  return spec.selector;
}

/**
 * Wait for the `waitFor` selector to appear on the top-level page, with timeout.
 *
 * - `waitFor === undefined` → no-op (the page-load timeout upstream still applies).
 * - Playwright's `TimeoutError` (detected by `err.name === 'TimeoutError'` — cross-version safe)
 *   is mapped to `CrawlError('timeout', detail)`.
 * - The detail string includes BOTH the selector and the timeout value, per 02-CONTEXT.md.
 * - Any other error is mapped to `CrawlError('unknown', message)`.
 */
export async function waitForReady(
  page: Page,
  waitFor: string | undefined,
  timeout: number,
): Promise<void> {
  if (waitFor === undefined) {
    return;
  }
  try {
    await page.waitForSelector(waitFor, { timeout });
  } catch (err) {
    const e = err as Error;
    if (e && e.name === 'TimeoutError') {
      throw new CrawlError(
        'timeout',
        'waitFor selector `' + waitFor + '` did not appear within ' + timeout + 'ms',
      );
    }
    throw new CrawlError('unknown', e?.message ?? String(err));
  }
}

/**
 * Resolve every selector against its declared frame (or the top page if `frame` is absent)
 * and return a `{ fieldName: textContent }` map.
 *
 * - Per-field errors attribute the field name in the error detail.
 * - A timeout with `spec.frame` declared is classified as `frame_not_found`; without
 *   `spec.frame` it is `selector_miss`.
 * - A `null` text content (element matched but has no text) is `selector_miss` too —
 *   the crawl contract is "extracted a field," and a null result is indistinguishable
 *   from "nothing to extract here" for the user.
 * - This is the **sole Phase-2 throw site** for `CrawlError('frame_not_found', ...)`.
 */
export async function extractFields(
  page: Page,
  selectors: Record<string, SelectorSpec>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  for (const [name, spec] of Object.entries(selectors)) {
    const target = descendToFrame(page, spec.frame);
    const pwSelector = toPlaywrightSelector(spec);

    try {
      const locator = target.locator(pwSelector);
      const text = await locator.first().textContent({ timeout: DEFAULT_EXTRACT_TIMEOUT_MS });
      if (text === null) {
        const detail = 'selector `' + spec.selector + '` for field `' + name + '` returned null';
        throw new CrawlError('selector_miss', detail);
      }
      out[name] = text.trim();
    } catch (err) {
      if (err instanceof CrawlError) {
        throw err;
      }
      const e = err as Error;
      if (e && e.name === 'TimeoutError') {
        if (spec.frame && spec.frame.length > 0) {
          const detail =
            'frame path ' + JSON.stringify(spec.frame) + ' not reachable for field `' + name + '`';
          throw new CrawlError('frame_not_found', detail);
        }
        const detail =
          'selector `' + spec.selector + '` for field `' + name +
          '` did not match within ' + DEFAULT_EXTRACT_TIMEOUT_MS + 'ms';
        throw new CrawlError('selector_miss', detail);
      }
      const detail = 'failed to extract `' + name + '`: ' + (e?.message ?? String(err));
      throw new CrawlError('extraction_failed', detail);
    }
  }

  return out;
}
