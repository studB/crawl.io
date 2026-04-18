# Phase 1: Config Parser - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a pure, browser-free parser that turns one markdown file into a validated, structured `CrawlJob` object. It is the layer every subsequent phase (crawler, auth, CLI) reads from. No Playwright, no network, no filesystem side effects beyond optionally reading an input file.

</domain>

<decisions>
## Implementation Decisions

### Parsing Strategy
- Use `unified` + `remark-parse` to parse markdown into an AST and walk heading nodes to split sections (`# URL`, `# Selectors`, `# Rules`, `# Output`).
- Within each relevant section, locate fenced code blocks tagged `yaml` or `yml` and parse them with the `yaml` package.
- Prose / plain text surrounding fenced blocks inside config sections is allowed and silently ignored — only fenced code blocks feed the parser.
- Phase 1 does NOT parse the `# Output` section into structured data. The parser ignores it entirely; Phase 2 is responsible for appending to it.

### Validation & Errors
- Validation library: **Zod** (TS-first, good error messages, light dependency).
- Zod schemas live in a dedicated module (`src/config/schema.ts`) and are imported by the parser. Parsing (markdown → raw object) and validation (raw object → `CrawlJob`) are cleanly separated.
- Aggregate errors — collect every Zod issue and every structural problem, then throw a single `ConfigParseError` carrying the full list. More useful when the user is editing the markdown.
- Custom error class: `ConfigParseError extends Error` with `{ issues: string[], filePath?: string }`. Downstream CLI can format the list nicely.

### Public API & Types
- `CrawlJob` shape:
  - `url: string`
  - `selectors: Record<string, SelectorSpec>`
  - `rules: { waitFor?: string, timeout: number }`
- `SelectorSpec` shape:
  - `selector: string`
  - `engine: 'css' | 'xpath'`
  - `frame?: string[]` (depth-ordered array of iframe selectors — supports nested frames ≥ 2 levels)
- Default engine when omitted: `css`.
- Default timeout when omitted: `30000` ms.
- Two entry points:
  - `parseConfig(source: string, opts?: { filePath?: string }): CrawlJob` — sync, pure, takes markdown text.
  - `parseConfigFile(path: string): Promise<CrawlJob>` — async wrapper that reads the file and calls `parseConfig` with `filePath` populated.

### Claude's Discretion
- Internal module layout under `src/config/` (parser.ts, schema.ts, errors.ts, types.ts or similar) is at Claude's discretion as long as the two public entry points and the `ConfigParseError` class are the external contract.
- Test structure and choice of runner (Vitest vs node:test) is at Claude's discretion — TypeScript strict mode and `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes` must be honored either way.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — the repository is effectively greenfield. `package.json` exists with name `crawl.io`, no dependencies. `tsconfig.json` is already configured with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `module: nodenext`, `target: esnext`.

### Established Patterns
- Project-level constraints enforced via CLAUDE.md and `tsconfig.json`: no loosening of strictness, no JS escape hatch.

### Integration Points
- Phase 2 (Core Crawler) will import the public `parseConfig` / `parseConfigFile` entry points and the `CrawlJob` type.
- Phase 4 (CLI) will import `parseConfigFile` and will rely on `ConfigParseError` for formatted error output.

</code_context>

<specifics>
## Specific Ideas

- Config format contract (fixed by CLAUDE.md / PROJECT.md): markdown sections `# URL`, `# Selectors`, `# Rules`, `# Output`, with YAML-in-code-blocks for structured fields.
- `# URL` section contains a single URL as plain text (first non-empty, non-heading line). YAML is not required for this section.
- `# Selectors` contains a YAML block: a map of field-name → selector spec.
- `# Rules` contains a YAML block with `waitFor` and `timeout`.
- Frame path format (YAML): an array of strings, each a selector for the iframe at that depth (top-level iframe first).

</specifics>

<deferred>
## Deferred Ideas

- Parsing `# Output` into structured history (Phase 2 concern at earliest, likely v2).
- Warn-mode on unknown top-level keys inside YAML blocks (currently aggregated as errors via Zod strict object mode).
- CLI-facing pretty formatter for `ConfigParseError.issues` — belongs in Phase 4.

</deferred>
