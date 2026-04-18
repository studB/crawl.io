---
phase: 04-cli-packaging
status: complete
fixes_applied: 7
fixes_deferred: 2
tests_passing: 221
tests_skipped: 6
fixed_at: 2026-04-18T19:08:00Z
review_path: .planning/phases/04-cli-packaging/04-REVIEW.md
iteration: 1
---

# Phase 4: Code Review Fix Report

**Fixed at:** 2026-04-18T19:08:00Z
**Source review:** `.planning/phases/04-cli-packaging/04-REVIEW.md`
**Iteration:** 1

## Summary

| Metric                    | Before | After |
| ------------------------- | ------ | ----- |
| Critical findings open    | 1      | 0     |
| Warning findings open     | 4      | 0     |
| Info findings open        | 4      | 2     |
| Tests passing             | 220    | 221   |
| Tests skipped             | 6      | 6     |
| tsc --noEmit exit         | 0      | 0     |
| npm run build exit        | 0      | 0     |
| npm pack --dry-run exit   | 0      | 0     |
| npm publish --dry-run exit| 0      | 0     |

7 findings fixed (1 CR, 4 WR, 2 IN). 2 IN-level findings deferred with rationale.

## Fixed Issues

| ID    | Severity | Commit    | Summary                                                                    |
| ----- | -------- | --------- | -------------------------------------------------------------------------- |
| CR-01 | Critical | `3f022db` | Top-level fatal stderr now routes through `scrubPaths` (T-04-01 closed)    |
| WR-01 | Warning  | `5f02030` | `crawl run --help` now advertises the correct `CRAWL_HEADED_TIMEOUT_MS` default (300000) |
| WR-02 | Warning  | `daeee5f` | `crawl --version` reads package.json at runtime (single source of truth)   |
| WR-03 | Warning  | `aa0351a` | Removed `TBD` placeholder URLs from `package.json`                         |
| WR-04 | Warning  | `93aece7` | `truncateForSummary` collapses newlines; defensive catch stack-scrub contract documented |
| IN-04 | Info     | `0c0b4cc` | `successSummary` now `Math.round`s `durationMs` for guaranteed integer output |
| IN-01 | Info     | `c4dbde7` | `pack.integration.test.ts beforeAll` documents `dist/` build side effect   |

### CR-01: Top-level fatal error bypasses path scrubbing

- **File modified:** `src/bin/crawl.ts`
- **Commit:** `3f022db`
- **Applied fix:** Imported `scrubPaths` from `../crawler/output`. The `runCli().catch` handler now passes `err.message` through `scrubPaths` before writing to stderr, closing the T-04-01 / MD-04 redaction gap. Added a code comment flagging that `err.stack` is deliberately suppressed so a future verbose-mode addition remembers to scrub it.

### WR-01: `--help` documents wrong default for `CRAWL_HEADED_TIMEOUT_MS`

- **File modified:** `src/cli/run.ts` (line 208)
- **Commit:** `5f02030`
- **Applied fix:** Changed the help-text literal from `default 180000` to `default 300000` to match `HEADED_TIMEOUT_DEFAULT_MS` in `src/auth/headed.ts` and the README env-var table.

### WR-02: Hardcoded `'0.1.0'` version string will drift

- **File modified:** `src/cli/cli.ts`
- **Commit:** `daeee5f`
- **Applied fix:** Added `readPackageVersion()` that uses `readFileSync(resolve(__dirname, '..', '..', 'package.json'), 'utf8')` + `JSON.parse` to read the version at module load. Wired it into `program.version(readPackageVersion())`. Chose `readFileSync` over a JSON-module import deliberately — avoids `resolveJsonModule` and avoids tsc copying `package.json` into `dist/`. Fallback to `'0.0.0'` on any read/parse failure keeps the binary resilient (tested — `node dist/bin/crawl.js --version` prints `0.1.0` correctly after build).

### WR-03: `package.json` contains `TBD` placeholders

- **File modified:** `package.json`
- **Commit:** `aa0351a`
- **Applied fix:** Chose option (b) — removed `repository`, `bugs`, and `homepage` fields entirely. `npm publish --dry-run` still exits 0 without them. `npm pack --dry-run` manifest shape unchanged (fields are pure metadata, not tarball inputs).

  > **Publish-prep note for maintainers:** Before the first real `npm publish`, re-add `repository`, `bugs`, `homepage`, and populate `author` in `package.json` with the actual project URLs. Absent these, the npm.org package page will show no Repository / Issues / Homepage links.

### WR-04: Summary truncation + defensive-catch stack contract

- **Files modified:** `src/cli/run.ts`, `src/cli/run.test.ts`
- **Commit:** `93aece7`
- **Applied fix (a):** `truncateForSummary` now calls `value.replace(/\s+/g, ' ').trim()` BEFORE measuring length — so a multi-line extracted value (LF, CRLF, tab mixes) collapses to one logical line and preserves the documented `✓ <field>: <value>` single-line contract. Added a regression test (`WR-04(a): embedded newlines in first-field value are collapsed to single spaces`) that feeds `'  line one\nline two\r\nline\tthree  '` and asserts the stdout element has no embedded `\n` or `\r` and equals `'✓ title: line one line two line three'`. Test count: 220 → 221.
- **Applied fix (b):** Added an explicit comment at the `runHandler` defensive catch site (now `src/cli/run.ts:~174`) locking the contract that `err.stack` is intentionally not emitted, and that any future verbose-mode stack dump MUST route through `scrubPaths`.

### IN-04: `successSummary` prints raw `durationMs`

- **File modified:** `src/cli/run.ts` (successSummary fallback branch)
- **Commit:** `0c0b4cc`
- **Applied fix:** Wrapped `result.durationMs` in `Math.round(...)` so the `✓ crawl ok (<n>ms)` line is guaranteed integer even if a future `CrawlResult` carries a fractional duration.

### IN-01: `pack.integration.test.ts` `beforeAll` mutates working tree

- **File modified:** `test/cli/pack.integration.test.ts`
- **Commit:** `c4dbde7`
- **Applied fix:** Added a multi-line comment above the `beforeAll` noting that on a cold checkout the block runs `npm run build` and writes to `dist/` as a side effect. `dist/` is gitignored so it does not dirty the tracked tree, but the comment makes the effect discoverable. Chose option (a) from REVIEW.md per the reviewer's own note that it was sufficient.

## Deferred Issues

### IN-02: Unicode slice may split surrogate pairs

- **File:** `src/cli/run.ts:84-87`
- **Reason for deferral:** v1 target content is plain ASCII / BMP Korean text. No user-facing content observed in Phase 2-3 test fixtures uses emoji, regional-indicator sequences, ZWJ sequences, or combining marks. Switching to `[...value].slice(0, N).join('')` changes the test `payload.length === 80` invariant subtly (code unit vs code point count), and the reviewer explicitly marked this "not urgent — v1 target content is plain text." Flagged for v1.1 hardening if emoji payloads appear.
- **Original issue:** `value.slice(0, 80)` slices on UTF-16 code units, so an emoji or surrogate pair at the boundary can emit a lone surrogate.

### IN-03: LICENSE copyright holder is generic placeholder

- **File:** `LICENSE:3`
- **Reason for deferral:** `Copyright (c) 2026 crawl.io contributors` is legally acceptable for an OSS project with no external contributor list yet. The reviewer explicitly wrote "Fine for v1; flag for future" and recommended the update happen on the first external contribution. Deferring to that milestone keeps the LICENSE honest (no single-author claim before one is appropriate) and matches the reviewer's own guidance.
- **Original issue:** Placeholder author line could be replaced with a concrete author / CONTRIBUTORS file.

## Verification Block

```
# tsc
$ npx tsc --noEmit
# (exit 0, no output)

# Unit + CLI integration tests
$ npx vitest run
Test Files  19 passed | 1 skipped (20)
     Tests  221 passed | 6 skipped (227)
  Duration  9.25s

# Build
$ npm run build
# (exit 0, tsc + postbuild shebang guard succeed)

# Shebang preservation
$ head -1 dist/bin/crawl.js
#!/usr/bin/env node

# Runtime version — now sourced from package.json
$ node dist/bin/crawl.js --version
0.1.0

# Help text — corrected timeout default
$ node dist/bin/crawl.js run --help | grep CRAWL_HEADED_TIMEOUT_MS
  CRAWL_HEADED_TIMEOUT_MS    Optional — headed-fallback poll timeout (ms, default 300000)

# npm pack --dry-run
$ npm pack --dry-run
# (exit 0, crawl.io-0.1.0.tgz, 167 files, 117.4 kB)

# npm publish --dry-run
$ npm publish --dry-run
# (exit 0, + crawl.io@0.1.0)

# Library boundary untouched
$ git diff --name-only 2fea78f..HEAD -- src/config src/crawler src/auth src/index.ts
# (empty — no files changed outside src/cli and src/bin)
```

## Publish-prep reminders for maintainers

Before running the first real `npm publish`:

1. Populate `author` in `package.json` (currently `""`).
2. Re-add `repository`, `bugs`, and `homepage` with real project URLs (WR-03 removed them as `TBD` placeholders).
3. If a concrete copyright holder or `CONTRIBUTORS` file emerges, update `LICENSE:3` (IN-03 deferred).

---

_Fixed: 2026-04-18_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
