---
phase: 03-naver-auth-session
plan: 01
subsystem: auth
tags: [naver, session, storage-state, playwright-adjacent, node-fs-promises, typescript-strict]

# Dependency graph
requires:
  - phase: 02-core-crawler-output
    provides: CrawlErrorCode union, CrawlError class, launchBrowser({ storageState? }) hook, .gitignore already covering .crawl-session.json (AUTH-06)
provides:
  - CrawlErrorCode union expanded to 10 members with three new auth variants (auth_missing_credentials, auth_failed, captcha_unresolved)
  - Cardinality-locked exhaustiveness test so removing any CrawlErrorCode variant now fails CI
  - Playwright-free session-file helper (src/auth/session.ts) exposing SESSION_FILENAME, sessionFilePath(cwd), sessionExists(cwd), readSession(cwd) with cwd resolved at call time
  - Unit coverage for the session module (4 tests, tmpdir-based, zero repo writes)
  - AUTH-06 verification: .gitignore contains .crawl-session.json (no edit; already present)
affects: [03-02-naver-auth-detect-forms, 03-03-naver-auth-runner-wiring, phase-04-cli-packaging]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Call-time process.cwd() resolution in session module (no top-level capture) — enables tests to pass a tmpdir without chdir"
    - "ENOENT-as-undefined pattern in readSession — raw string return keeps the surface narrow; other fs errors propagate unchanged for caller classification"
    - "Union-cardinality lock test: exhaustive literal array + expect(codes).toHaveLength(N) so accidental variant removal fails fast"

key-files:
  created:
    - src/auth/session.ts
    - src/auth/session.test.ts
  modified:
    - src/crawler/types.ts
    - src/crawler/errors.test.ts

key-decisions:
  - "readSession returns the RAW UTF-8 string (not parsed JSON) — Playwright consumes the file via its own { storageState: path } option, so this module never parses"
  - "cwd is a typed parameter with process.cwd() default, resolved at CALL time — tests pass os.tmpdir() paths without mutating any global state"
  - "session.ts has ZERO Playwright imports — keeps unit tests zero-browser and lets the module be imported from any layer without pulling the browser"
  - "Kept 'unknown' as the last union member; inserted the three new auth codes BEFORE 'unknown' so the ordering invariant holds"
  - "Did NOT touch the stale `7-member string-literal union` JSDoc in src/crawler/index.ts — explicitly reserved for Plan 03-03 (barrel ownership); acceptable single-wave staleness"

patterns-established:
  - "Pattern: Session-file helper owns ONLY path resolution + existence + raw read; no JSON parsing, no Playwright coupling"
  - "Pattern: Cardinality-lock tests for string-literal unions — add a toHaveLength(N) assertion next to the exhaustiveness loop"

requirements-completed: [AUTH-02, AUTH-03, AUTH-06]

# Metrics
duration: 2min
completed: 2026-04-18
---

# Phase 3 Plan 1: Naver Auth + Session — Foundation Types & Session Helper Summary

**Extended `CrawlErrorCode` to 10 members (three new auth variants), locked the cardinality via test, and landed a Playwright-free `src/auth/session.ts` helper (path + existence + raw read) with tmpdir-based round-trip coverage.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-18T06:22:50Z
- **Completed:** 2026-04-18T06:24:24Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 edited)

## Accomplishments
- `CrawlErrorCode` union grew from 7 → 10 members with `'auth_missing_credentials'`, `'auth_failed'`, `'captcha_unresolved'` inserted BEFORE `'unknown'` (ordering invariant preserved).
- `errors.test.ts` exhaustiveness loop now enumerates all 10 literals AND adds `expect(codes).toHaveLength(10)` so accidental variant removal breaks the test.
- `src/auth/session.ts` (new module): `SESSION_FILENAME` constant + `sessionFilePath(cwd)` + `sessionExists(cwd): Promise<boolean>` + `readSession(cwd): Promise<string | undefined>`. No Playwright. `cwd` defaults to `process.cwd()` but is evaluated at call time.
- `src/auth/session.test.ts`: 4 tests (constant value, path join, missing-file → false + undefined, round-trip via `os.tmpdir()`). Cleans up on success AND failure via try/finally. Zero repo writes.
- AUTH-06 re-verified: `grep -qE '^\.crawl-session\.json$' .gitignore` exits 0 (already satisfied by Phase 2 Plan 02-01; no edit).
- Full suite: 126/126 tests passing (122 baseline + 4 new). TypeScript strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes: clean.

## Task Commits

Each task committed atomically:

1. **Task 1: Extend CrawlErrorCode union + lock cardinality in errors.test.ts** — `b2244ca` (feat)
2. **Task 2: Implement src/auth/session.ts + unit tests; verify .gitignore AUTH-06** — `5881919` (feat)

**Plan metadata:** pending final `docs(03-01): complete plan` commit.

## Files Created/Modified

### Created
- `src/auth/session.ts` — Playwright-free session-file helper. Exports `SESSION_FILENAME` constant, `sessionFilePath(cwd)` path joiner, `sessionExists(cwd)` non-throwing exists check, `readSession(cwd)` raw UTF-8 read (ENOENT → undefined, others propagate). All take an optional `cwd` param that defaults to `process.cwd()` at call time.
- `src/auth/session.test.ts` — 4 unit tests verifying: constant literal value, path-join behavior, missing-file returns `false` + `undefined`, and round-trip `write → sessionExists === true → readSession === payload`. All tmp work goes through `os.tmpdir()` and cleans up in `finally`.

### Modified
- `src/crawler/types.ts` — `CrawlErrorCode` union expanded from 7 to 10 members. Three new variants inserted before `'unknown'`: `'auth_missing_credentials'`, `'auth_failed'`, `'captcha_unresolved'`. `CrawlResult` and all other exports byte-for-byte unchanged.
- `src/crawler/errors.test.ts` — Exhaustiveness loop's `codes` array grown to 10 entries (union order). Added `expect(codes).toHaveLength(10)` cardinality lock after the loop inside the same `it` block.

### Unchanged (verified)
- `src/crawler/errors.ts`, `src/crawler/index.ts`, `src/index.ts` — byte-for-byte unchanged (`git diff HEAD~2 HEAD -- src/index.ts src/crawler/index.ts src/crawler/errors.ts` → 0 lines).
- `.gitignore` — AUTH-06 line (`.crawl-session.json`) already present from Phase 2; verified, not edited.

## Decisions Made

- **readSession returns the raw UTF-8 string, not parsed JSON.** Rationale: Playwright consumes the session via its own `{ storageState: path }` option, so parsing here would be dead code. A raw-string return also keeps the module from caring about the storageState schema (which Playwright owns).
- **`cwd` is a parameter (default `process.cwd()`), resolved at call time.** Rationale: lets tests point at `os.tmpdir()` without `chdir`ing the process. No top-level `process.cwd()` capture — would freeze the path at module-import time and break parallel test runs.
- **No Playwright import in `session.ts` or `session.test.ts`.** Rationale: keeps unit tests zero-browser (fast, no CI infra), and lets the module be imported from any layer without dragging the browser into the dependency graph.
- **Stale `7-member string-literal union` JSDoc in `src/crawler/index.ts` left alone.** Rationale: that barrel is owned by Plan 03-03 per the plan text; editing it here would violate file ownership boundaries. One-wave staleness is acceptable per the plan's explicit instruction.
- **New variants inserted BEFORE `'unknown'`.** Rationale: `'unknown'` is the catch-all and is the last variant by convention across the codebase; the acceptance criteria verify this via `grep -n "^  | '" src/crawler/types.ts | tail -1 | grep -q "'unknown'"`.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None — this plan introduces no external service config, no env vars, and no new CLI flags. Credentials for Phase 3's end-to-end behavior (`NAVER_ID`/`NAVER_PW`) remain a Plan 03-02 / 03-03 concern.

## Next Phase Readiness

- **For Plan 03-02 (detect.ts + naver.ts + headed.ts):** The three new `CrawlErrorCode` variants are available on the type. 03-02 can throw `new CrawlError('auth_missing_credentials')` etc. without touching `types.ts`.
- **For Plan 03-03 (runner wiring):** `src/auth/session.ts` is the canonical path resolver + exists/read helper. 03-03 will call `sessionExists()` to decide whether to pass `storageState` to `launchBrowser`, and `sessionFilePath()` to tell `context.storageState({ path })` where to save.
- **For Phase 4 (CLI):** No interface changes here; the only cross-cutting knob (`CRAWL_HEADED_TIMEOUT_MS`) is still deferred to 03-03 as planned.
- **Blockers:** none.

## Self-Check: PASSED

**File existence checks:**
- `src/auth/session.ts` — FOUND
- `src/auth/session.test.ts` — FOUND
- `src/crawler/types.ts` — FOUND (modified)
- `src/crawler/errors.test.ts` — FOUND (modified)
- `.planning/phases/03-naver-auth-session/03-01-SUMMARY.md` — FOUND (this file)

**Commit existence checks:**
- `b2244ca` (Task 1: CrawlErrorCode 10-member union + cardinality lock) — FOUND in `git log`
- `5881919` (Task 2: session.ts + tests + gitignore verify) — FOUND in `git log`

**Invariants verified:**
- `grep -c "^  | '" src/crawler/types.ts` → `10`
- `grep -q "toHaveLength(10)" src/crawler/errors.test.ts` → exit 0
- `grep -qE '^\.crawl-session\.json$' .gitignore` → exit 0
- `! grep -q "from 'playwright'" src/auth/session.ts` → exit 0
- `! grep -q "from 'playwright'" src/auth/session.test.ts` → exit 0
- `npx tsc --noEmit -p tsconfig.json` → exit 0
- `npx vitest run` → 126/126 passing (10 test files)
- `git diff HEAD~2 HEAD -- src/index.ts src/crawler/index.ts src/crawler/errors.ts` → 0 lines (no leaks to public barrels or errors.ts)

---
*Phase: 03-naver-auth-session*
*Completed: 2026-04-18*
