---
phase: 01-config-parser
status: passed
verified: 2026-04-18T10:46:00Z
must_have_score: "4/4"
requirements_score: "6/6"
tests_passing: 63
tsc_exit: 0
vitest_exit: 0
re_verification: false
---

# Phase 1: Config Parser Verification Report

**Phase Goal (ROADMAP.md):** A markdown config file can be parsed into a complete, validated crawl job before any browser is launched.

**Verified:** 2026-04-18T10:46:00Z
**Status:** passed
**Re-verification:** No (initial verification)

## Must-Have Verdicts

| # | Must-Have (ROADMAP success criterion) | Status | Evidence |
|---|---------------------------------------|--------|----------|
| 1 | Valid markdown with `# URL`, `# Selectors`, `# Rules` → structured object with URL, selector map, waitFor/timeout. | VERIFIED | Test `parseConfig — success > parses a full well-formed config (URL + Selectors + Rules + Output) into CrawlJob` (parser.test.ts:78-90) asserts `job.url`, `Object.keys(job.selectors)`, `job.rules.timeout`, `'waitFor' in job.rules`, and that Output does not leak. Passing. |
| 2 | `engine: xpath` distinguishable from `engine: css` in parsed output. | VERIFIED | Test `engine: xpath round-trips as engine === "xpath" (CFG-03)` (parser.test.ts:92-99) asserts `job.selectors.body?.engine === 'xpath'`. Complementary test `engine defaults to "css" when omitted` (parser.test.ts:116) asserts default case. Schema enforces via `z.enum(['css', 'xpath']).default('css')` (schema.ts:15). Passing. |
| 3 | Selector entry with explicit `frame` path appears alongside its selector string. | VERIFIED | Test `frame array round-trips as string[] with length >= 2 (CFG-04)` (parser.test.ts:101-114) asserts `job.selectors.author?.frame === ['iframe#outer','iframe#inner']`. Type (`frame?: string[]`) at types.ts:4. Schema accepts via `z.array(z.string().min(1)).optional()` (schema.ts:16). Passing. |
| 4 | Missing `# URL` or invalid YAML → descriptive error thrown, no browser launched. | VERIFIED | Tests `throws ConfigParseError (not a generic Error) on missing URL section` (parser.test.ts:205-208) and `invalid YAML inside # Selectors surfaces the yaml parse error message` (parser.test.ts:253-259) both pass. No-browser invariant locked by test `package.json has no playwright dependency` (parser.test.ts:415-424). Package.json confirms no playwright dep. Passing. |

**Score:** 4/4 must-haves verified.

## Requirements Coverage (CFG-01..CFG-06)

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| CFG-01 | Parser reads target URL from `# URL` section | SATISFIED | `extractFirstNonEmptyLine` in parser.ts:160 + test `parses a full well-formed config` asserts `job.url === 'https://cafe.naver.com/example/article/123'` |
| CFG-02 | Parser reads YAML block inside `# Selectors` → map of named fields | SATISFIED | `findYamlFence` (parser.ts:199) + `YAML.parse` via `tryYamlParse` (parser.ts:219) + test asserts `Object.keys(job.selectors).sort() === ['author','body','title']` |
| CFG-03 | Selector entry declares engine (`css` or `xpath`) per field | SATISFIED | `z.enum(['css','xpath']).default('css')` (schema.ts:15); xpath round-trip test passes; default-css test passes |
| CFG-04 | Selector entry declares explicit `frame` path (nested iframes) | SATISFIED | `frame?: string[]` type (types.ts:4); `z.array(z.string().min(1)).optional()` (schema.ts:16); frame round-trip test asserts 2-level depth |
| CFG-05 | Parser reads `waitFor` + `timeout` from `# Rules` YAML block | SATISFIED | RulesSchema (schema.ts:32-41) with `waitFor?: string` + `timeout` default 30000; tests `rules.timeout defaults to 30000` and `omits rules.waitFor key entirely` both pass |
| CFG-06 | Parser fails with clear error before browser launch on missing URL / invalid YAML / unknown keys | SATISFIED | `ConfigParseError` aggregation (parser.ts:252-322); `canValidate` gate suppresses duplicate issues; strict-mode schemas reject unknown keys (schema.ts:13,33,55); playwright-absence test (parser.test.ts:415-424) |

**Score:** 6/6 requirements satisfied. REQUIREMENTS.md traceability table already marks all six as Complete.

## Cross-Check Results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript typecheck | `npx tsc --noEmit` | exit 0 |
| Test suite | `npx vitest run` | exit 0 — 3 files / 63 tests passing |
| Build | `npm run build` | exit 0, `dist/index.js` + `dist/index.d.ts` emitted |
| Runtime CJS exports | `require('./dist/index.js')` | `parseConfig=function`, `parseConfigFile=function`, `ConfigParseError=function` |
| Downstream error path | `parseConfig('')` via compiled dist | Throws `ConfigParseError` with `.issues.length === 3` (instance=true) |
| Sync contract — no `export async function parseConfig` | grep | No match (verified sync) |
| Sync contract — no `await import(` | grep | No match (no ESM fallback) |
| Sync contract — no `parseConfig[^=]*Promise<CrawlJob>` | grep | No match (parseConfig does not return Promise) |
| Runtime sync witness | `parseConfig.constructor.name` | `Function` (not `AsyncFunction`) — test at parser.test.ts:404-408 |
| Playwright not in deps | package.json `dependencies` | Only `remark-parse`, `unified`, `yaml`, `zod` — no browser lib |
| `canValidate` gate present | grep `canValidate` parser.ts | 3 matches (lines 246, 296, 301) |

**Test breakdown (grep `it(`):**
- `src/config/parser.test.ts` — 38 tests
- `src/config/schema.test.ts` — 20 tests
- `src/config/errors.test.ts` — 5 tests
- **Total: 63 (all passing)** — matches `01-REVIEW-FIX.md tests_passing: 63`.

Note: the review fix report listed 38 parser tests (31 original + 7 added); grep confirms 38 `it(` occurrences. Summary's "31 in parser.test.ts" is pre-review-fix count; post-fix count is 38.

## Locked Decisions (CONTEXT.md) — Honored

| Decision | Verification |
|----------|--------------|
| `unified@^9` + `remark-parse@^9` pinned (CJS-compatible) | package.json shows `"unified": "^9.2.2"`, `"remark-parse": "^9.0.0"` |
| Zod schemas in `src/config/schema.ts` | File exists with `SelectorSpecSchema`, `RulesSchema`, `CrawlJobSchema` exports |
| `ConfigParseError` with `declare readonly filePath?: string` + `issues: string[]` | errors.ts:5-18 matches contract exactly; `declare` modifier at line 7 |
| Default engine `css` | `.default('css')` at schema.ts:15 |
| Default timeout `30000` | `.default(30000)` at schema.ts:35 |
| `canValidate` gate (no duplicate Zod "required" errors) | parser.ts:296-299; dedup tests at parser.test.ts:210, 228, 236 all pass (exactly one issue per missing section) |
| Sync `parseConfig` + async `parseConfigFile` | parser.ts:248 (sync) and parser.ts:332 (async) |
| Public API surface | Both `src/config/index.ts` and `src/index.ts` export the 5 symbols: `parseConfig`, `parseConfigFile`, `ConfigParseError`, `CrawlJob` (type), `SelectorSpec` (type). Plus bonus `ConfigParseErrorOptions` type (LR-04 fix). |

## Anti-Pattern Scan

| File | Finding | Severity | Note |
|------|---------|----------|------|
| `src/config/parser.ts` | `as Root` cast at line 258 | Info | Documented in REVIEW LR-02; deferred. Safe under pinned unified@9. |
| `src/config/parser.ts` | `as Heading` casts at lines 60, 74 | Info | Documented in REVIEW LR-01; deferred. Redundant but harmless. |
| Source tree | No `TODO`, `FIXME`, `XXX`, `HACK`, `PLACEHOLDER` | Clean | Grep returns no matches in `src/`. |
| Source tree | No `eval`, `child_process`, `playwright`, `puppeteer`, `chromium` | Clean | Phase 1 is browser-free as required. |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Sync parseConfig throws ConfigParseError on empty input | `node -e "...parseConfig('')..."` | `instance=true issues=3` | PASS |
| Runtime re-exports in built artifact | `require('./dist/index.js')` has 3 functions | `parseConfig=function, parseConfigFile=function, ConfigParseError=function` | PASS |
| CJS `require('unified')` + `require('remark-parse')` succeed | per Plan 01 SUMMARY | exit 0, no `ERR_REQUIRE_ESM` | PASS |
| Full vitest suite | `npx vitest run` | 63/63 passing | PASS |
| Full TS typecheck | `npx tsc --noEmit` | exit 0 | PASS |

## Key-Link Wiring Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `src/config/parser.ts` | `unified` + `remark-parse` | `import unified from 'unified'`, `import remarkParse from 'remark-parse'` (lines 2-3) | WIRED |
| `src/config/parser.ts` | `yaml` | `import YAML from 'yaml'` (line 4) | WIRED |
| `src/config/parser.ts` | `./schema` | `import { CrawlJobSchema } from './schema'` (line 8) + `CrawlJobSchema.safeParse(candidate)` (line 307) | WIRED |
| `src/config/parser.ts` | `./errors` | `import { ConfigParseError } from './errors'` (line 9) + `throw new ConfigParseError(...)` at lines 261, 319, 338 | WIRED |
| `src/index.ts` | `./config/index` | `export ... from './config/index'` (lines 1-2) | WIRED |
| `src/config/index.ts` | `./types`, `./errors`, `./parser` | 4 re-export lines | WIRED |

## Notes

- **Phase 2 readiness:** Public API (`parseConfig`, `parseConfigFile`, `ConfigParseError`, `CrawlJob`, `SelectorSpec`, `ConfigParseErrorOptions`) is stable and verified at both compile-time (`dist/index.d.ts`) and runtime (`dist/index.js`). Phase 2 can import from the package root without further reshaping.
- **REVIEW deferrals:** LR-01 (redundant `as Heading` casts), LR-02 (`parse(source) as Root` escape hatch), and LR-05 (dead-style plumbing) were deferred by REVIEW-FIX as low-severity cosmetic items. None affect correctness; none block Phase 2.
- **Test count reconciliation:** 01-03-SUMMARY.md reported 56 tests pre-review; 01-REVIEW-FIX.md reported 63 post-review (+7 fix tests). Current grep count confirms 63 (38 parser + 20 schema + 5 errors). All passing.
- **CJS sync contract:** Multiple mechanical guards enforce the D-08 sync contract — a grep (`! grep -qE "export async function parseConfig\b"`), a compile-time `ParseConfigFileResult` type alias that prevents `Promise<CrawlJob>` from colocating with `parseConfig` on any single line, and a runtime test asserting `parseConfig.constructor.name === 'Function'`. All three still hold.
- **Security:** No credentials handled in Phase 1. `.crawl-session.json` is already in `.gitignore` (anticipating Phase 3). Parser is pure-TS / no network / no child processes.
- **No human verification needed.** Every must-have is mechanically testable and verified by the automated suite + grep checks.

---

_Verified: 2026-04-18T10:46:00Z_
_Verifier: Claude (gsd-verifier)_
