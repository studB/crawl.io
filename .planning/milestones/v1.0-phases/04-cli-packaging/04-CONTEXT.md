# Phase 4: CLI + Packaging - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 wraps the Phase 1-3 library in a publishable CLI. A user who runs `npm install -g crawl.io` gets a `crawl` command on their PATH. That command exposes one subcommand (`run`) today, with a subcommand shape that can accept future verbs (`init`, `validate`, `list`) without breaking the top-level interface. Phase 4 also finalizes the OUT-05 exit-code mapping (split from Phase 2) — `CrawlResult.status === 'error'` maps to `process.exit(1)`. Zero changes to `runCrawl` or any library-side API.

</domain>

<decisions>
## Implementation Decisions

### CLI Framework & Subcommand Shape
- **Library:** `commander`. Standard, good `--help` generation, subcommand composition is idiomatic.
- **Command shape:** `crawl run <file.md>` — `<file.md>` is a required positional arg. Top-level `crawl` without a verb prints usage.
- **Top-level `--help`:** one-line project tagline + list of subcommands (only `run` today) + link/repo. Commander's default output, lightly customized.
- **`crawl run --help`:** includes usage line, positional arg description, **required env vars** (`NAVER_ID`, `NAVER_PW` — listed but marked optional overall since non-Naver URLs don't need them), **optional env vars** (`CRAWL_HEADED_TIMEOUT_MS`), and **exit code table** (0 = success, 1 = any failure).

### Exit Codes, Logging, Error Surface
- **Binary exit codes:** `status: 'ok'` → `process.exit(0)`; `status: 'error'` → `process.exit(1)`. Simple and aligned with REQUIREMENTS.md OUT-05 wording ("non-zero on any failure"). Distinct codes per error type deferred to v2.
- **stdout:** single human-readable line summarizing the run (`✓ title: Example page` for success or `✗ timeout: waitFor '.foo' did not match within 30000ms` for error). Full data lives in the markdown file — CLI does NOT dump JSON.
- **stderr:** progress hints (`→ parsing config`, `→ launching Chromium`, `→ navigating`, `→ extracting 3 fields`, `→ writing output`), captcha warning, any scrubbed path messages.
- **`--verbose`:** prints every stage with timing. `--quiet`: silences stdout and stderr (exit code only). Both optional; balanced output by default (summary line + captcha warning if triggered).
- **Module layout:** `src/cli/cli.ts` (commander setup + top-level), `src/cli/run.ts` (the `run` subcommand handler that calls `runCrawl` and maps to exit code), `src/bin/crawl.ts` (shebang entry, imports from `./cli/cli`). tsc emits `dist/bin/crawl.js` preserving the shebang.

### Package Publish Readiness
- **Metadata:** set in `package.json`:
  - `description`: short crawler tagline
  - `keywords`: `["crawler", "playwright", "naver", "markdown", "cli"]`
  - `license`: `MIT` (overriding placeholder `ISC`)
  - `repository`, `bugs`, `homepage`: placeholders pointing at a TBD URL (plan marks these as "TBD — user fills in at publish time", grep-check that the strings are NOT empty strings). The executor sets them to `"TBD"` or a sensible GitHub placeholder that the user can replace.
  - `engines`: `{ "node": ">=20" }`
  - `author`: left as user-settable (plan does not hard-code a name)
- **`files` allowlist:** `["dist/", "README.md", "LICENSE"]`. Tests, fixtures, source, `.planning/` all stay out of the npm tarball.
- **`bin`:** `{ "crawl": "./dist/bin/crawl.js" }`. Source `src/bin/crawl.ts` starts with `#!/usr/bin/env node`; tsc preserves the shebang when the `.ts` input has it AND emits to the correct path.
- **Build script:** `npm run build` already exists from Phase 1 — verify it emits `dist/bin/crawl.js` and that file has the shebang + is marked executable by the `prepack` / tsc step. If needed, add a `chmod +x` follow-up in the build script.
- **README:** Phase 4 creates a minimal `README.md` covering: what crawl.io does, install command, quick-start example with a sample markdown config, env vars, exit codes. No deep-dive docs (v2).
- **LICENSE:** MIT license text in a root `LICENSE` file.
- **Publish verification:**
  - `npm pack --dry-run` must succeed; plan asserts stdout lists `dist/`, `package.json`, `README.md`, `LICENSE` AND does NOT list `src/`, `test/`, `.planning/`, `node_modules/`.
  - Actual `npm pack` produces a tarball; extract it, cd into unpacked dir, run `node dist/bin/crawl.js --help` and assert it prints the expected usage text.
  - `npm publish --dry-run` as final gate — must exit 0.
  - Do NOT run actual `npm publish` — that's a user decision.

### Claude's Discretion
- Internal helpers in `cli.ts` / `run.ts` (e.g., how to format the summary line, how to structure verbose logging) are at Claude's discretion.
- Whether to use `chalk` for colored output — plan can include it IF it fits the description (one small dep is fine). Recommend no color (zero deps, simpler shipping).
- Test strategy: CLI integration tests via `execa` or `child_process.spawn` against the built `dist/bin/crawl.js`. Unit tests for the exit-code mapping pure function.
- Minor `README.md` wording is Claude's discretion.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (Phases 1-3)
- `runCrawl(configPath): Promise<CrawlResult>` — the sole library entry point the CLI wraps.
- `CrawlResult.status` is either `'ok'` or `'error'`.
- `src/index.ts` already re-exports `runCrawl` and friends — CLI can import from `../index` (or directly from `../crawler`).
- `package.json` currently has `"type": "commonjs"`, `"main": "index.js"`, `"types": null` — Phase 4 finalizes `main`, `types`, `bin`, `files`, `engines` fields.

### Established Patterns
- TypeScript strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes honored throughout. CLI code must too.
- CJS build via tsc. `module: nodenext`, `target: esnext`. Build outputs to `dist/`.
- `scrubPaths` helper for redacting filesystem paths in error messages.
- No `process.exit` in the library — CLI is the exit point.

### Integration Points
- The CLI is the FIRST caller that translates `CrawlResult` to a process exit. No other integration surface.
- `bin/crawl.ts` is the ONLY file with a shebang. Tests that diff the tarball verify shebang survival.

</code_context>

<specifics>
## Specific Ideas

- `bin` file must have Unix line endings even on a Windows author machine — tsc should preserve input endings; plan can include a `.gitattributes` entry for `*.js` if needed (optional).
- After successful `runCrawl`, the summary line should show the first field extracted (e.g., `✓ title: "Example Page"`) with quoting/truncation so long text doesn't break the terminal.
- If `--quiet` is set, the CLI suppresses stderr progress AND stdout summary — only the exit code tells the user what happened.
- If the user provides a non-existent path, the CLI should emit `✗ config not found: <scrubbed path>` to stderr and exit 1 BEFORE calling `runCrawl` (fail-fast; `runCrawl` would catch it anyway via `parseConfigFile`'s ENOENT, but CLI handles it prettily).

</specifics>

<deferred>
## Deferred Ideas

- `crawl init <name>.md` scaffold (CLI2-01 — v2).
- `crawl validate <file.md>` without a browser (CLI2-02 — v2).
- `crawl run --headed` flag for debugging (CLI2-03 — v2).
- `crawl run --overwrite` flag (CLI2-04 — v2).
- Distinct exit codes per error type — v2.
- Colored output via `chalk` — not needed for v1.
- Shell completions (bash/zsh) — v2.

</deferred>
