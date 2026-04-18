# Phase 3: Naver Auth + Session - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 3 adds Naver Cafe authentication on top of the working Phase 2 crawler. The public `runCrawl(configPath)` signature does not change. Internally, runCrawl gains an "ensureAuthenticated" step that runs AFTER `launchBrowser` + context creation but BEFORE `page.goto(configUrl)` when the target host is a Naver host and env-var credentials are available. The session (cookies + localStorage) is persisted to a single `.crawl-session.json` file at the repo root and reused across runs. When captcha / 2FA is detected, the crawler switches to a headed browser, waits up to 5 minutes for the user to resolve the challenge, saves the refreshed session, and resumes the crawl in headless mode.

</domain>

<decisions>
## Implementation Decisions

### When to Attempt Login
- **Detection:** if `new URL(url).host.endsWith('naver.com')` AND `process.env.NAVER_ID` + `process.env.NAVER_PW` are both set, the auth step runs before the primary `goto`.
- **Missing credentials on Naver URL:** `runCrawl` does NOT fail-fast. It proceeds with whatever session is on disk. If the target page redirects to `nid.naver.com`, `runCrawl` emits `CrawlError { code: 'auth_missing_credentials' }`.
- **Session file path:** `.crawl-session.json` at the repo root (already gitignored since Phase 2). Single global session — adequate for v1's single-account target.
- **Session reuse:** on every run, if the session file exists, `launchBrowser({ storageState })` wires it into the new context. Login is only attempted when a post-goto redirect signals the session is invalid.

### Captcha / 2FA Detection & Headed Fallback
- **Detection signals (any of, evaluated up to `rules.timeout` after credential submit):**
  - Final URL path matches `/\/captcha|\/otp|\/login-verify|\/cap|sms/i`
  - Visible selector present: `img[src*=captcha]`, `#captcha`, `[id*=captcha]`, `iframe[src*=captcha]`
  - Login form submits but cookie `NID_AUT` is still absent after `timeout`
- **Headed fallback flow:**
  1. Close the headless browser cleanly (save whatever state exists).
  2. Relaunch Chromium with `headless: false`, reusing the same storage state.
  3. Navigate to `https://nid.naver.com/nidlogin.login`.
  4. Print to stderr: `⚠ Captcha/2FA detected — resolve it in the visible browser window. Waiting up to {N}s...` where N reflects the configured ceiling.
  5. Poll success signal every 2000 ms: cookie `NID_AUT` present OR final URL matches Naver main (`^https?://[^/]*naver\.com/(?!.*nid\.)`).
  6. On success: save `context.storageState({ path })` to the session file, close headed browser.
  7. Relaunch **headless** browser with the fresh session and proceed with the original `goto(configUrl)` crawl.
- **Headed wait ceiling:** 300_000 ms (5 minutes) default. Overridable via `CRAWL_HEADED_TIMEOUT_MS` env var.
- **Interaction model:** NON-INTERACTIVE on stdin. User never presses Enter. Success is detected via polling.

### API, Error Codes, Module Layout
- **Public API unchanged.** `runCrawl(configPath: string): Promise<CrawlResult>` — no new parameters, no new exports.
- **Module layout:** add `src/auth/` with:
  - `session.ts` — resolve session file path, load/save/test existence
  - `naver.ts` — fill login form + submit (pure Playwright page operations)
  - `detect.ts` — pure functions that take URL/selectors and classify: logged_in | captcha | login_required | unknown
  - `headed.ts` — orchestrate the headed fallback (close headless → relaunch headed → poll → save → relaunch headless → return page)
  - `index.ts` — internal barrel exporting `ensureAuthenticated(page, targetUrl, browser, contextOpts)` — the single entry point runner.ts consumes
- **New `CrawlErrorCode` variants:** `'auth_missing_credentials' | 'auth_failed' | 'captcha_unresolved'` (added to the union in `src/crawler/types.ts`; errors.test.ts must be updated to lock the new 10-member union).
- **No public API leaks:** nothing from `src/auth/` is exported from `src/crawler/index.ts` or `src/index.ts`. Auth is an internal mechanism.

### Testing Strategy
- **Unit tests (always run):**
  - `session.test.ts` — path resolution, exists/load/save round-trip, handling missing file.
  - `detect.test.ts` — captcha signal classification (pure, against fixed URL+selector inputs).
  - `naver.test.ts` — selector-building and form-filling logic validated against fake Page mocks (type-only Playwright import).
- **Integration tests (Naver real network, gated):**
  - Run only if BOTH `NAVER_ID`, `NAVER_PW` are set AND `RUN_NAVER_TESTS=1`. Otherwise `it.skip` with a clear reason.
  - Cases: fresh login, session-reuse, invalid credentials, captcha detection via URL mock (Playwright route interception).
- **Captcha / 2FA headed-flow integration:** cannot be automated against real Naver. Cover it with a unit test using a scripted fake page that exposes the captcha selector, verifying the headed detection + polling loop logic in isolation.

### Claude's Discretion
- Internal helper signatures within `src/auth/*.ts` are Claude's discretion.
- Choice of `Set-Cookie` check vs `context.cookies().find(c => c.name === 'NID_AUT')` for the success signal is Claude's discretion.
- Exact login form selectors (`#id`, `#pw`, `#log\\.login`) may drift with Naver UI — acceptable if the executor grabs them freshly while writing the plan. If Naver changes selectors later, that's a maintenance issue for a future phase.
- Whether to add `--headed-timeout` as a visible CLI flag (Phase 4) vs keeping it env-only — Phase 4's problem.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phases 1 + 2)
- `launchBrowser({ storageState? })` in `src/crawler/browser.ts` — already accepts the optional session path. Phase 3 wires it.
- `CrawlError` class with `declare readonly code, detail?` pattern.
- `.crawl-session.json` already in `.gitignore` (Phase 2 Plan 02-01).
- `runCrawl` structure with `finalize` helper for always-write-output — Phase 3 fits into this with a new error branch for the 3 new codes.

### Established Patterns
- TypeScript strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes — honored across the codebase.
- CJS build (`"type": "commonjs"`, `module: nodenext`) — imports must stay CJS-compatible.
- `declare readonly ... ?:` pattern for optional class fields (don't regress).
- `scrubPaths` helper in `src/crawler/output.ts` — any error messages that might contain filesystem paths (including session file path in auth errors) should pass through it before landing in `# Output`.

### Integration Points
- `src/crawler/runner.ts` — add an `ensureAuthenticated` call between context creation and `page.goto(url)`. Minimal edit; Phase 3 should NOT refactor runner.ts.
- Phase 4 (CLI) will pass through env vars unchanged. No CLI flag changes required for Phase 3.

</code_context>

<specifics>
## Specific Ideas

- Session file contents are Playwright's standard `storageState` JSON — cookies + localStorage. Do NOT reformat; `context.storageState({ path })` and `browser.newContext({ storageState: path })` round-trip it.
- Naver login URL for the headed flow: `https://nid.naver.com/nidlogin.login`. Success cookie: `NID_AUT` (+ `NID_SES`). Both must be present to consider login successful.
- The detection regex for captcha URLs must use `/i` flag and be conservative — false positives are worse than occasional false negatives because a false positive drags the user into an unnecessary headed session.
- When the headed browser closes and we relaunch headless, re-read the session file fresh — do NOT reuse the same storage state in-memory; file is the source of truth.
- The cumulative test count target after Phase 3: ~140+ (122 before + 15-20 new unit tests).

</specifics>

<deferred>
## Deferred Ideas

- CLI flag to force headed mode (`--headed`) — v2 / Phase 4's decision per REQUIREMENTS.md CLI2-03.
- Multiple Naver accounts / per-host session files — v2 expansion.
- Daum Cafe or other platforms — explicitly out of scope per PROJECT.md.
- Captcha-solving service integration — out of scope.
- Auto-refresh session TTL — not needed for v1; manual headed fallback covers session expiry.

</deferred>
