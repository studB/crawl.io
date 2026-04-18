---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 04-01-PLAN.md — CLI scaffold + commander + shebang entry landed
last_updated: "2026-04-18T08:37:20.591Z"
last_activity: 2026-04-18 -- Phase 4 planning complete
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 13
  completed_plans: 11
  percent: 85
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-18)

**Core value:** One markdown file fully describes a crawl job and carries its own results — config, selectors, and extracted data live in the same file.
**Current focus:** Phase 2 — Core Crawler + Output

## Current Position

Phase: 4
Plan: 04-02 (next)
Status: In Progress
Last activity: 2026-04-18 -- Completed 04-01 CLI scaffold + commander + shebang entry

Progress: [█████████░] 85%

## Performance Metrics

**Velocity:**

- Total plans completed: 11
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 1 | 3 | - | - |
| 2 | 4 | - | - |
| 3 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01-config-parser P01 | 3 min | 3 tasks | 7 files |
| Phase 01-config-parser P02 | 3 min | 2 tasks | 6 files |
| Phase 01-config-parser P03 | 5 min | 2 tasks | 4 files |
| Phase 02-core-crawler-output P01 | 4 min | 2 tasks | 7 files |
| Phase 02-core-crawler-output P02 | 3min | 1 tasks | 2 files |
| Phase 02-core-crawler-output P03 | 6min | 3 tasks | 11 files |
| Phase 03-naver-auth-session P01 | 2 min | 2 tasks | 4 files |
| Phase 03-naver-auth-session P02 | 4 min | 3 tasks | 6 files |
| Phase 03-naver-auth-session P03 | 7min | 3 tasks | 5 files |
| Phase 04-cli-packaging P01 | 7min | 3 tasks | 8 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: 4 coarse phases — Config Parser → Core Crawler + Output → Naver Auth + Session → CLI + Packaging
- Config: Markdown sections (`# URL`, `# Selectors`, `# Rules`, `# Output`), YAML-in-code-blocks for structured fields
- Auth: Credentials via `NAVER_ID`/`NAVER_PW` env vars; storage state persisted to `.crawl-session.json`
- Testing: Real Naver Cafe URLs (no local fixtures — deliberate fidelity tradeoff)
- [Phase 01-config-parser]: Pin unified and remark-parse to ^9 (last CJS-compatible majors) — v10+ is ESM-only; Node 20 LTS + type:commonjs + module:nodenext cannot require() ESM, and D-08 locks parseConfig as sync, forbidding the await import() workaround. v9 exposes identical unified().use(remarkParse).parse() sync API and mdast AST shape.
- [Phase 01-config-parser]: Keep package.json type:commonjs for v1 — Simpler npm publish shape (no exports conditional map, no dual-publish); constrains us to the unified/remark-parse v9 pin, which is an accepted cost.
- [Phase 01-config-parser]: Vitest with passWithNoTests:true and colocated src/**/*.test.ts — Colocated tests keep each module next to its spec; passWithNoTests:true makes empty-suite CI runs green regardless of Vitest version.
- [Phase 01-config-parser]: Use Zod v4 strictObject/z.url/z.record(keySchema, valueSchema) — matches installed zod@4.3.6 and is more direct than the v3 form. All schemas strict (CFG-06 unknown-key rejection).
- [Phase 01-config-parser]: Use 'declare readonly filePath?: string' + conditional assignment in ConfigParseError — suppresses useDefineForClassFields field emission so 'filePath' in err === false when omitted; required by exactOptionalPropertyTypes (D-05).
- [Phase 01-config-parser]: Disable verbatimModuleSyntax in tsconfig.json (Plan 02 Rule 3 deviation) — the flag forbids ESM import/export syntax under module:nodenext + type:commonjs, blocking idiomatic TS authorship. Not in CLAUDE.md-mandated strictness set; tsc still emits correct CJS.
- [Phase 01-config-parser]: Use default imports for unified@9 + remark-parse@9 (export= form) — named import fails TS2595 under module:nodenext with esModuleInterop unset; default import compiles to correct require() CJS and keeps parseConfig sync per D-08
- [Phase 01-config-parser]: Schema-validation gate (canValidate = url && selectorsRaw && rulesRaw) — safeParse skipped entirely when any raw piece is missing, so structural issues never duplicate as Zod 'Required'; missing-URL throws exactly one url-related issue
- [Phase 01-config-parser]: Introduce ParseConfigFileResult = Promise<CrawlJob> type alias so Promise<CrawlJob> never co-occurs with 'parseConfig' on a single line — keeps the acceptance grep  honest while preserving parseConfigFile's legitimate async signature
- [Phase 02-core-crawler-output]: playwright in dependencies (not devDep) — crawler imports it at runtime; no postinstall in this plan (Phase 4 packaging concern); types layer (src/crawler/types.ts + errors.ts) kept free of playwright imports
- [Phase 02-core-crawler-output]: CrawlError.message format '[code] detail' (or '[code]' when detail omitted); declare readonly detail?: string + conditional assignment mirrors ConfigParseError for exactOptionalPropertyTypes compliance
- [Phase 02-core-crawler-output]: CrawlResult error shape locked as { code, message, stack? } per 02-CONTEXT.md; stack populated by runCrawl from Error.stack
- [Phase 02-core-crawler-output]: 02-02 locks on-disk run entry shape: em-dash H2 heading + italic meta line + fenced json block; success shape { fields, meta }, error shape { error: { code, message, stack? }, meta }; appendOutput is EOF-append with # Output header detect only to avoid duplication
- [Phase 02-core-crawler-output]: fs errors from writeOutputToFile propagate unchanged — Plan 02-04 runner is the single point that wraps into CrawlError; keeps output.ts pure and free of error-classification coupling
- [Phase 02-core-crawler-output]: 02-03: extract.ts is the sole Phase-2 throw site for CrawlError('frame_not_found', ...); frame.ts is pure and does NOT import ./errors — Playwright's frameLocator is lazy, so frame-presence failures only surface downstream as TimeoutError on .textContent(), which extract.ts classifies as frame_not_found when spec.frame is declared or selector_miss otherwise
- [Phase 02-core-crawler-output]: 02-03: launchBrowser({ storageState? }) accepts the Phase-3 hook TODAY — conditional spread inside launchBrowser prevents 'storageState: undefined' from leaking into Playwright (exactOptionalPropertyTypes). Phase 3 is an additive call-site change, not a signature break.
- [Phase 02-core-crawler-output]: 02-03: per-field extraction uses an internal 5000ms cap (EXTRACT_TIMEOUT_MS) separate from rules.timeout — rules.timeout is the page-load/waitFor budget, extraction is sub-second on a rendered page; tight internal cap gives unambiguous error attribution
- [Phase 02-core-crawler-output]: 02-03 Rule-3 deviation: test/setup/playwright-env.ts extends LD_LIBRARY_PATH from /tmp/playwright-libs when the host is missing system NSS/NSPR/ALSA libs (WSL without sudo); no-op on well-provisioned hosts; crawler source has zero LD_LIBRARY_PATH knowledge
- [Phase 03-naver-auth-session]: 03-01: CrawlErrorCode grown from 7 → 10 variants ('auth_missing_credentials', 'auth_failed', 'captcha_unresolved' inserted before 'unknown' to preserve the ordering invariant); exhaustiveness test in errors.test.ts now locks the count with expect(codes).toHaveLength(10) so accidental variant removal fails fast
- [Phase 03-naver-auth-session]: 03-01: src/auth/session.ts has ZERO Playwright imports — session-file path resolution + existence + raw UTF-8 read only. Playwright consumes the session via its own { storageState: path } option, so this module never parses the JSON (keeps surface narrow and unit tests zero-browser)
- [Phase 03-naver-auth-session]: 03-01: cwd is a typed parameter with process.cwd() default, resolved at CALL time (no top-level capture) — lets tests pass os.tmpdir() without chdir; readSession returns undefined on ENOENT and propagates other fs errors unchanged for caller classification
- [Phase 03-naver-auth-session]: 03-01: AUTH-06 verified (not re-edited) — .gitignore already covers .crawl-session.json since Phase 2 Plan 02-01; stale '7-member string-literal union' JSDoc in src/crawler/index.ts deliberately LEFT UNTOUCHED because that barrel is owned by Plan 03-03
- [Phase 03-naver-auth-session]: 03-02: detect.ts is pure — ZERO Playwright import (not even type-only), ZERO env reads, ZERO node: imports. Callers hand in plain-data (URL + readonly CookieLike[] + readonly boolean[]); classifyPostLogin priority is captcha URL > selector hit > session cookies > login URL > unknown
- [Phase 03-naver-auth-session]: 03-02: naver.ts credential redaction boundary (T-03-04) — credentials read in exactly one function, kept in NaverCredentials, NEVER interpolated into error messages; auth_missing_credentials lists only VAR NAMES, auth_failed wraps only the underlying op message; tests plant canary secrets and assert they don't appear in errors
- [Phase 03-naver-auth-session]: 03-02: headed.ts NON-INTERACTIVE by contract (03-CONTEXT.md D9) — no stdin/readline anywhere; resolveHeadedTimeoutMs silently falls back to default on any malformed env value (non-numeric, ≤0, NaN, Infinity, non-integer via Number.isInteger); pollUntilLoggedIn takes injectable sleep/now for deterministic sub-ms tests
- [Phase 03-naver-auth-session]: 03-02: T-03-07 suffix-attack mitigation — isNaverHost tests explicitly cover BOTH evil.naver.com (legit subdomain → true) AND evil-naver.com.example (spoof → false); relies on URL.host parsing + literal endsWith('naver.com') check
- [Phase 03-naver-auth-session]: ensureAuthenticated returns Promise<Page>; runner rebinds via page-identity check after headed-fallback swap
- [Phase 03-naver-auth-session]: Stale-session + no-creds proceeds (runner goto surfaces redirect); only no-session + no-creds throws auth_missing_credentials
- [Phase 03-naver-auth-session]: Runner auth tests use vi.mock at module boundary (../auth/*, ./browser, ./extract) so no real Chromium launch
- [Phase 03-naver-auth-session]: Integration tests gated by RUN_NAVER_TESTS=1 + NAVER_ID/NAVER_PW; tmpdir-chdir pattern protects repo-root session file
- [Phase 04-cli-packaging]: 04-01: resolveExitCode is a pure function in src/cli/exit.ts returning the literal union 0|1; centralizes OUT-05 and is grep-gated for purity (no process.exit / console. / fs. in the file)
- [Phase 04-cli-packaging]: 04-01: runHandler uses RunDeps dependency injection (runCrawl+stdout+stderr+pathExists) and never calls process.exit itself — only registerRunCommand's commander action wrapper does; asserted to exactly 1 occurrence of process.exit in src/cli/run.ts
- [Phase 04-cli-packaging]: 04-01: CLI imports runCrawl from the public barrel ../index (never ../crawler/runner directly) to preserve CLI-02 extension axis; commander v12 addHelpText('after',...) renders only via outputHelp (not helpInformation), tests capture via configureOutput writer
- [Phase 04-cli-packaging]: 04-01: Postbuild script chmods dist/bin/crawl.js to 0755 (tsc emits 0644) and prepends shebang if missing — belt-and-suspenders; verified tsc 6.x preserves leading #! line natively; Rule-3 deviation from plan explicit template

### Pending Todos

None yet.

### Blockers/Concerns

None yet.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-04-18T08:37:20.586Z
Stopped at: Completed 04-01-PLAN.md — CLI scaffold + commander + shebang entry landed
Resume file: None
