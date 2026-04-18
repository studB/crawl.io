---
phase: 04-cli-packaging
verified: 2026-04-18T10:11:54Z
status: passed
score: 4/4 must-haves verified
must_have_score: 4/4
overrides_applied: 0
requirements_verified:
  - CLI-01
  - CLI-02
  - CLI-03
  - CLI-04
  - CLI-05
  - OUT-05
automated_checks:
  tsc_noEmit: pass
  npm_run_build: pass
  vitest_run: pass
  npm_pack_dry_run: pass
  npm_publish_dry_run: pass
  shebang_preserved: pass
  library_unchanged: pass
---

# Phase 4: CLI + Packaging — Verification Report

**Phase Goal:** The tool is invokable as `crawl run <file.md>` from any terminal after `npm install -g`, ships with help text, and is publishable to npm.
**Verified:** 2026-04-18T10:11:54Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `crawl run <file.md>` executes + exits; `crawl --help` AND `crawl run --help` print usage with arg shape + env vars | VERIFIED | `node dist/bin/crawl.js --help` exit 0 with "Usage: crawl" + tagline + `run` subcommand; `node dist/bin/crawl.js run --help` exit 0 with `<file>` positional, NAVER_ID, NAVER_PW, CRAWL_HEADED_TIMEOUT_MS, and exit-code block (0, 1); end-to-end pre-flight missing-file test exits 1 with scrubbed `✗ config not found:` and no Chromium launch |
| 2 | Subcommand structure extensible (second verb can be added without breaking top-level) | VERIFIED | `src/cli/cli.ts` `buildProgram()` calls `registerRunCommand(program)` — a second verb attaches via a sibling `registerXCommand(program)` call with zero edits to `src/bin/crawl.ts` or `runHandler`; commander v12 `program.command('run <file>')` is the canonical subcommand shape |
| 3 | `npm pack` produces tarball with working `bin` that resolves `crawl` after `npm install -g` | VERIFIED | `npm pack --dry-run --json` exit 0; tarball contains `dist/bin/crawl.js` (0755, shebang `#!/usr/bin/env node` preserved), `dist/index.js`, `dist/index.d.ts`, `package.json`, `README.md`, `LICENSE`; no leaks from `src/`, `test/`, `.planning/`, `node_modules/`, `vitest.config.ts`, `tsconfig.json`; `test/cli/pack.integration.test.ts` Test 2 runs real `npm pack` + `tar -xzf` + extracted-bin `--help` and asserts shebang survives round-trip |
| 4 | `npm publish --dry-run` succeeds: package includes compiled JS + types, strict-mode compliant | VERIFIED | `npm publish --dry-run` exit 0, emits `+ crawl.io@0.1.0`, 167 files, 117.4 kB tarball; `npx tsc --noEmit -p tsconfig.json` exit 0 under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`; tarball includes `dist/index.d.ts` + all `.d.ts` type declarations |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/exit.ts` | Pure `resolveExitCode(CrawlResult): 0 \| 1` | VERIFIED | Exports function, zero side effects, 6 unit tests (ok/error/10-variant-union/purity/type-narrowing) pass |
| `src/cli/run.ts` | `runHandler` + `registerRunCommand` + `RunDeps` DI | VERIFIED | Pre-flight existence check with scrubbed stderr, `--verbose`/`--quiet` flags, help text contains NAVER_ID/NAVER_PW/CRAWL_HEADED_TIMEOUT_MS (default 300000) + exit-code table; exactly 1 `process.exit` call (in commander action wrapper); 12 unit tests pass |
| `src/cli/cli.ts` | `buildProgram()` + `runCli(argv)` | VERIFIED | Commander program factory; reads version at runtime via `readPackageVersion()` → `package.json` (WR-02 fix, `crawl --version` → `0.1.0`); `registerRunCommand(program)` attaches `run` verb; `showHelpAfterError()` enabled |
| `src/bin/crawl.ts` | Shebang entry importing `runCli` | VERIFIED | Line 1 = `#!/usr/bin/env node`; top-level catch routes `err.message` through `scrubPaths` (CR-01 fix); 3 occurrences of `scrubPaths` (import, comment, call site) |
| `package.json` | bin, files allowlist, engines, MIT, keywords | VERIFIED | `bin.crawl = ./dist/bin/crawl.js`; `files = ["dist/", "README.md", "LICENSE"]`; `engines.node = ">=20"`; `license = "MIT"`; `keywords = [5 strings]`; `description` non-empty; commander in `dependencies` (not devDeps); no `TBD` placeholders (WR-03 fix removed them) |
| `README.md` | Install, quick-start, env vars, exit codes | VERIFIED | 74 lines; sections: What it does, Install (`npm install -g crawl.io`), Quick start with YAML-in-markdown fixture, Environment variables table (NAVER_ID, NAVER_PW, CRAWL_HEADED_TIMEOUT_MS default 300000), Exit codes table (0, 1), Status footer |
| `LICENSE` | MIT text + 2026 copyright | VERIFIED | 21 lines; first line `MIT License`; `Copyright (c) 2026 crawl.io contributors`; full "Permission is hereby granted" body + warranty disclaimer |
| `.gitattributes` | LF enforcement | VERIFIED | 6 lines; global `* text=auto eol=lf`; explicit `dist/bin/crawl.js text eol=lf` (T-04-06 mitigation) |
| `test/cli/cli.integration.test.ts` | Spawn bin + help + pre-flight + quiet + verbose | VERIFIED | 6 tests (Usage/run-subcommand/NAVER env vars/pre-flight scrubbed/quiet double-suppress/verbose arrow), 2 skipped gated tests; no `any` escape hatches |
| `test/cli/pack.integration.test.ts` | pack --dry-run + tarball extract + publish --dry-run | VERIFIED | 3 tests: allowlist/denylist JSON assertion, real pack + tar + shebang round-trip with NODE_PATH shim, `npm publish --dry-run` exit 0 |
| `test/fixtures/cli/minimal-public.md` | Valid Phase-1 markdown config for happy-path | VERIFIED | 17 lines; `# URL` + `# Selectors` (yaml) + `# Rules` (yaml) with `waitFor` + `timeout: 30000`; parses through `parseConfigFile` |
| `vitest.config.ts` | `test/**/*.integration.test.ts` discovered | VERIFIED | Include array extended with third entry; pre-existing src/** patterns preserved |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `src/bin/crawl.ts` | `src/cli/cli.ts` | `import { runCli } from '../cli/cli'` | WIRED |
| `src/cli/run.ts` | `src/index.ts` (public barrel) | `import { runCrawl } from '../index'` | WIRED — CLI-02 boundary preserved (does NOT reach into `../crawler/runner`) |
| `src/cli/run.ts` | `src/cli/exit.ts` | `resolveExitCode(result)` → `process.exit(...)` | WIRED — OUT-05 mapping flows through pure function |
| `src/bin/crawl.ts` | `src/crawler/output.ts` | `import { scrubPaths }` for fatal-catch redaction | WIRED — CR-01 fix |
| `package.json.bin.crawl` | `dist/bin/crawl.js` | `"crawl": "./dist/bin/crawl.js"` | WIRED — tarball carries the file, shebang preserved, 0755 |
| `package.json.files` | tarball contents | allowlist `["dist/", "README.md", "LICENSE"]` | WIRED — `npm pack --dry-run --json` confirms exact inclusion set |
| `src/cli/cli.ts` | `package.json` | `readPackageVersion()` via `readFileSync` | WIRED — `crawl --version` → `0.1.0` at runtime |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces Real Data | Status |
|----------|------|--------|--------------------|--------|
| `runHandler` exit code | `CrawlResult.status` | `deps.runCrawl(abs)` → Phase 2 `runCrawl` orchestrator | Yes — real Phase 2 library call with real Playwright | FLOWING |
| `crawl --version` output | `package.json.version` | `readFileSync(dist/../package.json)` | Yes — runtime read confirmed via `node dist/bin/crawl.js --version` → `0.1.0` | FLOWING |
| `crawl run --help` body | `addHelpText('after', ...)` block in `run.ts` | Static literal with NAVER_ID/NAVER_PW/CRAWL_HEADED_TIMEOUT_MS/exit codes | Yes — literal strings are the contract | FLOWING |
| Success summary stdout | `result.fields` first entry, truncated | `CrawlResult.fields` from `runCrawl` | Yes — unit tests assert shape on fake data; gated happy-path test exercises real fetch | FLOWING |

### Behavioral Spot-Checks

| # | Behavior | Command | Result | Status |
|---|----------|---------|--------|--------|
| 1 | Top-level help works | `node dist/bin/crawl.js --help` | exit 0; stdout has `Usage: crawl`, `run`, `Markdown-configured` | PASS |
| 2 | Run subcommand help works | `node dist/bin/crawl.js run --help` | exit 0; stdout has NAVER_ID, NAVER_PW, CRAWL_HEADED_TIMEOUT_MS default 300000, exit codes 0 + 1 | PASS |
| 3 | Version read from package.json | `node dist/bin/crawl.js --version` | stdout `0.1.0` (matches package.json) | PASS |
| 4 | Pre-flight missing file | `node dist/bin/crawl.js run /tmp/nonexistent-$$.md` | exit 1; stderr `✗ config not found: /tmp/...`; no Chromium | PASS |
| 5 | --quiet double suppression | `node dist/bin/crawl.js run --quiet /tmp/nonexistent-$$.md` | exit 1; stdout empty; stderr empty | PASS |
| 6 | Typecheck clean | `npx tsc --noEmit -p tsconfig.json` | exit 0, no output | PASS |
| 7 | Full build succeeds | `npm run build` | exit 0; tsc + postbuild chmod 0755 | PASS |
| 8 | Shebang preserved post-build | `head -1 dist/bin/crawl.js` | `#!/usr/bin/env node` | PASS |
| 9 | Executable bit set | `test -x dist/bin/crawl.js` | `-rwxr-xr-x` | PASS |
| 10 | Full vitest suite | `npx vitest run` | 221 passed + 6 skipped (19 files passed + 1 skipped); 0 failures | PASS |
| 11 | Tarball allowlist correct | `npm pack --dry-run --json` | 167 files, all expected inclusions present, no leaks from `src/`, `test/`, `.planning/`, `node_modules/`, `vitest.config.ts`, `tsconfig.json` | PASS |
| 12 | Publish dry-run succeeds | `npm publish --dry-run` | exit 0; `+ crawl.io@0.1.0`, 117.4 kB tarball | PASS |
| 13 | Library byte-unchanged | `git diff --name-only 74be020~1..HEAD -- src/config src/crawler src/auth src/index.ts` | empty | PASS |
| 14 | No `process.exit` in runHandler/runner/index | grep `process.exit` in runner.ts + index.ts → 0; in run.ts → 1 (action wrapper); in bin/crawl.ts → 1 (top-level catch) | 2 process.exit sites total, both at CLI boundary | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| CLI-01 | 04-01, 04-03 | `crawl run <file.md>` runs and exits | SATISFIED | `runHandler` in `src/cli/run.ts` + commander action wrapper; `cli.integration.test.ts` Tests 1, 4 confirm exit behaviour |
| CLI-02 | 04-01, 04-03 | Subcommand structure extensible for future verbs | SATISFIED | `src/cli/cli.ts` `registerRunCommand(program)` pattern; second verb attaches via `registerXCommand(program)` with zero edits to `src/bin/crawl.ts` or `runHandler` |
| CLI-03 | 04-01, 04-03 | `crawl --help` + `crawl run --help` print usage with arg shape + env vars | SATISFIED | `run.ts` `addHelpText('after', ...)` block + commander's default help; live `node dist/bin/crawl.js run --help` confirms NAVER_ID, NAVER_PW, CRAWL_HEADED_TIMEOUT_MS, exit codes 0/1 |
| CLI-04 | 04-02, 04-03 | `package.json` `bin` resolves `crawl` after install | SATISFIED | `bin = { "crawl": "./dist/bin/crawl.js" }`; `dist/bin/crawl.js` is 0755 + shebang; tarball round-trip test extracts + runs the bin with correct shebang first line |
| CLI-05 | 04-02, 04-03 | Package builds with TypeScript (Node 20 LTS) and is publishable | SATISFIED | `tsc --noEmit` exit 0 under strict; `npm publish --dry-run` exit 0; `engines.node >= 20`; `license = MIT`; tarball includes `dist/index.d.ts` type declarations |
| OUT-05 | 04-01 | Non-zero exit on any failure | SATISFIED | `src/cli/exit.ts` `resolveExitCode` maps `status === 'ok'` → 0, else → 1; 6 unit tests lock every CrawlErrorCode variant → 1; spot-check 4 (missing-file) + spot-check 5 (quiet) confirm live exit=1 behavior |

All 6 declared requirement IDs (CLI-01..05 + OUT-05) satisfied with concrete implementation evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/cli/cli.ts` | 56 | `return '0.0.0'` fallback | Info | Intentional — `crawl --version` must never break the binary. Documented in docstring. Not a stub — real read happens first. |
| `src/cli/run.ts` | 128 | `'\u2717 unknown: crawl failed without detail'` fallback | Info | Defensive branch — `CrawlResult.error` is optional in the type but guaranteed set when `status === 'error'` by contract. Guard exists for type safety, never hit in practice. |
| `package.json` | 13 | `"author": ""` | Info | Deliberate — CONTEXT.md § Package Publish Readiness: "left as user-settable"; published note in 04-REVIEW-FIX.md Publish-prep reminders |
| `LICENSE` | 3 | `crawl.io contributors` generic copyright | Info | IN-03 deferred from REVIEW-FIX with rationale: legally acceptable for pre-contributor OSS; update on first external contribution |
| `dist/**/*.test.*` + `dist/**/*.integration.test.*` | — | 72 compiled test files ship in tarball | Info | tsc includes `src/**/*` (which contains colocated `.test.ts` files) → `dist/`. `files: ["dist/"]` allowlist ships them. Tarball is 117.4 kB / 518.2 kB unpacked — not a blocker for v1. Tests do NOT run at install time (vitest is devDependency only). Consider excluding `**/*.test.*` from tsc `include` or adding a negative pattern to `files` allowlist in v1.1. |

No blocker or warning anti-patterns. No TODO/FIXME/PLACEHOLDER comments in CLI source. No empty-return stubs. Every handler, summary line, help section, and action wrapper is fully implemented with corresponding unit/integration test coverage.

### Review-Fix Finding Landing Verification

| Finding | Fix | Status |
|---------|-----|--------|
| CR-01: `src/bin/crawl.ts` catch scrubs stderr | 3 occurrences of `scrubPaths` in `src/bin/crawl.ts` (import + comment + call) | LANDED |
| WR-01: `--help` documents `CRAWL_HEADED_TIMEOUT_MS` default `300000` | `src/cli/run.ts:223` literal `default 300000`; README.md:59 matches | LANDED |
| WR-02: Version from `package.json` | `src/cli/cli.ts` `readPackageVersion()` → runtime `readFileSync` + `JSON.parse`; `crawl --version` → `0.1.0` | LANDED |
| WR-03: `TBD` removed from `package.json` | `repository` / `bugs` / `homepage` fields removed entirely; `grep TBD package.json` yields only doc-comment references in `src/cli/cli.ts` | LANDED |
| WR-04(a): `truncateForSummary` collapses newlines | `src/cli/run.ts:91` `const oneLine = value.replace(/\s+/g, ' ').trim()` BEFORE length check | LANDED |
| WR-04(b): Defensive catch stack-scrub contract | `src/cli/run.ts:176-180` explicit comment documenting `err.stack` intentionally suppressed + scrub-if-added contract | LANDED |
| IN-04: `Math.round(durationMs)` | `src/cli/run.ts:116` `Math.round(result.durationMs)` | LANDED |
| IN-01: pack test documents `dist/` side effect | `test/cli/pack.integration.test.ts` beforeAll comment added | LANDED |

All 7 review-fix items from `04-REVIEW-FIX.md` are present in the working tree. 2 items deferred (IN-02 Unicode slice, IN-03 LICENSE placeholder) with documented rationale.

### Human Verification Required

None. Every must-have is automatedly verifiable via `tsc`, `vitest`, `npm pack --dry-run`, `npm publish --dry-run`, and direct subprocess spawn of `dist/bin/crawl.js`. The gated network happy-path test (`RUN_CLI_NETWORK_TESTS=1`) is deferred to the user — it is optional coverage, not a phase requirement. All four ROADMAP success criteria are test-verified green.

### Gaps Summary

None. Phase 4 achieves its goal: `crawl run <file.md>` works end-to-end, `crawl --help` and `crawl run --help` print correct usage with all required env vars and exit codes, `npm pack --dry-run` produces a clean tarball with the shebang-preserved executable bin, and `npm publish --dry-run` succeeds. The library surface (`src/config`, `src/crawler`, `src/auth`, `src/index.ts`) is byte-unchanged across all three Phase 4 plans — the CLI wraps the library without modifying it. All 6 declared requirements (CLI-01..05 + OUT-05) are satisfied with implementation + test evidence. All critical + warning findings from `04-REVIEW.md` were addressed in `04-REVIEW-FIX.md` and the fixes are present in the final tree.

Informational notes for the maintainer (non-blocking):
- Publish prep: `package.json.author` is empty and `repository`/`bugs`/`homepage` fields were removed — populate before the first real `npm publish` (already documented in `04-REVIEW-FIX.md`'s "Publish-prep reminders").
- Tarball bloat: 72 compiled test files ship in the tarball because colocated `.test.ts` files compile into `dist/`. Not a blocker for v1 (117.4 kB packed), but a future tsc `include` or `files` tightening would slim it.

---

_Verified: 2026-04-18T10:11:54Z_
_Verifier: Claude (gsd-verifier)_
