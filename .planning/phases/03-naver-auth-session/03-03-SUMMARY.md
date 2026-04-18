---
phase: 03-naver-auth-session
plan: 03
subsystem: auth
tags: [naver, session-reuse, playwright-headed-fallback, internal-barrel, module-boundary-mocks, gated-integration-tests, typescript-strict]

# Dependency graph
requires:
  - phase: 03-naver-auth-session
    provides: "session.ts (Plan 03-01), detect.ts + naver.ts + headed.ts (Plan 03-02), CrawlErrorCode 10-member union (Plan 03-01)"
  - phase: 02-core-crawler-output
    provides: "runCrawl(configPath): Promise<CrawlResult> orchestrator, launchBrowser({ storageState? }) hook, scrubPaths helper, CrawlError class"
provides:
  - src/auth/index.ts internal barrel with ensureAuthenticated(page, targetUrl, browser, contextOpts) as the auth subsystem's single entry point
  - Runner wiring — src/crawler/runner.ts inserts exactly one ensureAuthenticated() call between launchBrowser() and page.goto(url), plus a conditional-spread session-rehydration block
  - 13 new unit tests — 7 for auth/index (fake Playwright shapes, zero Chromium launch) + 6 for runner auth integration (module-boundary mocks)
  - 4 gated integration tests (RUN_NAVER_TESTS=1 + NAVER_ID/NAVER_PW opt-in) with a tmpdir-chdir pattern that protects the real repo root
  - auth_missing_credentials / auth_failed / captcha_unresolved codes now surface through the existing CrawlResult envelope with scrubPaths applied
  - Headed-fallback orchestration (close-headless → relaunch-headed → poll → save → relaunch-headless) landed behind injectable launcher overrides for deterministic testing
affects: [phase-04-cli-packaging, future-ios-app-invocations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Internal-barrel single-entry-point — src/auth/index.ts is the only consumer-facing surface of the auth subsystem; no re-exports leak to src/crawler/index.ts or src/index.ts"
    - "Injectable-launcher contract for browser-relaunch orchestration — launchHeaded / launchHeadless / onHeadedOpened are optional overrides with production defaults, enabling unit tests to exercise the full headed-fallback flow without a real Chromium"
    - "Module-boundary mocking with vi.mock('../auth/index', ...) — runner auth tests stub the entire auth package plus ./browser + ./extract, so runCrawl's CATCH-classify-finalize path is exercised without touching Playwright"
    - "Page-identity-swap rebinding — runner detects `authedPage !== handle.page` to rebind handle to the fresh browser from page.context().browser() after a headed-fallback swap"
    - "Gated-integration opt-in via describe.skipIf(!GATED) with a secondary skipIf(GATED) sentinel block for a single informative skip line when the gate is closed"
    - "tmpdir-chdir pattern in integration tests — each test mkdtemps a fresh cwd, chdirs in beforeEach, restores + rm -rf in afterEach; no session-file pollution at the real repo root"

key-files:
  created:
    - src/auth/index.ts
    - src/auth/index.test.ts
    - src/auth/naver.integration.test.ts
    - src/crawler/runner.ts.auth.test.ts
  modified:
    - src/crawler/runner.ts

key-decisions:
  - "ensureAuthenticated returns Promise<Page> — the caller rebinds via a page-identity check when the headed fallback swaps browsers. Simpler than returning a {page, browser, context} trio because 99% of callers (non-Naver + session-reuse paths) hand the same page back unchanged."
  - "Stale-session + no-creds branch proceeds rather than throwing — rationale: if .crawl-session.json exists (left by a prior successful login), the runner's goto + waitForReady is the right place to learn whether the session is still valid. Throwing here would preempt the runner's existing classification. Only when NO session file exists AND no creds are set do we fail-fast with auth_missing_credentials."
  - "Integration test fallback TARGET_URL is www.naver.com (non-login-gated) — the missing-creds assertion is guarded by `if (process.env.NAVER_TEST_URL !== undefined)` so the test remains meaningful when the developer supplies a login-gated URL AND benign when they don't."
  - "Runner auth tests mock ./extract (waitForReady + extractFields) so the happy-path test does not require the fake Page to support full Playwright semantics — the runner's auth WIRING is the unit under test, not extract.ts. This is strictly scoped to runner.ts.auth.test.ts; the existing runner.integration.test.ts still covers extract against a real Chromium."
  - "runHeadedFallback reads the SESSION FILE (not the in-memory storage state) before relaunching headless — 03-CONTEXT.md §specifics locks this: 'file is source of truth'. The finally-block tears the headed browser down AFTER storageState({ path }) persists, so the fresh headless context always rehydrates from disk."
  - "Module-boundary vi.mock is registered at file scope BEFORE the runCrawl import — vitest's hoisting guarantees the mock is active at import time, which is critical because runner.ts imports ensureAuthenticated at its top-level scope."
  - "AuthLaunchHandle exported as a named interface (not inlined) — lets tests declare typed launchHeaded/launchHeadless mocks without awkward type gymnastics."

patterns-established:
  - "Pattern: Internal-barrel with single entry point + opt-in injection — src/auth/index.ts exposes ensureAuthenticated and AuthContextOptions; all fakes used by tests are shaped as optional overrides, never required params. Production callers never pass AuthContextOptions."
  - "Pattern: Page-identity swap for browser-relaunch flows — when an orchestrator may swap the underlying Browser, it returns a Page and callers detect the swap with `result !== originalPage`. Simpler than requiring callers to always destructure a handle."
  - "Pattern: vi.mock-at-file-scope for module-boundary testing — stub ALL imports a tested module reaches for (auth, session, browser, extract) so the unit test exercises ONLY the orchestration logic, not Playwright."
  - "Pattern: Gated integration test structure — describe.skipIf(!GATED) for the real tests, describe.skipIf(GATED) for a single sentinel-skip that surfaces the gate reason in CI logs."

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05]

# Metrics
duration: 7min
completed: 2026-04-18
---

# Phase 3 Plan 3: Naver Auth + Session — ensureAuthenticated Barrel & Runner Wiring Summary

**Composed Plans 03-01/03-02 into a single `ensureAuthenticated` entry point in `src/auth/index.ts`, wired it into `src/crawler/runner.ts` between `launchBrowser` and `page.goto` with full headed-fallback handoff, added 13 boundary-mocked unit tests plus a fully-gated real-Naver integration test, and kept the public API byte-for-byte unchanged. Test count 168 → 181 (+13 unit) with 4 extra integration tests skipped by default.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-18T06:37:49Z
- **Completed:** 2026-04-18T06:45:02Z
- **Tasks:** 3
- **Files modified:** 5 (4 created, 1 edited)

## Accomplishments

- `src/auth/index.ts` (new) composes `session.ts + detect.ts + naver.ts + headed.ts` into the **single entry point** the runner consumes. Exports only `ensureAuthenticated` (function), `AuthContextOptions` (injection surface), and `AuthLaunchHandle` (shape for test-injectable launchers). Nothing else is public; nothing is re-exported from `src/crawler/index.ts` or `src/index.ts`.
- Four-branch auth flow: (1) non-Naver host → unchanged page; (2) existing NID_AUT+NID_SES cookies → unchanged page; (3) creds + post-submit `logged_in` → save storageState to `sessionFilePath(cwd)` and return the same page; (4) post-submit `captcha` → close headless → launch headed → poll `hasNaverSessionCookies` every 2 s until timeout → save storageState → close headed → relaunch headless from file → return fresh page.
- `src/crawler/runner.ts` minimal edit: a conditional-spread `launchOpts` block hydrates `.crawl-session.json` into `launchBrowser` when it exists; a single `await ensureAuthenticated(handle.page, url, handle.browser)` call sits between `launchBrowser` and `page.goto`; a page-identity check rebinds `handle` to the fresh browser after a headed-fallback swap. **runCrawl signature unchanged.** `finally` still runs `closeBrowser(handle)` on the (possibly rebound) handle.
- Public API contract honored: `git diff HEAD~6 -- src/crawler/index.ts src/index.ts` emits **zero lines**. `CrawlErrorCode` union still 10 members (unchanged since 03-01). `runCrawl(configPath: string): Promise<CrawlResult>` signature preserved exactly once in the file.
- Error envelope pass-through: auth errors (`auth_missing_credentials`, `auth_failed`, `captcha_unresolved`) flow through the existing catch block verbatim; `scrubPaths` applies to `message` + `stack` with no new branches needed. Runner test #4 plants `/home/alice/secret/...` and asserts the envelope message becomes `<HOME>/secret/...`.
- Runner auth unit tests (`src/crawler/runner.ts.auth.test.ts`): 6 tests using `vi.mock` to stub `../auth/index` + `../auth/session` + `./browser` + `./extract` at the module boundary — no real Chromium, no real filesystem session file. Covers all three auth error codes, scrubPaths-in-envelope, URL propagation, and happy path.
- Gated integration test (`src/auth/naver.integration.test.ts`): 4 tests (3 real + 1 sentinel-skip) with `describe.skipIf(!GATED)` where `GATED = RUN_NAVER_TESTS === '1' && NAVER_ID && NAVER_PW`. Each test `chdir`s into a fresh `os.tmpdir()` subtree and restores + removes it in `afterEach`. With the gate CLOSED (default): `4 skipped` in <500 ms, 0 failures. With the gate OPEN: exercises first-run login → session file creation; second-run session reuse; missing-creds-against-login-gated-URL → `auth_missing_credentials` (conditional on `NAVER_TEST_URL`).
- Full suite: **181 passed / 4 skipped** (13 new unit tests + 4 gated integration tests on top of the 168 baseline). `tsc --noEmit -p tsconfig.json` exits 0 under strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`.

## Task Commits

Each task was committed atomically:

1. **Task 1: `src/auth/index.ts` — ensureAuthenticated barrel + unit coverage** — `fc83186` (feat)
2. **Task 2: Wire `ensureAuthenticated` into `runner.ts` + runner auth unit tests** — `80bc0aa` (feat)
3. **Task 3: Gated real-Naver integration test (`naver.integration.test.ts`)** — `532f5a5` (test)

**Plan metadata:** pending final `docs(03-03): complete plan` commit (includes this SUMMARY, STATE.md, ROADMAP.md, REQUIREMENTS.md).

## Files Created/Modified

### Created

- `src/auth/index.ts` — Internal barrel. Exports `ensureAuthenticated(page, targetUrl, browser, contextOpts?)`, `AuthContextOptions` (env / cwd / launchHeadless / launchHeaded / onHeadedOpened — all optional; production supplies defaults), and `AuthLaunchHandle` (`{ browser, context, page }` shape for injectable launchers). Orchestrates the four-branch flow: non-Naver fast path, session-reuse fast path, headless login + classify, captcha → headed-fallback + relaunch-headless. `scrubPaths` applied to the `auth_missing_credentials` branch's URL interpolation; no other branch interpolates path-like data.
- `src/auth/index.test.ts` — 7 unit tests with fake Playwright shapes (Page / BrowserContext / Browser cast through `unknown`). Covers: (a) non-Naver fast path; (b) session-reuse fast path (no login attempted); (c) missing creds + no session file → `auth_missing_credentials`; (d) missing creds + session file exists → unchanged page; (e) successful submit → `storageState({ path })` saved at `sessionFilePath(cwd)`; (f) post-submit classify=`auth_failed` throw; (g) post-submit classify=`captcha` → `launchHeaded` then `launchHeadless` each called exactly once in that order. Zero Chromium launch — acceptance gate `! grep -q "chromium.launch" src/auth/index.test.ts` holds.
- `src/crawler/runner.ts.auth.test.ts` — 6 unit tests using `vi.mock` at file scope for `../auth/index`, `../auth/session`, `./browser`, `./extract`. Tests: (1) `auth_missing_credentials` surfaces through envelope; (2) `auth_failed` surfaces; (3) `captcha_unresolved` surfaces; (4) `scrubPaths` rewrites `/home/alice/...` in the envelope; (5) `ensureAuthenticated` receives the exact URL from parsed config; (6) happy path returns `{ status: 'ok', fields }`.
- `src/auth/naver.integration.test.ts` — Gated real-Naver integration test. `describe.skipIf(!GATED)` for the 3 real tests (first-run login, session reuse, missing-creds-against-gated-URL), `describe.skipIf(GATED)` for a single `it.skip(GATE_REASON)` sentinel. Uses `process.chdir` + `os.tmpdir()` — no repo-root mutation.

### Modified

- `src/crawler/runner.ts` — Added two imports: `ensureAuthenticated` from `../auth/index`, `{ sessionExists, sessionFilePath }` from `../auth/session`. Inserted the `launchOpts` conditional-spread block + `ensureAuthenticated` call + page-identity-swap rebinding between `launchBrowser` and `page.goto`. **Zero changes to Stage 1 (config parse), the finalize helper, the catch block, or the public signature.** `grep -c "export async function runCrawl(configPath: string): Promise<CrawlResult>"` = 1 (unchanged). `! grep -q "process.exit"` still holds.

### Unchanged (verified)

- `src/crawler/index.ts` — `git diff HEAD~6 -- src/crawler/index.ts` → 0 lines. Public barrel exports unchanged; the stale `7-member string-literal union` JSDoc comment is still there (explicitly reserved for future maintenance; not in this plan's scope).
- `src/index.ts` — `git diff HEAD~6 -- src/index.ts` → 0 lines. No auth re-exports.
- `src/auth/session.ts`, `src/auth/detect.ts`, `src/auth/naver.ts`, `src/auth/headed.ts` — byte-for-byte unchanged from Plans 03-01 / 03-02 (this plan consumes them via imports only).
- `src/crawler/errors.ts`, `src/crawler/types.ts`, `src/crawler/browser.ts`, `src/crawler/output.ts`, `src/crawler/extract.ts`, `src/crawler/frame.ts` — unchanged.
- `src/crawler/runner.integration.test.ts` — unchanged; still 6/6 passing against the file:// fixtures.

## Decisions Made

- **`ensureAuthenticated` returns `Promise<Page>`, not `Promise<{ page, browser, context }>`.** The 95% case (non-Naver + session-reuse + logged-in-after-submit) hands the same page back — returning a trio every time would force every caller to destructure + rebind unnecessarily. The runner handles the 5% swap case with an identity check `if (authedPage !== handle.page)` and reaches for the new browser via `authedPage.context().browser()` — a stable Playwright API. This keeps the common path readable at one line.
- **Stale-session + no-creds proceeds rather than throwing.** If `.crawl-session.json` exists but `NAVER_ID`/`NAVER_PW` are unset, `ensureAuthenticated` returns the unchanged page. Rationale: the existing session may still be valid (Naver tokens can live for days/weeks). If it isn't, the runner's `page.goto` will redirect to `nid.naver.com/nidlogin` and a later classification pass (Phase 4 concern) surfaces the appropriate error. Throwing here would preempt that observation. Only when NO session exists AND no creds are set do we fail-fast with `auth_missing_credentials`.
- **Runner auth tests mock `./extract` in addition to `./browser` + `../auth/*`.** The happy-path test needs `waitForReady` and `extractFields` to succeed against a minimal fake page — stubbing them is simpler than crafting a Playwright-compatible fake Locator. The runner WIRING is the unit under test; `extract.ts` has its own dedicated unit + integration coverage.
- **Integration test's `missing-creds` assertion is conditional on `NAVER_TEST_URL`.** When the developer has set a truly login-gated URL, the missing-creds branch is assertable: `expect(result.error?.code).toBe('auth_missing_credentials')`. When they haven't (fallback `https://www.naver.com/`), the page renders without login and the result is `ok` — we don't fail the test on that outcome. This keeps the file meaningful without becoming flaky against Naver's public-page behavior.
- **`AuthLaunchHandle` is exported as a named interface.** `AuthContextOptions.launchHeaded` and `.launchHeadless` are typed as `(storage?: string) => Promise<AuthLaunchHandle>`. Exporting the type means tests declare typed fakes with one import rather than inlining the shape.
- **Headed fallback saves to the session file BEFORE tearing down the headed browser.** In the `finally` block, `storageState({ path: sessionPath })` runs before `close()` calls. The `finally` also wraps each close in its own try/catch so a close error can never shadow a post-save error. The relaunch-headless call reads from `sessionPath` fresh — consistent with 03-CONTEXT.md §specifics ("file is source of truth").
- **Session-file rehydration in runner uses conditional-spread `launchOpts`.** The pattern mirrors the existing `errorPayload` helper in `runner.ts` and the `ctxOpts` pattern in `browser.ts` — never assign `storageState: undefined` under `exactOptionalPropertyTypes`. `sessionExists()` defaults to `process.cwd()`, matching the default `sessionFilePath()` path.

## Deviations from Plan

None — plan executed exactly as written.

Two minor clarifications worth noting (NOT deviations):

1. **`AuthLaunchHandle` was extracted from the inline type the plan sketched.** The plan's `AuthContextOptions` typed `launchHeadless` / `launchHeaded` as `(storage?: string) => Promise<{ browser, context, page }>`. I exported the returned shape as a named interface `AuthLaunchHandle` for test ergonomics. The signature contract is byte-identical; only the naming changed.
2. **Test-docstring wording adjusted to avoid a grep self-collision.** The plan's acceptance gate grepped for `"chromium.launch"` in the test file to prove no real Chromium is launched. The literal string appeared once inside a docstring paragraph that referenced the acceptance criterion; I rephrased the docstring to describe the gate without reproducing the string. The test BEHAVIOR is unchanged — zero `chromium.launch` calls from test code.

## Issues Encountered

**One transient self-diagnosis:** after Task 1's initial write, a docstring phrase referencing the grep canary `stdin` triggered the acceptance gate `! grep -E "readline|process\.stdin" src/auth/*.ts`. I rephrased the docstring to describe the non-interactive contract without reproducing the forbidden substring. No code behavior was affected; the module has never read stdin.

## User Setup Required

**External services: require manual opt-in for integration tests only.**

- **Unit tests (default CI):** No setup required. Run with `npx vitest run` — 181 passed + 4 skipped.
- **Gated integration tests:** Set `RUN_NAVER_TESTS=1` AND both `NAVER_ID` and `NAVER_PW` to run the real-Naver flow. Optionally set `NAVER_TEST_URL` to a login-gated page (e.g., a specific Naver Cafe post URL) to exercise the missing-creds branch meaningfully; without `NAVER_TEST_URL`, the test falls back to `https://www.naver.com/` (not login-gated) and the missing-creds assertion is skipped.
- **Captcha behavior:** If Naver presents a captcha during the integration test, the headed browser WILL open visibly and the test will wait up to `CRAWL_HEADED_TIMEOUT_MS` (default 300 000 ms = 5 min) for the user to resolve it. This is documented behavior, not a test failure mode.

## Next Phase Readiness

- **For Phase 4 (CLI + packaging):** `runCrawl(configPath): Promise<CrawlResult>` is the stable public API. Phase 4's `bin` entry invokes it, maps `result.status === 'error'` to a non-zero exit code (and can read `result.error.code` for fine-grained exit-code conventions if desired), prints a concise stderr summary, and exits. All auth-related env vars (`NAVER_ID`, `NAVER_PW`, `CRAWL_HEADED_TIMEOUT_MS`, `RUN_NAVER_TESTS`, `NAVER_TEST_URL`) are consumed inside `src/auth/*` and `src/auth/naver.integration.test.ts`; Phase 4 only needs to document them in README.
- **For future iOS / other invokers:** The auth subsystem is reachable only through `runCrawl` (public) or a deliberate `../auth/index` import (internal). No public re-export leaks mean future refactors of `src/auth/*` are safe — the only cross-boundary consumer is `runner.ts`.
- **Blockers:** none.

## Self-Check: PASSED

**File existence checks:**
- `src/auth/index.ts` — FOUND
- `src/auth/index.test.ts` — FOUND
- `src/auth/naver.integration.test.ts` — FOUND
- `src/crawler/runner.ts.auth.test.ts` — FOUND
- `src/crawler/runner.ts` — FOUND (modified)
- `.planning/phases/03-naver-auth-session/03-03-SUMMARY.md` — FOUND (this file)

**Commit existence checks:**
- `fc83186` (Task 1: auth/index.ts barrel + unit tests) — FOUND in `git log`
- `80bc0aa` (Task 2: runner wiring + runner auth unit tests) — FOUND in `git log`
- `532f5a5` (Task 3: gated naver.integration.test.ts) — FOUND in `git log`

**Invariants verified:**
- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `npx vitest run` → 15 test files passed / 1 skipped; 181 tests passed / 4 skipped (was 168 passed; +13 unit + 4 gated-skipped = +13 active, +4 latent)
- `npx vitest run src/crawler/runner.integration.test.ts` → 6/6 passing (Phase 2 behavior preserved)
- `npx vitest run src/auth/index.test.ts` → 7/7 passing
- `npx vitest run src/crawler/runner.ts.auth.test.ts` → 6/6 passing
- `RUN_NAVER_TESTS=0 npx vitest run src/auth/naver.integration.test.ts` → 4 skipped, 0 passed, 0 failed (under 500 ms)
- `git diff HEAD~6 -- src/crawler/index.ts src/index.ts` → 0 lines (public barrels unchanged)
- `grep -c "export async function runCrawl(configPath: string): Promise<CrawlResult>" src/crawler/runner.ts` → `1` (signature unchanged)
- `grep -q "await ensureAuthenticated(handle.page, url, handle.browser)" src/crawler/runner.ts` → exit 0
- `grep -q "import { ensureAuthenticated } from '../auth/index'" src/crawler/runner.ts` → exit 0
- `grep -q "import { sessionExists, sessionFilePath } from '../auth/session'" src/crawler/runner.ts` → exit 0
- `grep -q "storageState = storagePath" src/crawler/runner.ts` → exit 0
- `! grep -q "process.exit" src/crawler/runner.ts` → exit 0
- `! grep -E "readline|process\\.stdin" src/auth/session.ts src/auth/detect.ts src/auth/naver.ts src/auth/headed.ts src/auth/index.ts` → exit 0 (all five source modules fully non-interactive; matches in test files are canary-string assertions, not real reads)
- `! grep -q "chromium.launch" src/auth/index.test.ts` → exit 0
- `grep -q "RUN_NAVER_TESTS === '1'" src/auth/naver.integration.test.ts` → exit 0
- `grep -q "describe.skipIf(!GATED)" src/auth/naver.integration.test.ts` → exit 0
- `grep -q "SESSION_FILENAME" src/auth/naver.integration.test.ts` → exit 0
- `grep -q "os.tmpdir" src/auth/naver.integration.test.ts` → exit 0
- `grep -q "process.chdir" src/auth/naver.integration.test.ts` → exit 0
- `grep -c "^  | '" src/crawler/types.ts` → 10 (CrawlErrorCode union cardinality preserved from Plan 03-01)

---
*Phase: 03-naver-auth-session*
*Completed: 2026-04-18*
