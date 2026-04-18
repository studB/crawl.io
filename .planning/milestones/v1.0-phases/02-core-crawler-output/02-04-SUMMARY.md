---
plan: 02-04
phase: 02-core-crawler-output
status: complete
completed: 2026-04-18
tasks: 2/2
requirements: [CRWL-01, CRWL-02, CRWL-03, CRWL-07, OUT-01, OUT-02, OUT-03, OUT-04]
---

# Plan 02-04: Runner + Public API — Summary

## What was built

`runCrawl(configPath: string): Promise<CrawlResult>` — the Phase 2 orchestrator. Given a markdown config path, it:

1. Parses the config via Phase 1's `parseConfigFile`. `ConfigParseError` is caught and mapped to `CrawlResult { status: 'error', error: { code: 'config_parse', message, stack } }`.
2. Launches a fresh Chromium browser + context + page via `launchBrowser` (with the Phase-3-ready `storageState?` hook unused for now).
3. Runs `page.goto(url, { timeout })` and `page.waitForSelector(waitFor, { timeout })` using the SAME `rules.timeout` value.
4. Descends through any `frame: [...]` CSS selectors via `descendToFrame` and extracts named fields via `extractFields` (CSS or XPath per `SelectorSpec.engine`).
5. Always writes a `# Output` entry to the source markdown file via `writeOutputToFile` — both success AND error paths.
6. Closes browser/context/page in a `finally` block, regardless of outcome.
7. Returns a typed `CrawlResult` envelope. NEVER calls `process.exit` — exit code mapping is Phase 4's concern (OUT-05 split, per CONTEXT.md).

Public API is now exposed end-to-end: `src/crawler/index.ts` re-exports `runCrawl`, `CrawlResult`, `CrawlError`, `CrawlErrorCode`. `src/index.ts` mirrors these alongside the Phase 1 parser exports.

## Key files

- `src/crawler/runner.ts` (165 lines) — orchestration, error classification, stack propagation
- `src/crawler/runner.integration.test.ts` (312 lines, 6 tests) — end-to-end integration coverage
- `src/crawler/index.ts` — crawler-module public barrel
- `src/index.ts` — package-level public barrel (both config + crawler)

## Test coverage

6 integration tests in `runner.integration.test.ts`, plus 111 cumulative tests across the suite:

1. Happy path — new `# Output` entry with JSON + human timestamp (must-have 1).
2. Two runs, two entries, first entry preserved byte-for-byte (must-have 2).
3. Two-level iframe descent against the `nested-iframes` fixture (must-have 3).
4. CSS and XPath selectors yield the same extracted text (must-have 4).
5. `waitFor` timeout — error entry written with `meta.status: 'error'` (must-have 5).
6. Stack propagation — `typeof result.error.stack === 'string'`, `"stack":` appears in rendered JSON.

All integration tests use `os.tmpdir()` for the markdown file — the repo is never mutated.

## Verification

- `npx tsc --noEmit` — exit 0 under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
- `npx vitest run` — 111/111 passing across 9 test files
- `! grep -q "process.exit" src/crawler/runner.ts` — verified (runCrawl never exits)
- `! grep -q "await import(" src/crawler/runner.ts` — verified
- `grep -q "export async function runCrawl" src/crawler/runner.ts` — verified
- Public barrel exports verified via `require('./dist').runCrawl` smoke test

## Requirements delivered

| Req | Status | Notes |
|-----|--------|-------|
| CRWL-01 | ✅ | page.goto via Playwright Chromium |
| CRWL-02 | ✅ | page.waitForSelector scoped to frame |
| CRWL-03 | ✅ | timeout applies to goto + waitForSelector |
| CRWL-07 | ✅ | extractFields returns `{name: text}` |
| OUT-01 | ✅ | entries appended to `# Output` |
| OUT-02 | ✅ | human timestamp in H2 heading |
| OUT-03 | ✅ | fenced JSON block per entry |
| OUT-04 | ✅ | error entries use `{ error, meta }` shape |

OUT-05 (non-zero exit) is deferred to Phase 4 per the CONTEXT.md split — Phase 2 delivers the `status === 'error'` envelope; Phase 4's CLI will map it to `process.exit(1)`.

## Commits

- `8b1c9b0` — feat(02-04): implement runCrawl orchestrator
- `c46e170` — feat(02-04): wire runCrawl into public API with e2e integration tests

## Deviations

None intentional. This SUMMARY.md was finalized in a follow-up session (usage limit interrupted the original run after both feat commits landed but before metadata was finalized).
