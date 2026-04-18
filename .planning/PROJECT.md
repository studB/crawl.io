# crawl.io

## What This Is

A TypeScript CLI web crawler configured entirely through markdown files. Each markdown file describes one single-page crawl job — URL, selectors, rules — and the crawler writes extracted data back into that same file as an Output section with a run timestamp. Primary target is Naver Cafe (behind login, heavy iframe use); the tool is generic enough to work on other sites with the same structure.

## Core Value

**One markdown file fully describes a crawl job and carries its own results.** The config, the selectors, and the extracted data live in the same file — a crawler run is just "open file, read job, run Playwright, append result section, save." Everything else (the CLI, iframe traversal, login session, error handling) exists to make that loop reliable for a real Naver Cafe page.

## Current State

v1.0 shipped 2026-04-18. 4 phases, 13 plans, 30 tasks, 2,479 LOC of production TypeScript, 221 passing tests + 6 gated. `npm pack`/`publish --dry-run` green, `crawl run <file.md>` working, Naver Cafe login + session reuse + captcha headed fallback wired. Known tech debt tracked in `v1.0-MILESTONE-AUDIT.md`: 3 human UAT items for live Naver (deferred), tarball includes compiled test files (bloat), and `repository`/`bugs`/`homepage` URLs were removed (user must add before real `npm publish`).

## Next Milestone Goals

No next milestone started yet. Run `/gsd-new-milestone` when ready. Likely v1.1 candidates based on REQUIREMENTS.md v2 list:
- Auto-comment agent (AGENT-01..03) — original v2 goal
- Pagination / listing→detail crawling (CRWL2-01..02)
- `crawl init` / `crawl validate` subcommands (CLI2-01..02)
- Tarball tightening + real repo URLs (v1.0 tech debt)

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Parse a markdown config file into a structured crawl job (URL, selectors, rules) — v1.0
- ✓ Crawl a single page with Playwright using the parsed job — v1.0
- ✓ Support CSS and XPath selectors with multiple named fields per job — v1.0
- ✓ Descend into nested iframes when the config specifies an explicit frame path — v1.0 (2-level verified)
- ✓ Honor `waitFor` and `timeout` rules before extracting — v1.0
- ✓ Log into Naver with credentials from `NAVER_ID` / `NAVER_PW` env vars — v1.0 (automated; live UAT deferred)
- ✓ Persist browser storage state to `.crawl-session.json` and reuse across runs — v1.0 (live UAT deferred)
- ✓ Open a headed browser for manual resolve when captcha / 2FA is detected, then save the session and continue — v1.0 (live UAT deferred)
- ✓ Append extracted data to the markdown file's Output section as fenced JSON with a timestamp header — v1.0
- ✓ Write error details to Output and exit non-zero on failure — v1.0
- ✓ Ship `crawl run <file.md>` as the primary CLI command (subcommand style) — v1.0
- ✓ Publish the tool as an installable npm package — v1.0 (`npm publish --dry-run` green)

### Active

<!-- Current scope. Building toward these. -->

(None — v1.0 shipped. Define v1.1 scope via `/gsd-new-milestone`.)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **Multi-page / pagination / link following** — v1 is intentionally single-page to keep the core loop simple; a listing→detail crawler is a later milestone.
- **Multi-job markdown files** — one file = one job keeps the output-append model clean; batch running is a later concern.
- **Headless toggle / custom user agent** — the v1 crawler rule set is only `waitFor` + `timeout`; other tuning happens later if real runs show a need.
- **Stdout / JSON file / CSV output** — the markdown-embedded Output section is the whole point; alternative sinks break that model.
- **Overwrite mode** — every run is appended with a timestamp so history is preserved; no `--overwrite` flag in v1.
- **Agent that auto-comments cafe content** — this is the v2 goal mentioned by the user; the crawler is the upstream data source but the agent itself is a separate milestone.
- **Multiple cafe platforms (Daum, etc.)** — Naver Cafe only for v1; design keeps selectors/frames generic so other sites work incidentally, but no platform-specific quirks for non-Naver targets.
- **Local HTML fixtures for tests** — the user chose to test against real Naver Cafe pages; this is a deliberate tradeoff (real behavior over CI stability) and fixtures are not built in v1.

## Context

- **Starting state:** The directory contains only `package.json` (name `crawl.io`, no deps) and a default `tsconfig.json` (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `nodenext`, `esnext`). No source code yet — effectively greenfield scaffolding.
- **Runtime target:** Node 20 LTS.
- **Why Playwright:** Naver Cafe renders through iframes and requires a real browser context for login; a fetch-based crawler can't get to the content. Playwright also makes frame traversal explicit.
- **Why markdown configs:** The user wants jobs to be human-readable, editable in any text editor, and self-documenting (the Output section is appended to the same file). Makes it natural to version-control individual crawl jobs.
- **Why env-var credentials + storage state:** Avoids ever putting credentials in the markdown config (which could end up in git) while keeping repeat runs fast (login once, reuse cookies until expiry).
- **Captcha / 2FA reality:** Naver does trigger captcha periodically. The design choice is to fall back to a headed browser and let the user resolve it manually once, then the saved storage state carries the session forward.
- **v2 direction:** After the POC is reliable, the user plans to wrap this crawler with an agent that takes cafe post content and generates auto-comments. That agent is a separate milestone — the crawler just needs to produce clean structured data from each post.
- **Language choice:** User explicitly called out "developed by typescript first" — no JS escape hatch.

## Constraints

- **Tech stack**: TypeScript + Node 20 LTS + Playwright — fixed by user.
- **Tech stack**: CLI only, no server component — the whole tool is `crawl run <file.md>` invoked from a terminal.
- **Security**: Credentials must come from env vars; storage-state file (`.crawl-session.json`) must be git-ignored by default.
- **Distribution**: Must be publishable to npm — implies a `bin` entry, a proper build step, and no hard-coded local paths.
- **Compatibility**: Config format is markdown sections (`# URL`, `# Selectors`, `# Output`) with YAML-in-code-blocks for structured fields — this is the contract, tool must not break it.
- **Testing**: Tests run against real Naver Cafe URLs (user's choice) — implies tests require credentials and network, and may be excluded from any future CI.
- **Tech stack**: TypeScript `strict` mode plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on in `tsconfig.json` — code must honor them, no loosening.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| TypeScript + Node 20 LTS + Playwright | User-specified stack; Playwright is needed for iframe + login support | ✓ Good (v1.0) |
| One markdown file = one crawl job | Keeps the output-append model (results live in the same file as the config) coherent | ✓ Good (v1.0) |
| Markdown sections (not YAML frontmatter) for config | User preferred readable `# URL` / `# Selectors` / `# Rules` / `# Output` headings over a frontmatter block | ✓ Good (v1.0) |
| Explicit frame path in config for iframes | Naver Cafe nests iframes — being explicit avoids ambiguous auto-descent misses | ✓ Good (v1.0 — 2-level verified) |
| Output as fenced JSON appended with timestamp | Keeps history for each run; fenced JSON is trivial to re-parse downstream | ✓ Good (v1.0) |
| Errors written to Output + non-zero exit code | User sees the failure in the same place results normally land; CI / scripts still detect failure via exit code | ✓ Good (v1.0 — OUT-05 split: envelope Phase 2, exit Phase 4) |
| Env vars `NAVER_ID` / `NAVER_PW` for credentials | Never put credentials in markdown (could leak to git); env vars are the most portable option | ✓ Good (v1.0) |
| Save Playwright storage state, reuse until expired | Avoids re-login + captcha churn every run | ✓ Good (v1.0 — live UAT deferred) |
| Headed browser fallback for captcha / 2FA | Naver captcha is unavoidable at times; the only realistic path is a visible browser for manual resolve, then save session | ✓ Good (v1.0 — non-interactive polling, 5-min ceiling, live UAT deferred) |
| `crawl run <file.md>` subcommand shape | Leaves verb-space for `init`, `validate`, `list` later without restructuring CLI | ✓ Good (v1.0 — commander) |
| Publish to npm | User wants the tool installable; defines build + bin + packaging shape | ✓ Good (v1.0 — `npm publish --dry-run` green; user must add repo URLs before real publish) |
| Test against real Naver Cafe pages | User's explicit choice — accept brittleness in exchange for real-world behavior fidelity | ⚠️ Revisit (v1.0 deferred live tests to UAT; local fixtures used for Phase 2 iframe mechanism per in-phase carve-out) |
| Agent that auto-comments cafe content is v2 | Keeps POC scope tight; crawler ships first, agent consumes its output later | — Pending (v2) |
| Pin `unified@^9` + `remark-parse@^9` (v1.0) | Node 20 LTS + commonjs + module:nodenext cannot `require()` the ESM-only v10+ majors; v9 keeps `parseConfig` sync | ✓ Good (v1.0) |
| `declare readonly` for optional class fields (v1.0) | Under target:esnext + useDefineForClassFields:true, bare class fields emit `Object.defineProperty` at construction; `declare` suppresses emission so `'foo' in err === false` holds | ✓ Good (v1.0 — ConfigParseError, CrawlError) |
| Zod v4 schemas in `src/config/schema.ts` (v1.0) | TS-first validation with aggregated-error support; `canValidate` gate suppresses duplicate Zod "required" errors when structural pieces are missing | ✓ Good (v1.0) |
| Non-interactive captcha polling with 5-min ceiling (v1.0) | No stdin/readline — user never presses Enter; success detected via cookie polling; `CRAWL_HEADED_TIMEOUT_MS` env var overrides | ✓ Good (v1.0) |
| `scrubPaths` helper for error redaction (v1.0) | Universal application across all stderr emission sites prevents leaking home paths / usernames in committed markdown or CLI output | ✓ Good (v1.0 — enforced in code review) |
| Atomic session writes via tmp + rename (v1.0) | Non-atomic writes leave corrupt session files on crash; tmp + rename + validator-on-read makes expired/malformed sessions self-healing | ✓ Good (v1.0) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-18 after v1.0 milestone*
