---
phase: 01-config-parser
plan: 02
subsystem: infra
tags: [typescript, zod, zod-v4, vitest, types, validation, exact-optional-property-types]

# Dependency graph
requires:
  - phase: 01-01
    provides: "Phase 1 toolchain (typescript@6, zod@4.3.6, vitest@4.1.4) and empty src/config/ directory"
provides:
  - "Public TypeScript types: CrawlJob, SelectorSpec (compile-time data contract locked per D-06)"
  - "Zod schemas: SelectorSpecSchema, RulesSchema, CrawlJobSchema — validate raw parsed objects into typed CrawlJob values with engine=css and timeout=30000 defaults applied"
  - "ConfigParseError class with aggregated { issues: string[], filePath?: string } contract; 'filePath' in err === false when omitted (exactOptionalPropertyTypes compliant)"
  - "Unit-test target surface (25 tests) that Plan 03's markdown parser must produce objects compatible with"
  - "Compile-time assertion z.infer<typeof CrawlJobSchema> is assignable to CrawlJob — drift between schema and types fails tsc"
affects: [01-03-parser, 02-core-crawler, 04-cli-packaging]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Zod v4 API: z.strictObject, z.url(), z.record(keySchema, valueSchema), z.enum().default() — confirmed CJS-loadable at zod@4.3.6"
    - "Transform pipeline strips optional-undefined keys ({ frame: undefined } -> key omitted) so schema output satisfies exactOptionalPropertyTypes"
    - "declare readonly fieldName?: T in error classes — suppresses useDefineForClassFields field emission so 'field' in instance === false when constructor skips assignment"
    - "Compile-time type equality check: const _assertShape = (x: z.infer<typeof S>): PublicType => x — fails tsc if schema output drifts from public type"

key-files:
  created:
    - src/config/types.ts
    - src/config/errors.ts
    - src/config/errors.test.ts
    - src/config/schema.ts
    - src/config/schema.test.ts
  modified:
    - tsconfig.json (verbatimModuleSyntax: true -> false; see Deviations)

key-decisions:
  - "Use Zod v4 API (z.strictObject, z.url) — the resolved zod@4.3.6 exposes both v3 and v4 flavors; v4's z.strictObject is more direct than z.object().strict() and was chosen to match the installed major"
  - "Strip optional-undefined keys via .transform() in SelectorSpecSchema and RulesSchema — required so schema output is assignable to CrawlJob under exactOptionalPropertyTypes (no { frame: undefined } allowed)"
  - "Compile-time _assertShape proves z.infer<typeof CrawlJobSchema> is assignable to CrawlJob — catches schema/type drift at tsc time, not at runtime"
  - "Disable verbatimModuleSyntax — with module:nodenext + type:commonjs it forbids ESM import/export syntax in source files; CLAUDE.md mandates strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes but not this flag; tsc still emits correct CJS under the remaining combo"

patterns-established:
  - "Schema module imports 'type { CrawlJob, SelectorSpec } from ./types' — public types drive schema output, not the other way around"
  - "Every object schema in this codebase uses strict mode (z.strictObject) — aggregate-error model needs precise unknown-key issue reporting, not silent passthrough"
  - "Colocated Vitest tests alongside modules (src/config/*.test.ts) — pattern inherited from Plan 01"

requirements-completed: [CFG-02, CFG-03, CFG-04, CFG-05, CFG-06]

# Metrics
duration: 3 min
completed: 2026-04-18
---

# Phase 1 Plan 2: Types, Zod Schemas, and ConfigParseError Summary

**CrawlJob/SelectorSpec types, three strict Zod v4 schemas with engine=css and timeout=30000 defaults, and a ConfigParseError with `declare readonly filePath` preserving `'filePath' in err === false` under exactOptionalPropertyTypes — 25 unit tests locking the contract Plan 03's markdown parser will produce.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-04-18T01:13:45Z
- **Completed:** 2026-04-18T01:17:14Z
- **Tasks:** 2 (both `tdd=true`, 4 atomic commits total: 2 RED + 2 GREEN)
- **Files modified:** 6 (5 created, 1 modified)

## Accomplishments

- **Public data contract locked** — `src/config/types.ts` exports `SelectorSpec { selector, engine: 'css'|'xpath', frame? }` and `CrawlJob { url, selectors, rules: { waitFor?, timeout } }` exactly as specified in CONTEXT.md D-06. No helpers, no extra aliases — minimal surface so downstream code has a single source of truth.
- **ConfigParseError with aggregate-issues contract** — `src/config/errors.ts` defines the class that every later error path will throw: `new ConfigParseError(issues, { filePath? })` joins issues into `.message`, exposes them on `.issues`, and — critically — uses `declare readonly filePath?: string` so the field is **not** auto-initialized by `useDefineForClassFields`. When the conditional `if (opts?.filePath !== undefined) this.filePath = ...` is skipped, the property does not exist on the instance and `'filePath' in err === false` holds. Test `errors.test.ts:25` locks this invariant — the sole test that would fail if the `declare` modifier is ever removed.
- **Three strict Zod v4 schemas with defaults** — `src/config/schema.ts` exports `SelectorSpecSchema`, `RulesSchema`, `CrawlJobSchema`. Every object schema is `z.strictObject(...)` so CFG-06 (unknown-key rejection) is enforced uniformly. `engine` defaults to `'css'`, `timeout` defaults to `30000`. `.transform()` pipelines strip optional-undefined keys (no `{ frame: undefined }` or `{ waitFor: undefined }` ever appears in output), keeping the schema output assignable to the public types under `exactOptionalPropertyTypes`.
- **Compile-time schema-vs-type drift guard** — `const _assertShape = (x: z.infer<typeof CrawlJobSchema>): CrawlJob => x` in schema.ts forces tsc to prove the schema's parsed output is assignable to `CrawlJob`. Any future edit that changes one but not the other fails `npm run typecheck` immediately — the same flag that gates CI once one exists.
- **25 tests locking behavior** — 5 for ConfigParseError (instanceof chain, issues array, joined message, `'filePath' in err === false`, filePath stored), 20 for the schemas (defaults, xpath passthrough, frame array round-trip, strict unknown-key rejection at every level, invalid engine descriptive error, empty selectors map rejected, invalid URL rejected). Full suite: `npx vitest run` → 25/25 pass in ~280 ms.

## Resolved API Decisions (Zod v4)

Zod v4.3.6 exposes both the v3 and v4 method flavors. This plan uses the v4 forms because they're more direct and match the installed major:

| Construct        | v4 form used                     | v3 equivalent (not used)                        |
|------------------|----------------------------------|-------------------------------------------------|
| Strict object    | `z.strictObject({...})`          | `z.object({...}).strict()`                      |
| URL validator    | `z.url('message')`               | `z.string().url('message')`                     |
| Record           | `z.record(keySchema, valSchema)` | `z.record(valSchema)` (no explicit key schema)  |
| Enum with default| `z.enum(['a','b']).default('a')` | same                                            |

`z.record(z.string().min(1), SelectorSpecSchema)` validates that every key is a non-empty string **and** every value parses through `SelectorSpecSchema` (including the defaults/transforms). The `.refine(s => Object.keys(s).length > 0, ...)` check on top of that enforces "at least one named selector" from the plan's behavior table.

## Schema Output Shapes (observed at runtime)

```text
SelectorSpecSchema.parse({ selector: '#foo' })
  -> { selector: '#foo', engine: 'css' }          // 'frame' key absent
SelectorSpecSchema.parse({ selector: '//h1', engine: 'xpath' })
  -> { selector: '//h1', engine: 'xpath' }        // 'frame' key absent
SelectorSpecSchema.parse({ selector: '#x', frame: ['a','b'] })
  -> { selector: '#x', engine: 'css', frame: ['a','b'] }

RulesSchema.parse({})                 -> { timeout: 30000 }             // 'waitFor' key absent
RulesSchema.parse({ waitFor: '#r' })  -> { waitFor: '#r', timeout: 30000 }
RulesSchema.parse({ timeout: 5000 })  -> { timeout: 5000 }              // 'waitFor' key absent

CrawlJobSchema.parse({ url, selectors: { title: { selector: 'h1' } }, rules: {} })
  -> { url, selectors: { title: { selector: 'h1', engine: 'css' } }, rules: { timeout: 30000 } }
```

The `'frame' in out === false` and `'waitFor' in out === false` assertions in the tests lock this — a future schema change that introduces `{ frame: undefined }` back would fail those tests **and** would fail the `_assertShape` compile-time check.

## Exports by Module

From `grep -RE "export (interface|class|const)" src/config/ | grep -v test.ts`:

| Module                 | Exports                                                                 |
|------------------------|-------------------------------------------------------------------------|
| `src/config/types.ts`  | `SelectorSpec`, `CrawlJob` (interfaces)                                 |
| `src/config/errors.ts` | `ConfigParseErrorOptions` (interface), `ConfigParseError` (class)       |
| `src/config/schema.ts` | `SelectorSpecSchema`, `RulesSchema`, `CrawlJobSchema` (const)           |

Matches the plan's `<verification>` point 3 exactly: 7 exports across 3 modules.

## Test Count and Pass Rate

| File                         | `it(` blocks | Passing | Notes                                                              |
|------------------------------|--------------|---------|--------------------------------------------------------------------|
| `src/config/errors.test.ts`  | 5            | 5       | Minimum 5 required; includes the load-bearing `'filePath' in err`. |
| `src/config/schema.test.ts`  | 20           | 20      | Minimum 15 required; 3 describe blocks (Selector/Rules/CrawlJob).  |
| **Total**                    | **25**       | **25**  | 100% pass rate. Plan success criterion is "at least 20" — exceeded.|

`npx vitest run` and `npm test` both exit 0. `npx tsc -p tsconfig.json --noEmit` exits 0.

## Task Commits

Each task follows the TDD gate (RED → GREEN), yielding 2 commits per task:

1. **Task 1 RED: Failing tests for ConfigParseError** — `35b31fd` (test)
   - `src/config/errors.test.ts` (new, 33 lines)
2. **Task 1 GREEN: Types + ConfigParseError + tsconfig deviation** — `f4ff6b7` (feat)
   - `src/config/types.ts` (new), `src/config/errors.ts` (new), `tsconfig.json` (modified — verbatimModuleSyntax flip; see Deviations)
3. **Task 2 RED: Failing tests for Zod schemas** — `170748a` (test)
   - `src/config/schema.test.ts` (new, 163 lines, 20 it blocks)
4. **Task 2 GREEN: Zod schemas for SelectorSpec/Rules/CrawlJob** — `7480ce6` (feat)
   - `src/config/schema.ts` (new, 67 lines, 3 exported schemas + compile-time assertion)

**Plan metadata:** pending (final commit after this SUMMARY.md + STATE.md + ROADMAP.md).

## Files Created/Modified

### Created (5)

- `src/config/types.ts` — `SelectorSpec` and `CrawlJob` interfaces. Matches CONTEXT.md D-06 character-for-character.
- `src/config/errors.ts` — `ConfigParseError extends Error` with `readonly issues: string[]`, `declare readonly filePath?: string`, and conditional-assignment constructor. Includes `ConfigParseErrorOptions` interface.
- `src/config/errors.test.ts` — 5 Vitest cases covering instanceof chain, issues preservation, message join, `'filePath' in err === false` invariant (declare-modifier witness), and filePath storage when provided.
- `src/config/schema.ts` — 3 Zod v4 schemas with defaults, strict mode, transform-strip-undefined pipelines, and a compile-time `_assertShape` drift guard.
- `src/config/schema.test.ts` — 20 Vitest cases across 3 describe blocks covering defaults, type rejection, unknown-key rejection, invalid enum value, empty selectors map, and full-job round-trip.

### Modified (1)

- `tsconfig.json` — flipped `verbatimModuleSyntax: true` → `false` with an inline comment explaining why. Zero impact on CLAUDE.md-mandated strict flags (all preserved). See **Deviations** below.

## Decisions Made

- **v4 strictObject form over v3 `.object().strict()`.** The plan marked either as acceptable; v4 is more direct and matches the installed major.
- **Transform output typed explicitly** (`.transform((v): SelectorSpec => ...)` and `.transform((v): { waitFor?: string; timeout: number } => ...)`). Without the explicit return type, Zod's inference keeps `waitFor?: string | undefined` in the transform's output type, which then fails the `exactOptionalPropertyTypes` assignability check in `_assertShape`. The explicit return type tells TS the transform produces an exact-optional-aware shape.
- **`const _assertShape = (x: z.infer<typeof S>): CrawlJob => x`** instead of the plan's `null as unknown as _CrawlJobSchemaOutput` cast. The function form is the clearest way to force a one-directional assignability check (schema output → public type); the cast form was ambiguous about direction and harder to reason about.
- **Commit tsconfig edit with Task 1 GREEN** rather than as a separate deviation commit. The flag flip is required for Task 1's tests to typecheck, so bundling it into the same commit keeps the atomic task↔commit mapping intact and preserves bisect-ability (every commit on master `tsc --noEmit` passes).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Flipped `verbatimModuleSyntax: true` → `false` in tsconfig.json**

- **Found during:** Task 1 (first real TypeScript source files committed to the repo).
- **Issue:** Plan 01 set `verbatimModuleSyntax: true` in tsconfig.json. Under `module: nodenext` + `"type": "commonjs"`, that flag forbids ESM `import`/`export` syntax in source files — tsc emits `TS1287: A top-level 'export' modifier cannot be used on value declarations in a CommonJS module when 'verbatimModuleSyntax' is enabled` and `TS1295: ECMAScript imports and exports cannot be written in a CommonJS file under 'verbatimModuleSyntax'`. Plan 01's typecheck passed only because `src/index.ts` was `export {};` (no real imports/exports). Plan 02 requires writing `export interface` and `import { z } from 'zod'` — the idiomatic TS form — which triggers the errors. The plan's success criterion `npx tsc --noEmit` exits 0 is unachievable with the flag on.
- **Fix:** Set `verbatimModuleSyntax: false` with an inline comment explaining the reasoning. Preserves `module: nodenext`, `type: commonjs`, and every CLAUDE.md-mandated strict flag (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). tsc still emits correct CJS under this combo (verified: `dist/config/errors.js` begins with `"use strict"; Object.defineProperty(exports, "__esModule", ...)` and emits `class ConfigParseError extends Error { issues; ... }` — exactly the shape the `declare readonly filePath` requires, with no field initialization for `filePath`).
- **Files modified:** `tsconfig.json`.
- **Verification:** `npx tsc -p tsconfig.json --noEmit` exits 0. `npx tsc -p tsconfig.json` emits CJS (`"use strict"`, `Object.defineProperty(exports, ...)`). `npx vitest run` → 25/25. `node -e "require('unified'); require('remark-parse')"` still exits 0 (the v9 CJS-loading invariant from Plan 01 is unaffected).
- **Committed in:** `f4ff6b7` (Task 1 GREEN commit).
- **Alternative considered:** Keeping the flag on and using `export = ` / `import X = require(...)` TypeScript-CJS syntax. Rejected: nonstandard, clashes with Zod's ESM-style export shape, and conflicts with Vitest test files which use `import { describe, it, expect } from 'vitest'`. No realistic path forward without the flip.

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking).
**Impact on plan:** Minimal. CLAUDE.md's mandated strictness set is fully preserved. The v1 CJS publish shape is unchanged. The Plan 01 load-bearing invariant (unified/remark-parse v9 require-loadable) is unaffected. This is a latent Plan 01 bug that only surfaces once real TS source files land — had Plan 01's typecheck smoke-test included a non-trivial source file, the flag would have been caught there.

## Issues Encountered

None beyond the Rule 3 deviation above. Every grep-based acceptance criterion (11 for Task 1, 12 for Task 2 — 23 total) passed on first run. Both Vitest test files ran clean on first GREEN attempt with no iteration needed. Zod v4's behavior was verified via a preflight `node -e` probe before writing either schema, so no runtime surprises.

## User Setup Required

None — this plan is pure-TypeScript / pure-Vitest and touches no external service. Naver credentials, `.crawl-session.json`, npm publish, and CLI binary setup are all deferred to later phases.

## Next Phase Readiness

- **Plan 01-03 (markdown parser) unblocked.** It now has an authoritative target: its job is to read a markdown file, build a raw JS object with the shape Zod expects, hand it to `CrawlJobSchema.safeParse`, and on failure aggregate every Zod issue + every structural issue into a `ConfigParseError(issues, { filePath })`. The public `parseConfig` / `parseConfigFile` entry points from CONTEXT.md D-06 can thin-wrap that pipeline.
- **Phase 2 (crawler) and Phase 4 (CLI) dependency surface stable.** `CrawlJob`, `SelectorSpec`, and `ConfigParseError` are now the compile-time contract those phases will import — no further reshaping expected.
- **Zod v4 API confirmed working under CJS.** `require('zod')` + `z.strictObject` + `z.url` + `z.record(keySchema, valueSchema)` all function correctly in the Node 20 + `type: commonjs` runtime. Plan 03's aggregation step can rely on `ZodError.issues[].path` and `.message` for formatting.
- **`tsc --noEmit` is now a meaningful gate.** Going forward, every PR that drifts schema vs. types, introduces `{ frame: undefined }` back into outputs, or forgets `declare` on a class field fails typecheck before it ever reaches tests.

## TDD Gate Compliance

Both tasks have `tdd="true"`. Git log shows the required RED → GREEN sequence for each:

- Task 1: `35b31fd` (test) → `f4ff6b7` (feat) ✓
- Task 2: `170748a` (test) → `7480ce6` (feat) ✓

Each RED commit's test file imported a module that did not yet exist; verified by running `npx vitest run <file>` before the GREEN commit — both RED runs failed with `Cannot find module` as expected (not with "unexpectedly passing" false negatives). REFACTOR phase was unnecessary — both implementations were minimal by construction.

## Self-Check: PASSED

Files verified on disk:
- `src/config/types.ts` — FOUND
- `src/config/errors.ts` — FOUND
- `src/config/errors.test.ts` — FOUND
- `src/config/schema.ts` — FOUND
- `src/config/schema.test.ts` — FOUND
- `.planning/phases/01-config-parser/01-02-SUMMARY.md` — FOUND (this file)

Commits verified in `git log`:
- `35b31fd` (Task 1 RED) — FOUND
- `f4ff6b7` (Task 1 GREEN) — FOUND
- `170748a` (Task 2 RED) — FOUND
- `7480ce6` (Task 2 GREEN) — FOUND

All plan success criteria re-run clean:
- `npx tsc -p tsconfig.json --noEmit` → exit 0
- `npx vitest run` → 25/25 passing, exit 0
- `grep -q "declare readonly filePath" src/config/errors.ts` → match
- `grep -q "'filePath' in err" src/config/errors.test.ts` → match (and the assertion passes at runtime)

---
*Phase: 01-config-parser*
*Completed: 2026-04-18*
