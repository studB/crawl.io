# Roadmap: crawl.io

## Overview

Four phases build the crawler from the inside out. Phase 1 delivers the markdown config parser — the layer everything else reads from. Phase 2 wires Playwright to that config and writes results back into the same file, completing the core extraction loop against a public page. Phase 3 layers Naver authentication and session reuse on top of the working crawler. Phase 4 wraps everything in a publishable CLI with a proper bin entry and npm packaging.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Config Parser** - Parse a markdown file into a validated, structured crawl job (completed 2026-04-18)
- [x] **Phase 2: Core Crawler + Output** - Playwright extraction loop writing results back into the markdown file (completed 2026-04-18)
- [x] **Phase 3: Naver Auth + Session** - Login, storage-state reuse, and captcha headed fallback (completed 2026-04-18)
- [ ] **Phase 4: CLI + Packaging** - Subcommand CLI, bin entry, TypeScript build, and npm publish readiness

## Phase Details

### Phase 1: Config Parser
**Goal**: A markdown config file can be parsed into a complete, validated crawl job before any browser is launched
**Depends on**: Nothing (first phase)
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04, CFG-05, CFG-06
**Success Criteria** (what must be TRUE):
  1. Given a valid markdown file with `# URL`, `# Selectors`, and `# Rules` sections, the parser returns a structured object with the URL, a named-field selector map, and waitFor/timeout values
  2. A selector entry that specifies `engine: xpath` is distinguished from one that specifies `engine: css` in the parsed output
  3. A selector entry with an explicit `frame` path is present in the parsed output alongside its selector string
  4. Given a markdown file missing `# URL` or containing invalid YAML, the parser throws a descriptive error message without launching any browser process
**Plans**: 3 plans
  - [x] 01-01-PLAN.md — Install deps (unified, remark-parse, yaml, zod, vitest), align tsconfig/package.json for CJS build, create src/config scaffold
  - [x] 01-02-PLAN.md — Define CrawlJob/SelectorSpec types, Zod schemas (engine enum, frame array, strict unknown-key rejection, defaults), ConfigParseError class + unit tests
  - [x] 01-03-PLAN.md — Implement parseConfig + parseConfigFile via unified+remark+yaml, aggregate errors, wire src/index.ts public barrel + unit tests

### Phase 2: Core Crawler + Output
**Goal**: The crawler navigates to a configured URL, extracts named fields (including from nested iframes), and appends the results as a timestamped JSON block to the markdown file's Output section
**Depends on**: Phase 1
**Requirements**: CRWL-01, CRWL-02, CRWL-03, CRWL-04, CRWL-05, CRWL-06, CRWL-07, OUT-01, OUT-02, OUT-03, OUT-04, OUT-05
**Success Criteria** (what must be TRUE):
  1. Running the crawler against a public URL produces a new `# Output` entry in the markdown file containing a fenced JSON block and a human-readable timestamp
  2. Running the crawler twice produces two separate timestamped entries — the first entry is never overwritten
  3. A config that declares an explicit frame path causes the crawler to descend into that iframe before evaluating the selector; extraction succeeds at least 2 levels deep
  4. A config using `engine: xpath` successfully extracts text that a CSS selector on the same field would also return
  5. When the `waitFor` condition is not met within `timeout` milliseconds, the crawler writes an error entry to `# Output` and exits with a non-zero code
**Plans**: 4 plans
  - [x] 02-01-PLAN.md — Install Playwright + Chromium binary, extend .gitignore for session/artifacts, scaffold src/crawler/ type contracts (CrawlErrorCode, CrawlResult, CrawlError class + unit tests) [Wave 1]
  - [x] 02-02-PLAN.md — Pure markdown writeback (formatTimestamp, renderEntry, appendOutput, writeOutputToFile) with TDD unit tests covering append-only + success/error JSON shapes [Wave 2]
  - [x] 02-03-PLAN.md — Playwright-bound crawler modules (browser.ts, frame.ts, extract.ts) + nested-iframe HTML fixtures + integration tests for 2-level descent, CSS vs XPath, timeout mapping [Wave 2]
  - [x] 02-04-PLAN.md — runCrawl orchestrator wiring parser → browser → extract → writeback, crawler barrel, src/index.ts public exposure, end-to-end integration tests for happy path + two-run append + error entries [Wave 3]
**UI hint**: no

### Phase 3: Naver Auth + Session
**Goal**: The crawler can log into Naver Cafe with env-var credentials, persist the session, reuse it on repeat runs, and fall back to a headed browser when a captcha challenge is detected
**Depends on**: Phase 2
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. Setting `NAVER_ID` and `NAVER_PW` env vars and pointing the crawler at a login-gated Naver Cafe page completes without a credentials error
  2. After a successful login, `.crawl-session.json` exists on disk and a subsequent run reuses it without re-triggering the login flow
  3. `.crawl-session.json` is listed in `.gitignore` so it is never staged by git
  4. When a captcha or 2FA challenge is detected, a headed browser window opens; after the user resolves it manually, the session is saved and the crawl proceeds without restarting
**Plans**: 3 plans
  - [x] 03-01-PLAN.md — Extend CrawlErrorCode union (10 members), land session.ts helpers + unit tests, verify .gitignore [Wave 1]
  - [x] 03-02-PLAN.md — Pure detect.ts classifiers, naver.ts login-form helpers, headed.ts polling orchestrator + exhaustive unit tests [Wave 1]
  - [x] 03-03-PLAN.md — ensureAuthenticated barrel, runner.ts wiring, runner auth unit tests, gated Naver integration test [Wave 2]

### Phase 4: CLI + Packaging
**Goal**: The tool is invokable as `crawl run <file.md>` from any terminal after `npm install -g`, ships with help text, and is publishable to npm
**Depends on**: Phase 3
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05
**Success Criteria** (what must be TRUE):
  1. `crawl run <file.md>` executes a full crawl job and exits; `crawl --help` and `crawl run --help` both print usage that includes the argument shape and required env vars
  2. The subcommand structure allows a second verb (e.g., `crawl validate`) to be added in future without changing the top-level interface
  3. `npm pack` produces a tarball with a working `bin` entry that resolves the `crawl` command after `npm install -g`
  4. `npm publish` succeeds against the registry (or a dry run passes): package includes compiled JS, type declarations, and no TypeScript source errors under strict mode
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Config Parser | 3/3 | Complete    | 2026-04-18 |
| 2. Core Crawler + Output | 4/4 | Complete    | 2026-04-18 |
| 3. Naver Auth + Session | 3/3 | Complete    | 2026-04-18 |
| 4. CLI + Packaging | 0/TBD | Not started | - |
