---
phase: 03-naver-auth-session
verified: 2026-04-18T16:05:00Z
status: human_needed
score: 4/4 must-haves verified (automated)
must_have_score: 4/4
overrides_applied: 0
requirements_covered:
  - id: AUTH-01
    status: satisfied
    evidence: "readNaverCredentials reads process.env.NAVER_ID/NAVER_PW in src/auth/naver.ts:50-51; invoked by ensureAuthenticated only when isNaverHost(targetUrl); see src/auth/index.ts:195"
  - id: AUTH-02
    status: satisfied
    evidence: "ensureAuthenticated saves storageState via atomic writeSession at src/auth/index.ts:213 (logged_in branch) and :328 (post-headed branch); session file path from sessionFilePath(cwd)"
  - id: AUTH-03
    status: satisfied
    evidence: "runner.ts:134 gates session reuse on sessionLooksValid() (M-03 hardening) and passes storagePath to launchBrowser; ensureAuthenticated also short-circuits when NID_AUT+NID_SES already in context (src/auth/index.ts:172)"
  - id: AUTH-04
    status: satisfied
    evidence: "CAPTCHA_URL_REGEX (detect.ts:53, H-01 narrowed), CAPTCHA_SELECTORS (detect.ts:29), classifyPostLogin priority (detect.ts:108), probeCaptchaSelectors with visibility gate (auth/index.ts:93-126, M-02 hardening)"
  - id: AUTH-05
    status: needs_human
    evidence: "runHeadedFallback closes headless, launches headed, polls via hasNaverSessionCookies every HEADED_POLL_INTERVAL_MS up to CRAWL_HEADED_TIMEOUT_MS, atomically saves session, relaunches headless (auth/index.ts:241-365). Unit tests exercise the orchestration with injected fakes; end-to-end captcha resolution in a visible window cannot be automated"
  - id: AUTH-06
    status: satisfied
    evidence: ".gitignore line 7 contains `.crawl-session.json`"
invariants_verified:
  - "npx tsc --noEmit → exit 0"
  - "npx vitest run → 194 passed | 4 skipped (15 files passed, 1 file skipped)"
  - "grep -c '^  | ' src/crawler/types.ts → 10 (CrawlErrorCode cardinality)"
  - "grep -q 'toHaveLength(10)' src/crawler/errors.test.ts → exit 0"
  - "runCrawl signature: `export async function runCrawl(configPath: string): Promise<CrawlResult>` present exactly once in src/crawler/runner.ts"
  - "! grep -q 'process.exit' src/crawler/runner.ts → exit 0"
  - "src/crawler/index.ts byte-unchanged since Phase 2 (git log --follow: last touching commit c46e170, a Phase-2 commit)"
  - "src/index.ts byte-unchanged since Phase 2 (git log --follow: last touching commit c46e170, a Phase-2 commit)"
  - "No auth re-exports from public barrels (grep for 'auth' in src/index.ts + src/crawler/index.ts returns nothing)"
  - "Non-interactive: ! grep -E 'readline|process\\.stdin' src/auth/{session,detect,naver,headed,index}.ts → exit 0"
  - ".gitignore contains .crawl-session.json at line 7"
review_fix_findings_landed:
  - "H-01: CAPTCHA_URL_REGEX narrowed to path-segment anchors (detect.ts:53) — /\\/captcha(?:[/?]|$)|\\/otp(?:[/?]|$)|\\/login-verify|\\/sms(?:[/?]|$)/i"
  - "H-02: writeSession helper (session.ts:109) implements tmp+rename atomic write; both storageState callsites route through it (auth/index.ts:213, :328); sessionLooksValid (session.ts:78) gates corrupt-file recovery"
  - "M-01: launchHeaded failure wrapped in try/catch and rethrown as CrawlError('captcha_unresolved') with scrubPaths on underlying message (auth/index.ts:290-299)"
  - "M-05: scrubPaths applied at auth_failed throw site in submitNaverLoginForm (naver.ts:117)"
human_verification:
  - test: "End-to-end captcha/2FA headed fallback with a real Naver account"
    expected: "When Naver presents a captcha during login, a visible Chromium window opens, the user resolves the challenge, the crawl resumes in headless mode with the same runCrawl invocation (no restart), .crawl-session.json contains valid cookies, and the next run reuses the session without triggering the headed flow"
    why_human: "Captcha challenges cannot be simulated against real Naver; a human must observe the headed window opens, interact with the captcha, and confirm the seamless resumption. Unit tests cover the orchestration branches with injected fakes but cannot exercise the user-resolves-in-window path"
  - test: "First-run login + second-run reuse against a login-gated Naver Cafe page"
    expected: "With NAVER_ID/NAVER_PW set and RUN_NAVER_TESTS=1 (plus NAVER_TEST_URL pointing at a login-gated cafe post), first `crawl run <file.md>` completes with status=ok and creates .crawl-session.json; second run with same config completes without re-entering credentials (session reuse path taken)"
    why_human: "Gated integration tests in src/auth/naver.integration.test.ts skip by default in this environment (no RUN_NAVER_TESTS=1 + creds); they require a real Naver account + opt-in to execute. The test file structurally covers this scenario but is not runnable in CI"
  - test: "Missing credentials + login-gated URL surfaces auth_missing_credentials"
    expected: "With NAVER_ID/NAVER_PW unset and no .crawl-session.json on disk, `crawl run <file.md>` against a Naver URL produces a CrawlResult with status=error, error.code='auth_missing_credentials', and the `# Output` section in the markdown file contains a corresponding error entry"
    why_human: "Requires a real Naver URL + real absence of creds; unit tests verify the classification and envelope flow via mocks"
---

# Phase 3: Naver Auth + Session Verification Report

**Phase Goal:** The crawler can log into Naver Cafe with env-var credentials, persist the session, reuse it on repeat runs, and fall back to a headed browser when a captcha challenge is detected.

**Verified:** 2026-04-18T16:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Setting `NAVER_ID` + `NAVER_PW` + pointing at a login-gated Naver Cafe page completes without a credentials error | VERIFIED (automated) | `readNaverCredentials` (naver.ts:47) reads env; `ensureAuthenticated` (auth/index.ts:151) gates attempt on `isNaverHost(targetUrl)` + presence of both creds; runner.ts:147 wires the call before `page.goto`. Unit coverage: src/auth/index.test.ts (9 tests), src/auth/naver.test.ts (7 tests), src/crawler/runner.ts.auth.test.ts (6 tests). End-to-end confirmation blocked on real creds — see human verification item #2 |
| 2 | After login, `.crawl-session.json` exists; subsequent run reuses without re-login | VERIFIED (automated) | Logged-in branch persists session via atomic `writeSession(cwd, (tmp) => context.storageState({ path: tmp }))` at auth/index.ts:213. Reuse path: runner.ts:134 gates on `sessionLooksValid()` (M-03 hardening) and passes storagePath to `launchBrowser`; `ensureAuthenticated` short-circuits at auth/index.ts:172 when NID_AUT+NID_SES already in context. Gated integration test `second run reuses the session without triggering a fresh login flow` in naver.integration.test.ts:80 structurally covers this; live confirmation = human item #2 |
| 3 | `.crawl-session.json` in `.gitignore` | VERIFIED | `.gitignore` line 7: `.crawl-session.json` |
| 4 | Captcha/2FA → headed browser opens → user resolves → session saved → crawl resumes (no restart) | VERIFIED (automated orchestration); NEEDS HUMAN (end-to-end) | `runHeadedFallback` at auth/index.ts:241-365: closes headless (:262), launches headed (:291), polls via `hasNaverSessionCookies` every `HEADED_POLL_INTERVAL_MS` up to `CRAWL_HEADED_TIMEOUT_MS` (:305-322), atomically saves session (:328), relaunches headless (:349-364). runner.ts:148-164 detects the page-identity swap and rebinds `handle` so the `finally` block closes the correct browser. Unit coverage in src/auth/index.test.ts exercises each branch with fake `launchHeaded`/`launchHeadless`. Live captcha resolution = human item #1 |

**Score:** 4/4 truths verified (automated); item #4 has an end-to-end component needing human testing.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/auth/session.ts` | Session path + exists + atomic write + validator | VERIFIED | Exports `SESSION_FILENAME`, `sessionFilePath`, `sessionExists`, `readSession`, `sessionLooksValid`, `writeSession`. 131 lines, zero Playwright import |
| `src/auth/detect.ts` | Pure classifiers (URL + cookies + selector hits) | VERIFIED | Exports `isNaverHost`, `hasNaverSessionCookies`, `urlLooksLikeCaptcha`, `urlLooksLikeNaverLogin`, `classifyPostLogin`, `CAPTCHA_SELECTORS`, `CAPTCHA_URL_REGEX` (narrowed), `NAVER_AUTH_COOKIES`. Zero Playwright, zero env, zero I/O |
| `src/auth/naver.ts` | Credential reader + login-form submit | VERIFIED | Exports `NAVER_LOGIN_URL`, `NAVER_SUBMIT_SELECTOR`, `readNaverCredentials`, `submitNaverLoginForm`. Type-only Playwright import. `scrubPaths` applied at auth_failed throw site (M-05). Non-null assertions removed (L-01) |
| `src/auth/headed.ts` | Polling orchestrator (non-interactive) | VERIFIED | Exports `HEADED_TIMEOUT_DEFAULT_MS` (300_000), `HEADED_POLL_INTERVAL_MS` (2_000), `HEADED_TIMEOUT_ENV_VAR` (`CRAWL_HEADED_TIMEOUT_MS`), `resolveHeadedTimeoutMs`, `pollUntilLoggedIn`. Zero Playwright, zero stdin/readline |
| `src/auth/index.ts` | Internal barrel with `ensureAuthenticated` | VERIFIED | Exports `ensureAuthenticated`, `AuthContextOptions`, `AuthLaunchHandle`, `isCaptchaSelectorPresent`. Composes all four submodules. M-01 (launchHeaded→captcha_unresolved), M-02 (visibility gate), H-02 (atomic writes) applied |
| `src/crawler/runner.ts` | Runner wiring (storage reuse + ensureAuthenticated) | VERIFIED | Imports `ensureAuthenticated` (line 40) + `sessionFilePath, sessionLooksValid` (line 41); M-03 hardened reuse at :134; single `ensureAuthenticated(handle.page, url, handle.browser)` call at :147; page-identity swap at :148-164; public signature unchanged |
| `src/crawler/types.ts` | 10-member CrawlErrorCode | VERIFIED | Exactly 10 union members (grep count = 10); includes 3 new auth codes in union order; `'unknown'` remains last |
| Test files | Unit + gated integration | VERIFIED | 7 test files under src/auth/ (session, detect, naver, headed, index — all `.test.ts`; `naver.integration.test.ts` gated) + `src/crawler/runner.ts.auth.test.ts` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `src/crawler/runner.ts` | `src/auth/index.ts` | `ensureAuthenticated(handle.page, url, handle.browser)` | WIRED | grep -n match at runner.ts:147 |
| `src/crawler/runner.ts` | `src/auth/session.ts` | `sessionLooksValid() ? sessionFilePath() : undefined` | WIRED | runner.ts:134; M-03 gate in place |
| `src/auth/index.ts` | `src/auth/{session,detect,naver,headed}.ts` | internal imports | WIRED | All four imports present at auth/index.ts:36-53 |
| `src/crawler/runner.ts` | `src/crawler/output.ts::scrubPaths` | existing catch path applies scrubPaths to error.message + error.stack | WIRED | runner.ts:210: `errorPayload(code, scrubPaths(message), scrubPaths(stack))` |
| `src/auth/naver.ts` | `src/crawler/output.ts::scrubPaths` | `auth_failed` throw site | WIRED | naver.ts:117 (M-05 fix) |
| Public barrels | `src/auth/*` | (must NOT be re-exported) | VERIFIED isolation | `grep -r 'auth' src/index.ts src/crawler/index.ts` → no matches |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ensureAuthenticated` | `preCookies` | `page.context().cookies()` | Yes — real Playwright BrowserContext | FLOWING |
| `ensureAuthenticated` | `creds` | `readNaverCredentials(env)` → `process.env.NAVER_ID/PW` | Yes — real env reads | FLOWING |
| `runHeadedFallback` | `timeoutMs` | `resolveHeadedTimeoutMs(env)` → `process.env.CRAWL_HEADED_TIMEOUT_MS` | Yes | FLOWING |
| `runner.ts` Stage 2 | `storagePath` | `sessionLooksValid()` gates real file read | Yes | FLOWING |
| `session.writeSession` | session JSON | Playwright `context.storageState({ path: tmp })` → rename to final | Yes — real Playwright serialization | FLOWING |

No hollow wiring — all data paths trace back to real system sources (env, Playwright cookies, fs reads/writes).

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| TypeScript compiles under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes | `npx tsc --noEmit` | exit 0, no output | PASS |
| Full test suite passes (194 unit + 4 gated-skipped integration) | `npx vitest run` | 15 passed / 1 skipped files; 194 passed / 4 skipped tests | PASS |
| CrawlErrorCode cardinality = 10 | `grep -c "^  \| '" src/crawler/types.ts` | 10 | PASS |
| Error cardinality lock test in place | `grep -q "toHaveLength(10)" src/crawler/errors.test.ts` | exit 0 | PASS |
| runCrawl signature unchanged | `grep -c "^export async function runCrawl(configPath: string): Promise<CrawlResult>" src/crawler/runner.ts` | 1 | PASS |
| runner.ts never calls process.exit | `! grep -q "process.exit" src/crawler/runner.ts` | exit 0 | PASS |
| Auth modules non-interactive | `! grep -E "readline\|process\\.stdin" src/auth/{session,detect,naver,headed,index}.ts` | exit 0 | PASS |
| Public barrels unchanged since Phase 2 | `git log --follow src/crawler/index.ts src/index.ts` latest touch = c46e170 (Phase 2) | Phase-2 commit | PASS |
| Auth not re-exported | `grep -rE "auth" src/index.ts src/crawler/index.ts` | no matches | PASS |
| .gitignore covers session file | `grep -qE "^\\.crawl-session\\.json$" .gitignore` | match at line 7 | PASS |
| ensureAuthenticated call site in runner | `grep -q "await ensureAuthenticated(handle.page, url, handle.browser)" src/crawler/runner.ts` | match at runner.ts:147 | PASS |

All 11 spot-checks PASS.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| AUTH-01 | 03-02, 03-03 | Reads `NAVER_ID`/`NAVER_PW` from env when target requires Naver login | SATISFIED | `readNaverCredentials` in naver.ts:47-66 reads `process.env.NAVER_ID`/`NAVER_PW`; called only after `isNaverHost(targetUrl)` gate in auth/index.ts:163 |
| AUTH-02 | 03-01, 03-03 | Saves Playwright storage state to `.crawl-session.json` after successful login | SATISFIED | `writeSession(cwd, (tmp) => context.storageState({ path: tmp }))` at auth/index.ts:213 (logged-in branch) + :328 (post-headed branch). Atomic tmp+rename guarantees no corrupt file |
| AUTH-03 | 03-01, 03-03 | Reuses `.crawl-session.json` on subsequent runs when session is still valid | SATISFIED | runner.ts:134 — `sessionLooksValid()` ? `sessionFilePath()` : undefined` passed to `launchBrowser`; ensureAuthenticated short-circuits at auth/index.ts:172 when cookies already present |
| AUTH-04 | 03-02, 03-03 | Detects captcha / 2FA challenges during login | SATISFIED | URL regex (detect.ts:53, H-01 narrowed), selector list (detect.ts:29), visibility-gated selector probe (auth/index.ts:108-126, M-02), priority-ordered classifyPostLogin (detect.ts:108) |
| AUTH-05 | 03-02, 03-03 | Opens headed browser for manual resolution, waits, saves fresh state, proceeds | SATISFIED (orchestration) / NEEDS HUMAN (end-to-end) | `runHeadedFallback` (auth/index.ts:241-365) + runner page-identity swap (runner.ts:148-164) + `pollUntilLoggedIn` (headed.ts:73-91). Orchestration unit-tested with fakes; live captcha resolution is inherently human |
| AUTH-06 | 03-01 | `.crawl-session.json` is in `.gitignore` | SATISFIED | .gitignore line 7 |

**No orphaned requirements.** REQUIREMENTS.md maps Phase 3 to AUTH-01..06 and every ID is claimed by at least one plan.

### Anti-Patterns Found

None of Blocker or Warning severity. All `TODO`/placeholder text is in DOC or COMMENT sections explaining design decisions; no runtime stubs. Key pattern check results:

| Pattern | Finding | Severity |
|---------|---------|----------|
| `return null` / empty handlers in auth modules | None in source files (only in test fakes) | OK |
| Hardcoded empty data in rendered output | None — all cookie/session data flows from Playwright/env at call time | OK |
| TODO/FIXME in source | None in src/auth/*.ts or runner.ts Phase-3 additions | OK |
| Non-interactive contract violation | Zero `readline`/`process.stdin` in src/auth/*.ts source files | OK |
| Unscrubbed error paths | scrubPaths applied at naver.ts:117 (M-05) AND at runner.ts:210 (outer belt) | OK |

### Human Verification Required

Three items need live observation against a real Naver account. Unit coverage exercises every branch with injected fakes, but certain behaviors (captcha resolution in a visible browser, cookie rotation by Naver, login-gated page redirects) cannot be simulated deterministically.

#### 1. End-to-end captcha/2FA headed fallback with a real Naver account

**Test:** Set `NAVER_ID`/`NAVER_PW` to credentials for an account Naver will occasionally challenge (or trigger the challenge by logging in from a new IP). Run `crawl run <login-gated-job.md>`. When the captcha appears, resolve it in the visible Chromium window.

**Expected:**
- A visible Chromium window opens (headed mode).
- stderr emits `⚠ Captcha/2FA detected — resolve it in the visible browser window. Waiting up to 300s...`
- After manual resolution, the crawl continues without restart (no second `crawl run` invocation needed).
- `.crawl-session.json` now contains valid `NID_AUT` + `NID_SES` cookies.
- `# Output` entry shows `status: ok` with the expected fields.

**Why human:** Captcha challenges cannot be deterministically triggered against real Naver; the user-resolves-in-window interaction is inherently manual.

#### 2. First-run login + second-run reuse against a login-gated Naver Cafe page

**Test:** Set `RUN_NAVER_TESTS=1`, `NAVER_ID`, `NAVER_PW`, and `NAVER_TEST_URL=<a login-gated cafe post URL>`. Run `npx vitest run src/auth/naver.integration.test.ts`. Or equivalently, delete `.crawl-session.json`, run `crawl run <file.md>` twice, observing the first creates the session and the second reuses it.

**Expected:**
- First run: browser logs in, `.crawl-session.json` is created (non-empty JSON), `status: ok`.
- Second run: no login form interaction observed (session-reuse fast path), `.crawl-session.json` still valid, `status: ok`.

**Why human:** The gated integration test file structurally covers this scenario but is skipped by default in CI (4 skipped tests observed). Opt-in requires real Naver creds + a chosen test URL.

#### 3. Missing credentials + login-gated URL surfaces `auth_missing_credentials`

**Test:** With `NAVER_ID` and `NAVER_PW` unset and `.crawl-session.json` absent, run `crawl run <file.md>` where the URL is a login-gated Naver Cafe page.

**Expected:**
- `CrawlResult.status === 'error'`
- `CrawlResult.error.code === 'auth_missing_credentials'`
- `# Output` entry in the markdown file contains the error code and a scrubbed message (no absolute paths).

**Why human:** Requires a real login-gated Naver URL to distinguish the creds-missing branch from the non-Naver-host fast path. Unit tests cover the classification logic and envelope flow via mocks; this verifies the real HTTP-level behavior.

### Gaps Summary

**No gaps found.** Every automated invariant from the verification checklist passed:
- TypeScript strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess: clean
- 194 tests pass / 4 correctly skipped (gated integration tests)
- `CrawlErrorCode` is a 10-member union with three new auth variants
- `runCrawl(configPath: string): Promise<CrawlResult>` signature preserved exactly once
- `src/crawler/index.ts` and `src/index.ts` byte-unchanged since Phase 2 (last touching commit is Phase-2 era `c46e170`)
- `src/auth/` is internal-only — zero re-exports in public barrels
- Non-interactive contract holds (no `readline`/`process.stdin` in auth source modules)
- `.crawl-session.json` in `.gitignore`
- Session file path logic resolves to repo root via `sessionFilePath(cwd=process.cwd())`
- All review-fix findings (H-01, H-02, M-01, M-02, M-03, M-05) landed as specified

The only remaining work is live human testing against real Naver (captcha flow, session reuse against a login-gated page, missing-creds against a gated URL) — see the Human Verification Required section above.

---

*Verified: 2026-04-18T16:05:00Z*
*Verifier: Claude (gsd-verifier)*
