/**
 * runCrawl — the single public orchestrator for a Phase-2 crawl.
 *
 * Composes the pieces from Plans 02-01 through 02-03:
 *
 *   parseConfigFile  (Phase 1)          — read + validate markdown config
 *   launchBrowser    (Plan 02-03)       — fresh Chromium / context / page
 *   page.goto        (Playwright)       — navigate with rules.timeout
 *   waitForReady     (Plan 02-03)       — block on rules.waitFor with the SAME timeout
 *   extractFields    (Plan 02-03)       — per-field text extraction (CSS / XPath, iframe descent)
 *   renderEntry      (Plan 02-02)       — format the CrawlResult as a markdown run entry
 *   writeOutputToFile(Plan 02-02)       — append the entry under `# Output`
 *   closeBrowser     (Plan 02-03)       — finally-safe teardown
 *
 * Contract locked by 02-CONTEXT.md and 02-04-PLAN.md:
 *
 *   1. Signature is EXACTLY `runCrawl(configPath: string): Promise<CrawlResult>`.
 *   2. NEVER terminates the process itself (Phase 4 CLI owns the exit-code mapping).
 *   3. ALWAYS writes a run entry before returning — success or failure. Writeback
 *      failures are swallowed (the returned CrawlResult is still meaningful).
 *   4. Browser is closed in a `finally` block — Chromium never leaks.
 *   5. A `ConfigParseError` from Phase 1 surfaces as
 *      `CrawlResult.error = { code: 'config_parse', ..., stack? }` and does NOT
 *      launch a browser.
 *   6. `page.goto(url, { timeout })` and `waitForReady(page, waitFor, timeout)`
 *      both receive the SAME `rules.timeout` value.
 *   7. `error.stack` is populated from the caught `Error.stack` when present;
 *      absent when the thrown value has no stack (conditional spread).
 *   8. `durationMs` is measured with `process.hrtime.bigint()` — monotonic,
 *      immune to wall-clock jumps.
 */

import { parseConfigFile, ConfigParseError } from '../config/index';
import type { CrawlJob } from '../config/index';
import type { CrawlResult, CrawlErrorCode } from './types';
import { CrawlError } from './errors';
import { launchBrowser, closeBrowser, type BrowserHandle } from './browser';
import { waitForReady, extractFields } from './extract';
import { renderEntry, scrubPaths, writeOutputToFile } from './output';
import { ensureAuthenticated } from '../auth/index';
import { sessionExists, sessionFilePath } from '../auth/session';

/**
 * Build the `error` envelope object, omitting `stack` entirely when it is
 * `undefined`. The conditional spread is required by exactOptionalPropertyTypes
 * (we must not assign `stack: undefined`) and mirrors the renderEntry contract
 * in `src/crawler/output.ts` which only emits a `"stack"` JSON key when the
 * field is defined.
 */
function errorPayload(
  code: CrawlErrorCode,
  message: string,
  stack: string | undefined,
): { code: CrawlErrorCode; message: string; stack?: string } {
  return {
    code,
    message,
    ...(stack !== undefined ? { stack } : {}),
  };
}

export async function runCrawl(configPath: string): Promise<CrawlResult> {
  const startedAt = new Date();
  const startNs = process.hrtime.bigint();
  let url = '';

  /**
   * Assemble the CrawlResult and write it to the config file before returning.
   * Every return path funnels through here so must-have #2 (always write an
   * `# Output` entry) holds unconditionally.
   *
   * If the writeback itself fails we swallow the error — returning the result
   * is still meaningful (the CLI will surface the exit code; losing the on-disk
   * entry is secondary to losing the envelope).
   */
  const finalize = async (
    partial: Omit<CrawlResult, 'configPath' | 'startedAt' | 'durationMs'>,
  ): Promise<CrawlResult> => {
    const durationMs = Number((process.hrtime.bigint() - startNs) / 1_000_000n);
    const result: CrawlResult = {
      ...partial,
      configPath,
      startedAt,
      durationMs,
    };
    try {
      await writeOutputToFile(configPath, renderEntry(result));
    } catch {
      // swallow — the envelope is still returned to the caller
    }
    return result;
  };

  // --- Stage 1: parse the markdown config ---
  // A ConfigParseError short-circuits out before a browser is ever launched,
  // satisfying the "config_parse WITHOUT launching Chromium" contract.
  let job: CrawlJob;
  try {
    job = await parseConfigFile(configPath);
    url = job.url;
  } catch (err) {
    if (err instanceof ConfigParseError) {
      // MD-04: scrub absolute home-directory paths out of each issue before
      // joining — ConfigParseError.issues often contains fully-qualified
      // filePath and stack-like strings that would otherwise be committed.
      const scrubbedIssues = err.issues.map((i) => scrubPaths(i));
      // LW-01: `return await` (not bare `return`) so that if a future refactor
      // wraps runCrawl in an outer try/catch, rejections from finalize are
      // caught inside runCrawl's frame rather than escaping unobserved.
      return await finalize({
        status: 'error',
        url: '',
        error: errorPayload('config_parse', scrubbedIssues.join('; '), scrubPaths(err.stack)),
      });
    }
    const e = err as Error;
    return await finalize({
      status: 'error',
      url: '',
      error: errorPayload('unknown', scrubPaths(e?.message ?? String(err)), scrubPaths(e?.stack)),
    });
  }

  // --- Stage 2: drive Chromium ---
  let handle: BrowserHandle | undefined;
  try {
    // Phase 3: if a prior run saved a session, rehydrate it into the new
    // context. The conditional-spread mirrors the existing exactOptional-
    // PropertyTypes convention — never assign `storageState: undefined`.
    const storagePath = (await sessionExists()) ? sessionFilePath() : undefined;
    const launchOpts: Parameters<typeof launchBrowser>[0] = {};
    if (storagePath !== undefined) {
      launchOpts.storageState = storagePath;
    }
    handle = await launchBrowser(launchOpts);

    // Phase 3: ensureAuthenticated may throw CrawlError with code
    // 'auth_missing_credentials' | 'auth_failed' | 'captcha_unresolved' —
    // all of which flow through the existing catch block below unchanged.
    // The returned page is EITHER the original page OR a fresh page from a
    // post-headed-fallback headless relaunch; in the latter case `handle`
    // must be rebound so the `finally` block closes the CORRECT browser.
    const authedPage = await ensureAuthenticated(handle.page, url, handle.browser);
    if (authedPage !== handle.page) {
      // Headed fallback swapped browsers — best-effort-close the stale
      // page/context/browser. The new browser is reachable via
      // authedPage.context().browser() (stable Playwright API).
      try { await handle.page.close(); } catch { /* swallow */ }
      try { await handle.context.close(); } catch { /* swallow */ }
      try { await handle.browser.close(); } catch { /* swallow */ }
      const ctx = authedPage.context();
      const newBrowser = ctx.browser();
      if (newBrowser === null) {
        throw new CrawlError(
          'auth_failed',
          'headed fallback produced a page with no browser',
        );
      }
      handle = { browser: newBrowser, context: ctx, page: authedPage };
    }

    // Navigate with the configured timeout. Playwright's TimeoutError is
    // detected by name (cross-version safe); any other navigation error maps
    // to `network`.
    try {
      await handle.page.goto(url, { timeout: job.rules.timeout });
    } catch (err) {
      const e = err as Error;
      if (e && e.name === 'TimeoutError') {
        throw new CrawlError(
          'timeout',
          'page.goto(' + url + ') did not complete within ' + job.rules.timeout + 'ms',
        );
      }
      throw new CrawlError('network', 'navigation failed: ' + (e?.message ?? String(err)));
    }

    // waitForReady applies the SAME rules.timeout budget to the readiness
    // selector (CRWL-02). extract.ts already maps Playwright TimeoutError to
    // CrawlError('timeout', ...) with both selector AND timeout in detail.
    await waitForReady(handle.page, job.rules.waitFor, job.rules.timeout);

    // Per-field extraction (CSS / XPath / iframe descent). Already throws
    // CrawlError on failure; the catch below funnels it into the envelope.
    const fields = await extractFields(handle.page, job.selectors);

    return await finalize({ status: 'ok', url, fields });
  } catch (err) {
    let code: CrawlErrorCode = 'unknown';
    let message = (err as Error)?.message ?? String(err);
    // Standard Error.stack — present on every JS Error subclass including
    // CrawlError. The conditional spread in errorPayload keeps the envelope
    // clean when no stack is available (e.g., a non-Error thrown).
    const stack: string | undefined = (err as Error)?.stack;
    if (err instanceof CrawlError) {
      code = err.code;
      // Prefer `.detail` over `.message` — the message is `[code] detail`,
      // so using detail avoids the code being repeated in the envelope.
      message = err.detail ?? err.message;
    }
    // MD-04: scrub absolute home-directory paths from message + stack before
    // they are rendered into the committed markdown output.
    return await finalize({
      status: 'error',
      url,
      error: errorPayload(code, scrubPaths(message), scrubPaths(stack)),
    });
  } finally {
    if (handle !== undefined) {
      await closeBrowser(handle);
    }
  }
}
