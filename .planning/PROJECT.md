# crawl.io

## What This Is

A TypeScript CLI web crawler configured entirely through markdown files. Each markdown file describes one single-page crawl job — URL, selectors, rules — and the crawler writes extracted data back into that same file as an Output section with a run timestamp. Primary target is Naver Cafe (behind login, heavy iframe use); the tool is generic enough to work on other sites with the same structure.

## Core Value

**One markdown file fully describes a crawl job and carries its own results.** The config, the selectors, and the extracted data live in the same file — a crawler run is just "open file, read job, run Playwright, append result section, save." Everything else (the CLI, iframe traversal, login session, error handling) exists to make that loop reliable for a real Naver Cafe page.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Parse a markdown config file into a structured crawl job (URL, selectors, rules)
- [ ] Crawl a single page with Playwright using the parsed job
- [ ] Support CSS and XPath selectors with multiple named fields per job
- [ ] Descend into nested iframes when the config specifies an explicit frame path
- [ ] Honor `waitFor` and `timeout` rules before extracting
- [ ] Log into Naver with credentials from `NAVER_ID` / `NAVER_PW` env vars
- [ ] Persist browser storage state to `.crawl-session.json` and reuse across runs
- [ ] Open a headed browser for manual resolve when captcha / 2FA is detected, then save the session and continue
- [ ] Append extracted data to the markdown file's Output section as fenced JSON with a timestamp header
- [ ] Write error details to Output and exit non-zero on failure (timeout, selector miss, network error)
- [ ] Ship `crawl run <file.md>` as the primary CLI command (subcommand style, room for `init`/`validate`/`list` later)
- [ ] Publish the tool as an installable npm package

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
| TypeScript + Node 20 LTS + Playwright | User-specified stack; Playwright is needed for iframe + login support | — Pending |
| One markdown file = one crawl job | Keeps the output-append model (results live in the same file as the config) coherent | — Pending |
| Markdown sections (not YAML frontmatter) for config | User preferred readable `# URL` / `# Selectors` / `# Output` headings over a frontmatter block | — Pending |
| Explicit frame path in config for iframes | Naver Cafe nests iframes — being explicit avoids ambiguous auto-descent misses | — Pending |
| Output as fenced JSON appended with timestamp | Keeps history for each run; fenced JSON is trivial to re-parse downstream | — Pending |
| Errors written to Output + non-zero exit code | User sees the failure in the same place results normally land; CI / scripts still detect failure via exit code | — Pending |
| Env vars `NAVER_ID` / `NAVER_PW` for credentials | Never put credentials in markdown (could leak to git); env vars are the most portable option | — Pending |
| Save Playwright storage state, reuse until expired | Avoids re-login + captcha churn every run | — Pending |
| Headed browser fallback for captcha / 2FA | Naver captcha is unavoidable at times; the only realistic path is a visible browser for manual resolve, then save session | — Pending |
| `crawl run <file.md>` subcommand shape | Leaves verb-space for `init`, `validate`, `list` later without restructuring CLI | — Pending |
| Publish to npm | User wants the tool installable; defines build + bin + packaging shape | — Pending |
| Test against real Naver Cafe pages | User's explicit choice — accept brittleness in exchange for real-world behavior fidelity | ⚠️ Revisit |
| Agent that auto-comments cafe content is v2 | Keeps POC scope tight; crawler ships first, agent consumes its output later | — Pending |

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
*Last updated: 2026-04-18 after initialization*
