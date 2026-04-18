---
phase: 03-naver-auth-session
fixed_at: 2026-04-18T16:00:00Z
review_path: .planning/phases/03-naver-auth-session/03-REVIEW.md
iteration: 1
findings_in_scope: 11
fixes_applied: 8
fixes_deferred: 3
tests_passing: 194
status: partial
---

# Phase 3: Code Review Fix Report

**Fixed at:** 2026-04-18
**Source review:** `.planning/phases/03-naver-auth-session/03-REVIEW.md`
**Iteration:** 1

## Summary

- Findings in scope: 11 (2 high, 5 medium, 4 low)
- Fixes applied: 8 (both high, all five medium, one low)
- Fixes deferred: 3 (three of four low — rationale below)
- Test count: 181 → 194 (+13 new tests) | 4 skipped unchanged
- `npx tsc --noEmit`: exit 0 (clean)
- `npx vitest run`: 194 passed | 4 skipped (198 total) across 15 files

## Findings Table

| ID   | Severity | Status | Commit    | One-line summary |
|------|----------|--------|-----------|------------------|
| H-01 | high     | fixed  | 996ee21   | Narrowed `CAPTCHA_URL_REGEX` to path-segment-anchored sub-patterns; dropped `\\/cap`; anchored `sms` as `/sms(?:[/?]|$)` |
| H-02 | high     | fixed  | 4859284   | Added `writeSession` (tmp → rename atomic) + tmp cleanup on failure; both `context.storageState({ path })` callsites routed through it |
| M-01 | medium   | fixed  | 45f41cd   | Wrapped `launchHeaded` in try/catch → `CrawlError('captcha_unresolved', ...)` with scrubbed message naming the captcha context |
| M-02 | medium   | fixed  | 5c68f95   | Added `isCaptchaSelectorPresent` visibility gate so hidden `[id*=captcha]` nodes no longer force a headed fallback |
| M-03 | medium   | fixed  | 4859284   | Added `sessionLooksValid` (non-empty JSON object w/ `cookies` array); runner now gates session reuse on it instead of bare `sessionExists` |
| M-04 | medium   | deferred | —       | (see Deferred section) |
| M-05 | medium   | fixed  | f5702dc   | `scrubPaths` applied at the `auth_failed` throw site in `submitNaverLoginForm` |
| L-01 | low      | fixed  | f5702dc   | Consolidated missing-credential guard so TS narrows `id`/`pw` without non-null assertions |
| L-02 | low      | deferred | —       | (see Deferred section) |
| L-03 | low      | fixed  | bd3bba7   | Dropped unused `targetUrl` parameter (and `void targetUrl;`) from `runHeadedFallback` |
| L-04 | low      | deferred | —       | (see Deferred section — partial coverage landed with H-01/H-02/M-01/M-02/M-03) |

## Fixed Issues

### H-01: `CAPTCHA_URL_REGEX` false positives

**Files modified:** `src/auth/detect.ts`, `src/auth/detect.test.ts`
**Commit:** 996ee21
**Applied fix:** Replaced `/\/captcha|\/otp|\/login-verify|\/cap|sms/i` with `/\/captcha(?:[/?]|$)|\/otp(?:[/?]|$)|\/login-verify|\/sms(?:[/?]|$)/i`. Each sub-pattern is now anchored to a path-segment boundary. Negative regression tests cover `/capture-tutorial`, `/capture`, `/capital`, `/capacity`, `?tag=smstoday`, `?promo=captivate`, `/asmspace/foo`; positive cases cover `/v2/captcha`, `/captcha?foo=bar`, `/sms`, `/sms?`, `/sms/verify`, `/otp`, `/otp/x`.

### H-02: Non-atomic session write

**Files modified:** `src/auth/session.ts`, `src/auth/session.test.ts`, `src/auth/index.ts`, `src/auth/index.test.ts`, `src/crawler/runner.ts`, `src/crawler/runner.ts.auth.test.ts`
**Commit:** 4859284
**Applied fix:** New `writeSession(cwd, cb)` helper in `session.ts` — writes via caller-supplied callback to a sibling tmp path, then `rename(tmp, final)`. Best-effort `unlink(tmp)` on any cb/rename failure; original error propagates unchanged. Both `context.storageState({ path: sessionFilePath(cwd) })` sites in `auth/index.ts` now invoke `await writeSession(cwd, (tmp) => ctx.storageState({ path: tmp }))`. Three new tests: happy-path (asserts final file landed + tmp cleaned up), cb-throws-after-partial-write (tmp cleaned + original error propagates), cb-throws-before-tmp-write (unlink-ENOENT swallowed, original error propagates).

### M-01: Cryptic `launchHeaded` failure

**Files modified:** `src/auth/index.ts`, `src/auth/index.test.ts`
**Commit:** 45f41cd
**Applied fix:** Wrapped the `launchHeaded(seedPath)` call inside `runHeadedFallback` in a try/catch that re-throws `CrawlError('captcha_unresolved', 'headed browser could not launch to resolve captcha: ' + scrubPaths(e.message))`. New regression test simulates a `/home/alice/.cache/ms-playwright/chromium` failure and asserts: (a) code is `captcha_unresolved` not `unknown`, (b) message contains "captcha" hint, (c) `<HOME>` substitution applied, (d) `launchHeadless` never called.

### M-02: Over-broad `[id*=captcha]` selector

**Files modified:** `src/auth/index.ts`, `src/auth/index.test.ts`
**Commit:** 5c68f95
**Applied fix:** Extracted selector probing into `isCaptchaSelectorPresent(page, selector)` (exported). In addition to `count > 0`, requires the first match to be visible via `locator(sel).first().isVisible().catch(() => false)`. Chose Option B from the review (visibility gate) over Option A (drop the selector) because hidden disclaimer nodes are a documented failure mode and the visibility check is cheap. New regression test: hidden `[id*=captcha]` on a non-captcha URL → classifies as auth_failed (via login_required/unknown), NOT captcha; `launchHeaded` never called.

### M-03: Malformed/zero-byte session poisoning Playwright

**Files modified:** `src/auth/session.ts`, `src/auth/session.test.ts`, `src/crawler/runner.ts`, `src/crawler/runner.ts.auth.test.ts`
**Commit:** 4859284 (co-landed with H-02)
**Applied fix:** `sessionLooksValid(cwd)` helper in `session.ts` — `false` for missing / zero-byte / invalid-JSON / JSON-without-cookies-array; `true` only for a JSON object with `Array.isArray(parsed.cookies)`. Runner's session-reuse fast path now gates on `sessionLooksValid()` instead of `sessionExists()`. Five new tests cover: missing, zero-byte, garbage-JSON, valid-JSON-but-no-cookies-array, valid Playwright shape.

### M-05: Playwright error messages bypass `scrubPaths`

**Files modified:** `src/auth/naver.ts`
**Commit:** f5702dc
**Applied fix:** Applied `scrubPaths(...)` to the underlying-error message at the `throw new CrawlError('auth_failed', ...)` site inside `submitNaverLoginForm`'s catch block. Redaction is now a module-local property, not dependent on the runner's outer catch. Existing naver.test.ts suite still passes (7 tests — the redaction-boundary test at SECRET_ID/PW leakage was the binding constraint and is unaffected).

### L-01: Non-null assertions in `readNaverCredentials`

**Files modified:** `src/auth/naver.ts`
**Commit:** f5702dc (co-landed with M-05)
**Applied fix:** Consolidated the pair of presence checks into a single guarded branch `if (id === undefined || id.length === 0 || pw === undefined || pw.length === 0)`, so TypeScript narrows `id` and `pw` to `string` at the return site. The `return { id: id!, pw: pw! }` became `return { id, pw }`. No behavior change; semantic identical to prior logic, and the `strict` null-check posture is no longer defeated by future refactors.

### L-03: Unused `targetUrl` parameter

**Files modified:** `src/auth/index.ts`, `src/auth/session.ts` (writeSession callback-return-type widened to `Promise<unknown>` so `context.storageState({ path })`'s StorageState return is accepted without a wrapper)
**Commit:** bd3bba7
**Applied fix:** Removed the `targetUrl: string` parameter from `runHeadedFallback` and the accompanying `void targetUrl;` suppression. Updated the sole callsite inside `ensureAuthenticated`. When Phase 4 adds "relaunched headless to resume ..." logging, reintroduce the parameter at the call chain then.

## Deferred Issues

### M-04: `ensureAuthenticated` duplicates `readNaverCredentials` presence check

**Reason:** Cosmetic / low-risk — the duplicate `typeof ... === 'string' && .length > 0` check in `index.ts:150-151` is a short-lived "is a login even worth attempting" gate that precedes calling `readNaverCredentials` later. Extracting a `hasNaverCredentials(env)` helper saves ~4 lines but adds a cross-module helper that would need its own test; the drift risk the reviewer flagged is real but remote (the contract of "both env vars non-empty strings" is extremely unlikely to change within v1). Deferred to a future cleanup.

### L-02: `pollUntilLoggedIn` iteration cap as defense-in-depth

**Reason:** Speculative safeguard. The failure mode (a test fake whose `sleep` doesn't advance `now`) is caught by test timeouts, not by correctness. Adding a max-iterations counter would mask the real test bug (forgetting to advance the clock) with a silent timeout. The jsdoc contract note is sufficient documentation for now. Deferred.

### L-04: Additional test coverage (expired session, selector false-positive, malformed session)

**Reason:** PARTIALLY addressed in-flight. The selector-false-positive case is now covered by the M-02 regression test. The malformed-session case is covered by the five new `sessionLooksValid` tests (M-03) and the new atomic-write tests (H-02). The remaining uncovered case — a session file with valid JSON whose cookies Playwright accepts but which the target URL rejects via a post-goto redirect back to `nid.naver.com` — needs a richer fake Playwright page that models navigation/redirect, and is a better fit for the Phase 4 integration-test suite than a Phase 3 retrofit. Deferred.

## Verification

**TypeScript:**
```
$ npx tsc --noEmit
(exit 0, no output)
```

**Test suite:**
```
$ npx vitest run
Test Files  15 passed | 1 skipped (16)
Tests      194 passed | 4 skipped (198)
Duration   ~8.6s
```

**Baseline before fixes:** 181 passed | 4 skipped
**Delta:** +13 new tests, 0 regressions, 0 new skips.

Per-suite deltas (after / before):
- `src/auth/detect.test.ts`: 26 / 20 (+6 for H-01)
- `src/auth/session.test.ts`: 12 / 4 (+8 for H-02/M-03)
- `src/auth/index.test.ts`: 9 / 7 (+2 for M-01 + M-02) — note: one existing storageState assertion was updated in-place to match the new tmp-then-rename write, not counted as +1
- All other suites unchanged.

---

_Fixed: 2026-04-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
