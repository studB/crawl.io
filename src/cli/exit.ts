/**
 * OUT-05 exit-code mapping — translate a CrawlResult envelope into the
 * literal union 0 | 1 that the CLI run subcommand hands to the platform
 * exit primitive.
 *
 * Requirement (REQUIREMENTS.md OUT-05):
 *   "The process exits with a non-zero code on any failure so shells and
 *    schedulers detect it."
 *
 * Mapping:
 *   - status === 'ok'    → 0 (success)
 *   - status === 'error' → 1 (any failure — the library's single fatal
 *                             error class CrawlError already collapses
 *                             every failure mode onto status 'error'
 *                             before the CLI sees the result, so the
 *                             CLI does not need to look at error.code)
 *
 * Distinct per-error-code exit codes (e.g., timeout → 2, auth_failed → 3)
 * are deliberately deferred to v2 — see 04-CONTEXT.md exit-codes section.
 *
 * This module is intentionally side-effect free: no environment reads, no
 * I/O, no module-scope mutation. Purity is guarded by a unit test that
 * calls the function with a static fixture and asserts the input is not
 * mutated, AND by a grep-based acceptance gate in 04-01-PLAN.md.
 */

import type { CrawlResult } from '../crawler/types';

/**
 * Map a CrawlResult to an exit code.
 *
 * The return type is the literal union 0 | 1 (not number), so callers can
 * forward the result directly to the platform exit primitive with full
 * compile-time narrowing — and a refactor that widens the return type
 * would fail the tsc narrowing assertion in exit.test.ts.
 */
export function resolveExitCode(result: CrawlResult): 0 | 1 {
  return result.status === 'ok' ? 0 : 1;
}
