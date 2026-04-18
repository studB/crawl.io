/**
 * Chromium browser lifecycle for the crawler.
 *
 * `launchBrowser` returns a fresh `{ browser, context, page }` handle per call;
 * `closeBrowser` tears it down in page → context → browser order, swallowing
 * errors so the close path never shadows a more important crawl error.
 *
 * The optional `storageState` option is the **Phase 3 hook**: when Phase 3
 * introduces session reuse, it will pass a storage-state file path here and
 * `newContext` will hydrate cookies + localStorage from it. Phase 2 never sets
 * this option; we build the context options object with a conditional spread
 * so `exactOptionalPropertyTypes` is satisfied (no `storageState: undefined`
 * key on the wire).
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

export interface LaunchOptions {
  /** Phase 3 hook — path to a Playwright storage-state JSON file. Phase 2 never sets this. */
  storageState?: string;
  /** Defaults to `true`. Tests may pass `false` to debug locally. */
  headless?: boolean;
}

export interface BrowserHandle {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function launchBrowser(opts?: LaunchOptions): Promise<BrowserHandle> {
  const browser = await chromium.launch({ headless: opts?.headless ?? true });

  // Build context options conditionally so `exactOptionalPropertyTypes` is
  // satisfied — never assign `storageState: undefined`.
  const ctxOpts: Parameters<Browser['newContext']>[0] = {};
  if (opts?.storageState !== undefined) {
    ctxOpts.storageState = opts.storageState;
  }
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();

  return { browser, context, page };
}

export async function closeBrowser(handle: BrowserHandle): Promise<void> {
  // Best-effort cleanup: we never want teardown to shadow the real crawl error.
  try { await handle.page.close(); } catch { /* swallow */ }
  try { await handle.context.close(); } catch { /* swallow */ }
  try { await handle.browser.close(); } catch { /* swallow */ }
}
