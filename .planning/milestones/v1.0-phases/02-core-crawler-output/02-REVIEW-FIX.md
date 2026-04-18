---
phase: 02-core-crawler-output
status: complete
fixes_applied: 6
fixes_deferred: 3
tests_passing: 122
fixed_at: 2026-04-18T14:54:00Z
review_path: .planning/phases/02-core-crawler-output/02-REVIEW.md
iteration: 1
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-04-18T14:54:00Z
**Source review:** `.planning/phases/02-core-crawler-output/02-REVIEW.md`
**Iteration:** 1

## Summary

- Findings in scope: 6 (MD-01, MD-02, MD-03, MD-04, LW-01, LW-02)
- Fixed: 6
- Deferred: 3 (LW-03, LW-04, LW-05 — cosmetic low findings)
- Tests passing: 122 (baseline 111 + 11 new)
- `tsc --noEmit` exit code: 0
- `vitest run` exit code: 0

## Fix Ledger

| ID    | Severity | Status   | Commit     | Summary                                                                 |
|-------|----------|----------|------------|-------------------------------------------------------------------------|
| MD-01 | Medium   | fixed    | `3254132`  | Preserve CRLF line endings in `appendOutput`; +2 unit tests             |
| MD-02 | Medium   | fixed    | `4d9b334`  | Fence-aware `# Output` header detection; +2 unit tests                  |
| MD-03 | Medium   | fixed    | `3aa9472`  | Atomic writeback via tmp+rename + in-process per-path lock; +1 test     |
| MD-04 | Medium   | fixed    | `d74a53a`  | `scrubPaths` helper applied to message/stack/issues; +6 unit tests      |
| LW-01 | Low      | fixed    | `6dbb456`  | Uniform `return await finalize(...)` across all four runner sites       |
| LW-02 | Low      | fixed    | `5e991b9`  | Rename + export `DEFAULT_EXTRACT_TIMEOUT_MS`                            |
| LW-03 | Low      | deferred | -          | Comment-only clarification on `declare readonly detail?`; non-blocking  |
| LW-04 | Low      | deferred | -          | Test-file `as number` cast cosmetic; no behavior impact                 |
| LW-05 | Low      | deferred | -          | `frame.test.ts` DRY extraction; non-blocking test-quality polish        |

## Fixed Issues

### MD-01: Mixed line endings after writeback on CRLF config files

- **Files modified:** `src/crawler/output.ts`, `src/crawler/output.test.ts`
- **Commit:** `3254132`
- **Applied fix:** In `appendOutput`, detect the source's dominant newline style (`\r\n` vs `\n`) once from the source string and thread it through every separator we add, plus normalize the rendered entry's `\n` to `\r\n` when CRLF is detected. Added 2 unit tests (`Test 16a`, `Test 16b`) asserting CRLF source round-trips with zero lone `\n` bytes in the result.

### MD-02: `# Output` header detector false-positives inside fenced code blocks

- **Files modified:** `src/crawler/output.ts`, `src/crawler/output.test.ts`
- **Commit:** `4d9b334`
- **Applied fix:** Extracted `hasOutputHeaderOutsideFences` helper that scans line-by-line tracking triple-backtick fence state. Only `# Output` lines OUTSIDE a fenced block are recognized as the real header. Added 2 unit tests (`Test 16c`: fenced `# Output` triggers real-header creation; `Test 16d`: fenced plus real header only reuses the real one).

### MD-03: Concurrent `runCrawl` on the same config path races on readback/writeback

- **Files modified:** `src/crawler/output.ts`, `src/crawler/output.test.ts`
- **Commit:** `3aa9472`
- **Applied fix:** `writeOutputToFile` now (a) serializes concurrent callers on the same absolute path via an in-process `Map<string, Promise<void>>` lock keyed by the resolved path, and (b) performs `readFile → appendOutput → writeFile(tmp) → rename(tmp, final)` so readers never observe a half-written state. The rename retries once on transient failure; orphan tmp files are `unlink`ed on terminal failure. The in-process lock is scoped to one Node process — the CLI is one-shot per run, so this matches the v1 invocation model. Added `Test 20` that fires two writes via `Promise.all` and asserts both entries land with no stray tmp file in the directory.

### MD-04: Error stack / ConfigParseError issues leak absolute paths into committed markdown

- **Files modified:** `src/crawler/output.ts`, `src/crawler/output.test.ts`, `src/crawler/runner.ts`
- **Commit:** `d74a53a`
- **Applied fix:** New `scrubPaths(text: string | undefined): string | undefined` helper exported from `src/crawler/output.ts`. Four substitutions run in order (most-specific first): `os.homedir()` exact prefix, POSIX `/home/<user>`, macOS `/Users/<user>`, Windows `C:\Users\<user>` — each replaced with `<HOME>`. The repo-relative portion after the home prefix is preserved verbatim (documented choice — keeps stacks useful for debugging while stripping identifiable username/layout). Applied in three runner/renderer sites: `renderEntry` error branch (message + stack before JSON serialization), `runCrawl` ConfigParseError branch (each issue + stack, before join), and `runCrawl` main catch (message + stack). Added 6 unit tests covering all four OS shapes, multiline stacks, no-match passthrough, and undefined passthrough.

### LW-01: Inconsistent `return` vs `return await finalize(...)` in runner

- **Files modified:** `src/crawler/runner.ts`
- **Commit:** `6dbb456`
- **Applied fix:** Unified all four `finalize(...)` return sites on `return await finalize(...)`. Rationale: if a future refactor wraps `runCrawl` in an outer `try/catch`, rejections from `finalize` will be caught inside `runCrawl`'s frame rather than escaping unobserved; async stack traces also link correctly.

### LW-02: Magic 5000ms per-field extract timeout constant

- **Files modified:** `src/crawler/extract.ts`
- **Commit:** `5e991b9`
- **Applied fix:** Renamed `EXTRACT_TIMEOUT_MS` → `DEFAULT_EXTRACT_TIMEOUT_MS` and changed it from internal to `export const` so the runner JSDoc and any Phase-3 configurable-timeout work can reference the concrete value. Header doc-comment updated to use the new name. Behavior unchanged.

## Deferred Issues

### LW-03: `errors.ts` `declare readonly detail?` lacks an inline rationale comment

- **File:** `src/crawler/errors.ts:5`
- **Rationale:** Pure documentation tweak with zero behavioral impact. The `errors.test.ts` "property not in instance when detail omitted" test already pins the behavior. Can be addressed in the next docs-only pass; not blocking Phase 3.

### LW-04: `runner.integration.test.ts` uses `as number` casts under `noUncheckedIndexedAccess`

- **File:** `src/crawler/runner.integration.test.ts:189,191`
- **Rationale:** Test-only cosmetic cleanup. The length assertion above the cast makes the cast safe in practice; tests pass under strict flags. Defer to a test-quality polish pass.

### LW-05: `frame.test.ts` five-times-repeated `as unknown as Parameters<...>[0]` fake-page cast

- **File:** `src/crawler/frame.test.ts:12,22,33,48,68`
- **Rationale:** DRY improvement for test fixtures. No runtime impact; does not block the v1 surface. Extract-helper refactor is appropriate alongside a broader Phase-3 test-harness revisit.

## Verification

- `npx tsc --noEmit` → exit 0 (no type errors introduced).
- `npx vitest run` → exit 0, 122 tests pass across 9 files (baseline was 111; added 11 tests: 2 CRLF, 2 fence-aware, 1 concurrency, 6 scrubPaths).
- No public API signature changed — `runCrawl(configPath: string): Promise<CrawlResult>` still the sole Phase-2 surface.
- No new runtime dependencies introduced.
- Strict TypeScript invariants preserved (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).

---

_Fixed: 2026-04-18T14:54:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
