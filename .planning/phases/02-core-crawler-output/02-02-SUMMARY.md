---
phase: 02-core-crawler-output
plan: 02
subsystem: output
tags: [markdown, output, writeback, pure-functions, tdd]

# Dependency graph
requires:
  - phase: 02-core-crawler-output
    plan: 01
    provides: "CrawlResult envelope + CrawlErrorCode union (src/crawler/types.ts)"
provides:
  - "src/crawler/output.ts — pure markdown writeback: formatTimestamp, renderEntry, appendOutput, writeOutputToFile"
  - "Locked on-disk format for run entries: em-dash H2 heading, italic meta line, fenced json payload"
  - "Append-only contract: prior # Output entries preserved byte-for-byte, exactly one # Output header"
affects: [02-04-runcrawl-orchestrator, 03-naver-auth-session]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure synchronous string helpers + one thin async fs wrapper — unit-testable without launching a browser"
    - "Conditional spread `...(x !== undefined ? { key: x } : {})` to omit optional keys under exactOptionalPropertyTypes"
    - "FENCE constant `'\\u0060\\u0060\\u0060'` to avoid triple-backtick escape drama in TS source"
    - "Line-anchored regex `/^```json\\n([\\s\\S]*?)\\n```\\s*$/m` for fenced JSON extraction — triple-backtick substring inside a JSON string does NOT terminate the match"
    - "Per-plan TDD: test(02-02) RED commit precedes feat(02-02) GREEN commit — git log is the audit trail"

key-files:
  created:
    - "src/crawler/output.ts — 4 exported helpers (formatTimestamp, renderEntry, appendOutput, writeOutputToFile)"
    - "src/crawler/output.test.ts — 19 unit tests exercising every locked behavior"
  modified: []

key-decisions:
  - "Append-at-EOF semantics: appendOutput always places new entries at the end of file; the # Output header detect is ONLY to avoid creating a duplicate header. Documented in the top-of-file comment of output.ts."
  - "Conditional spread for optional stack — setting `stack: undefined` would violate exactOptionalPropertyTypes, and even if allowed, makes the test-contract noisier. Spread pattern keeps the JSON output clean: no `\"stack\":` token appears when stack is not provided."
  - "fs errors propagate unchanged from writeOutputToFile — Plan 02-04's runner is the single place that wraps caught errors into CrawlError + CrawlResult envelope. Keeps output.ts free of error-classification concerns."
  - "JSON payload omits configPath — only url/status/durationMs in meta. The config file IS the path, so serializing it would be redundant and leak absolute paths into potentially-committed markdown."
  - "renderEntry never imports playwright — Plan 02-03's browser layer is separate. Phase 4 CLI and anyone consuming this module can call renderEntry without the 170 MB browser dependency being exercised."

patterns-established:
  - "On-disk run entry shape is locked: H2 `## Run \\u2014 YYYY-MM-DD HH:MM` (em dash) + `_count: N, duration: Xms_` (success) or `_error: code, duration: Xms_` (error) + fenced ```json block"
  - "Success JSON shape: { fields: {...}, meta: { url, status: 'ok', durationMs } } — no error key, no configPath"
  - "Error JSON shape: { error: { code, message, stack? }, meta: { url, status: 'error', durationMs } } — no fields key; stack present only when set"

requirements-completed: [OUT-01, OUT-02, OUT-03, OUT-04]

# Metrics
duration: 3min
completed: 2026-04-18
---

# Phase 2 Plan 2: Markdown Output Writeback Summary

**Pure markdown writeback layer implemented as 4 helpers in `src/crawler/output.ts` — UTC-locked timestamps, em-dash H2 heading, italic meta line, fenced ```json payload, conditional `stack` key — locked by 19 TDD tests (RED then GREEN), full suite 87/87 green, `tsc --noEmit` clean.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-18T02:30:21Z
- **Completed:** 2026-04-18T02:32:56Z
- **Tasks:** 1 (TDD RED + GREEN)
- **Files created:** 2 (`src/crawler/output.ts`, `src/crawler/output.test.ts`)
- **Files modified:** 0

## Accomplishments

- `src/crawler/output.ts` exports 4 pure/async helpers — no Playwright import, no browser launch, no side effects beyond `writeOutputToFile`'s two `fs/promises` calls.
- **TDD gate satisfied:** `test(02-02)` RED commit (`8239b5f`) with 19 failing tests precedes `feat(02-02)` GREEN commit (`f650896`) with 19 passing tests.
- **Full suite:** 87/87 passing (68 pre-existing Phase 1 + 02-01 + **19 new**). Execution time ~180ms for the new file.
- **Type safety:** `npx tsc --noEmit` exits 0 under `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`. Conditional spread pattern (`...(src.stack !== undefined ? { stack: src.stack } : {})`) keeps the `stack` key absent from JSON output when unset.
- **Append-only contract proved:** Tests 11, 12, 15, 18 lock that two successive `appendOutput`/`writeOutputToFile` calls produce exactly one `# Output` header and preserve the first entry byte-for-byte.
- **Fence safety proved:** Test 8 locks that a triple-backtick substring inside `error.message` round-trips through `JSON.parse` — the fence is line-anchored so a backtick sequence inside a JSON string literal cannot prematurely terminate the markdown fenced block.

## (a) Exported Symbol Table

File: `src/crawler/output.ts`

| Symbol | Signature |
|--------|-----------|
| `formatTimestamp` | `(date: Date) => string` — returns `YYYY-MM-DD HH:MM` in UTC, zero-padded, no seconds |
| `renderEntry` | `(result: CrawlResult) => string` — returns H2 heading + italic meta + fenced json, terminated by `\n` |
| `appendOutput` | `(source: string, entry: string) => string` — normalizes trailing newline, reuses existing `# Output` H1 when present (case-insensitive), otherwise creates one; appends entry at EOF |
| `writeOutputToFile` | `(configPath: string, entry: string) => Promise<void>` — `readFile` + `appendOutput` + `writeFile`; fs errors propagate unchanged |

Imports: `import type { CrawlResult } from './types';` and `import { readFile, writeFile } from 'node:fs/promises';` — nothing else.

## (b) Sample Rendered Entries

### Success entry

Input: `{ status:'ok', url:'https://example.com', startedAt: 2026-04-18T01:22:00Z, durationMs: 1234, fields: { title: 'Hello', author: 'Alice' } }`

```
## Run — 2026-04-18 01:22

_count: 2, duration: 1234ms_

\`\`\`json
{
  "fields": {
    "title": "Hello",
    "author": "Alice"
  },
  "meta": {
    "url": "https://example.com",
    "status": "ok",
    "durationMs": 1234
  }
}
\`\`\`
```

### Error entry (no stack)

Input: `{ status:'error', url:'https://example.com', startedAt: 2026-04-18T01:23:00Z, durationMs: 5000, error: { code:'timeout', message:'waitFor #post failed after 5000ms' } }`

```
## Run — 2026-04-18 01:23

_error: timeout, duration: 5000ms_

\`\`\`json
{
  "error": {
    "code": "timeout",
    "message": "waitFor #post failed after 5000ms"
  },
  "meta": {
    "url": "https://example.com",
    "status": "error",
    "durationMs": 5000
  }
}
\`\`\`
```

### Error entry WITH stack (CONTEXT.md `error: { code, message, stack? }` — third sample for Plan 04 integration comparison)

Input: `{ status:'error', url:'https://example.com', startedAt: 2026-04-18T01:24:00Z, durationMs: 1234, error: { code:'extraction_failed', message:'could not extract title', stack: 'Error: could not extract title\n    at extract (extract.ts:42:15)\n    at runCrawl (runner.ts:87:21)' } }`

```
## Run — 2026-04-18 01:24

_error: extraction_failed, duration: 1234ms_

\`\`\`json
{
  "error": {
    "code": "extraction_failed",
    "message": "could not extract title",
    "stack": "Error: could not extract title\n    at extract (extract.ts:42:15)\n    at runCrawl (runner.ts:87:21)"
  },
  "meta": {
    "url": "https://example.com",
    "status": "error",
    "durationMs": 1234
  }
}
\`\`\`
```

Plan 02-04 integration test can compare `renderEntry(...)` output against these three known-good shapes to detect accidental format drift.

## (c) Test Count / Pass Rate

- `src/crawler/output.test.ts`: **19 / 19** passing (one file, 19 `it()` blocks).
- Full vitest run: **87 / 87** across 5 test files (`src/config/parser.test.ts`, `src/config/schema.test.ts`, `src/config/errors.test.ts`, `src/crawler/errors.test.ts`, `src/crawler/output.test.ts`).
- `npx tsc --noEmit`: **0 errors** under the mandated strictness set.
- New-file execution time: ~180ms — no browser, no network, pure string/fs work.

Test mapping to locked behaviors:

| Test # | Behavior | Requirement |
|--------|----------|-------------|
| 1 | `formatTimestamp` returns `YYYY-MM-DD HH:MM` regex-match | OUT-02 |
| 2 | Zero-padding single-digit components | OUT-02 |
| 3 | UTC-locked regardless of `process.env.TZ` | OUT-02 |
| 4 | Success entry line-by-line structure (em-dash H2, italic, fence, trailing newline) | OUT-02, OUT-03 |
| 5 | Success JSON deep-equals `{ fields, meta }` (no `error`, no `configPath`) | OUT-03 |
| 6 | Error entry italic + JSON deep-equal; no `fields`, no `stack` when absent | OUT-04 |
| 7 | Zero-fields success → `_count: 0_` + empty object | OUT-03 |
| 8 | Triple-backtick inside `error.message` round-trips through JSON.parse | OUT-03 (fence safety, T-02-04 mitigation) |
| 9 | Error WITH stack → parsed JSON includes stack verbatim + raw entry contains `"stack":` | OUT-04 (CONTEXT.md stack? semantics) |
| 10 | No existing `# Output` → source preserved as prefix, header added | OUT-01 |
| 11 | Existing `# Output` with no prior entries → no duplicate header | OUT-01 |
| 12 | Existing `# Output` with ONE prior entry → prior preserved byte-for-byte | OUT-01 (append-only) |
| 13 | Case-insensitive `# output` recognition | OUT-01 |
| 14 | `# Output` followed by other sections → new entry still lands at EOF | OUT-01 |
| 15 | Idempotent two-run append → both entries in order, one header | OUT-01, OUT-02 |
| 16 | Source without trailing newline → normalized, result ends with `\n` | OUT-01 |
| 17 | `writeOutputToFile` happy path → file equals `appendOutput(source, entry)` | OUT-01 at fs level |
| 18 | Two successive `writeOutputToFile` calls → both entries, first before second, one `# Output` header | OUT-01 (append-only at fs level) |
| 19 | fs error surfaces — unreachable path rejects with Error | fs-error propagation contract |

## (d) Two-Append Confirmation

The two-append test (Test 15 in-memory, Test 18 at fs level) produces exactly one `# Output` header and preserves the first entry. Concrete example from a live `renderEntry` + `appendOutput(appendOutput(src, e1), e2)` run:

Input source:

```
# URL

https://example.com

# Selectors

[block]
```

Output (first entry is the success sample, second is the error sample — note exactly ONE `# Output` header and the first entry appears BEFORE the second, byte-for-byte preserved):

```
# URL

https://example.com

# Selectors

[block]

# Output

## Run — 2026-04-18 01:22

_count: 2, duration: 1234ms_

\`\`\`json
{
  "fields": {
    "title": "Hello",
    "author": "Alice"
  },
  "meta": {
    "url": "https://example.com",
    "status": "ok",
    "durationMs": 1234
  }
}
\`\`\`

## Run — 2026-04-18 01:23

_error: timeout, duration: 5000ms_

\`\`\`json
{
  "error": {
    "code": "timeout",
    "message": "waitFor #post failed after 5000ms"
  },
  "meta": {
    "url": "https://example.com",
    "status": "error",
    "durationMs": 5000
  }
}
\`\`\`
```

Exactly one `# Output` header. First entry preserved byte-for-byte. Original config sections (`# URL`, `# Selectors`) preserved byte-for-byte (no re-parse, no re-stringify — string-level append per CONTEXT.md).

## (e) Requirement Mapping

- **OUT-01 (append-only, preserve history, create `# Output` if missing):** Locked by Tests 10, 11, 12, 13, 14, 15, 16, 17, 18.
- **OUT-02 (human-readable timestamp + count):** Locked by Tests 1, 2, 3 (timestamp format and UTC invariance), Test 4 (italic meta line format), Test 7 (count = 0 edge case), Test 15 (multi-run).
- **OUT-03 (fenced json, parseable):** Locked by Tests 4, 5, 7, 8 — every rendered entry contains a fenced ```json block whose payload is a valid JSON object after regex extraction.
- **OUT-04 (error entry shape, including optional `stack`):** Locked by Tests 6 (no-stack error shape), 9 (with-stack error shape), 18 (error entry co-exists with success entry after two writes).
- **OUT-05 (non-zero exit on failure):** Out of scope for this plan — Plan 04's runner + Phase 4 CLI wiring deliver the non-zero-exit behavior. Plan 02-02 delivers only the error envelope half of OUT-05 (the rendered error entry that the CLI will see on disk).

## Task Commits

| # | Type | Hash | Description |
|---|------|------|-------------|
| RED | test | `8239b5f` | `test(02-02): add failing tests for output writeback helpers` — 19 failing tests, module-not-found |
| GREEN | feat | `f650896` | `feat(02-02): implement markdown output writeback (renderEntry + appendOutput)` — 19/19 passing |

_Plan metadata commit: pending — added below after STATE/ROADMAP updates._

## Decisions Made

- **FENCE constant `'\u0060\u0060\u0060'`** — using the `\u0060` escape for the backtick keeps the TS source file clean. Writing three literal backticks inside a TS string constant is valid but would trigger editor/syntax-highlighter confusion; the escape is identical at runtime.
- **`appendOutput` detects `# Output` header only to avoid duplicating it, and always appends at EOF** — attempting to splice inside the file would mean finding the `# Output` section, walking to the end of its subsections, and inserting before any following H1. That is fragile (what about trailing prose?) and unnecessary for this tool's configs (the `# Output` section is always last). Documented in the top-of-file comment.
- **fs errors propagate unchanged** — Plan 02-04's runner owns the full `CrawlResult` envelope, including error classification. Wrapping fs errors here would duplicate that logic and couple output.ts to CrawlError. Test 19 confirms the propagation.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1/2/3 auto-fixes required. No architectural decisions (Rule 4) surfaced.

## Issues Encountered

None. Test infrastructure (vitest, fs/promises, os.tmpdir) was already in place from Phase 1; no new tooling required.

## Threat Flags

None — the module's only trust boundary (CrawlResult field values → markdown on disk) is covered by T-02-04 in the plan's threat_model and mitigated by Test 8 (triple-backtick fence safety). No new surface introduced by this plan.

## Known Stubs

None — all four exported symbols are fully implemented and test-covered. No placeholder text, no hardcoded empties, no TODO/FIXME markers.

## User Setup Required

None — pure Node + CrawlResult type. No external service, no credentials, no environment variables, no manual steps.

## Next Phase Readiness

- Plan 02-04 (runCrawl orchestrator) can now call `renderEntry(result)` + `writeOutputToFile(configPath, entry)` — the two-step write-back loop the plan envisions is already one function call (`writeOutputToFile(configPath, renderEntry(result))`).
- Plan 02-04 integration test can assert on the three sample entries in section (b) as known-good shapes.
- Plan 02-03 (browser/frame/extract) has zero dependency on this plan — the two tracks (output in Wave 2, browser in Wave 2) are independent, confirmed by zero cross-imports (`output.ts` imports only `./types` + `node:fs/promises`; `output.test.ts` imports only `./output` + `./types` + node stdlib).

## TDD Gate Compliance

- Task 1 is `tdd="true"`; `test(02-02)` commit `8239b5f` precedes `feat(02-02)` commit `f650896` — RED → GREEN order confirmed in `git log --oneline -5`. No REFACTOR commit needed (the implementation is minimal and already structured; no cleanup surfaced during GREEN).
- Plan-level type is `execute`, not `tdd`, so the plan-level RED/GREEN gate does not strictly apply; the per-task TDD gate applies and passes.

## Self-Check: PASSED

- `src/crawler/output.ts` — FOUND
- `src/crawler/output.test.ts` — FOUND
- `.planning/phases/02-core-crawler-output/02-02-SUMMARY.md` — FOUND (this file)
- Commit `8239b5f` (RED — test) — FOUND in `git log --oneline`
- Commit `f650896` (GREEN — feat) — FOUND in `git log --oneline`
- 19 `it()` blocks in `src/crawler/output.test.ts` — CONFIRMED via `grep -cE "^\s*it\(" ...`
- All 4 exported signatures match `output.ts` via grep — CONFIRMED
- Full suite 87/87 — CONFIRMED via `npx vitest run`
- `npx tsc --noEmit` exit 0 — CONFIRMED
- No `playwright` import in output.ts — CONFIRMED via grep

---
*Phase: 02-core-crawler-output*
*Completed: 2026-04-18*
