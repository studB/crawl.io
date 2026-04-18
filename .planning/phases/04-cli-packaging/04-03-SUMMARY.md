---
phase: 04-cli-packaging
plan: 03
subsystem: testing
tags: [vitest, integration, child_process, npm-pack, npm-publish, tarball, shebang, cli]

# Dependency graph
requires:
  - phase: 04-cli-packaging
    provides: "dist/bin/crawl.js (0755, shebang-preserved) + commander subcommand surface from Plan 04-01"
  - phase: 04-cli-packaging
    provides: "publish-ready package.json (bin, files allowlist, engines, MIT) + README.md + LICENSE + .gitattributes from Plan 04-02"
provides:
  - "test/cli/cli.integration.test.ts — 6 CLI behavior tests (--help, run --help, pre-flight-miss, --quiet suppression, --verbose progress, verbose arrow via existing-broken config) + 1 network-gated happy-path sentinel via child_process.spawn against dist/bin/crawl.js"
  - "test/cli/pack.integration.test.ts — 3 packaging tests (npm pack --dry-run --json allowlist/denylist; real npm pack + tar -xzf + shebang + executable bit + extracted-bin --help; npm publish --dry-run exit 0)"
  - "test/fixtures/cli/minimal-public.md — valid Phase-1 markdown config pointing at https://example.com/ used by the gated happy-path CLI test"
  - "vitest.config.ts include extended with test/**/*.integration.test.ts so the new top-level test/ tree is discovered alongside the colocated src/ suite"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI integration via child_process.spawn — every invocation routed through a typed runBin/runCmd helper with explicit setTimeout(kill('SIGKILL')) per-call timeout so a hung subprocess cannot hang the vitest worker (T-04-11 mitigation pattern)"
    - "Tarball allowlist verification via JSON — `npm pack --dry-run --json` parsed, each expected path asserted explicitly with custom failure messages, each forbidden prefix grep'd and asserted empty (T-04-05/T-04-09 mitigation)"
    - "Extracted-tarball bin smoke test under NODE_PATH shim — tarball extracted into mkdtemp'd dir, shebang read via first-line check, run with NODE_PATH=$(REPO)/node_modules so commander resolves without re-installing deps inside the extract (the test's concern is bin/shebang integrity, not npm install mechanics)"
    - "Network-gated happy-path via describe.skipIf(!GATED) + mirror describe.skipIf(GATED) sentinel — preserves a visible `it.skip(...)` line when gate is closed so reviewers see the coverage exists but is intentionally deferred (Phase 3 gated-integration pattern inherited)"
    - "Plan-03 test-only surface under test/ (not co-located under src/) — keeps integration tests outside the tsc project (rootDir=src/, include=src/**/*) but inside vitest's glob, cleanly separating library build from test-only TypeScript"

key-files:
  created:
    - test/cli/cli.integration.test.ts
    - test/cli/pack.integration.test.ts
    - test/fixtures/cli/minimal-public.md
  modified:
    - vitest.config.ts

key-decisions:
  - "Plan Test 6 (crawl run -v <missing>.md) kept minimal — asserts exit 1 + stderr contains `config not found:` + stderr non-empty. The plan text also asked for `→` arrow OR `parsing` literal, but Plan 01's runHandler emits the verbose arrow line AFTER pre-flight passes, so a missing-file path never witnesses it. Added companion test 5b with an EXISTING but syntactically broken config — the only path that exercises the verbose arrow + `→ parsing` literal + `config_parse` summary. Net coverage is stronger, not weaker."
  - "Extracted-tarball --help test uses NODE_PATH=$(repo)/node_modules instead of running `npm install` inside the extract. The test's purpose is proving shebang survived tarball round-trip and the bin starts cleanly; reproducing npm's global-install mechanics (which materialize commander adjacent to the package) is out of scope and would make the test 10x slower and flaky on constrained networks."
  - "describe.skipIf(SKIP) wrapping the entire pack test suite with SKIP_PACK_TESTS=1 — plan says 'test must pass in the local verification loop' (default run), but on constrained CI (no npm registry DNS, bandwidth caps) the skip gate is a clean out without commenting out files"
  - "`npm publish --dry-run` asserted via combined stdout+stderr — npm emits the bulk of its output (tarball manifest, size, etc.) on stdout but prefixes the 'requires you to be logged in to … (dry-run)' warning on stderr; gating on combined-content keeps the assertion stable across npm minor versions that rebalance the two streams"
  - "Tarball filename regex matches crawl.io-<semver>.tgz rather than a frozen `crawl.io-0.1.0.tgz` literal — when version bumps in future plans, these tests stay green without edits (the acceptance criteria specifically lock content, not the version number)"

patterns-established:
  - "test/** integration tests: any future CLI-adjacent test that needs to spawn a real subprocess or exercise filesystem side-effects (tarball extract, gitattributes eol-round-trip, etc.) lives under test/cli/*.integration.test.ts, matched by the vitest include pattern added here"
  - "Allowlist/denylist duality in packaging tests — every inclusion asserted one-per-expect line; every forbidden prefix asserted as empty-filter result. Failure messages name the exact offender, so a regression in package.json.files or .gitignore lands a surgical test failure"

requirements-completed: [CLI-01, CLI-03, CLI-04, CLI-05]

# Metrics
duration: 7min
completed: 2026-04-18
---

# Phase 4 Plan 03: CLI + Packaging Integration Tests Summary

**Shipped the final Phase-4 publish-readiness gate — 9 end-to-end integration tests under test/cli/ that spawn the built dist/bin/crawl.js through child_process, prove the tarball allowlist is correct via `npm pack --dry-run --json`, round-trip the bin through `tar -xzf` to verify the shebang and executable bit survive, and close with `npm publish --dry-run` as the atomic CLI-05 gate — all with zero src/ touches and library byte-unchanged across all three Phase 4 plans.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-18T08:50:50Z
- **Completed:** 2026-04-18T08:58:00Z
- **Tasks:** 3
- **Files created:** 3 (test/cli/cli.integration.test.ts, test/cli/pack.integration.test.ts, test/fixtures/cli/minimal-public.md)
- **Files modified:** 1 (vitest.config.ts)

## Accomplishments

- **6 CLI behavior tests + 2 gated variants** (`test/cli/cli.integration.test.ts`) spawn `dist/bin/crawl.js` via `child_process.spawn(process.execPath, [BIN, …])` and assert: top-level `--help` (Usage prefix + `run` subcommand + `Markdown-configured` tagline + empty stderr); `run --help` (NAVER_ID, NAVER_PW, CRAWL_HEADED_TIMEOUT_MS, exit code block mentioning 0 and 1, `<file>` positional, empty stderr); pre-flight miss (exit 1, `config not found:` scrubbed, NO `chromium`/`playwright`/`launching` in either stream); `--quiet` double-suppression (both streams zero bytes, still exit 1); `-v` with missing file (non-empty stderr, scrubbed error); `-v` with existing-but-broken config (verbose `→` arrow + `→ parsing` + `config_parse:` all present, exit 1); + 1 gated happy-path test behind `RUN_CLI_NETWORK_TESTS=1` (skipped by default with a sentinel `it.skip` so coverage is visible to reviewers).
- **3 packaging tests** (`test/cli/pack.integration.test.ts`) exercise the full publish pipeline: `npm pack --dry-run --json` parsed and asserted against a 9-entry allowlist (dist/index.js, dist/index.d.ts, dist/bin/crawl.js, dist/cli/{cli,run,exit}.js, package.json, README.md, LICENSE) and a 4-prefix denylist (src/, test/, .planning/, node_modules/) plus 4 specific forbidden files (vitest.config.ts, tsconfig.json, .gitignore, .gitattributes); real `npm pack --pack-destination <tmp>` + `tar -xzf` + asserts shebang first line equals `#!/usr/bin/env node`, executable bit (mode & 0100) preserved on POSIX, and extracted `--help` invocation exits 0 with `Usage: crawl` and `run` in stdout; `npm publish --dry-run` exits 0 + advertises `crawl.io@0.1.0` + `tarball`/`filename` + `dry-run` label in combined output.
- **Fixture** (`test/fixtures/cli/minimal-public.md`) — 17-line valid Phase-1 markdown config (URL https://example.com/, h1 selector, 30s rule timeout) that round-trips cleanly through `parseConfigFile` — verified inline via a one-liner during Task 1.
- **Vitest include extended** so `test/**/*.integration.test.ts` is discovered alongside the pre-existing `src/**/*.{test,integration.test}.ts` matchers. No other vitest config fields touched.
- **No regression:** full suite is now **220 passed + 6 skipped** (up from the 211 + 4 baseline from Plan 04-01/02; delta is exactly the 9 new passing tests + 2 new skipped — 1 sentinel + 1 live-gated). `npx tsc --noEmit -p tsconfig.json` exits 0. `npm run build` still emits 0755 shebang-correct bin. `git diff --name-only HEAD~6 HEAD -- src/` returns empty.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add CLI test fixture + extend vitest include to test/** — `8653e79` (chore)
2. **Task 2: Build test/cli/cli.integration.test.ts — spawn dist/bin/crawl.js and assert help + pre-flight + quiet + verbose** — `d234340` (test)
3. **Task 3: Build test/cli/pack.integration.test.ts — npm pack --dry-run + tarball-extract smoke + npm publish --dry-run** — `e73378e` (test)

## Files Created/Modified

### Created

- `test/fixtures/cli/minimal-public.md` — 17-line minimal valid markdown config pointing at https://example.com/ with a single `h1` selector named `title` and a 30000 ms timeout. Shape matches Phase-1's `parseConfigFile` contract verbatim; used by the gated happy-path CLI test after being copied to a throwaway mkdtemp dir so the run's Output writeback does not dirty the repo.
- `test/cli/cli.integration.test.ts` — 225 lines; 6 passing + 2 skipped CLI behavior integration tests driven through a typed `runBin(args, opts)` helper that spawns `node dist/bin/crawl.js …` with a `setTimeout(SIGKILL)` fallback, captures stdout/stderr as utf8 strings, and returns a `{ code, stdout, stderr }` envelope. beforeAll guards against a missing dist/bin/crawl.js or missing shebang with a clear error pointing at Plan 04-01's build step. The gated happy-path test block uses the Phase 3 `describe.skipIf(!GATED)` + `describe.skipIf(GATED)` sentinel pattern so reviewers always see a skip line in the vitest output whether the gate is open or closed.
- `test/cli/pack.integration.test.ts` — 247 lines; 3 passing packaging integration tests routed through a typed `runCmd(cmd, args, opts)` helper (same SIGKILL-timeout shape as runBin). Test 1 parses `npm pack --dry-run --json` stdout into a `PackManifestEntry` interface and asserts per-file inclusions/exclusions with custom failure messages. Test 2 runs real `npm pack --pack-destination <mkdtemp>`, matches the tarball filename with a semver-tolerant regex so future version bumps don't break the test, extracts via `tar -xzf`, reads the bin's first line for the shebang assertion, stats the file for POSIX executable bit, and runs the extracted bin with `NODE_PATH=$(repo)/node_modules` so commander resolves. Test 3 invokes `npm publish --dry-run` — the `--dry-run` flag is a hard-coded literal in the args array (T-04-10 mitigation documented in-file) — and asserts exit 0 + advertised tarball manifest + `dry-run` label in combined output.

### Modified

- `vitest.config.ts` — exactly one field changed: `include` extended from `['src/**/*.test.ts', 'src/**/*.integration.test.ts']` to include a third entry `'test/**/*.integration.test.ts'`. Formatted as a multi-line array for readability. `environment`, `passWithNoTests`, `testTimeout`, `hookTimeout`, `setupFiles` are byte-unchanged. Per-test timeouts inside the new pack tests (120s / 180s) are set via vitest's per-test timeout argument, not via global config, so the existing 60s default covers all unit/integration tests under src/.

### Not Modified (library byte-unchanged — Phase 4 invariant)

- `src/**/*` — `git diff --name-only HEAD~6 HEAD -- src/` returns empty. The Phase 4 invariant ("library byte-unchanged throughout Phase 4") is honored — the CLI surface, runCrawl orchestrator, scrubPaths helper, everything under src/config, src/crawler, src/auth, src/index.ts: byte-for-byte identical to the Phase 3 tip.
- `package.json`, `README.md`, `LICENSE`, `.gitattributes`, `tsconfig.json` — untouched.

## Decisions Made

- **Companion verbose test 5b added with existing-but-broken config.** The plan's Test 6 asked for `stderr` to contain both `config not found:` AND an arrow `→` OR literal `parsing` on a MISSING-file path. But Plan 01's `runHandler` emits the verbose arrow (`→ parsing config (<scrubbed>)`) only AFTER the pre-flight existence check passes — a missing file short-circuits before that line runs. Rather than weaken the Test 6 assertion to something trivially passable, I split it: Test 6 keeps the missing-file assertion (exit 1, non-empty stderr, `config not found:`), and added companion Test 5b which writes a syntactically broken config to a throwaway mkdtemp file, runs `crawl run -v <tmp>`, and asserts `→`, `parsing`, and `config_parse` all appear in stderr. Net test coverage is strictly stronger.
- **NODE_PATH instead of `npm install` inside the extracted tarball.** Test 2 runs the extracted-tarball bin with `NODE_PATH=$(repo)/node_modules` so commander resolves. Running `npm install --omit=dev` inside each extract would add ~10s per test run and introduces flakiness on constrained networks. The extracted-bin test's job is proving the shebang survived the tarball round-trip and the bin starts cleanly, not reproducing the full `npm install -g` install mechanics (which npm materializes commander adjacent to the package during link).
- **Tarball filename regex, not frozen literal.** Tests 2 & 3 match `/crawl\.io-\d+\.\d+\.\d+\.tgz/` rather than `crawl.io-0.1.0.tgz`. When version bumps (v2, bugfix, whatever), these tests stay green without edits. The acceptance criteria lock tarball CONTENT, not version number — this decision reflects that intent.
- **SKIP_PACK_TESTS=1 gate for constrained environments.** Plan explicitly says "test must pass in the local verification loop" (default run), but some CI runners don't have npm registry DNS or bandwidth for `npm publish --dry-run`. A `describe.skipIf(SKIP)` gate gives a clean opt-out without commenting out files; default is to run. Local verification in this environment ran with gate closed → all 3 pass.
- **Combined stdout+stderr for npm publish assertions.** `npm publish --dry-run` emits the tarball manifest on stdout but prefixes "This command requires you to be logged in… (dry-run)" on stderr. Gating assertions on `stdout + stderr` keeps them stable across npm minor versions that occasionally rebalance which stream gets which message.
- **Executable-bit check is POSIX-only.** `stat().mode & 0o100` is meaningful on POSIX but not on Windows (where fs.stat mode semantics are different — files without explicit ACL bits can read as non-executable even when they work). Guarded with `process.platform !== 'win32'` so Windows CI won't false-fail.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan's test shape] Test 6 rewritten + companion Test 5b added**

- **Found during:** Task 2 (CLI integration test authoring — verifying assertions against the built binary)
- **Issue:** Plan's Test 6 required `crawl run -v <nonexistent>.md` to emit `→` arrow OR `parsing` literal on stderr alongside `config not found:`. But Plan 01's `runHandler` (which is an src/ surface I cannot modify per the `git diff --name-only -- src/` empty invariant) short-circuits on pre-flight miss BEFORE the `if (verbose && !quiet)` block that emits the `→ parsing config …` arrow. No stream-scan against the current implementation could satisfy the plan's literal assertion.
- **Fix:** Test 6 relaxed to assert only what the pre-flight-miss path CAN emit — exit 1, non-empty stderr, `config not found:` literal. Added companion Test 5b that creates an EXISTING but invalid config via mkdtemp + writeFile (`"not a valid crawl config\n"`), runs `crawl run -v <tmp>`, and asserts the verbose progress arrow `\u2192` (→), the `parsing` literal, and the `config_parse` summary all appear on stderr. This is the only path that exercises Plan 01's verbose progress surface, and it's the strictest possible assertion — the test fails if any of the three tokens is missing.
- **Files modified:** `test/cli/cli.integration.test.ts` (both test cases in the same file, same commit).
- **Verification:** `npx vitest run test/cli/cli.integration.test.ts` → 6 pass + 2 skipped (both verbose tests green); `grep -q "\\\\u2192\\|→" test/cli/cli.integration.test.ts` → matches; `git diff --name-only HEAD~4 HEAD -- src/` → empty (invariant preserved).
- **Committed in:** `d234340` (Task 2 commit).

**2. [Rule 3 - Blocking] Used NODE_PATH shim for extracted-tarball bin smoke test**

- **Found during:** Task 3 (real-pack-and-extract Test 2 authoring)
- **Issue:** After `npm pack --pack-destination <tmp>` + `tar -xzf`, the extracted `<tmp>/package/dist/bin/crawl.js` cannot resolve `commander` (its only runtime import) because there's no `<tmp>/package/node_modules/` sibling — npm materializes those adjacent directories during `npm install`, not during `npm pack`. First smoke attempt: `Error: Cannot find module 'commander'`. Without a fix, Test 2 cannot verify the extracted bin actually RUNS — only that the shebang and file exist.
- **Fix:** Spawn the extracted bin with `env: { ...process.env, NODE_PATH: path.resolve(REPO_ROOT, 'node_modules') }`. Node's module resolver consults NODE_PATH after local node_modules, so `commander` resolves to the repo's copy. The test now exits 0 with the expected help text. This is a legitimate shim — the test's purpose is proving shebang + executable bit + bin startup integrity, not reproducing the precise `npm install -g` directory layout.
- **Files modified:** `test/cli/pack.integration.test.ts` (inline in Test 2's helpEnv construction).
- **Verification:** `NODE_PATH="$(pwd)/node_modules" node <tmp>/package/dist/bin/crawl.js --help` exits 0 with `Usage: crawl [options] [command]` as line 1. Full pack test suite: 3 pass.
- **Committed in:** `e73378e` (Task 3 commit).

---

**Total deviations:** 2 auto-fixed (1 plan-shape bug fix, 1 blocking-resolution shim)
**Impact on plan:** Both deviations are necessary to make the plan's tests actually pass against the Plan-01 surface without violating the `src/`-byte-unchanged invariant. Rule 1 deviation strengthens coverage (covers both pre-flight and post-pre-flight verbose paths rather than asserting the arrow on a path that never emits it). Rule 3 deviation is the minimum intervention to prove bin startup works after tarball extract without running `npm install` inside every test. No scope creep; no library edits.

## Issues Encountered

- **First tarball-extract smoke attempt with plain `cd "$TMPDIR" && npm pack` failed** — `cd`ing away from the repo root breaks `npm pack` since it needs `package.json` in cwd. Fix: keep cwd as the repo root (which `runCmd`'s `opts.cwd ?? REPO_ROOT` default naturally does) and pass `--pack-destination=<tmp>` so npm writes the tarball into the temp dir instead of the cwd. No test code affected; surfaced during manual smoke-testing before Task 3's vitest assertions ran.
- **`npm publish --dry-run` emits part of its output on stderr** — specifically the "This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)" line. Initially gated the assertion on `r.stdout`, which missed the `dry-run` token. Switched to asserting on `r.stdout + r.stderr` combined. This is also defensive against future npm minor versions that may rebalance streams.

## User Setup Required

None — no external service configuration required. All tests run locally against the built dist and the npm registry's `--dry-run` stub. The user-action items for eventual real publication (replace `TBD` repo URLs in package.json, optionally fill author) are inherited from Plan 04-02's SUMMARY and are not gated by this plan's tests.

## Known Stubs

None. Every test fires a real subprocess (node, npm, tar), reads real bytes, asserts real content. No placeholders, no TODOs, no "coming soon" markers, no components rendering mocked data. The one gated happy-path test is a DEFERRED coverage point (network-dependent), not a stub — the existing-but-broken companion test 5b exercises the same CLI surface minus the network round-trip.

## Threat Flags

None. No new surface beyond what Plan 04-03's `<threat_model>` block already covered (T-04-09/10/11/12/13). All mitigations are witnessed by live tests:

- T-04-09 (files allowlist leak): Test 1 of `pack.integration.test.ts` asserts every forbidden prefix has zero matches.
- T-04-10 (accidental real `npm publish`): The `--dry-run` literal is grep-gated in the test file and threaded verbatim into the spawn args array. Grep `grep -n "'publish'" test/cli/pack.integration.test.ts` shows exactly one match, adjacent to `'--dry-run'`.
- T-04-11 (subprocess hang): every spawn in both test files has an explicit `setTimeout(kill('SIGKILL'), timeoutMs)`.
- T-04-12 (shebang stripping): Test 2 of `pack.integration.test.ts` asserts the extracted-tarball bin's first line equals `#!/usr/bin/env node`.
- T-04-13 (temp paths in failure messages): accepted; no secrets in mkdtemp paths.

## Phase 4 Roadmap Criteria Status

- **Criterion 1 — `crawl --help` presents usage with env vars:** GREEN (cli.integration Test 1 + Test 2 assert usage, NAVER_ID, NAVER_PW, CRAWL_HEADED_TIMEOUT_MS).
- **Criterion 2 — subcommand structure extensible:** GREEN (Plan 01's `registerRunCommand(program)` pattern + this plan's tests verify `crawl run …` works without coupling to bin or handler internals).
- **Criterion 3 — npm pack tarball has working bin:** GREEN (pack.integration Tests 1 + 2 assert allowlist + bin startup after extract).
- **Criterion 4 — npm publish --dry-run succeeds:** GREEN (pack.integration Test 3 asserts exit 0 + manifest advertised).

All four Phase 4 roadmap success criteria are now test-verified.

## Next Phase Readiness

- Phase 4 is fully proven end-to-end. The CLI + packaging surface is ready for real `npm publish` — the user's remaining steps are (a) replace `github.com/TBD/crawl.io` in package.json with the real repo URL, (b) optionally fill package.json.author, (c) `npm login && npm publish` (no `--dry-run`). Plan 04-03's tests do not gate on (a) or (b).
- Library byte-unchanged across all three Phase 4 plans: `git diff --name-only $(git log --format=%H -n 7 | tail -1) HEAD -- src/` returns empty. The Phase 1-3 library contract is preserved.
- No blockers or concerns for subsequent milestones.

## Self-Check

Verifying claims:

- `test -f test/cli/cli.integration.test.ts` → FOUND
- `test -f test/cli/pack.integration.test.ts` → FOUND
- `test -f test/fixtures/cli/minimal-public.md` → FOUND
- `grep -qE "test/\*\*/\*\.integration\.test\.ts" vitest.config.ts` → PASSED
- `npx vitest run` → 220 passed + 6 skipped → PASSED
- `npx tsc --noEmit -p tsconfig.json` → exit 0 → PASSED
- `git diff --name-only HEAD~3 HEAD -- src/` → empty → PASSED
- `npm pack --dry-run --json` standalone allowlist check → PASSED
- `npm publish --dry-run` exit 0 → PASSED
- `head -1 dist/bin/crawl.js` → `#!/usr/bin/env node` → PASSED
- Commit `8653e79` (Task 1) → FOUND
- Commit `d234340` (Task 2) → FOUND
- Commit `e73378e` (Task 3) → FOUND

## Self-Check: PASSED

---
*Phase: 04-cli-packaging*
*Completed: 2026-04-18*
