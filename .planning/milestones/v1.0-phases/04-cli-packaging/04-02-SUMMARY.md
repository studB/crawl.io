---
phase: 04-cli-packaging
plan: 02
subsystem: packaging
tags: [package.json, npm, mit, readme, license, gitattributes, publish-readiness]

# Dependency graph
requires:
  - phase: 04-cli-packaging
    provides: "dist/bin/crawl.js (0755 executable shebang-preserved) from Plan 04-01"
provides:
  - "package.json with publish-ready metadata: bin.crawl, files allowlist, engines>=20, MIT license, 5-keyword array, description, repository/bugs/homepage placeholders, prepack script"
  - "README.md — install, quick-start sample markdown config, env-var table (NAVER_ID, NAVER_PW, CRAWL_HEADED_TIMEOUT_MS), exit-code table (0/1)"
  - "LICENSE — canonical MIT text with 2026 copyright"
  - ".gitattributes — text=auto eol=lf globally plus explicit LF rules for *.ts/*.js/*.json/*.md and dist/bin/crawl.js"
affects: [04-03-publish-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-level LF enforcement in .gitattributes — globbed rules for authored text types plus an explicit dist/bin/crawl.js line — so shebang survives cross-platform contribution flow even if future tsc versions drop native preservation"
    - "Placeholder repository/bugs/homepage URLs using github.com/TBD/crawl.io — grep-verified non-empty by tests; user overwrites before real npm publish"
    - "prepack script running npm run build — tsc + postbuild chmod chain runs on every npm pack, so the tarball always ships a fresh 0755 shebang-correct bin"

key-files:
  created:
    - README.md
    - LICENSE
    - .gitattributes
    - .planning/phases/04-cli-packaging/04-02-SUMMARY.md
  modified:
    - package.json

key-decisions:
  - "License moved from ISC (npm-init default) to MIT — CONTEXT.md §Package Publish Readiness locks MIT; package.json.license and LICENSE file both carry the same SPDX signal so registry consumers see one unambiguous source of truth"
  - "repository/bugs/homepage use literal github.com/TBD/crawl.io placeholders — CONTEXT.md explicitly allows this ('user fills in at publish time'); tests assert non-empty strings, not specific URLs, so a later one-line edit lands the real repo without breaking verification"
  - "files allowlist is exactly [\"dist/\", \"README.md\", \"LICENSE\"] — trailing slash on dist/ is the npm-idiomatic form; src/, test/, .planning/, vitest.config.ts, tsconfig.json, node_modules/ are all implicitly excluded (T-04-05 mitigation), Plan 03 will assert via npm pack --dry-run"
  - "prepack → npm run build (which chains through postbuild to chmod 0755) — guarantees every npm pack ships a freshly compiled bin with correct permissions; no stale-dist bug possible at publish time"
  - "LICENSE copyright line says 'crawl.io contributors' (not an individual name) — package.json.author is deliberately empty per CONTEXT.md ('left as user-settable'); a generic contributor line keeps the MIT notice valid while leaving the attribution slot open for the user"
  - ".gitattributes includes both a globbed '*.js text eol=lf' rule AND an explicit 'dist/bin/crawl.js text eol=lf' line — redundant on purpose; the explicit line documents intent (T-04-06 rationale) and survives even if a contributor narrows the *.js glob for some future reason"
  - "README.md kept to 74 lines — CONTEXT.md locks README as 'minimal, no deep-dive docs (v2)'; covers all 6 required sections (title, what it does, install, quick-start, env vars, exit codes) plus a two-line status footer without bloat"

patterns-established:
  - "Quoted fenced markdown inside README quick-start uses 4-backtick fences (````) so the nested ```yaml and ```bash blocks render literally to users — standard markdown escape for docs-about-markdown"
  - "package.json script chain for publish: prepack → build (tsc) → postbuild (chmod 0755 + shebang guard); three small scripts, each single-purpose, chained via npm lifecycle"

requirements-completed: [CLI-04, CLI-05]

# Metrics
duration: 8min
completed: 2026-04-18
---

# Phase 4 Plan 02: Packaging metadata + README + LICENSE + .gitattributes Summary

**Turned the Plan-01 CLI into a publishable npm package — package.json metadata finalized (MIT, bin, files, engines, keywords, repo placeholders, prepack), README covering install / quick-start / env vars / exit codes, canonical MIT LICENSE with 2026 copyright, and LF-enforcing .gitattributes — all four files landed atomically with zero touches under src/ and the 211-test suite still passing.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-04-18T08:39:09Z
- **Completed:** 2026-04-18T08:47:20Z
- **Tasks:** 3
- **Files created:** 3 (README.md, LICENSE, .gitattributes)
- **Files modified:** 1 (package.json)

## Accomplishments

- **package.json publish-ready** — description is a substantive one-liner (`> 20` chars), keywords are the exact 5-string array from CONTEXT (`["crawler", "playwright", "naver", "markdown", "cli"]`), license flipped `ISC` → `MIT`, engines pin `node >= 20`, files allowlist is `["dist/", "README.md", "LICENSE"]`, bin exposes `crawl → ./dist/bin/crawl.js`, repository/bugs/homepage placeholders use `github.com/TBD/crawl.io`, prepack runs `npm run build`.
- **README.md (74 lines)** covering the 6 required sections plus a status footer: title + tagline, "What it does" (≈3 sentences), Install (`npm install -g crawl.io`), Quick start with a full sample `job.md` using 4-backtick outer fences so the inner ```yaml / ```bash blocks survive, Environment variables table (NAVER_ID / NAVER_PW / CRAWL_HEADED_TIMEOUT_MS), Exit codes table (0 success / 1 any failure — OUT-05), and a pointer to `crawl --help` / `crawl run --help`.
- **LICENSE** — canonical MIT text (21 lines), first line `MIT License`, copyright line `Copyright (c) 2026 crawl.io contributors`, full "Permission is hereby granted..." body, full "THE SOFTWARE IS PROVIDED..." warranty clause.
- **.gitattributes** — `* text=auto eol=lf` globally, plus explicit `*.ts / *.js / *.json / *.md text eol=lf` rules, plus an explicit `dist/bin/crawl.js text eol=lf` line (T-04-06 mitigation).
- **No regression:** `npx tsc --noEmit` → 0, `npx vitest run` → 211 passed + 4 skipped (identical to Plan 01 baseline), `npm run build` → still emits `dist/bin/crawl.js` with shebang and 0755 mode, `git diff --name-only -- src/` → empty.

## Task Commits

Each task was committed atomically:

1. **Task 1: Update package.json metadata (bin, files, engines, keywords, license MIT, description, scripts, repo placeholders)** — `ef99008` (chore)
2. **Task 2: Create README.md with install + quick-start + env vars + exit codes** — `1dc7830` (docs)
3. **Task 3: Create LICENSE (MIT) + .gitattributes (LF enforcement)** — `f009096` (chore)

## Files Created/Modified

### Created

- `README.md` — 74 lines, all 6 required sections plus v1 status footer. Outer quick-start block uses 4-backtick fences so the nested ```yaml selectors and rules blocks render literally in the rendered markdown view. Env-var table marks NAVER_ID/NAVER_PW as "Yes, for Naver Cafe targets" and CRAWL_HEADED_TIMEOUT_MS as optional with default `300000`. Exit codes section uses a 2-row table aligned with the OUT-05 "non-zero on any failure" wording.
- `LICENSE` — 21 lines, opensource.org canonical MIT text. Copyright line uses `crawl.io contributors` since `package.json.author` is deliberately empty (CONTEXT.md §Package Publish Readiness: "left as user-settable").
- `.gitattributes` — 6 lines: global `* text=auto eol=lf`, plus four per-extension rules (`*.ts`, `*.js`, `*.json`, `*.md`), plus an explicit `dist/bin/crawl.js text eol=lf` line. The explicit line is redundant with `*.js` but documents intent for future readers (T-04-06 rationale) and stays correct if a contributor later narrows the `*.js` glob.

### Modified

- `package.json` — 4 insertions beyond the existing keys: added `bin`, `engines`, `repository`, `bugs`, `homepage`, and a `prepack` script entry; changed `license` from `"ISC"` to `"MIT"`; rewrote `description` from `""` to the one-sentence tagline; expanded `keywords` from `[]` (implicit) to the 5-entry array; expanded `files` from `["dist"]` to `["dist/", "README.md", "LICENSE"]`. `dependencies`, `devDependencies`, and the existing `build`/`postbuild`/`typecheck`/`test`/`test:watch` scripts were preserved byte-for-byte.

### Not Modified (library byte-unchanged — plan invariant)

- All `src/**/*` files — `git diff --name-only HEAD~3 HEAD -- src/` returns empty. Plan 04-02 is a packaging-only plan; all CLI code shipped in Plan 04-01.
- `tsconfig.json`, `vitest.config.ts`, `.gitignore` — untouched.

## Decisions Made

- **License: MIT (overriding ISC default) and a matching LICENSE file.** CONTEXT.md §Package Publish Readiness locks MIT. Two sources — `package.json.license` and the `LICENSE` file at repo root — keep the signal unambiguous for SPDX-consuming registry scanners.
- **Repository placeholders use `github.com/TBD/crawl.io`.** CONTEXT.md explicitly calls these out as placeholders the user edits before `npm publish`. Tests assert non-empty strings, not specific URLs, so the user's one-line edit will keep all verification green.
- **files allowlist includes trailing slash on `dist/`.** npm-idiomatic form; makes the directory intent explicit. Tests assert `files.includes("dist/")` (with slash) so the idiom is locked.
- **prepack runs `npm run build`.** The build script chains through `postbuild` (inherited from Plan 01), so `npm pack` always produces a freshly compiled, 0755, shebang-correct bin. Eliminates a class of stale-dist bugs at publish time.
- **LICENSE copyright says "crawl.io contributors".** `package.json.author` is deliberately empty (CONTEXT.md: "left as user-settable" — the user fills in their name before publish). A generic contributors line keeps the MIT notice legally complete while leaving the attribution slot open.
- **.gitattributes has both globbed rules AND an explicit bin-file line.** Redundant on purpose: the `*.js text eol=lf` rule already covers `dist/bin/crawl.js`, but the explicit line documents the T-04-06 rationale and survives even if someone later narrows the glob. Cheap defense-in-depth.
- **README kept to 74 lines.** CONTEXT.md locks README as minimal — deep-dive docs are v2. All 6 required sections fit in 74 lines, within the plan's 30–200 line envelope.
- **Quick-start uses 4-backtick outer fences.** The sample `job.md` contains ```yaml and ```bash fences; wrapping it in a standard ``` fence would terminate at the first inner closer. 4-backtick outer is the standard markdown-about-markdown escape.

## Deviations from Plan

None — plan executed exactly as written. All three tasks landed with their acceptance gates green on first attempt; no Rule 1/2/3/4 deviations required.

## Issues Encountered

None.

## User Setup Required

None for this plan. Before actual `npm publish` (Plan 03 + user's release step), the user should:

- Replace `https://github.com/TBD/crawl.io.git` in `repository.url`, `bugs.url`, and `homepage` with the real GitHub URL.
- Optionally fill in `package.json.author` with their name/email.
- Optionally replace the `crawl.io contributors` line in `LICENSE` with a specific name.

Plan 04-02 tests do not gate on these — they check non-empty strings, not specific values.

## Threat Flags

None. No new trust-boundary surface beyond what CONTEXT.md and the plan's `<threat_model>` already covered. T-04-05 (files allowlist leak) is mitigated by the explicit `["dist/", "README.md", "LICENSE"]` allowlist — Plan 03 Task 1 will assert via `npm pack --dry-run`. T-04-06 (CRLF in shebang) is mitigated by `.gitattributes` eol=lf rules. T-04-07 (repo placeholder) is an accepted risk per the threat register. T-04-08 (license mis-claim) is mitigated by the canonical MIT text + matching SPDX identifier.

## Next Phase Readiness

- Plan 04-03 can now run `npm pack --dry-run` and assert the tarball lists exactly `package.json`, `dist/*`, `README.md`, `LICENSE` — the allowlist and all three files are in place.
- Plan 04-03 can run `npm publish --dry-run` — all required fields (name, version, description, license, repository, bugs, homepage, main, types, bin, engines, files, keywords) are present and valid.
- Plan 04-03 can tarball-extract and invoke `node <extracted>/dist/bin/crawl.js --help` — dist/bin/crawl.js is 0755 with shebang, prepack will rebuild it on the next pack.

## Self-Check

Verifying claims:

- `test -f README.md` → FOUND
- `test -f LICENSE` → FOUND
- `test -f .gitattributes` → FOUND
- `head -1 LICENSE` equals `MIT License` → FOUND
- `wc -l LICENSE` → 21 (> 15 ✓)
- `wc -l README.md` → 74 (30 < 74 < 200 ✓)
- `node -e 'const p=require(\"./package.json\"); ...'` assertions all pass → FOUND
- `npx tsc --noEmit` exit 0 → PASSED
- `npx vitest run` → 211 passed + 4 skipped → PASSED
- `git diff --name-only -- src/` → empty → PASSED
- Commit `ef99008` (package.json) → FOUND
- Commit `1dc7830` (README.md) → FOUND
- Commit `f009096` (LICENSE + .gitattributes) → FOUND

## Self-Check: PASSED

---
*Phase: 04-cli-packaging*
*Completed: 2026-04-18*
