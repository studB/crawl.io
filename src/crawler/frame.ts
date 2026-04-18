/**
 * Nested-iframe descent helper.
 *
 * Pure, synchronous, side-effect-free. Given a top-level `Page` and an ordered
 * list of iframe CSS selectors, returns a `FrameLocator` chain pointing at the
 * deepest frame — or the `Page` itself when the path is undefined/empty.
 *
 * Playwright's `frameLocator(selector)` is lazy: it returns a handle that
 * resolves only when an action (e.g. `.locator(...).textContent()`) is
 * performed. A missing iframe at any depth therefore does NOT throw here;
 * the failure surfaces later, when `extract.ts` awaits a `.textContent()` call
 * and that call times out.
 *
 * That design keeps this module pure (no import from `./errors`) and makes
 * `extract.ts` the sole Phase-2 throw site for `CrawlError('frame_not_found', ...)`
 * — see `02-03-PLAN.md` key_links invariant.
 */

import type { Page, FrameLocator } from 'playwright';

/** Either the top-level page or a (possibly nested) FrameLocator. */
export type FrameTarget = Page | FrameLocator;

/**
 * Build a `FrameLocator` chain by folding `page.frameLocator(path[0]).frameLocator(path[1])...`.
 *
 * - `framePath === undefined` or `framePath.length === 0` → return `page` unchanged.
 * - Otherwise fold left over the selectors.
 *
 * Never throws. Never awaits. Never imports `./errors` — frame-presence failures
 * are detected and classified in `extract.ts`.
 */
export function descendToFrame(page: Page, framePath?: string[]): FrameTarget {
  if (framePath === undefined || framePath.length === 0) {
    return page;
  }
  let target: FrameTarget = page;
  for (const selector of framePath) {
    target = target.frameLocator(selector);
  }
  return target;
}
