---
phase: 02-core-crawler-output
plan: 01
subsystem: infra
tags: [playwright, chromium, typescript, types, errors, tdd]

# Dependency graph
requires:
  - phase: 01-config-parser
    provides: "CrawlJob/SelectorSpec types; ConfigParseError pattern (declare readonly ?: string + Object.setPrototypeOf)"
provides:
  - "playwright@^1.59.1 runtime dep + Chromium 147.0.7727.15 browser binary on disk"
  - "src/crawler/types.ts — CrawlErrorCode (7-member union) + CrawlResult envelope (with optional error.stack?)"
  - "src/crawler/errors.ts — CrawlError class (readonly code, declare readonly detail?)"
  - ".gitignore entries for .crawl-session.json (Phase 3) and Playwright test artifacts"
affects: [02-02-output-writeback, 02-03-browser-frame-extract, 02-04-runcrawl-orchestrator, 03-naver-auth-session]

# Tech tracking
tech-stack:
  added: [playwright@^1.59.1]
  patterns:
    - "Type-only cross-module import (import type { CrawlErrorCode } from './types') keeps errors.ts free of value-level coupling"
    - "declare readonly {field}?: T + conditional assignment in constructor — mirrors ConfigParseError for exactOptionalPropertyTypes compliance"
    - "CrawlError message format: [code] detail (or [code] when detail omitted) — uniform for log scanning"
    - "TDD gate enforced via two atomic commits per tdd=true task: test(02-01) RED then feat(02-01) GREEN"

key-files:
  created:
    - "src/crawler/types.ts — CrawlErrorCode union + CrawlResult envelope"
    - "src/crawler/errors.ts — CrawlError class"
    - "src/crawler/errors.test.ts — 5 unit tests for CrawlError contract"
  modified:
    - "package.json — add playwright@^1.59.1 to dependencies"
    - "package-lock.json — lock playwright + transitive deps"
    - ".gitignore — add .crawl-session.json (Phase 3) + Playwright artifact dirs"
    - "src/config/parser.test.ts — relax playwright-dep guard to a source-level import check (Phase 2 legitimately ships playwright)"

key-decisions:
  - "playwright as runtime dep (not devDep) — matches 02-CONTEXT.md D-08 style: the crawler imports it directly, it is NOT just a test tool"
  - "No postinstall hook for browser download in this plan — deferred to Phase 4 packaging so users of the parser-only API are not forced into a 170 MB install"
  - "CrawlError.message format is '[code] detail' (no trailing colon or space when detail omitted) — tested explicitly to lock the contract against future drift"
  - "Types layer (types.ts + errors.ts) stays pure — no import of playwright; Plan 02-02's output.ts consumes these types without pulling a browser in"
  - "Error shape on CrawlResult is { code, message, stack? } — 02-CONTEXT.md locks this; stack is populated by Plan 02-04's runCrawl from Error.stack when present"

patterns-established:
  - "Crawler-layer types live in src/crawler/types.ts; Plans 02-02/03/04 import from here, never re-declare"
  - "CrawlError is the single fatal type for the crawler; runCrawl catches → wraps as CrawlResult.error with .code/.message/.stack"
  - "Per-plan TDD on behavior-rich files (errors.ts): RED commit as `test(NN-MM)`, GREEN commit as `feat(NN-MM)` — git log is the audit trail"

requirements-completed: [CRWL-01]

# Metrics
duration: 4min
completed: 2026-04-18
---

# Phase 2 Plan 1: Playwright Install + Crawler Type Contracts Summary

**playwright@^1.59.1 + Chromium 147 binary on disk; pure `src/crawler/types.ts` + `src/crawler/errors.ts` locked via 5 TDD tests, with CrawlErrorCode as a 7-member string-literal union and CrawlError using the declare-readonly-optional pattern for exactOptionalPropertyTypes compliance.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-04-18T02:22:52Z
- **Completed:** 2026-04-18T02:26:27Z
- **Tasks:** 2
- **Files modified:** 7 (4 created, 3 pre-existing modified)

## Accomplishments
- `playwright@^1.59.1` installed as a **runtime** dependency (not devDep) — `package.json` + `package-lock.json` both updated; Chromium browser binary (`chromium-1217`) downloaded to `~/.cache/ms-playwright` and verified loadable from Node.
- `src/crawler/types.ts` exports the authoritative `CrawlErrorCode` (7 members, exact contract) and `CrawlResult` envelope (status / configPath / url / startedAt / durationMs required; `fields?`, `error?: { code, message, stack? }` optional).
- `src/crawler/errors.ts` exports `CrawlError` — `declare readonly detail?: string` keeps `'detail' in err === false` when omitted (exactOptionalPropertyTypes), `Object.setPrototypeOf(this, CrawlError.prototype)` preserves `instanceof` across realm boundaries.
- 5 TDD unit tests in `src/crawler/errors.test.ts` lock the contract (construction with/without detail, 7-member union round-trip, prototype chain, readonly compile-time guarantee via `@ts-expect-error`) — full suite 68/68 green (63 Phase 1 + 5 new).
- `.gitignore` now includes `.crawl-session.json` (Phase 3 preemptive; T-02-02 mitigation) and `test-results/`, `playwright-report/`, `.playwright-artifacts/` (T-02-03 mitigation).

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Playwright + Chromium + extend .gitignore** — `df68c41` (chore)
2. **Task 2 — RED: failing tests for CrawlError + CrawlErrorCode** — `0e07330` (test)
3. **Task 2 — GREEN: implement CrawlError + types** — `c39acea` (feat)

**Plan metadata:** pending — final commit below

_Note: Task 2 is `tdd="true"` and therefore produced both a `test(02-01)` RED commit and a `feat(02-01)` GREEN commit in that order — the TDD gate sequence is satisfied._

## Files Created/Modified

- `src/crawler/types.ts` **(created)** — `CrawlErrorCode` union + `CrawlResult` envelope. Exact content:
  ```ts
  export type CrawlErrorCode =
    | 'timeout'
    | 'selector_miss'
    | 'network'
    | 'frame_not_found'
    | 'extraction_failed'
    | 'config_parse'
    | 'unknown';

  export interface CrawlResult {
    status: 'ok' | 'error';
    configPath: string;
    url: string;
    startedAt: Date;
    durationMs: number;
    fields?: Record<string, string>;
    error?: {
      code: CrawlErrorCode;
      message: string;
      stack?: string;
    };
  }
  ```

- `src/crawler/errors.ts` **(created)** — `CrawlError` class. Exact content:
  ```ts
  import type { CrawlErrorCode } from './types';

  export class CrawlError extends Error {
    readonly code: CrawlErrorCode;
    declare readonly detail?: string;

    constructor(code: CrawlErrorCode, detail?: string) {
      super(detail !== undefined ? `[${code}] ${detail}` : `[${code}]`);
      this.name = 'CrawlError';
      this.code = code;
      if (detail !== undefined) {
        this.detail = detail;
      }
      Object.setPrototypeOf(this, CrawlError.prototype);
    }
  }
  ```

- `src/crawler/errors.test.ts` **(created)** — 5 passing tests: name/code/detail/message format, omitted-detail exactOptionalPropertyTypes behavior, 7-code round-trip, prototype-chain check, readonly compile-time guarantee (via `@ts-expect-error`).
- `package.json` **(modified)** — added `"playwright": "^1.59.1"` to `dependencies`.
- `package-lock.json` **(modified)** — lockfileVersion 3 updated in place with `playwright` + transitives.
- `.gitignore` **(modified)** — delta added in this plan:
  ```
  # Playwright session state (Phase 3)
  .crawl-session.json   # (was already present — kept in place)

  # Playwright test artifacts
  test-results/
  playwright-report/
  .playwright-artifacts/
  ```
- `src/config/parser.test.ts` **(modified, Rule 1 auto-fix)** — replaced the Phase 1 "`package.json` must have no playwright dep" assertion with a `src/config/parser.ts` source-level assertion (no `from 'playwright'`, no `require('playwright')`, no puppeteer/chromium). See deviations below.

## Playwright + Chromium Verification

Output of `node -e "console.log(require('playwright').chromium.executablePath())"`:
```
/home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome
```
The binary exists on disk (`fs.existsSync(...) === true`) and `require('playwright').chromium.launch` is a function — Plan 02-03 can launch Chromium with zero further setup.

Downloaded components:
- Chrome for Testing 147.0.7727.15 (playwright chromium v1217) — 170.4 MiB
- FFmpeg (playwright ffmpeg v1011) — 2.3 MiB
- Chrome Headless Shell 147.0.7727.15 (playwright chromium-headless-shell v1217) — 112 MiB

## Test Count / Pass Rate

- `src/crawler/errors.test.ts`: **5 / 5 passing**.
- Full suite (`npx vitest run`): **68 / 68 passing** (4 test files: errors, parser, schema, crawler/errors).
- `npx tsc --noEmit`: **0 errors** under strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes.

## Decisions Made

- **playwright goes into `dependencies`, not `devDependencies`** — the crawler source (`src/crawler/*`, arriving in Plans 02-03 and 02-04) imports Playwright at runtime; end users of the `crawl` CLI need it. This matches 02-CONTEXT.md ("Playwright Chromium launch + context + page helpers"). The plan explicitly noted `@playwright/test` is NOT needed (we use vitest).
- **No `postinstall` script in this plan** — a download-on-install hook is a Phase 4 (packaging) concern. Adding it here would surprise anyone who runs `npm install` in this repo before they are ready for a 170 MB Chromium pull.
- **Relax the Phase 1 package.json guard, do not delete it** — the guard is structurally useful (the *parser* still must not launch browsers). Replacing package.json introspection with a parser-source regex check preserves the original intent while permitting legitimate `dependencies.playwright`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Phase 1 parser invariant test asserted "no playwright in package.json"**
- **Found during:** Task 1 (install playwright) — full test suite dropped from 63/63 to 62/63 immediately after `npm install --save playwright@^1`.
- **Issue:** `src/config/parser.test.ts` had an assertion `expect(deps.includes('playwright')).toBe(false)` — a Phase 1 guard against *accidentally* shipping a browser dep. Phase 2 legitimately ships it. The in-file comment said "such a change must wait for Phase 2", explicitly permitting this revision now.
- **Fix:** Replaced the package.json-level check with a source-level check that reads `src/config/parser.ts` and asserts it contains no `from 'playwright'`, no `require('playwright')`, no `from 'puppeteer'`, etc. Preserves the actual invariant the parser needs.
- **Files modified:** `src/config/parser.test.ts`
- **Verification:** `npx vitest run` → 68/68 passing; parser.ts itself still imports nothing from playwright (grep confirms).
- **Committed in:** `df68c41` (Task 1 chore commit)

### Minor Plan-Doc Observations (not code deviations)

- The plan's acceptance-criteria regex `^\s+\| '(...)'$` under "exactly 7" matched only 6 lines because the final `'unknown'` literal has a trailing `;` (standard TS syntax: `  | 'unknown';`). A permissive regex `^\s+\| '(...)'*;?$` confirms all 7 members present. The file is correct; the regex in the plan has a trailing-semicolon oversight. Not fixed — no code change needed; downstream plans / the verifier should read the types file directly.

---

**Total deviations:** 1 auto-fixed (1 × Rule 1 — test invariant obsoleted by mandated install, original in-file comment preapproved the change).
**Impact on plan:** None on deliverables. The deviation was an unavoidable side-effect of Task 1's mandated install; fix preserves the test's underlying intent.

## Issues Encountered

None — Chromium download succeeded on first attempt, all acceptance criteria passed after the single deviation fix.

## User Setup Required

None — no external service configuration required. Chromium binary is on disk in this worktree; downstream plans (02-03 onward) will use it without manual steps.

## Next Phase Readiness

- Plan 02-02 (markdown output writeback) can now `import type { CrawlErrorCode, CrawlResult } from '../crawler/types'` and `import { CrawlError } from '../crawler/errors'` directly.
- Plan 02-03 (browser/frame/extract) can now `import { chromium } from 'playwright'` with the binary available on disk.
- Plan 02-04 (runCrawl orchestrator) can construct `CrawlError('timeout', ...)`, `CrawlError('config_parse', ...)`, etc., and wrap them into the `CrawlResult.error` shape without any further type work.
- Phase 3 preemptive: `.crawl-session.json` is already git-ignored — the storage-state write Phase 3 introduces cannot be accidentally staged.

## TDD Gate Compliance

- Task 2 (`tdd="true"`): `test(02-01)` commit `0e07330` precedes `feat(02-01)` commit `c39acea` — RED → GREEN order confirmed in `git log`. No REFACTOR commit was needed (files are minimal).
- Plan-level type is `execute`, not `tdd`, so the plan-level RED/GREEN gate does not apply; the per-task TDD gate does, and it passes.

## Self-Check: PASSED

- `src/crawler/types.ts` — FOUND
- `src/crawler/errors.ts` — FOUND
- `src/crawler/errors.test.ts` — FOUND
- `.planning/phases/02-core-crawler-output/02-01-SUMMARY.md` — FOUND
- Commit `df68c41` (Task 1 chore) — FOUND
- Commit `0e07330` (Task 2 RED) — FOUND
- Commit `c39acea` (Task 2 GREEN) — FOUND
- `.gitignore` lines (`.crawl-session.json`, `test-results/`, `playwright-report/`, `.playwright-artifacts/`) — all FOUND
- `playwright` in `package.json` and `package-lock.json` — FOUND

---
*Phase: 02-core-crawler-output*
*Completed: 2026-04-18*
