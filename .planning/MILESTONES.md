# Milestones

## v1.0 crawl.io v1 (Shipped: 2026-04-18)

**Phases completed:** 4 phases, 13 plans, 30 tasks

**Key accomplishments:**

- CommonJS TypeScript toolchain installed with unified@9 + remark-parse@9 + yaml + zod + vitest, pinned to v9 majors so Node 20 CJS runtime can `require()` them under the sync `parseConfig` contract locked by D-08.
- CrawlJob/SelectorSpec types, three strict Zod v4 schemas with engine=css and timeout=30000 defaults, and a ConfigParseError with `declare readonly filePath` preserving `'filePath' in err === false` under exactOptionalPropertyTypes — 25 unit tests locking the contract Plan 03's markdown parser will produce.
- End-to-end sync parseConfig (markdown AST → sections → YAML → validated CrawlJob) with aggregated ConfigParseError and a canValidate gate that suppresses duplicate Zod issues when structural sections are missing, plus an async parseConfigFile wrapper and a 5-symbol public API barrel at src/index.ts.
- playwright@^1.59.1 + Chromium 147 binary on disk; pure `src/crawler/types.ts` + `src/crawler/errors.ts` locked via 5 TDD tests, with CrawlErrorCode as a 7-member string-literal union and CrawlError using the declare-readonly-optional pattern for exactOptionalPropertyTypes compliance.
- Pure markdown writeback layer implemented as 4 helpers in `src/crawler/output.ts` — UTC-locked timestamps, em-dash H2 heading, italic meta line, fenced ```json payload, conditional `stack` key — locked by 19 TDD tests (RED then GREEN), full suite 87/87 green, `tsc --noEmit` clean.
- Three Playwright-bound crawler modules (browser/frame/extract) + a three-file local iframe fixture chain + 6 real-Chromium integration tests — 2-level iframe descent extracts the `DEEP_CONTENT_SENTINEL` sentinel via both CSS and XPath, waitForReady maps Playwright TimeoutError to `CrawlError('timeout', detail-with-selector-AND-timeout-value)`, extract.ts is the sole Phase-2 throw site for `CrawlError('frame_not_found', ...)`, Phase-3 `storageState?` hook already accepted in launchBrowser.
- Extended `CrawlErrorCode` to 10 members (three new auth variants), locked the cardinality via test, and landed a Playwright-free `src/auth/session.ts` helper (path + existence + raw read) with tmpdir-based round-trip coverage.
- Landed the three pure-logic pillars of the auth subsystem: detect.ts (URL + selector + cookie classifiers, zero Playwright), naver.ts (env-var credential reader + login-form filler via typed Page, redaction-safe errors), headed.ts (non-interactive polling orchestrator with env-tunable timeout and injectable sleep/now). Test count 126 → 168 (+42 new).
- Composed Plans 03-01/03-02 into a single `ensureAuthenticated` entry point in `src/auth/index.ts`, wired it into `src/crawler/runner.ts` between `launchBrowser` and `page.goto` with full headed-fallback handoff, added 13 boundary-mocked unit tests plus a fully-gated real-Naver integration test, and kept the public API byte-for-byte unchanged. Test count 168 → 181 (+13 unit) with 4 extra integration tests skipped by default.
- Shipped the full v1 CLI surface — commander-backed `crawl run <file>` with shebang-preserved bin entry, pure `resolveExitCode` OUT-05 mapping, pre-flight scrubbed-path errors, --verbose/--quiet flags, and 17 new unit tests — without touching a single library file.
- Turned the Plan-01 CLI into a publishable npm package — package.json metadata finalized (MIT, bin, files, engines, keywords, repo placeholders, prepack), README covering install / quick-start / env vars / exit codes, canonical MIT LICENSE with 2026 copyright, and LF-enforcing .gitattributes — all four files landed atomically with zero touches under src/ and the 211-test suite still passing.
- Shipped the final Phase-4 publish-readiness gate — 9 end-to-end integration tests under test/cli/ that spawn the built dist/bin/crawl.js through child_process, prove the tarball allowlist is correct via `npm pack --dry-run --json`, round-trip the bin through `tar -xzf` to verify the shebang and executable bit survive, and close with `npm publish --dry-run` as the atomic CLI-05 gate — all with zero src/ touches and library byte-unchanged across all three Phase 4 plans.

---
