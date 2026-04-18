# Phase 2: Core Crawler + Output - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers the Playwright-driven extraction loop and the markdown write-back. Given a markdown config file that already parses cleanly (Phase 1), Phase 2 is responsible for: launching Chromium, navigating, descending into nested iframes when a `frame` path is present, extracting text per named field, and appending a new entry under the markdown file's `# Output` section (creating the section if missing). Authentication / session reuse is deferred to Phase 3; Phase 2 can crawl any publicly reachable URL.

</domain>

<decisions>
## Implementation Decisions

### Output Section Format
- Timestamp format: human-readable `_Last run: 2026-04-18 10:22 KST_` (markdown italic).
- Each run adds an H2 subsection under `# Output`: `## Run — YYYY-MM-DD HH:MM` followed by an italic meta line (`_count: N, duration: Xms_`) and a fenced ```json block.
- JSON shape: `{ fields: { name: text, ... }, meta: { url: string, status: "ok" | "error", durationMs: number } }` — `meta` always present so downstream tools know context.
- Error entry shape: SAME H2 heading format with `meta.status: "error"`; the `fields` key is replaced by `error: { code, message, stack? }`. Readers can tell success from error without parsing prose.
- Run entries are APPENDED — earlier entries are never modified. If `# Output` does not exist, the crawler creates it at the end of the file.

### Crawler Module & API
- Split module layout under `src/crawler/`:
  - `browser.ts` — Playwright Chromium launch + context + page helpers
  - `frame.ts` — descent into nested iframes via `page.frameLocator(...)` chain
  - `extract.ts` — per-field extraction (CSS + XPath) against a page or frame
  - `output.ts` — markdown writeback: load file, parse `# Output`, append entry, save
  - `runner.ts` — orchestrates: parse config → launch browser → navigate → waitFor → extract → writeback → close
- Public API: `runCrawl(configPath: string): Promise<CrawlResult>`
  - `CrawlResult = { status: 'ok' | 'error', configPath: string, url: string, startedAt: Date, durationMs: number, fields?: Record<string, string>, error?: { code: CrawlErrorCode, message: string } }`
  - `runCrawl` always writes the Output entry before returning — caller never has to separately persist results.
- Custom error class: `CrawlError extends Error { code: CrawlErrorCode, detail?: string }` where `CrawlErrorCode = 'timeout' | 'selector_miss' | 'network' | 'frame_not_found' | 'extraction_failed' | 'unknown'`.
- `runCrawl` does NOT call `process.exit`. It returns the `CrawlResult` envelope and lets callers (the Phase 4 CLI) decide the exit code. Keeps `runCrawl` testable and composable.

### Playwright & Frames
- Frame path entries are CSS selectors matching `iframe` elements. Descent is `page.frameLocator(selector1).frameLocator(selector2)...` — matches Playwright's native API. Any missing frame at any depth raises `CrawlError { code: 'frame_not_found' }`.
- `rules.timeout` applies to BOTH `page.goto({ timeout })` and `page.waitForSelector({ timeout })`. Single mental model; simpler YAML.
- Browser: Chromium only, headless by default. Playwright's default user agent is used (no custom UA — OOS bars it in v1).
- Browser lifecycle per run: fresh `browser`, `context`, `page` launched inside `runCrawl`, closed in a `finally` block (even on error). Phase 3 will layer storage state into context options.
- XPath support: Playwright's built-in `xpath=...` selector syntax inside `page.locator()` / `frameLocator.locator()`.

### Claude's Discretion
- Internal helper signatures within each crawler module are Claude's discretion.
- Whether to use Playwright's `chromium.launch({ args: [...] })` with tuning flags (e.g., `--no-sandbox`) is Claude's discretion — default launch is fine unless Linux sandbox issues arise.
- Test strategy: Phase 2 integration tests use a real public URL (per PROJECT.md "test against real Naver Cafe pages" rule, but for Phase 2 we do not need login — any stable public site works for the non-login paths). Claude picks the URL; prefer one with a visible H1 or known text for a deterministic assertion. A simple local fixture or data: URL is acceptable if the user's network doesn't permit outbound requests during automated runs.
- How to compute `durationMs` (high-resolution clock vs Date difference) is Claude's discretion.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- `parseConfigFile(path): Promise<CrawlJob>` — Phase 2 `runCrawl` will call this first.
- `CrawlJob`, `SelectorSpec` types in `src/config/types.ts`.
- `ConfigParseError` for parse-stage errors — Phase 2 must propagate these unchanged through `CrawlResult { status: 'error', error: { code: 'config_parse', ... } }` (add a `'config_parse'` variant to `CrawlErrorCode`).
- `src/index.ts` barrel already re-exports the Phase 1 public API.

### Established Patterns
- TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` — honored in Phase 1, must remain honored.
- CommonJS build (`"type": "commonjs"`, `module: nodenext`) — use `require`/static imports compatible with CJS.
- Aggregate-error philosophy — but in Phase 2 a crawl has ONE fatal point (timeout, nav, extract), so a single structured `CrawlError` is enough; no aggregation is needed for the crawler per se.

### Integration Points
- Phase 3 (Naver Auth) will inject `storageState` into the Playwright `browser.newContext({ storageState })` call in `browser.ts` — design that function to accept an optional `{ storageState?: string }` opt today so Phase 3 is an additive change, not a signature break.
- Phase 4 (CLI) will import `runCrawl` and map `CrawlResult.status === 'error'` to `process.exit(1)`.

</code_context>

<specifics>
## Specific Ideas

- Markdown writeback MUST preserve the original file's config sections byte-for-byte — only `# Output` and its children are modified. Use `unified` + `remark-parse` + `remark-stringify` to round-trip the AST, OR use simple string manipulation that finds `# Output` (case-insensitive) and appends. Claude picks — recommended: string manipulation on text, not AST round-trip, to avoid surprising reformatting of the rest of the file.
- If the markdown file doesn't end with a trailing newline, add one before appending so the new section starts on its own line.
- For iframe descent depth ≥ 2 (ROADMAP must-have 3), a test must actually traverse two iframes. Suggest building a small HTML fixture served from a local file:// URL or a Playwright route stub, since finding a real public page with stable nested iframes is brittle. This is the one place local fixtures are acceptable for Phase 2 — PROJECT.md's "no local fixtures" rule is aimed at the Naver cafe end-to-end tests, not at testing the iframe descent mechanism itself.
- The timeout error message must mention BOTH the selector that failed and the timeout value, for user-facing clarity.

</specifics>

<deferred>
## Deferred Ideas

- `--headed` flag for visual debugging — marked CLI2-03 (v2) in REQUIREMENTS.md.
- Pagination / link following (CRWL2-01, CRWL2-02) — v2.
- Custom user agent — out of scope per OOS (v1 rules are only waitFor + timeout).
- Retry loop for transient errors — explicitly OOS.
- `--overwrite` flag for Output — OOS (history preservation is a hard rule).
- Output parsing by Phase 2 parser — Phase 1 parser ignores `# Output` by design; Phase 2 only appends to it.

</deferred>
