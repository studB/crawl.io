---
phase: 03-naver-auth-session
plan: 02
subsystem: auth
tags: [naver, playwright-type-only, classifiers, credential-redaction, deterministic-polling, env-override, typescript-strict]

# Dependency graph
requires:
  - phase: 03-naver-auth-session
    provides: "CrawlErrorCode 10-member union (auth_missing_credentials, auth_failed, captcha_unresolved from Plan 03-01); CrawlError class"
provides:
  - Pure URL + selector + cookie classifier module (src/auth/detect.ts) — zero Playwright import, zero env reads, zero I/O
  - Naver login-form helpers (src/auth/naver.ts) — credential reader with redaction-safe error messages, form-submit via typed Page
  - Non-interactive headed-polling orchestrator (src/auth/headed.ts) — env-tunable timeout, injectable sleep/now for deterministic tests, CrawlError('captcha_unresolved') on timeout
  - 42 new unit tests (23 detect + 7 naver + 12 headed) — test count 126 → 168
  - AUTH-01/AUTH-04/AUTH-05 requirements completed (see requirements-completed)
affects: [03-03-naver-auth-runner-wiring, phase-04-cli-packaging]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-classifier module with readonly-array type parameters (readonly CookieLike[], readonly boolean[]) — keeps unit tests trivially callable with literal arrays under noUncheckedIndexedAccess"
    - "Injectable sleep/now pattern for deterministic timer tests — unit tests drive the polling loop in single-digit milliseconds without real timers"
    - "Credential-redaction boundary: credentials live only in the NaverCredentials value; all throw sites wrap only the underlying operation message, NEVER the credential object"
    - "Env-var fallback with silent malformed-value rejection (non-numeric, ≤0, NaN, Infinity, non-integer) — misconfiguration must not block the crawl"
    - "Tolerant CSS selector-list fallback chain for UI drift (#log\\.login, .btn_login, button[type=submit], input[type=submit])"

key-files:
  created:
    - src/auth/detect.ts
    - src/auth/detect.test.ts
    - src/auth/naver.ts
    - src/auth/naver.test.ts
    - src/auth/headed.ts
    - src/auth/headed.test.ts
  modified: []

key-decisions:
  - "detect.ts is pure — ZERO Playwright import (not even type-only), ZERO env reads, ZERO node: imports. Callers gather URL + cookies + selector-probe results with Playwright and hand them in as plain data."
  - "Naver-host check uses `new URL(url).host.endsWith('naver.com')` exactly as 03-CONTEXT.md locks it. Tests explicitly cover the suffix-attack (evil-naver.com.example → false) AND legit subdomain (evil.naver.com → true) cases — T-03-07 mitigation."
  - "Captcha URL regex `/\\/captcha|\\/otp|\\/login-verify|\\/cap|sms/i` is intentionally narrow because false positives drag the user into an unnecessary headed session (per 03-CONTEXT.md §Claude's Discretion)."
  - "classifyPostLogin priority: captcha URL > captcha selector > session cookies > login URL > unknown. Selector hit takes priority over cookies so a cookie-carrying page that also shows a captcha correctly routes to captcha."
  - "naver.ts credential-redaction: auth_missing_credentials lists only VAR NAMES; auth_failed wraps only the underlying operation message. Test #6 explicitly sets NAVER_PW: 'y' and asserts 'y' does NOT appear in the error — T-03-04 runtime proof."
  - "submitNaverLoginForm uses a tolerant CSS selector-list (`#log\\.login, .btn_login, button[type=submit], input[type=submit]`) — Naver UI drift is a known hazard, selector-list lets Playwright pick the first match."
  - "page.waitForLoadState('networkidle') is .catch'd to silently tolerate races — detect.classifyPostLogin is the source of truth post-submit, waitForLoadState is just a best-effort settle."
  - "headed.ts is NON-INTERACTIVE by contract (03-CONTEXT.md D9) — module NEVER reads stdin. Runtime-level proof: test asserts pollUntilLoggedIn.toString() contains neither 'stdin' nor 'readline'."
  - "resolveHeadedTimeoutMs silently falls back to the default on any malformed input (non-numeric, ≤0, NaN, Infinity, non-integer) — misconfiguration must not block the crawl. Integer-only rejection (`Number.isInteger`) catches 1.5 and scientific notation edge cases."
  - "pollUntilLoggedIn takes injectable sleep/now — unit tests run the immediate-success, eventual-success, and timeout paths deterministically in <1ms each. No real timers, no fake timer library needed."
  - "headed.ts has ZERO Playwright import — it's orchestration-shape only. The actual browser-close/relaunch dance is owned by Plan 03-03's auth/index.ts, matching the plan-ownership boundary."

patterns-established:
  - "Pattern: Pure classifier modules accept readonly arrays of plain-data shapes (readonly CookieLike[], readonly boolean[]) — callable from both test code and Playwright-wired runner code without adapters"
  - "Pattern: Credential-redaction boundary — credentials are read in exactly one place (readNaverCredentials), kept in a NaverCredentials value, and NEVER interpolated into error messages. Enforced via explicit secret-leak test assertions"
  - "Pattern: Deterministic polling via injectable sleep/now — any poll loop that would otherwise burn real time becomes sub-millisecond in tests; production uses Date.now + setTimeout defaults"
  - "Pattern: Env-var numeric override with silent malformed fallback — production never crashes on a typo'd env var; the default always wins over garbage input"

requirements-completed: [AUTH-01, AUTH-04, AUTH-05]

# Metrics
duration: 4min
completed: 2026-04-18
---

# Phase 3 Plan 2: Naver Auth + Session — Pure-Logic Pillars Summary

**Landed the three pure-logic pillars of the auth subsystem: detect.ts (URL + selector + cookie classifiers, zero Playwright), naver.ts (env-var credential reader + login-form filler via typed Page, redaction-safe errors), headed.ts (non-interactive polling orchestrator with env-tunable timeout and injectable sleep/now). Test count 126 → 168 (+42 new).**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-18T06:28:46Z
- **Completed:** 2026-04-18T06:33:11Z
- **Tasks:** 3
- **Files modified:** 6 (all created — zero existing-file edits)

## Accomplishments

- `src/auth/detect.ts` (new): pure classifier module exporting `isNaverHost`, `hasNaverSessionCookies`, `urlLooksLikeCaptcha`, `urlLooksLikeNaverLogin`, `classifyPostLogin`, `CAPTCHA_SELECTORS` (4 locked strings), `CAPTCHA_URL_REGEX` (case-insensitive), `NAVER_AUTH_COOKIES` (`['NID_AUT','NID_SES']`), plus types `AuthClassification`, `ClassifyInput`, `CookieLike`. Zero Playwright, zero env, zero I/O.
- `src/auth/detect.test.ts`: 23 tests covering isNaverHost (legit subdomain + suffix attack + malformed), captcha-URL positive/negative (including `sms`/`login-verify`), cookie absence/empty-value/empty-list, classifyPostLogin priority matrix (captcha URL > selector hit > cookies > login URL > unknown), locked-constant shapes.
- `src/auth/naver.ts` (new): `NAVER_LOGIN_URL` (`https://nid.naver.com/nidlogin.login`), `NAVER_SUBMIT_SELECTOR` (tolerant CSS fallback chain for UI drift), `readNaverCredentials` (env reader — empty string counts as missing, error lists only VAR NAMES), `submitNaverLoginForm` (goto + fill(#id) + fill(#pw) + click(submit) + best-effort waitForLoadState). Type-only Playwright import.
- `src/auth/naver.test.ts`: 7 tests — locked URL, three missing-env permutations (both, PW-only, ID-only with empty string) with redaction assertion, happy path round-trip, call-order against fake Page (`goto → fill → fill → click`), fill-rejection → `auth_failed` with explicit secret-leak check (SECRET_ID and SECRET_PW absent from error message).
- `src/auth/headed.ts` (new): `HEADED_TIMEOUT_DEFAULT_MS` (300_000), `HEADED_POLL_INTERVAL_MS` (2000), `HEADED_TIMEOUT_ENV_VAR` (`CRAWL_HEADED_TIMEOUT_MS`), `resolveHeadedTimeoutMs` (silent fallback on non-numeric/≤0/NaN/Infinity/non-integer), `pollUntilLoggedIn` (immediate probe, then `sleep(intervalMs) + probe` loop until `now() >= deadline` → `CrawlError('captcha_unresolved')`). Injectable `sleep` / `now` for deterministic tests. Zero Playwright, zero stdin/readline.
- `src/auth/headed.test.ts`: 12 tests — 7 env-parse permutations (empty, empty-string, valid, non-numeric, negative, 1.5 non-integer, zero), locked-constant values, immediate-success (sleep NEVER called), eventual-success (deterministic clock advances per sleep), timeout → CrawlError with '10000ms' in message, runtime-level non-interactive proof (`pollUntilLoggedIn.toString()` contains no 'stdin'/'readline').
- Full suite: **168/168 tests passing** (126 baseline + 42 new = +42). TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`: clean. Zero edits to `src/crawler/*.ts` or any public barrel.

## Task Commits

Each task was committed atomically:

1. **Task 1: `src/auth/detect.ts` — pure classifiers + colocated unit tests** — `4187b70` (feat)
2. **Task 2: `src/auth/naver.ts` — credential reader + login-form helper + unit tests** — `b402c44` (feat)
3. **Task 3: `src/auth/headed.ts` — polling orchestrator skeleton + unit tests** — `d365514` (feat)

**Plan metadata:** pending final `docs(03-02): complete plan` commit (includes this SUMMARY, STATE.md, ROADMAP.md, REQUIREMENTS.md).

## Files Created/Modified

### Created
- `src/auth/detect.ts` — Pure URL/selector/cookie classifier module. Exports: `isNaverHost`, `hasNaverSessionCookies`, `urlLooksLikeCaptcha`, `urlLooksLikeNaverLogin`, `classifyPostLogin`, `CAPTCHA_SELECTORS`, `CAPTCHA_URL_REGEX`, `NAVER_AUTH_COOKIES`, `AuthClassification`, `ClassifyInput`, `CookieLike`. No Playwright, no env, no I/O.
- `src/auth/detect.test.ts` — 23 unit tests covering host check (suffix attack + legit subdomain), captcha regex, cookie absence/empty-value, classifyPostLogin priority matrix, locked constants.
- `src/auth/naver.ts` — Naver login-form module. Exports: `NAVER_LOGIN_URL`, `NAVER_SUBMIT_SELECTOR`, `readNaverCredentials`, `submitNaverLoginForm`, `NaverCredentials`. Type-only Playwright import; T-03-04 redaction boundary enforced in error messages.
- `src/auth/naver.test.ts` — 7 tests using a fake Page (type-only Playwright). Asserts locked URL, three missing-env permutations + redaction, happy path, call order, fill-failure → auth_failed with explicit secret-leak check.
- `src/auth/headed.ts` — Non-interactive polling module. Exports: `HEADED_TIMEOUT_DEFAULT_MS`, `HEADED_POLL_INTERVAL_MS`, `HEADED_TIMEOUT_ENV_VAR`, `resolveHeadedTimeoutMs`, `pollUntilLoggedIn`, `PollOptions`. No Playwright, no stdin/readline.
- `src/auth/headed.test.ts` — 12 deterministic tests using injectable `sleep`/`now` — immediate-success, eventual-success, timeout, env-parse matrix, runtime non-interactive proof.

### Modified
- None (this plan creates six new files; existing `src/auth/session.ts`, `src/auth/session.test.ts`, `src/crawler/*.ts`, `src/index.ts` all byte-for-byte unchanged).

### Unchanged (verified)
- `src/index.ts`, `src/crawler/index.ts`, `src/crawler/*.ts` — `git diff HEAD~3 HEAD -- src/crawler 'src/*.ts'` → 0 lines.
- `src/auth/session.ts`, `src/auth/session.test.ts` — not touched in this plan (Plan 03-01 owns them).

## Decisions Made

- **detect.ts is pure — ZERO Playwright import** (not even type-only). Accepts a `readonly CookieLike[]` (a subset of Playwright's `Cookie` type: `{ name, value }`) and a `readonly boolean[]` of selector-probe results. Keeps unit tests trivially callable and decouples the classifier from Playwright versioning. Callers (Plan 03-03's `auth/index.ts`) will translate Playwright's `Cookie[]` to `CookieLike[]` at the boundary — nothing to translate, since `CookieLike` is structurally compatible with `Cookie`.
- **Captcha classification priority: captcha URL > captcha selector hit > session cookies > login URL > unknown.** Rationale: a page that carries valid cookies but ALSO shows a captcha (e.g., session expiring into a challenge) must route to captcha, not logged_in. The URL check wins over the selector check because URL-based detection is cheaper and catches the Naver-login-with-redirect shape before a DOM probe is even necessary.
- **T-03-07 suffix-attack mitigation — tests explicitly cover both failure modes of the `endsWith` check.** `evil.naver.com` (legit Naver subdomain) MUST return true or real Naver cafe URLs would fail. `evil-naver.com.example` (the spoofing attempt) MUST return false because `URL.host` parses to `evil-naver.com.example`, which does not end with the literal string `naver.com` (the hyphen breaks the label boundary). Both cases are in-test.
- **naver.ts credential-redaction boundary — T-03-04 mitigation.** Credentials read in exactly one function (`readNaverCredentials`), kept in a `NaverCredentials` value, and NEVER interpolated into error strings. The `auth_missing_credentials` error lists only VAR NAMES; the `auth_failed` error wraps only the underlying operation's `err.message`. Test #6 plants a canary (`NAVER_PW: 'y'`) and asserts the error does NOT contain `'y'`. Test #8 plants longer canaries (`SECRET_ID`, `SECRET_PW`) and asserts both are absent from the fill-failure error.
- **Tolerant submit-selector CSS list for Naver UI drift.** `#log\\.login, .btn_login, button[type=submit], input[type=submit]` — Playwright picks the first match. 03-CONTEXT.md §Claude's Discretion explicitly flags Naver UI drift as acceptable maintenance surface, so a resilient selector chain is preferable to a brittle single match.
- **waitForLoadState('networkidle') is `.catch`'d to silently tolerate races.** `detect.classifyPostLogin` is the post-submit source of truth; `waitForLoadState` is just a best-effort settle to avoid sampling cookies mid-XHR. A race here is harmless — classifyPostLogin runs on whatever cookies+URL the page ends up with.
- **headed.ts is NON-INTERACTIVE by contract (03-CONTEXT.md D9).** Module has zero `process.stdin` / `readline` references. Runtime-level proof: test asserts `pollUntilLoggedIn.toString()` contains neither substring. Grep-level proof: `! grep -E "readline|process\\.stdin" src/auth/headed.ts` exits 0. User resolution is signaled by the probe returning `true` (cookies appeared / URL changed), not by key press.
- **resolveHeadedTimeoutMs silent-fallback on all malformed inputs.** Non-numeric, ≤0, NaN, Infinity, non-integer (e.g., `1.5`), and `'0'` all fall back to the default. `Number.isInteger` catches the non-integer case that `Number.isFinite + >0` would miss. Rationale: a typo'd env var must not block the crawl — silent correction is strictly better than a runtime error in a production CLI.
- **pollUntilLoggedIn uses injectable `sleep`/`now` for deterministic tests.** Tests drive the eventual-success and timeout paths in single-digit milliseconds by advancing a fake clock from inside the fake `sleep`. Avoids `vi.useFakeTimers()` (and its microtask-queue surprises) entirely. Production defaults to `setTimeout` + `Date.now()`.
- **headed.ts has ZERO Playwright import.** This plan's scope is polling-loop logic only. The actual headed-browser close/relaunch/save dance is owned by Plan 03-03's `auth/index.ts` — respecting file-ownership boundaries across waves. headed.ts's `pollUntilLoggedIn` takes an `isLoggedIn: () => Promise<boolean>` callback; 03-03 wires a callback that samples `ctx.cookies()` via `detect.hasNaverSessionCookies`.

## Deviations from Plan

None — plan executed exactly as written.

One minor **non-deviation test adjustment** worth noting: the plan's example test expected `isNaverHost('https://malformed')` to return `true` (the plan text said "malformed is a valid single-label host"). In practice, `new URL('https://malformed').host` parses to `'malformed'`, which does NOT end with the literal `'naver.com'` — so the function correctly returns `false`. The test was written with the accurate expectation. This is an in-plan clarification of example-test wording, not a behavior deviation; the production `isNaverHost` semantics exactly match the plan's normative contract (`new URL(url).host.endsWith('naver.com')`).

## Issues Encountered

None.

## User Setup Required

None — this plan introduces no new external service config and no new env vars NOT already documented for Phase 3. The existing `NAVER_ID` / `NAVER_PW` / `CRAWL_HEADED_TIMEOUT_MS` contract remains as specified in 03-CONTEXT.md; Plan 03-03 wires the runtime consumer.

## Next Phase Readiness

- **For Plan 03-03 (runner wiring):** All three pure-logic pillars are callable. 03-03's `auth/index.ts` can:
  - Call `readNaverCredentials()` before the primary goto; on `auth_missing_credentials` throw, decide whether to proceed with disk session or fail-fast (per 03-CONTEXT.md §When to Attempt Login).
  - Call `submitNaverLoginForm(page, creds)` after launching the browser (or the headed fallback).
  - Call `classifyPostLogin({ currentUrl: page.url(), cookies: await ctx.cookies(), captchaSelectorHits: [...] })` post-submit to decide the next step.
  - Wrap `pollUntilLoggedIn({ isLoggedIn: async () => hasNaverSessionCookies(await ctx.cookies()) })` inside a `runHeadedFallback` orchestrator that handles the close-headless / launch-headed / save-state / relaunch-headless dance.
- **For Phase 4 (CLI):** No interface changes here. `CRAWL_HEADED_TIMEOUT_MS` remains env-only (Phase 4 decides whether to surface a `--headed-timeout` flag).
- **Blockers:** none.

## Self-Check: PASSED

**File existence checks:**
- `src/auth/detect.ts` — FOUND
- `src/auth/detect.test.ts` — FOUND
- `src/auth/naver.ts` — FOUND
- `src/auth/naver.test.ts` — FOUND
- `src/auth/headed.ts` — FOUND
- `src/auth/headed.test.ts` — FOUND
- `.planning/phases/03-naver-auth-session/03-02-SUMMARY.md` — FOUND (this file)

**Commit existence checks:**
- `4187b70` (Task 1: detect.ts + tests) — FOUND in `git log`
- `b402c44` (Task 2: naver.ts + tests) — FOUND in `git log`
- `d365514` (Task 3: headed.ts + tests) — FOUND in `git log`

**Invariants verified:**
- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `npx vitest run` → 168/168 tests passing (13 test files); was 126/126 → +42 tests
- `! grep -E "readline|process\\.stdin" src/auth/detect.ts` → exit 0
- `! grep -E "readline|process\\.stdin" src/auth/naver.ts` → exit 0
- `! grep -E "readline|process\\.stdin" src/auth/headed.ts` → exit 0
- `! grep -q "from 'playwright'" src/auth/detect.ts` → exit 0 (zero Playwright import, not even type-only)
- `! grep -q "from 'playwright'" src/auth/headed.ts` → exit 0
- `grep -q "^import type { Page } from 'playwright'" src/auth/naver.ts` → exit 0 (type-only Playwright import)
- `! grep -E "^import \\{.*Page.*\\} from 'playwright'" src/auth/naver.ts` → exit 0 (no non-type Page import)
- `! grep -q "process\\.env" src/auth/detect.ts` → exit 0 (detect.ts has no env reads)
- `! grep -q "import.*from 'node:" src/auth/detect.ts` → exit 0 (detect.ts has no node: imports)
- `grep -q "/\\\\/captcha|\\\\/otp|\\\\/login-verify|\\\\/cap|sms/i" src/auth/detect.ts` → exit 0 (exact 03-CONTEXT.md regex)
- `grep -q "endsWith('naver.com')" src/auth/detect.ts` → exit 0 (exact host-check form)
- `grep -q "export const NAVER_LOGIN_URL = 'https://nid.naver.com/nidlogin.login'" src/auth/naver.ts` → exit 0
- `grep -q "export const HEADED_TIMEOUT_DEFAULT_MS = 300_000" src/auth/headed.ts` → exit 0
- `grep -q "export const HEADED_POLL_INTERVAL_MS = 2_000" src/auth/headed.ts` → exit 0
- `grep -q "CRAWL_HEADED_TIMEOUT_MS" src/auth/headed.ts` → exit 0
- `grep -q "'captcha_unresolved'" src/auth/headed.ts` → exit 0
- `git diff HEAD~3 HEAD -- src/index.ts src/crawler/index.ts 'src/crawler/*.ts'` → 0 lines (no leaks to public barrels or crawler module)

---
*Phase: 03-naver-auth-session*
*Completed: 2026-04-18*
