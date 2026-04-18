# Requirements: crawl.io

**Defined:** 2026-04-18
**Core Value:** One markdown file fully describes a crawl job and carries its own results — config, selectors, and extracted data live in the same file.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Config (markdown config parser)

- [x] **CFG-01**: Parser reads a target URL from the `# URL` section of the markdown file
- [x] **CFG-02**: Parser reads a YAML block inside `# Selectors` and produces a map of named fields
- [x] **CFG-03**: A selector entry can declare an engine (`css` or `xpath`) per field
- [x] **CFG-04**: A selector entry can declare an explicit `frame` path so the crawler descends into a specific nested iframe before matching
- [x] **CFG-05**: Parser reads `waitFor` (selector to wait for) and `timeout` (milliseconds) from a `# Rules` YAML block
- [x] **CFG-06**: Parser fails with a clear error message (before launching a browser) when the file is missing `# URL`, has invalid YAML, or references unknown keys

### Crawling (Playwright single-page extraction)

- [x] **CRWL-01**: Crawler launches Playwright (Chromium) and navigates to the configured URL
- [x] **CRWL-02**: Crawler waits for the `waitFor` selector (scoped to the correct frame) before extracting
- [x] **CRWL-03**: Crawler aborts cleanly when the page or `waitFor` condition exceeds the configured `timeout`
- [x] **CRWL-04**: Crawler resolves CSS selectors against the top-level page or the declared frame
- [x] **CRWL-05**: Crawler resolves XPath selectors against the top-level page or the declared frame
- [x] **CRWL-06**: Crawler descends through each frame in an explicit frame path (supporting nested iframes at least 2 levels deep)
- [x] **CRWL-07**: Crawler extracts text content for each named field and returns a `{field: value}` object

### Auth (Naver login + session reuse)

- [x] **AUTH-01**: Crawler reads `NAVER_ID` and `NAVER_PW` from environment variables when the target requires Naver login
- [x] **AUTH-02**: Crawler saves Playwright storage state to `.crawl-session.json` after a successful login
- [x] **AUTH-03**: Crawler reuses `.crawl-session.json` on subsequent runs when the session is still valid
- [x] **AUTH-04**: Crawler detects captcha / 2FA challenges during the login flow
- [x] **AUTH-05**: Crawler opens a headed browser for manual resolve when a challenge is detected, waits for the user to complete it, then saves the fresh storage state and proceeds
- [x] **AUTH-06**: `.crawl-session.json` is added to `.gitignore` so credentials/cookies never end up in version control

### Output (write-back to markdown)

- [x] **OUT-01**: Crawler appends (does not overwrite) a new entry to the `# Output` section on every run
- [x] **OUT-02**: Each entry includes a human-readable timestamp (e.g., `_Last run: 2026-04-18 10:22_`) and a count of extracted items
- [x] **OUT-03**: Extracted data is written as a fenced ```json code block inside the entry, parseable by any JSON reader
- [x] **OUT-04**: On failure (timeout, selector miss, network error, login error) the crawler writes an error entry to `# Output` with error type and message instead of results
- [x] **OUT-05**: The process exits with a non-zero code on any failure so shells and schedulers detect it

### CLI (command shape + packaging)

- [x] **CLI-01**: `crawl run <file.md>` runs a single crawl job from the given markdown file and exits
- [x] **CLI-02**: The CLI uses a subcommand structure so future verbs (`init`, `validate`, `list`) can be added without breaking the top-level interface
- [x] **CLI-03**: `crawl --help` and `crawl run --help` print usage showing the argument shape and required env vars
- [x] **CLI-04**: `package.json` declares a `bin` entry that resolves the `crawl` command after installation
- [x] **CLI-05**: The package builds with TypeScript (Node 20 LTS target) and is publishable to npm via `npm publish`

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Agent (auto-commenter, the original stated v2 goal)

- **AGENT-01**: An agent reads crawler output and generates a comment in response to the cafe post
- **AGENT-02**: The agent posts the generated comment back to the source cafe page
- **AGENT-03**: Agent invocation is separable from the crawler CLI (composable, not embedded)

### Crawl Scope (post-POC expansion)

- **CRWL2-01**: Crawler follows pagination (multi-page listings)
- **CRWL2-02**: Crawler follows listing → detail links and extracts per-detail content
- **CRWL2-03**: One markdown file can define multiple crawl jobs

### CLI (post-POC expansion)

- **CLI2-01**: `crawl init <name>.md` scaffolds a template config file
- **CLI2-02**: `crawl validate <file.md>` checks config without running a browser
- **CLI2-03**: `crawl run` gains a `--headed` flag for visible debugging
- **CLI2-04**: `crawl run` gains a `--overwrite` flag to replace (instead of append) the Output section

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-page / pagination / link following | v1 is intentionally single-page — keeps the core extraction loop simple |
| Multi-job markdown files | One file = one job preserves the clean "config and output in same file" model |
| Headless toggle / custom user agent (in v1) | v1 crawler rules are only `waitFor` + `timeout`; any more tuning defers to v2 |
| Stdout / CSV / separate JSON file output | The markdown-embedded Output section is the product; alternative sinks break the model |
| Overwrite mode for Output | History is preserved deliberately — every run appends a new timestamped entry |
| Daum Cafe / other cafe platforms | v1 targets Naver Cafe only; design stays generic but no platform-specific handling elsewhere |
| Local HTML fixtures for tests | User chose real Naver Cafe URLs for tests; fixtures trade fidelity for stability and were declined |
| Credentials in markdown / config file | Security — credentials must only come from env vars, never live in the repo |
| Retry loop for transient network errors (v1) | Exit non-zero on failure; retry is a script-level concern, not a crawler feature |
| Agent that auto-comments cafe content | This is the stated v2 goal — crawler ships first, agent consumes its output later |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 1 | Complete |
| CFG-02 | Phase 1 | Complete |
| CFG-03 | Phase 1 | Complete |
| CFG-04 | Phase 1 | Complete |
| CFG-05 | Phase 1 | Complete |
| CFG-06 | Phase 1 | Complete |
| CRWL-01 | Phase 2 | Complete |
| CRWL-02 | Phase 2 | Complete |
| CRWL-03 | Phase 2 | Complete |
| CRWL-04 | Phase 2 | Complete |
| CRWL-05 | Phase 2 | Complete |
| CRWL-06 | Phase 2 | Complete |
| CRWL-07 | Phase 2 | Complete |
| AUTH-01 | Phase 3 | Complete |
| AUTH-02 | Phase 3 | Complete |
| AUTH-03 | Phase 3 | Complete |
| AUTH-04 | Phase 3 | Complete |
| AUTH-05 | Phase 3 | Complete |
| AUTH-06 | Phase 3 | Complete |
| OUT-01 | Phase 2 | Complete |
| OUT-02 | Phase 2 | Complete |
| OUT-03 | Phase 2 | Complete |
| OUT-04 | Phase 2 | Complete |
| OUT-05 | Phase 4 | Pending (split: Phase 2 delivers error envelope; Phase 4 CLI maps to process.exit) |
| CLI-01 | Phase 4 | Complete |
| CLI-02 | Phase 4 | Complete |
| CLI-03 | Phase 4 | Complete |
| CLI-04 | Phase 4 | Complete |
| CLI-05 | Phase 4 | Complete |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-18*
*Last updated: 2026-04-18 after roadmap creation*
