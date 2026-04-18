---
phase: 01-config-parser
status: complete
fixes_applied: 6
fixes_deferred: 3
tests_passing: 63
fixed_at: 2026-04-18T10:42:48Z
review_path: .planning/phases/01-config-parser/01-REVIEW.md
iteration: 1
---

# Phase 01 (Config Parser) — Code Review Fix Report

**Fixed at:** 2026-04-18T10:42:48Z
**Source review:** `.planning/phases/01-config-parser/01-REVIEW.md`
**Iteration:** 1

## Summary

- Findings in scope: 6 (4 medium + 2 low)
- Applied: 6
- Deferred: 3 (low, cosmetic/readability — see Deferred section)
- Tests passing: 63 (was 56; +7 new tests: 1 for MR-01, 1 for MR-02, 3 for MR-03, 1 for MR-04, 1 for LR-03)

## Fixes Applied

| ID    | Severity | Status | Commit     | Change summary |
|-------|----------|--------|-----------|----------------|
| MR-01 | Medium   | fixed  | `5a49d23` | Reject selector names starting with `_` via `z.string().regex(/^(?!_)/)` so YAML anchor hosts (`_base: &b ...`) don't leak into the selectors map. Doc comment added to `schema.ts`. |
| MR-04 | Medium   | fixed  | `d9a9a8b` | `splitSections` now returns `StructuralIssue[]` tagged with origin key (`'url' \| 'selectors' \| 'rules'`). REQUIRED-loop dedups via `i.key === key` instead of `message.toLowerCase().includes(key)`. Caller flattens to strings preserving order. |
| MR-02 | Medium   | fixed  | `696e9ca` | Track `seen` set of known-section headings; on duplicate push a tagged `` `duplicate \`# X\` section (only the first is used)` `` issue and `continue` (first-wins). |
| MR-03 | Medium   | fixed  | `f7c5d5e` | `extractFirstNonEmptyLine` now accepts first child of type `paragraph`, `list`, `blockquote`, or `code` — not just paragraph — so URLs written as bullets / quotes / fenced blocks are picked up. |
| LR-03 | Low      | fixed  | `3998a0b` | Added `missing \`# Rules\`` dedup test mirroring the existing URL and Selectors cases to lock the `canValidate` gate for all three REQUIRED keys. |
| LR-04 | Low      | fixed  | `2557941` | `ConfigParseErrorOptions` re-exported from `src/config/index.ts` and `src/index.ts` so consumers can name the options type from the public package surface. |

## Deferred (out-of-scope for this pass)

| ID    | Severity | Rationale |
|-------|----------|-----------|
| LR-01 | Low | Redundant `as Heading` casts — purely cosmetic; narrowing works today, no behavior or type-safety gap to close. Pick up opportunistically with a broader parser tidy-up. |
| LR-02 | Low | `parse(source) as Root` escape hatch — current cast is safe given pinned `unified@9` / `remark-parse@9`; adding a runtime `t.type !== 'root'` guard is a belt-and-suspenders refinement, not a correctness fix. Defer until a typings drift actually surfaces. |
| LR-05 | Low | `_assertShape` / `ParseConfigFileResult` dead-style plumbing — both are load-bearing (compile-time contract + grep-trap for Plan 03 acceptance). Existing JSDoc is adequate; refactor to "standard TS assignability assertion" is a micro-readability call best made alongside a schema or plan change. |

## Final Verification

### `npx tsc --noEmit`
```
---TSC_EXIT:0---
```
Clean — no diagnostics.

### `npx vitest run`
```
 Test Files  3 passed (3)
      Tests  63 passed (63)
   Duration  ~411ms
---TEST_EXIT:0---
```
All 63 tests pass (up from 56; 7 new tests added across MR-01 / MR-02 / MR-03 / MR-04 / LR-03).

## Notes / Deviations

- None. No changes to the sync `parseConfig` signature; no new dependencies; public API surface only grew by the `ConfigParseErrorOptions` type re-export (LR-04).
- The `StructuralIssue` type (MR-04) is internal to `parser.ts` and is flattened to `string[]` at the boundary — `ConfigParseError.issues` remains `string[]`, preserving the public contract.
- MR-02's duplicate issues are tagged with the originating required key when applicable; this means a `# URL` (missing) + duplicate `# URL` pathological config would surface the duplicate but not double-report "missing" (tagged-dedup path from MR-04 handles that correctly).

---

_Fixed: 2026-04-18T10:42:48Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
