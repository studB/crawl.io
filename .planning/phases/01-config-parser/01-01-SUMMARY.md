---
phase: 01-config-parser
plan: 01
subsystem: infra
tags: [typescript, nodenext, commonjs, unified, remark-parse, yaml, zod, vitest]

# Dependency graph
requires: []
provides:
  - Phase 1 dependency set installed (unified@^9, remark-parse@^9, yaml, zod, vitest, typescript, @types/node, @types/mdast)
  - CommonJS build pipeline wired (tsc -> dist/ with .js + .d.ts)
  - npm scripts: build, typecheck, test, test:watch
  - src/config/ directory placeholder ready for Plan 02/03 modules
  - .gitignore excludes node_modules, dist, .crawl-session.json, *.log, .DS_Store
  - Verified invariant: unified v9.x and remark-parse v9.x load via require() on Node 20 CJS runtime
affects: [01-02-types-schema-errors, 01-03-parser, 02-core-crawler, 04-cli-packaging]

# Tech tracking
tech-stack:
  added:
    - unified@9.2.2 (CJS-compatible major — v10+ is ESM-only, blocked by D-08 sync parseConfig under module:nodenext + type:commonjs on Node 20 LTS)
    - remark-parse@9.0.0 (same CJS-compatibility reason as unified)
    - yaml@2.8.3
    - zod@4.3.6
    - typescript@6.0.3 (dev)
    - vitest@4.1.4 (dev)
    - "@types/node@25.6.0 (dev)"
    - "@types/mdast@4.0.4 (dev) — mdast Root/Heading/Code/Text types for Plan 03"
  patterns:
    - CJS emit via module:nodenext + type:commonjs (no ESM in v1 — keeps npm publish shape simple)
    - Strict TS invariants locked: strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes (per CLAUDE.md — do not loosen)
    - Tests colocated under src/ with `.test.ts` suffix (Vitest glob `src/**/*.test.ts`)
    - `.gitkeep` to preserve empty source directories in git

key-files:
  created:
    - .gitignore
    - src/index.ts
    - src/config/.gitkeep
    - vitest.config.ts
    - package-lock.json
  modified:
    - package.json (deps, devDeps, scripts, main, types, files)
    - tsconfig.json (rootDir, outDir, lib, types, include, exclude; removed jsx)

key-decisions:
  - "Pin unified and remark-parse to ^9 — the last CJS-compatible majors — so Node 20 LTS + type:commonjs + module:nodenext can require() them without ERR_REQUIRE_ESM, honoring D-08 sync parseConfig"
  - "Keep package.json type:commonjs for v1 — simpler npm publish surface; ESM migration deferred"
  - "Emit CJS via tsc (module:nodenext auto-emits CJS when type:commonjs) rather than adding tsup/esbuild — one fewer toolchain moving part"
  - "Vitest over node:test — richer assertion/glob/config ergonomics, negligible cost increase; passWithNoTests:true so empty runs are green regardless of Vitest version"
  - "Test files colocated in src/**/*.test.ts, not a top-level tests/ tree — keeps each module adjacent to its spec"

patterns-established:
  - "CJS build pattern: type:commonjs + module:nodenext + tsc -> dist/ with declaration and source maps"
  - "Strict type posture: noUncheckedIndexedAccess + exactOptionalPropertyTypes never loosened"
  - "Dependency discipline: top-level deps contain only what the code imports (no transitives)"

requirements-completed: []

# Metrics
duration: 3 min
completed: 2026-04-18
---

# Phase 1 Plan 1: Scaffold Phase 1 Toolchain Summary

**CommonJS TypeScript toolchain installed with unified@9 + remark-parse@9 + yaml + zod + vitest, pinned to v9 majors so Node 20 CJS runtime can `require()` them under the sync `parseConfig` contract locked by D-08.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-18T01:06:58Z
- **Completed:** 2026-04-18T01:10:01Z
- **Tasks:** 3
- **Files modified:** 7 (2 modified, 5 created)

## Accomplishments

- Installed the full Phase 1 dependency set (4 prod + 4 dev) at the versions resolved by npm at run time, with unified and remark-parse pinned to the v9 majors — the last CJS-compatible releases — so `require()` works on Node 20 LTS under `type: commonjs`.
- Aligned `tsconfig.json` with the CJS emit pipeline (`rootDir: ./src`, `outDir: ./dist`, `lib: [esnext]`, `types: [node]`, `include`, `exclude`) while preserving every strict flag mandated by CLAUDE.md: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`. Removed the accidental `"jsx": "react-jsx"` left over from the bootstrap template.
- Wired four npm scripts (`build`, `typecheck`, `test`, `test:watch`) and package metadata (`main`, `types`, `files`) so the package is npm-publishable once code lands. Scaffolded `src/index.ts` (stub `export {};`) and `src/config/.gitkeep` so subsequent plans have a compilable rootDir and a tracked target directory.
- Added `.gitignore` covering `node_modules`, `dist`, `.crawl-session.json` (per the security constraint from PROJECT.md/CLAUDE.md), `*.log`, and `.DS_Store`.
- Verified the full smoke loop: `npm run typecheck` → exit 0, `npm run build` → CJS emit at `dist/index.js` + `dist/index.d.ts`, `npm test` → exit 0, `node -e "require('unified'); require('remark-parse')"` → exit 0 (no `ERR_REQUIRE_ESM`).

## Resolved Dependency Versions

Captured from `node_modules/*/package.json` after `npm install`:

| Package          | Kind    | Spec         | Resolved  | Notes                                      |
|------------------|---------|--------------|-----------|--------------------------------------------|
| unified          | prod    | `^9`         | 9.2.2     | **Pinned to v9** (last CJS major)          |
| remark-parse     | prod    | `^9`         | 9.0.0     | **Pinned to v9** (last CJS major)          |
| yaml             | prod    | (unpinned)   | 2.8.3     |                                            |
| zod              | prod    | (unpinned)   | 4.3.6     |                                            |
| typescript       | dev     | (unpinned)   | 6.0.3     |                                            |
| vitest           | dev     | (unpinned)   | 4.1.4     |                                            |
| @types/node      | dev     | (unpinned)   | 25.6.0    |                                            |
| @types/mdast     | dev     | (unpinned)   | 4.0.4     | mdast AST types for Plan 03                |

**Why v9 pin:** `unified@10+` and `remark-parse@10+` ship as ESM-only. Under the phase-locked combo of `module: nodenext` + `"type": "commonjs"` on Node 20 LTS, TypeScript emits `require()` calls for these imports. Node 20 does not stabilize `require()` of ESM (that capability lands unflagged in 22.12+). D-08 in `01-CONTEXT.md` locks `parseConfig` as synchronous, which forbids the `await import()` workaround. v9 is the only compatible path — it exposes the same `unified().use(remarkParse).parse(source)` sync API and the same mdast `Root`/`Heading`/`Code`/`Text` AST shape Plan 03 needs, so downstream plans are unaffected.

## tsconfig.json Changes Applied

Preserved (untouched): `module: nodenext`, `target: esnext`, `sourceMap: true`, `declaration: true`, `declarationMap: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `strict: true`, `verbatimModuleSyntax: true`, `isolatedModules: true`, `noUncheckedSideEffectImports: true`, `moduleDetection: force`, `skipLibCheck: true`.

Added:
- `"rootDir": "./src"`
- `"outDir": "./dist"`
- `"lib": ["esnext"]` (was commented out)
- `"types": ["node"]` (was empty array)
- `"include": ["src/**/*"]` (top-level)
- `"exclude": ["dist", "node_modules"]` (top-level)

Removed:
- `"jsx": "react-jsx"` — no JSX in this project; removing avoids downstream tooling confusion

## Build & Test Script Status

- `npm run typecheck` → exits 0 (no errors on the empty `src/` tree).
- `npm run build` → exits 0, produces `dist/index.js` (`"use strict"; Object.defineProperty(exports, "__esModule", { value: true });`) and `dist/index.d.ts`. Emit is unambiguously CommonJS.
- `npm test` → exits 0 with "No test files found" (Vitest 4.1.4 treats this as success thanks to `passWithNoTests: true`).
- `npm run test:watch` → not run (watch command, not verifiable in one-shot CI-style run).

## CJS Loading Sanity Check

```bash
$ node -e "require('unified'); require('remark-parse')"
# exit 0, no ERR_REQUIRE_ESM — confirms v9 pin avoids the ESM-only trap
```

This is the single most load-bearing invariant for Plan 03. If it ever fails (e.g., someone bumps unified to ^10), `parseConfig` will crash at require time, before any parser code runs.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Phase 1 dependencies via npm** — `3d74d1f` (chore)
   - `package.json`, `package-lock.json`
2. **Task 2: Align tsconfig.json and wire build/test scripts** — `1e9baa3` (chore)
   - `tsconfig.json`, `package.json`, `.gitignore`, `src/index.ts`
3. **Task 3: Create src/config directory placeholder and sanity-run vitest** — `de258ab` (chore)
   - `src/config/.gitkeep`, `vitest.config.ts`

**Plan metadata:** pending (final commit after SUMMARY.md is written)

## Files Created/Modified

### Created

- `.gitignore` — excludes `node_modules`, `dist`, `.crawl-session.json` (security-critical), `*.log`, `.DS_Store`
- `src/index.ts` — stub `export {};` so `tsc` has a compilable entry point at `rootDir`; Plan 03 replaces this with real public-API re-exports (`parseConfig`, `parseConfigFile`, `CrawlJob`, `ConfigParseError`)
- `src/config/.gitkeep` — empty file tracked by git so the directory survives a clean checkout
- `vitest.config.ts` — Vitest config: `include: ['src/**/*.test.ts']`, `environment: 'node'`, `passWithNoTests: true`
- `package-lock.json` — generated by npm; captures the full transitive tree for reproducible installs

### Modified

- `package.json` — added `dependencies`, `devDependencies`, replaced `scripts`, set `main: dist/index.js`, added `types: dist/index.d.ts` and `files: [dist]`
- `tsconfig.json` — added `rootDir`/`outDir`/`lib`/`types`/`include`/`exclude`; removed `jsx`; preserved every strict invariant

## Decisions Made

Consolidated in `key-decisions` frontmatter. Notable call-outs:

- **Pin unified and remark-parse to `^9`.** Driven by Node 20 + CJS + D-08 sync `parseConfig` — non-negotiable. Documented inline in the package.json spec in PLAN and here, so future "why is this pinned?" audits find the answer.
- **Keep `type: commonjs` for v1.** Easier npm publish story (no `exports` conditional map, no dual-publish), at the cost of blocking ESM-only libs. That cost is accepted and constrained to the unified/remark-parse pin.
- **Vitest + colocated `.test.ts`.** Consistent with modern TS projects; `passWithNoTests: true` unconditionally avoids per-Vitest-version exit-code differences on empty runs.

## Deviations from Plan

None - plan executed exactly as written.

All three tasks ran top-to-bottom with no deviations. Every `<acceptance_criteria>` item (12 for Task 1, 12 for Task 2, 6 for Task 3 — 30 total) passed on first check. The plan-level `<verification>` smoke test (typecheck + build + test + require() sanity) passed end-to-end.

---

**Total deviations:** 0
**Impact on plan:** None — plan was fully self-contained and correctly specified.

## Issues Encountered

None.

One transient observation: the pre-existing untracked `package.json`, `package-lock.json`, and `tsconfig.json` in the repo start state were never committed under the `chore: add project config` bootstrap commit (that commit only added `.planning/`), so Task 1 and Task 2 committed them fresh rather than as modifications. No impact — content is what the plan prescribed.

## User Setup Required

None - no external service configuration required. This plan installs toolchain only; credentials, APIs, and dashboards do not enter until Phase 3 (Naver auth).

## Next Phase Readiness

- Toolchain is green end-to-end: `npm run typecheck`, `npm run build`, `npm test` all exit 0.
- `src/config/` is tracked and empty — Plan 02 (types, schema, errors) can drop files in without any infra work.
- `unified`, `remark-parse`, `yaml`, `zod`, and `@types/mdast` are installed and CJS-loadable — Plan 03 (parser) can `require()`/`import` them without hitting `ERR_REQUIRE_ESM`.
- Ready for **Plan 01-02: Define CrawlJob types, Zod schemas, and ConfigParseError**.

## Self-Check: PASSED

Files verified on disk:
- `.gitignore` — FOUND
- `src/index.ts` — FOUND
- `src/config/.gitkeep` — FOUND
- `vitest.config.ts` — FOUND
- `package-lock.json` — FOUND
- `package.json` — FOUND (modified)
- `tsconfig.json` — FOUND (modified)

Commits verified in `git log`:
- `3d74d1f` (Task 1) — FOUND
- `1e9baa3` (Task 2) — FOUND
- `de258ab` (Task 3) — FOUND

All plan-level verification commands re-run clean:
- `npm run typecheck` → exit 0
- `npm run build` → emits `dist/index.js` + `dist/index.d.ts`
- `npm test` → exit 0
- `node -e "require('unified'); require('remark-parse')"` → exit 0

---
*Phase: 01-config-parser*
*Completed: 2026-04-18*
