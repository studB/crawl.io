/**
 * Crawler public barrel — stable surface for Phase 2.
 *
 * Consumers (the package root `src/index.ts`, Phase 4 CLI, external callers)
 * import from `./crawler` or `crawl.io/crawler` without reaching into
 * implementation files. Internal helpers (`browser`, `frame`, `extract`,
 * `output`) are deliberately NOT re-exported; they are implementation details
 * of `runCrawl`.
 *
 * Re-exports:
 *   - `runCrawl`      — the orchestrator function (runner.ts)
 *   - `CrawlError`    — the single fatal error class (errors.ts)
 *   - `CrawlErrorCode`— the 7-member string-literal union (types.ts)
 *   - `CrawlResult`   — the envelope returned by runCrawl (types.ts)
 */

export type { CrawlErrorCode, CrawlResult } from './types';
export { CrawlError } from './errors';
export { runCrawl } from './runner';
