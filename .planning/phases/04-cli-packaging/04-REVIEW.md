---
phase: 04-cli-packaging
reviewed: 2026-04-18T00:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - src/cli/exit.ts
  - src/cli/exit.test.ts
  - src/cli/run.ts
  - src/cli/run.test.ts
  - src/cli/cli.ts
  - src/bin/crawl.ts
  - test/cli/cli.integration.test.ts
  - test/cli/pack.integration.test.ts
  - test/fixtures/cli/minimal-public.md
  - package.json
  - README.md
  - LICENSE
  - .gitattributes
  - vitest.config.ts
findings:
  critical: 1
  warning: 4
  info: 4
  total: 9
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 4's CLI + packaging surface is well-factored: `resolveExitCode` is a pure 2-line function with exhaustive test coverage, `runHandler` cleanly separates I/O via `RunDeps`, only two `process.exit` call sites exist (bin entry + commander action wrapper — matches the invariant), and `scrubPaths` is applied at every pre-flight and defensive-catch emission site in `run.ts`. The `package.json` allowlist is tight, `prepack` runs only `tsc`, and the shebang guard in `postbuild` is idempotent.

The most material finding is a redaction gap in `src/bin/crawl.ts`: the top-level `catch` writes `err.message` directly to stderr without passing it through `scrubPaths`, which silently bypasses T-04-01 if anything downstream throws with an absolute path in its message. Lower-severity issues include one user-facing documentation / help-text contradiction (`CRAWL_HEADED_TIMEOUT_MS` default: README says `300000`, `crawl run --help` says `180000`, actual code is `300000`), drift-prone hardcoded version string in `cli.ts`, unreplaced `TBD` placeholders in `package.json` repository URLs, and a handful of info-level items.

## Critical Issues

### CR-01: Top-level fatal error bypasses path scrubbing

**File:** `src/bin/crawl.ts:22-24`
**Category:** Security — credential / path leakage
**Issue:** The `runCli().catch` handler does `process.stderr.write('\u2717 fatal: ' + msg + '\n')` where `msg = err.message`. Unlike every other stderr emission in `run.ts`, this one does **not** pass through `scrubPaths`. Any unhandled rejection that surfaces here (e.g., a future refactor leaks a filesystem error, a commander internal failure with a path in its message, a `require` resolution error) will print the user's home path verbatim — violating the T-04-01 "no path leakage at any CLI emission site" invariant and contradicting the file's own docstring ("catch any top-level unhandled rejection and translate it into a scrubbed stderr line").
**Fix:**
```ts
import { scrubPaths } from '../crawler/output';

runCli().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write('\u2717 fatal: ' + scrubPaths(msg) + '\n');
  process.exit(1);
});
```
Consider also scrubbing the stack (or explicitly not writing one) so a `--trace-uncaught` escalation does not reintroduce the leak.

## Warnings

### WR-01: `--help` documents wrong default for `CRAWL_HEADED_TIMEOUT_MS`

**File:** `src/cli/run.ts:208`
**Category:** Bug — user-facing documentation contradicts runtime
**Issue:** The help text says `default 180000`, but the locked default in `src/auth/headed.ts:21` is `HEADED_TIMEOUT_DEFAULT_MS = 300_000`, and `README.md:59` and the timeout error message in `runner.ts.auth.test.ts:153` both agree on `300000`. A user reading `crawl run --help` will configure a timeout expecting it to be twice as long as it actually is.
**Fix:**
```ts
// src/cli/run.ts:208
'  CRAWL_HEADED_TIMEOUT_MS    Optional — headed-fallback poll timeout (ms, default 300000)',
```
Better long-term: import `HEADED_TIMEOUT_DEFAULT_MS` from `../auth/headed` and interpolate it so the string can't drift again — but that crosses a library boundary; for v1 the literal fix is sufficient. Add a regression test that asserts the help-text number matches `HEADED_TIMEOUT_DEFAULT_MS`.

### WR-02: Hardcoded `'0.1.0'` version string will drift from `package.json`

**File:** `src/cli/cli.ts:40`
**Category:** Quality — maintainability, drift hazard
**Issue:** `program.version('0.1.0')` is a string literal, not sourced from `package.json`. The tarball test in `test/cli/pack.integration.test.ts:239` pins the advertised version by matching `/crawl\.io@0\.1\.0/` against publish output, and `package.json` currently has `"version": "0.1.0"`, so nothing catches the next bump. On the first `npm version patch` → `0.1.1`, `crawl --version` will lie.
**Fix:** Read the version from the compiled `package.json` at runtime:
```ts
// src/cli/cli.ts
import pkg from '../../package.json' with { type: 'json' };
// ...
program.name('crawl').description('...').version(pkg.version);
```
Or, if the JSON-module import is awkward under `module: nodenext`, use `createRequire(import.meta.url)('../../package.json').version`, OR have the build step replace a sentinel. Either way, the version should have a single source of truth.

### WR-03: `package.json` still contains `TBD` placeholders in public URLs

**File:** `package.json:28-35`
**Category:** Quality — publish-readiness hygiene
**Issue:** `repository.url`, `bugs.url`, and `homepage` all still reference `https://github.com/TBD/crawl.io…`. These strings are rendered verbatim on the npm package page after publish. `npm publish --dry-run` (run in the pack integration test) does not catch this. If the user runs `npm publish` without editing these first, the published package will have dead "Repository" / "Issues" / "Homepage" links on npmjs.com.
**Fix:** Either (a) blank the fields so npm omits them from the rendered page, or (b) add a CI check / prepublish hook that fails if `TBD` appears in `package.json`. Example guard:
```json
"scripts": {
  "prepublishOnly": "node -e \"const p=require('./package.json');const s=JSON.stringify(p);if(s.includes('TBD'))throw new Error('package.json still has TBD placeholders — update repository/bugs/homepage before publishing')\""
}
```

### WR-04: `runHandler` defensive catch does not scrub stack, and truncation does not handle newlines in extracted values

**File:** `src/cli/run.ts:84-87, 167-169`
**Category:** Bug — summary output quality; minor leakage
**Issue (a):** `truncateForSummary` slices on character count only. If an extracted field value contains a newline (e.g., the selector matched a `<pre>` or a multi-paragraph text node), the "single-line summary" will actually span multiple stdout lines, breaking the documented `✓ <field>: <value>` shape and potentially confusing downstream shell piping.
**Issue (b):** The catch-all at `run.ts:167-169` scrubs `err.message` but not `err.stack`. While the current code does not print `err.stack`, a future change that adds `if (verbose) stderr(err.stack)` would re-introduce the leak. This is a latent hazard, not a live bug.
**Fix (a):** Normalize whitespace before truncation:
```ts
function truncateForSummary(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= SUMMARY_MAX_LEN) return oneLine;
  return oneLine.slice(0, SUMMARY_MAX_LEN) + '\u2026';
}
```
**Fix (b):** Keep the current behavior (stack intentionally suppressed) but add a code comment at `run.ts:167` documenting that `err.stack` is deliberately not emitted, so a future maintainer adding verbose diagnostics remembers to scrub it.

## Info

### IN-01: `pack.integration.test.ts` `beforeAll` mutates the working tree

**File:** `test/cli/pack.integration.test.ts:109-118`
**Category:** Quality — test hygiene
**Issue:** When `dist/bin/crawl.js` is missing, `beforeAll` runs `npm run build`, which writes to `dist/`. Running this test on a cold checkout produces a tracked-untracked state difference after the run. Acceptable for an integration test, but undocumented side effect.
**Fix:** Either (a) add a clarifying comment noting the test will populate `dist/` as a side-effect, or (b) have the test build into a scratch `outDir` via a separate tsconfig and leave the repo's `dist/` untouched. Option (a) is sufficient.

### IN-02: Long extracted value truncation: visible payload length may differ after Unicode normalization

**File:** `src/cli/run.ts:84-87`
**Category:** Quality — edge case on Unicode input
**Issue:** `value.slice(0, 80)` slices on UTF-16 code units, not grapheme clusters. If an extracted field value contains emoji, combining marks, or surrogate pairs, `slice(0, 80)` can land mid-pair and emit a lone surrogate. The paired test asserts the byte length on ASCII input only; it wouldn't catch this.
**Fix:** Switch to `[...value].slice(0, SUMMARY_MAX_LEN).join('')` if preserving user-visible grapheme boundaries matters, or accept the current behavior and note the limitation. Not urgent — v1 target content is plain text.

### IN-03: `LICENSE` copyright holder is generic placeholder

**File:** `LICENSE:3`
**Category:** Quality — legal hygiene
**Issue:** `Copyright (c) 2026 crawl.io contributors` is acceptable for an open-source project but typically either (a) names a specific author / org, or (b) references a `CONTRIBUTORS` file. Fine for v1; flag for future.
**Fix:** When the first external contributor merges, either add a `CONTRIBUTORS` file or update to a concrete author line.

### IN-04: `run.ts` `successSummary` prints raw `durationMs` as a number

**File:** `src/cli/run.ts:107`
**Category:** Quality — output formatting consistency
**Issue:** `'✓ crawl ok (' + result.durationMs + 'ms)'` will render `55` cleanly, but a non-integer `durationMs` (e.g., `55.123`) would render with a decimal tail. The empirical CrawlResult always carries integer ms today, so this is cosmetic.
**Fix:** If desired, `Math.round(result.durationMs)` to guarantee integer output. Otherwise, accept.

---

_Reviewed: 2026-04-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
