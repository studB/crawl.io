---
phase: 04-cli-packaging
plan: 01
subsystem: cli
tags: [commander, cli, shebang, tdd, vitest, typescript]

# Dependency graph
requires:
  - phase: 02-core-crawler-output
    provides: runCrawl orchestrator returning CrawlResult, scrubPaths helper (MD-04)
  - phase: 03-naver-auth-session
    provides: 10-variant CrawlErrorCode union (locked union size)
provides:
  - src/cli/exit.ts — pure resolveExitCode(CrawlResult): 0 | 1 (OUT-05 mapping)
  - src/cli/run.ts — run-subcommand handler with RunDeps DI surface, pre-flight existence check, --verbose/--quiet flags, and addHelpText block listing NAVER_ID/NAVER_PW/CRAWL_HEADED_TIMEOUT_MS + exit codes
  - src/cli/cli.ts — buildProgram() + runCli() commander factory
  - src/bin/crawl.ts — shebang entry (first line #!/usr/bin/env node)
  - dist/bin/crawl.js — executable (0755) with shebang preserved
  - commander@^12.1.0 in dependencies
affects: [04-02-packaging, 04-03-publish-verification]

# Tech tracking
tech-stack:
  added: [commander@^12.1.0]
  patterns:
    - "CLI dependency injection via RunDeps interface (runCrawl + stdout + stderr + pathExists) so runHandler is unit-testable without child_process/fs/browser"
    - "Exit-code mapping extracted into a pure function (resolveExitCode) so OUT-05 is enforced in exactly one location"
    - "addHelpText('after', …) + configureOutput writer for help-text introspection under test (commander v12 quirk: helpInformation() does NOT include addHelpText hooks; outputHelp does)"
    - "Postbuild shim chmod 0755 on dist/bin/crawl.js belt-and-suspenders shebang preservation"
    - "Shebang-first bin entry — #!/usr/bin/env node on line 1 of src/bin/crawl.ts; tsc 6.x preserved it verbatim in CJS emit"

key-files:
  created:
    - src/cli/exit.ts
    - src/cli/exit.test.ts
    - src/cli/run.ts
    - src/cli/run.test.ts
    - src/cli/cli.ts
    - src/bin/crawl.ts
  modified:
    - package.json (added commander@^12, postbuild script)
    - package-lock.json (npm install commander side-effect)

key-decisions:
  - "resolveExitCode is a pure function in src/cli/exit.ts returning the literal union `0 | 1`; centralizes OUT-05 mapping and is grep-gated (`! grep -qE '(process\\.exit|console\\.|fs\\.)' src/cli/exit.ts`) to stay free of side effects"
  - "runHandler takes a RunDeps dependency bundle (runCrawl + stdout + stderr + pathExists) and NEVER calls process.exit — only registerRunCommand's commander action wrapper does. Keeps the handler trivially unit-testable and asserts exactly one process.exit in src/cli/run.ts"
  - "CLI reaches for runCrawl through the public barrel `../index`, never into `../crawler/runner` — CLI-02 extension axis preserved"
  - "Commander help-text introspection uses `outputHelp()` with a configureOutput writer, not `helpInformation()`, because commander v12 only surfaces `addHelpText('after', …)` hooks on the outputHelp event path"
  - "Postbuild script added to package.json that chmods dist/bin/crawl.js to 0755 (tsc emits 0644) and prepends shebang only if missing — belt-and-suspenders; verified shebang survives tsc 6.x CJS emit natively"
  - "Summary line truncation: first-field value capped at 80 chars with horizontal ellipsis (U+2026) suffix; empty-fields fallback is `✓ crawl ok (<ms>)` — locked by dedicated tests"

patterns-established:
  - "CLI unit tests use in-file `makeDeps()` factory returning { deps, stdout, stderr, runCrawlCalls } — stdout/stderr assertions become array-equality checks, no stdio mocking"
  - "TDD RED verified by running the test before the module exists (vitest surfaces MODULE_NOT_FOUND); GREEN flips it to passing with minimal implementation"
  - "Pre-flight failures (config not found) emit a scrubbed stderr line (T-04-01 MD-04 inheritance) BEFORE any Chromium launch — verified end-to-end by `! node dist/bin/crawl.js run /missing | grep -qi chromium`"

requirements-completed: [CLI-01, CLI-02, CLI-03, OUT-05]

# Metrics
duration: 7min
completed: 2026-04-18
---

# Phase 4 Plan 01: CLI scaffold + commander subcommand + exit-code mapper Summary

**Shipped the full v1 CLI surface — commander-backed `crawl run <file>` with shebang-preserved bin entry, pure `resolveExitCode` OUT-05 mapping, pre-flight scrubbed-path errors, --verbose/--quiet flags, and 17 new unit tests — without touching a single library file.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-18T08:28:06Z
- **Completed:** 2026-04-18T08:35:07Z
- **Tasks:** 3
- **Files created:** 6 (src/cli/exit.ts + .test.ts, src/cli/run.ts + .test.ts, src/cli/cli.ts, src/bin/crawl.ts)
- **Files modified:** 2 (package.json, package-lock.json)

## Accomplishments

- Commander@^12.1.0 installed as a prod dependency (not devDep), pinned to a caret range on the stable CJS-compatible v12 major.
- `src/cli/exit.ts` ships `resolveExitCode(result: CrawlResult): 0 | 1` — pure, side-effect-free, typecheck-narrowing-asserted, and locked against accidental union growth via a 10-code iteration + cardinality assertion.
- `src/cli/run.ts` ships `runHandler` + `registerRunCommand` + `RunDeps` DI surface; pre-flight path-existence check emits a scrubbed `✗ config not found: <HOME>/…` stderr line and exits 1 WITHOUT launching Chromium.
- `src/cli/cli.ts` ships `buildProgram()` and `runCli(argv)` so future verbs (validate, init, list) attach with a one-liner call to a new `registerXCommand(program)` — no bin or run-handler edits needed (CLI-02).
- `src/bin/crawl.ts` starts with the literal shebang `#!/usr/bin/env node` on line 1; tsc 6.x preserves it verbatim in CJS emit, producing `dist/bin/crawl.js` that the postbuild script chmods to 0755.
- 17 new unit tests (6 exit + 11 run) pass under `npx vitest run`, plus the existing 194 tests — 211 total passing + 4 skipped.
- End-to-end smoke: `node dist/bin/crawl.js --help`, `… run --help`, and `… run /missing.md` all exit with the correct codes, correct stderr/stdout shapes, and zero Chromium launch on the pre-flight-failed path.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install commander + create exit.ts with TDD unit tests** — `74be020` (feat)
2. **Task 2: Build src/cli/run.ts run-subcommand handler + 11-test DI coverage** — `62a2228` (feat)
3. **Task 3: Create src/cli/cli.ts commander factory + src/bin/crawl.ts shebang entry** — `886a690` (feat)

## Files Created/Modified

### Created

- `src/cli/exit.ts` — Pure `resolveExitCode(CrawlResult): 0 | 1` OUT-05 mapper. No side effects (grep-gated). Imports `CrawlResult` from `../crawler/types`.
- `src/cli/exit.test.ts` — 6 tests: ok → 0, ok with empty fields → 0, error timeout → 1, all 10 CrawlErrorCode variants → 1 + cardinality lock, purity (input not mutated), tsc `0 | 1` literal-union narrowing.
- `src/cli/run.ts` — `runHandler({ file, verbose, quiet }, deps?)` + `registerRunCommand(program)` + `RunDeps` interface + `defaultRunDeps`. Pre-flight existence check, summary formatting (80-char truncation with U+2026), --quiet/--verbose honoring, defensive try/catch around runCrawl, commander action wrapper is the ONLY process.exit call in the file (grep-asserted to exactly 1 occurrence).
- `src/cli/run.test.ts` — 11 tests covering all 7 plan behaviors plus edge cases (empty fields fallback summary, long-value truncation, --quiet pre-flight). Uses in-file `makeDeps()` factory for DI — no real fs, no real runCrawl, no spawn.
- `src/cli/cli.ts` — `buildProgram()` pure factory; `runCli(argv)` entry. Wires `registerRunCommand`. Shows help after commander errors. Version `0.1.0`.
- `src/bin/crawl.ts` — Shebang entry (line 1). Imports `runCli`, catches unhandled rejection with scrubbed-message stderr + exit 1.

### Modified

- `package.json` — Added `commander@^12.1.0` to `dependencies` (NOT devDependencies). Added `postbuild` script that chmods `dist/bin/crawl.js` to 0755 and prepends shebang if missing (belt-and-suspenders — tsc 6.x preserves it natively, but future tsc majors might not).
- `package-lock.json` — npm install side-effect for commander.

### Not Modified (library byte-unchanged — plan invariant)

- `src/config/**`, `src/crawler/**`, `src/auth/**`, `src/index.ts` — `git diff --name-only HEAD~3 HEAD -- src/config src/crawler src/auth src/index.ts` returns empty.

## Decisions Made

- **Exit-code mapping as a pure function (exit.ts):** Plan explicitly specified `resolveExitCode` be unit-testable without the runtime. Chose literal union return type `0 | 1` (not `number`) so tsc narrows at every call site and an accidental widening fails a dedicated test.
- **Dependency injection via RunDeps (run.ts):** Rejected `vi.mock('../index')` pattern in favor of DI — plan §<action> explicitly recommended it as "cleaner for this shape". Tests become pure function-level contract checks; no module-boundary mocking state leakage.
- **Single process.exit per file (run.ts):** Plan requires exactly 1 occurrence in `src/cli/run.ts`. Placed it inside `registerRunCommand`'s commander action wrapper — `runHandler` itself always returns 0 | 1 so every test can call it directly.
- **Commander help-text introspection via outputHelp (run.test.ts):** Initial test used `helpInformation()` (RED), but commander v12 only surfaces `addHelpText('after', …)` hooks on `outputHelp()`'s event path. Switched to capturing via `configureOutput({ writeOut })`. This matches how runtime `crawl run --help` actually renders, so the test is stricter, not looser.
- **Postbuild shim (package.json):** Plan §<action> step 5 explicitly conditions this on tsc stripping the shebang. Verified tsc 6.x preserves it natively; kept the postbuild anyway for (a) the executable-bit (`chmod 0755`) which tsc does NOT set, and (b) forward compatibility if a future tsc major drops shebang preservation. Cost: one small inline node -e invocation per build. Benefit: `dist/bin/crawl.js` is unconditionally correct.
- **Summary line truncation at 80 chars + ellipsis:** 04-CONTEXT.md §Specific Ideas requires "quoting/truncation so long text doesn't break the terminal". Chose 80 chars + U+2026 suffix (not 3-dot "..." to keep width predictable in monospace terminals). Fallback for empty fields: `✓ crawl ok (<ms>ms)` — both locked by dedicated tests.

## Deviations from Plan

**1. [Rule 3 - Blocking] Added postbuild chmod script to package.json**

- **Found during:** Task 3 (dist/bin/crawl.js verification)
- **Issue:** tsc emits `dist/bin/crawl.js` with shebang preserved BUT with mode 0644 (non-executable). `test -x dist/bin/crawl.js` failed the plan's Task 3 acceptance gate, and post-install the npm symlink `crawl` → `dist/bin/crawl.js` would have required `node dist/bin/crawl.js` invocation rather than direct shell execution via the shebang.
- **Fix:** Added `postbuild` npm script matching the plan's §<action> step 5 template. The script also prepends the shebang if missing — belt-and-suspenders for future tsc majors.
- **Files modified:** `package.json` (added `"postbuild": "node -e \"…\""` between `build` and `typecheck`).
- **Verification:** `rm -rf dist && npm run build && test -x dist/bin/crawl.js` → exit 0; `head -1 dist/bin/crawl.js` → `#!/usr/bin/env node`.
- **Committed in:** `886a690` (Task 3 commit).

---

**Total deviations:** 1 auto-fixed (1 blocking — Rule 3)
**Impact on plan:** Expected and anticipated by the plan itself (§<action> step 5 explicitly provided the postbuild snippet). No scope creep.

## Issues Encountered

- **Commander v12 help-text introspection quirk:** `helpInformation()` does NOT include `addHelpText('after', …)` hooks; only `outputHelp()` does (via the internal `afterAll` event). Test initially used `helpInformation()` and failed; switched to `outputHelp()` with a `configureOutput({ writeOut })` capture. This actually matches runtime behavior better (the `crawl run --help` user-facing path also goes through `outputHelp`).
- **Grep-gate on comments:** Plan's purity check `! grep -qE "(process\.exit|console\.|fs\.)" src/cli/exit.ts` initially matched doc-comment references to `process.exit`. Rewrote the doc comments to use "platform exit primitive" phrasing instead of the literal token. No behavioral change.

## User Setup Required

None — no external service configuration required. Plan 02 wires `package.json.bin` for `npm install -g`; Plan 03 verifies via `npm pack --dry-run` and tarball round-trip.

## TDD Gate Compliance

Tasks 1 and 2 followed TDD: test file written first → vitest run confirms failing (RED) → implementation written → vitest run confirms passing (GREEN). Task 3 is not TDD-marked (scaffolding + shebang + build verification, end-to-end smoke tests are the gate).

## Threat Flags

No new trust-boundary surface beyond the ones the plan's `<threat_model>` already listed. T-04-01 (scrubbed `config not found`) mitigated; T-04-02 (error message forwarding) verified — `result.error.message` is passed through unchanged because runCrawl already scrubs it before returning.

## Next Phase Readiness

- Plan 02 can now consume the working `dist/bin/crawl.js` — all it needs is to wire `package.json.bin` + `files` allowlist + README + LICENSE + MIT license change + engine field.
- Plan 03 will `npm pack` / `npm publish --dry-run` and re-verify the shebang survives the tarball round-trip.
- Library contract remained byte-unchanged (`git diff --name-only -- src/config src/crawler src/auth src/index.ts` empty), honoring the plan's invariant.

## Self-Check

Verifying claims:

- `test -f src/cli/exit.ts` → FOUND
- `test -f src/cli/exit.test.ts` → FOUND
- `test -f src/cli/run.ts` → FOUND
- `test -f src/cli/run.test.ts` → FOUND
- `test -f src/cli/cli.ts` → FOUND
- `test -f src/bin/crawl.ts` → FOUND
- `test -x dist/bin/crawl.js` → FOUND (0755)
- Commit `74be020` → FOUND
- Commit `62a2228` → FOUND
- Commit `886a690` → FOUND

## Self-Check: PASSED

---
*Phase: 04-cli-packaging*
*Completed: 2026-04-18*
