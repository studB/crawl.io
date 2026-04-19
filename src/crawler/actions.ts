/**
 * Per-step action execution against a Playwright Page / FrameLocator.
 *
 * Mirrors the contract of `extract.ts`:
 *   - A step's selector resolves through `descendToFrame` so iframe chains
 *     declared on the step itself (not job-wide) apply.
 *   - A Playwright TimeoutError on a selector-driven step becomes a
 *     CrawlError classified the same way as extract.ts: `frame_not_found`
 *     when the step declared `frame`, otherwise `selector_miss`.
 *   - A TimeoutError on a `goto` step becomes `CrawlError('timeout', ...)`.
 *   - Any other error is mapped to `CrawlError('action_failed', ...)` with
 *     the step index and kind in the detail.
 *
 * Runner contract:
 *   - A job declares EITHER collectors OR actions (validated upstream). When
 *     actions are present, the runner calls `executeActions` INSTEAD of
 *     `extractFields`.
 *   - Returns one `ActionResult` per successfully executed step. On failure,
 *     throws; no partial result is returned (parity with extractFields).
 */

import type { Page } from 'playwright';

import type { ActionKind, ActionStep } from '../config/types';
import { CrawlError } from './errors';
import { toPlaywrightSelector } from './extract';
import { descendToFrame } from './frame';

/**
 * Per-step budget (ms). Decoupled from `rules.timeout` for the same reason
 * as DEFAULT_EXTRACT_TIMEOUT_MS: a rendered page should complete a click /
 * fill / waitFor far under a second; keeping the ceiling tight gives crisp
 * error attribution when a step truly misses.
 */
export const DEFAULT_ACTION_TIMEOUT_MS = 5000;

export interface ActionResult {
  /** Which kind of step this result corresponds to (`goto` / `click` / `type` / `waitFor`). */
  action: ActionKind;
  /** Zero-based position in the `actions` array. */
  index: number;
  status: 'ok';
  durationMs: number;
}

/**
 * Execute every step in `steps` sequentially. Returns one `ActionResult` per
 * completed step. On failure throws a `CrawlError` so the runner's existing
 * catch-and-classify path builds the envelope.
 *
 * `timeout` is the page-load / goto budget (same semantics as `page.goto`
 * in the crawl path). Per-step selector interactions use the tighter
 * DEFAULT_ACTION_TIMEOUT_MS.
 */
export async function executeActions(
  page: Page,
  steps: ActionStep[],
  timeout: number,
): Promise<ActionResult[]> {
  const out: ActionResult[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (step === undefined) continue; // unreachable under strict indexing but narrows TS
    const start = process.hrtime.bigint();
    try {
      await executeStep(page, step, timeout);
    } catch (err) {
      throw classify(err, step, i);
    }
    const durationMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
    out.push({ action: step.action, index: i, status: 'ok', durationMs });
  }

  return out;
}

async function executeStep(
  page: Page,
  step: ActionStep,
  timeout: number,
): Promise<void> {
  if (step.action === 'goto') {
    await page.goto(step.url, { timeout });
    return;
  }

  // All remaining kinds share the selector-driven shape (BaseSelector).
  const target = descendToFrame(page, step.frame);
  const pw = toPlaywrightSelector(step);
  const locator = target.locator(pw).first();

  if (step.action === 'click') {
    await locator.click({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
    return;
  }
  if (step.action === 'type') {
    await locator.fill(step.value, { timeout: DEFAULT_ACTION_TIMEOUT_MS });
    return;
  }
  // waitFor
  await locator.waitFor({ timeout: DEFAULT_ACTION_TIMEOUT_MS });
}

/**
 * Map a thrown value into a CrawlError with step attribution. Keeps the
 * classification parallel to extract.ts:
 *   - goto timeout → `timeout`
 *   - selector step timeout + `frame` declared → `frame_not_found`
 *   - selector step timeout otherwise → `selector_miss`
 *   - anything else → `action_failed`
 */
function classify(err: unknown, step: ActionStep, index: number): CrawlError {
  if (err instanceof CrawlError) return err;
  const e = err as Error;
  const isTimeout = Boolean(e) && e.name === 'TimeoutError';

  if (isTimeout) {
    if (step.action === 'goto') {
      return new CrawlError(
        'timeout',
        'action ' + index + ' (goto) did not complete in time: ' + step.url,
      );
    }
    if (step.frame && step.frame.length > 0) {
      return new CrawlError(
        'frame_not_found',
        'frame path ' +
          JSON.stringify(step.frame) +
          ' not reachable for action ' +
          index +
          ' (' +
          step.action +
          ')',
      );
    }
    return new CrawlError(
      'selector_miss',
      'selector `' +
        ('selector' in step ? step.selector : '?') +
        '` for action ' +
        index +
        ' (' +
        step.action +
        ') did not match within ' +
        DEFAULT_ACTION_TIMEOUT_MS +
        'ms',
    );
  }

  return new CrawlError(
    'action_failed',
    'action ' +
      index +
      ' (' +
      step.action +
      ') failed: ' +
      (e?.message ?? String(err)),
  );
}
