---
phase: 02-core-crawler-output
verified: 2026-04-18T14:57:00Z
status: passed
must_have_score: "5/5"
score: 5/5
overrides_applied: 0
---

# Phase 2: Core Crawler + Output Verification Report

**Phase Goal:** The crawler navigates to a configured URL, extracts named fields (including from nested iframes), and appends the results as a timestamped JSON block to the markdown file's Output section.

**Verified:** 2026-04-18T14:57:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running against a public URL produces a new `# Output` entry with fenced JSON + human timestamp | VERIFIED | `runner.integration.test.ts:100` happy path — asserts `# Output` header count === 1, `## Run — YYYY-MM-DD HH:MM` present, fenced JSON parses to `{ fields, meta: { status: 'ok' } }` |
| 2 | Running twice → two separate entries, first never overwritten | VERIFIED | `runner.integration.test.ts:138` — after two `runCrawl` calls: `# Output` count === 1, `## Run —` count === 2, byte-for-byte snapshot of first entry found in final content, index ordering asserted |
| 3 | Config with explicit frame path → iframe descent ≥ 2 levels deep, extraction succeeds | VERIFIED | `runner.integration.test.ts:194` — `frame: ['iframe#level-1-frame', 'iframe#level-2-frame']` extracts `DEEP_CONTENT_SENTINEL`; `extract.integration.test.ts:63` same at the extractFields layer (CSS and XPath variants) |
| 4 | `engine: xpath` extracts text correctly | VERIFIED | `runner.integration.test.ts:222` XPath selector `//*[@id="top-title"]` yields `'Top Level'` (same as CSS); `extract.integration.test.ts:49` top-level XPath + 2-level XPath inside descended frame |
| 5 | `waitFor` timeout → error entry, `meta.status: 'error'`, `CrawlResult.status === 'error'` | VERIFIED | `runner.integration.test.ts:243` — 2s timeout against data URL yields `result.status==='error'`, `result.error.code==='timeout'`, on-disk fenced JSON has `meta.status: 'error'` and a non-empty rendered `"stack":` field |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/crawler/types.ts` | CrawlErrorCode 7-member union + CrawlResult envelope with `error.stack?` | VERIFIED | 7 union members confirmed (`timeout`, `selector_miss`, `network`, `frame_not_found`, `extraction_failed`, `config_parse`, `unknown`); `CrawlResult` has `status`, `configPath`, `url`, `startedAt`, `durationMs`, `fields?`, `error?: { code, message, stack? }` |
| `src/crawler/errors.ts` | CrawlError class with readonly code + optional detail | VERIFIED | `extends Error`, `readonly code`, `declare readonly detail?`, `Object.setPrototypeOf` — matches 02-01 plan exactly |
| `src/crawler/browser.ts` | launchBrowser with `storageState?` Phase-3 hook + closeBrowser | VERIFIED | `LaunchOptions { storageState?: string; headless?: boolean }`, `BrowserHandle { browser, context, page }`, conditional-spread ctxOpts, best-effort page→context→browser teardown |
| `src/crawler/frame.ts` | Pure descendToFrame (no `./errors` import) | VERIFIED | `import type { Page, FrameLocator } from 'playwright'` only; left-fold over `framePath`; no throws, no awaits |
| `src/crawler/extract.ts` | toPlaywrightSelector + waitForReady + extractFields; sole `frame_not_found` throw site | VERIFIED | All three exports present; `xpath=` prefix for XPath; TimeoutError detected by name; classification: frame declared → `frame_not_found`, else `selector_miss`; `DEFAULT_EXTRACT_TIMEOUT_MS = 5000` exported (LW-02 fix) |
| `src/crawler/output.ts` | formatTimestamp + renderEntry + appendOutput + writeOutputToFile + scrubPaths | VERIFIED | UTC-locked timestamp; em-dash H2 + italic meta + fenced JSON; conditional `stack` spread; CRLF preservation (MD-01); fence-aware `# Output` detection (MD-02); atomic rename + in-process lock (MD-03); `scrubPaths` exported and wired (MD-04) |
| `src/crawler/runner.ts` | runCrawl orchestrator, never exits, finalize-always, closeBrowser in finally | VERIFIED | Signature exact; `process.hrtime.bigint()` monotonic duration; parse→launch→goto→waitForReady→extractFields→finalize; `finally` closes browser; no `process.exit`; stack propagation via conditional `errorPayload` spread |
| `src/crawler/index.ts` | Crawler barrel: runCrawl, CrawlError, CrawlErrorCode, CrawlResult | VERIFIED | Exact 3 lines re-export the expected 4 symbols |
| `src/index.ts` | Package root barrel: adds Phase 2 exports alongside Phase 1 | VERIFIED | Phase 1 exports preserved; adds `CrawlErrorCode`, `CrawlResult`, `CrawlError`, `runCrawl` |
| `test/fixtures/nested-iframes/{index,level-1,level-2}.html` | 2-level iframe chain with `DEEP_CONTENT_SENTINEL` | VERIFIED | 3 fixture files present; `#top-title`, `iframe#level-1-frame`, `iframe#level-2-frame`, `#deep-target` with sentinel — all grep-confirmed |
| `vitest.config.ts` | 60s testTimeout + integration include pattern | VERIFIED | `testTimeout: 60_000`, include covers both `*.test.ts` and `*.integration.test.ts` |
| `src/crawler/runner.integration.test.ts` | 6 e2e tests | VERIFIED | 6 `it()` blocks, all passing |
| `src/crawler/extract.integration.test.ts` | 6 real-Chromium tests (2-level iframe, CSS/XPath cross-check, frame_not_found, timeout) | VERIFIED | 6 `it()` blocks, all passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `runner.ts` | `config/index` | `parseConfigFile, ConfigParseError` | WIRED | Line 33 — import used in Stage 1 try/catch |
| `runner.ts` | `./browser` | `launchBrowser, closeBrowser` | WIRED | Line 37 — `launchBrowser()` called, `closeBrowser` in finally |
| `runner.ts` | `./extract` | `waitForReady, extractFields` | WIRED | Line 38 — both called in Stage 2 try block |
| `runner.ts` | `./output` | `renderEntry, writeOutputToFile, scrubPaths` | WIRED | Line 39 — `finalize` calls `writeOutputToFile(…, renderEntry(result))`; `scrubPaths` applied at 4 error sites |
| `crawler/index.ts` | `runner, errors, types` | `runCrawl, CrawlError, CrawlErrorCode, CrawlResult` | WIRED | Grep + runtime check confirms all 4 symbols reachable through the barrel |
| `src/index.ts` | `crawler/index` | re-export | WIRED | Lines 4–5; runtime `require('./dist')` confirms `runCrawl` + `CrawlError` are functions |
| `extract.ts` (sole throw site) | `CrawlError('frame_not_found', …)` | throw | WIRED | Only `src/crawler/extract.ts:128` originates the code; `frame.ts` has no `./errors` import |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `runner.ts::runCrawl` | `fields` | `extractFields(handle.page, job.selectors)` — real Playwright `.textContent()` against CSS/XPath locators | Yes — proven end-to-end by `runner.integration.test.ts` Test 1 (`'Top Level'`) and Test 3 (`'DEEP_CONTENT_SENTINEL'`) | FLOWING |
| `runner.ts::finalize` | `result.error.stack` | Caught `Error.stack` (CrawlError inherits from Error) | Yes — Test 5 asserts `typeof stack === 'string' && length > 0` on the envelope and in the rendered JSON | FLOWING |
| `output.ts::renderEntry` | `payload.meta.status` | Constructed from `result.status` | Yes — Tests 1, 2, 3, 5, 6 parse the fenced JSON and assert `meta.status` equals `'ok'` or `'error'` appropriately | FLOWING |
| `output.ts::writeOutputToFile` | file content on disk | `readFile → appendOutput → writeFile(tmp) → rename` (atomic) | Yes — all 6 runner integration tests read the tmp file back and confirm the rendered entry is on disk | FLOWING |

No hollow props, no static-only fallbacks, no disconnected data paths.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles cleanly under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes | `npx tsc --noEmit` | exit 0 | PASS |
| Full test suite passes | `npx vitest run` | `Test Files 9 passed (9)`, `Tests 122 passed (122)`, 8.46s | PASS |
| `runCrawl` never calls `process.exit` | `! grep -q "process.exit" src/crawler/runner.ts` | no match across all of `src/crawler/*.ts` | PASS |
| `runCrawl` is an async function | `grep -q "export async function runCrawl" src/crawler/runner.ts` | match at line 60 | PASS |
| Public API surface reachable at runtime | `node -e "const p=require('./dist'); ['runCrawl','CrawlError','parseConfig','parseConfigFile','ConfigParseError'].forEach(k => assert typeof p[k]==='function')"` | all 5 are functions | PASS |
| Type-only public exports present | inspect `dist/index.d.ts` | exports `CrawlJob`, `SelectorSpec`, `ConfigParseErrorOptions`, `CrawlErrorCode`, `CrawlResult` | PASS |
| Config preservation + two-run append | in-process `appendOutput(appendOutput(src, entry), entry)` | `startsWith(src)=true`, `# Output` count=1, `## Run —` count=2 | PASS |
| `frame_not_found` throw-site invariant | `grep -rln "throw new CrawlError('frame_not_found'" src/` | only `src/crawler/extract.ts` | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CRWL-01 | 02-01, 02-03, 02-04 | Crawler launches Playwright (Chromium) and navigates to the configured URL | SATISFIED | `browser.ts::launchBrowser` uses `chromium.launch({ headless })`; `runner.ts:131` calls `handle.page.goto(url, { timeout })`; integration tests 1-5 exercise it |
| CRWL-02 | 02-03, 02-04 | Waits for `waitFor` selector (scoped to correct frame) before extracting | SATISFIED | `runner.ts:146` calls `waitForReady(handle.page, job.rules.waitFor, job.rules.timeout)`; `extract.ts:76` forwards to `page.waitForSelector(waitFor, { timeout })` |
| CRWL-03 | 02-03, 02-04 | Aborts cleanly when `waitFor` exceeds configured `timeout` | SATISFIED | `extract.ts:79` maps TimeoutError by name → `CrawlError('timeout', 'waitFor selector … did not appear within Xms')`; `runner.integration.test.ts:243` and `extract.integration.test.ts:128` both assert the mapped error |
| CRWL-04 | 02-03 | Resolves CSS selectors against top-level page or declared frame | SATISFIED | `extract.ts::toPlaywrightSelector` returns CSS unchanged; `runner.integration.test.ts:100` extracts `title: 'Top Level'` via CSS |
| CRWL-05 | 02-03 | Resolves XPath selectors against top-level page or declared frame | SATISFIED | `extract.ts:52-54` prefixes `xpath=`; `runner.integration.test.ts:222` and `extract.integration.test.ts:49` both extract via XPath and match CSS output |
| CRWL-06 | 02-03, 02-04 | Descends through each frame in explicit path (≥ 2 levels) | SATISFIED | `frame.ts::descendToFrame` folds `page.frameLocator(a).frameLocator(b)`; `runner.integration.test.ts:194` extracts `DEEP_CONTENT_SENTINEL` via 2-level descent; both CSS and XPath variants tested at the extract layer |
| CRWL-07 | 02-03, 02-04 | Extracts text content for each named field and returns `{field: value}` | SATISFIED | `extract.ts::extractFields` returns `Record<string,string>`; every integration test asserts `result.fields` shape |
| OUT-01 | 02-02, 02-04 | Appends (does not overwrite) a new entry to `# Output` on every run | SATISFIED | `output.ts::appendOutput` + `writeOutputToFile`; `output.test.ts` Tests 10-18 + Test 20 (MD-03 concurrent); `runner.integration.test.ts:138` asserts two-run preservation end-to-end |
| OUT-02 | 02-02, 02-04 | Human-readable timestamp + count of extracted items | SATISFIED | `formatTimestamp` returns `YYYY-MM-DD HH:MM` UTC; `renderEntry` emits `_count: N, duration: Xms_`; `output.test.ts` Tests 1-4, 7 |
| OUT-03 | 02-02, 02-04 | Extracted data written as fenced ```json block | SATISFIED | `renderEntry` emits FENCE + `json\n` + `JSON.stringify(payload, null, 2)`; `output.test.ts` Tests 5, 7, 8; `runner.integration.test.ts` blocks parseable JSON |
| OUT-04 | 02-02, 02-04 | On failure, writes error entry with error type + message | SATISFIED | `renderEntry` error branch emits `{ error: { code, message, stack? }, meta: { status: 'error' } }`; `output.test.ts` Tests 6, 9; `runner.integration.test.ts:243` timeout + `:283` config_parse both verify on-disk error entries |
| OUT-05 | Phase 4 (deferred) | Process exits with non-zero code on failure | DEFERRED | Per CONTEXT.md split. Phase 2 delivers the error-envelope half (`CrawlResult.status === 'error'` with populated `error: { code, message, stack? }`) and the written error entry — verified above. The `process.exit(1)` mapping is Phase 4's CLI concern and is out of scope for Phase 2 verification per REQUIREMENTS.md line 123 |

**Phase 2 requirements:** 11 of 11 SATISFIED. OUT-05 correctly deferred to Phase 4 per the explicit CONTEXT.md split.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | no TODO/FIXME/XXX/HACK/PLACEHOLDER found in any modified src file | — | None |
| — | — | no `process.exit` in `src/crawler/` (grep confirms) | — | None (contract held) |
| — | — | no empty `return null/[]/{}` stub body in modified files | — | None |
| — | — | no `console.log`-only function bodies | — | None |

Modified files scanned: `src/crawler/{types,errors,browser,frame,extract,output,runner,index}.ts`, `src/index.ts`. All contain concrete implementations covered by tests; no placeholders, no stubs.

### Review Fix Landings (from 02-REVIEW-FIX.md)

| Fix | Commit | Landed? | Evidence |
|-----|--------|---------|----------|
| MD-01 CRLF preservation in appendOutput | `3254132` | YES | `output.ts:184` `const nl = source.includes('\r\n') ? '\r\n' : '\n'` + normalization of rendered entry; `output.test.ts` Tests 16a/16b pass |
| MD-02 fence-aware `# Output` detection | `4d9b334` | YES | `output.ts:145 hasOutputHeaderOutsideFences` toggles on ```...```; Tests 16c/16d pass |
| MD-03 atomic writeback + per-path lock | `3aa9472` | YES | `output.ts:207 writeLocks: Map<string, Promise<void>>`; `doAtomicWrite` = readFile→appendOutput→writeFile(tmp)→rename(tmp, final) with retry; Test 20 passes |
| MD-04 scrubPaths in error payload | `d74a53a` | YES | `scrubPaths` exported from `output.ts:47-75`; applied in `runner.ts` lines 104, 111, 118, 171 (3 error paths) and in `output.ts::renderEntry` error branch; 6 unit tests (S1-S6) pass |
| LW-01 uniform `return await finalize(...)` | `6dbb456` | YES | Grep confirms all 4 return sites use `return await finalize` |
| LW-02 `DEFAULT_EXTRACT_TIMEOUT_MS` renamed + exported | `5e991b9` | YES | `extract.ts:39 export const DEFAULT_EXTRACT_TIMEOUT_MS = 5000` |

All 6 in-scope review findings landed as described. 3 deferred low-severity items (LW-03, LW-04, LW-05) are cosmetic and non-blocking per the fix ledger.

### Human Verification Required

None. All ROADMAP success criteria are testable programmatically and every test passes; the phase produces no UI, no external-service behavior, no visual artifacts.

### Gaps Summary

No gaps found. Phase 2 goal is fully achieved:

1. ROADMAP success criteria 1-5: all locked by passing integration tests (122/122 total, 9 files, 8.46s).
2. All 11 in-scope requirements (CRWL-01..07, OUT-01..04) are satisfied by wired, tested, data-flowing code paths.
3. OUT-05's exit-code half is correctly deferred to Phase 4 per the CONTEXT.md split; Phase 2 owns the envelope and error-entry halves and both are verified on disk.
4. All 6 in-scope review findings (MD-01..04, LW-01..02) landed as described.
5. Invariants hold: `runCrawl` never exits; `closeBrowser` in finally; `extract.ts` is the sole `frame_not_found` throw site; `frame.ts` has no `./errors` import; `storageState?` Phase-3 hook is already on `LaunchOptions`.

---

_Verified: 2026-04-18T14:57:00Z_
_Verifier: Claude (gsd-verifier)_
