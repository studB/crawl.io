---
phase: 03-naver-auth-session
reviewed: 2026-04-18T00:00:00Z
depth: standard
file_count: 14
files_reviewed_list:
  - src/auth/session.ts
  - src/auth/detect.ts
  - src/auth/naver.ts
  - src/auth/headed.ts
  - src/auth/index.ts
  - src/auth/session.test.ts
  - src/auth/detect.test.ts
  - src/auth/naver.test.ts
  - src/auth/headed.test.ts
  - src/auth/index.test.ts
  - src/auth/naver.integration.test.ts
  - src/crawler/runner.ts
  - src/crawler/runner.ts.auth.test.ts
  - src/crawler/errors.test.ts
finding_count: 11
blocker: 0
high: 2
medium: 5
low: 4
status: issues_found
---

# Phase 3: Code Review Report

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 3 delivers a clean, well-structured auth subsystem: credential reading is isolated in `naver.ts`, classification is pure in `detect.ts`, and `ensureAuthenticated` composes them behind a single entry point. Redaction boundaries, `exactOptionalPropertyTypes` compliance, and the 10-member `CrawlErrorCode` lock all hold. No public-API leakage was detected. The `runCrawl` signature is unchanged and `process.exit` is never invoked.

The two main concerns are:

1. `CAPTCHA_URL_REGEX` is dangerously broad — the sub-patterns `\/cap` and `sms` match far beyond captcha routes (e.g., `/capture`, `/capital`, `?tag=smswatch`), which violates the "false positives are worse than false negatives" invariant stated in the module's own header comment.
2. Session persistence is non-atomic — `context.storageState({ path })` writes directly to `.crawl-session.json`, so a mid-write crash can leave a corrupt file that poisons the next run. The phase context explicitly mentions "tmp + rename" atomic writes as the intent; the implementation does not match.

Test coverage is strong for the happy path, credential missing, and post-submit classification, but does NOT cover: (a) an expired session file whose cookies Playwright accepts but that the target URL rejects, (b) a malformed/zero-byte session file, (c) `[id*=captcha]` false-positive classification, or (d) the `launchHeaded`-failure path between closing headless and opening headed.

## High

### H-01: `CAPTCHA_URL_REGEX` sub-patterns `\/cap` and `sms` produce false positives on legitimate Naver paths

**File:** `src/auth/detect.ts:42`

**Issue:** The regex is

```ts
export const CAPTCHA_URL_REGEX = /\/captcha|\/otp|\/login-verify|\/cap|sms/i;
```

Two sub-patterns are not conservative:

- `\/cap` matches `/captcha` (intended) **and also** `/capture`, `/capital`, `/capacity`, `/capabilities`, etc. A Naver Cafe URL that happens to contain `/cap` (e.g., `https://cafe.naver.com/board/capture-tutorial`) would be classified as captcha and drag the user into an unnecessary headed session — precisely the outcome the module comment says it is trying to prevent.
- `sms` is unanchored and matches anywhere in `pathname + search`. URLs like `?tag=smstoday`, `?q=smswatch`, or even `/cafe/asmspace/...` would trigger the captcha branch on regex match.

Both are tested as accepted positives (`detect.test.ts:60-63`) with no corresponding negative test proving legitimate cafe paths don't match — the test actually bakes the loose behavior in.

**Fix:** Anchor `sms` to a path segment boundary and drop the bare `\/cap` alias (since `\/captcha` already covers the real case). If SMS-verify routes must be detected, match the actual route shape:

```ts
// BEFORE
export const CAPTCHA_URL_REGEX = /\/captcha|\/otp|\/login-verify|\/cap|sms/i;

// AFTER — narrower, real-route patterns only
export const CAPTCHA_URL_REGEX = /\/captcha\b|\/otp\b|\/login-verify\b|\/sms(?:-verify|\/)/i;
```

Then add a negative test: `expect(urlLooksLikeCaptcha('https://cafe.naver.com/board/capture-tutorial')).toBe(false);` and `expect(urlLooksLikeCaptcha('https://cafe.naver.com/post?tag=smstoday')).toBe(false);`.

### H-02: Session-file write is not atomic — a crash mid-write can corrupt `.crawl-session.json` and poison the next run

**File:** `src/auth/index.ts:183`, `src/auth/index.ts:280`

**Issue:** Both session-save sites call Playwright's `context.storageState({ path: sessionFilePath(cwd) })` directly. Playwright writes the target file in-place; there is no tmp + rename. If the process is killed (Ctrl+C, OOM, power loss) while Playwright is mid-serialize, the next run's `launchBrowser({ storageState })` call hands a truncated/partial JSON to Playwright, which throws a non-specific parse error — the runner's catch block maps it to `code: 'unknown'` with no indication that the remedy is "delete the corrupt session file."

The phase context document (`03-CONTEXT.md §specifics` + review brief item 5) explicitly calls out "`writeSession` uses tmp + rename. Does it clean up the tmp file on failure?" — but no `writeSession` helper exists. The atomic-write invariant is documented but not implemented.

A related gap: there is no "corrupt session file" detection in the session-reuse fast path. `sessionExists()` only checks `fs.access`; it does not validate the file is non-zero-byte valid JSON.

**Fix:** Add an atomic `writeSession(cwd, fn)` helper in `session.ts` that writes via Playwright to a tmp path and renames into place, then route both callsites through it:

```ts
// session.ts
import { rename, unlink } from 'node:fs/promises';

export async function writeSessionAtomic(
  cwd: string,
  write: (tmpPath: string) => Promise<void>,
): Promise<void> {
  const final = sessionFilePath(cwd);
  const tmp = final + '.tmp-' + process.pid + '-' + Date.now();
  try {
    await write(tmp);
    await rename(tmp, final);
  } catch (err) {
    try { await unlink(tmp); } catch { /* best-effort */ }
    throw err;
  }
}

// auth/index.ts — both callsites become:
await writeSessionAtomic(cwd, (tmp) => context.storageState({ path: tmp }));
```

Additionally, in the session-reuse fast path (runner.ts:130) consider wrapping `launchBrowser({ storageState: path })` in a try/catch that deletes the corrupt file and falls back to a fresh context — converting a silent "unknown error" into graceful recovery.

## Medium

### M-01: `launchHeaded` failure after closing headless produces a cryptic, non-classified error

**File:** `src/auth/index.ts:233-253`

**Issue:** `runHeadedFallback` closes the original headless browser (line 234) and THEN calls `launchHeaded()` (line 253). If `launchHeaded()` throws (e.g., no X server, Chromium not installed with headed support, display permission error), the raw Playwright error propagates out — the runner's catch block sees no `CrawlError`, falls through to `code: 'unknown'`, and the user gets a cryptic Playwright stack with no hint that the remedy is "install a headed-capable environment" or "re-run with `RUN_NAVER_TESTS=0`".

The stderr warning (line 222-228) is printed AFTER the headed launch attempt in the current code path — but is guarded by a `try` inside which the relaunch happens. If `launchHeaded` throws, the user never sees the "⚠ Captcha/2FA detected" warning AND also gets no `CrawlError`-wrapped message explaining what step failed.

**Fix:** Wrap the headed relaunch in a try/catch that re-throws as `CrawlError('auth_failed', ...)` with a clear message:

```ts
let headed: AuthLaunchHandle;
try {
  headed = await launchHeaded(seedPath);
} catch (err) {
  const e = err as Error;
  throw new CrawlError(
    'auth_failed',
    'failed to launch headed browser for captcha resolution: ' + (e?.message ?? String(err)),
  );
}
```

### M-02: `[id*=captcha]` selector is over-broad — may hit legitimate Naver UI elements

**File:** `src/auth/detect.ts:32`

**Issue:** `CAPTCHA_SELECTORS` includes `[id*=captcha]` (substring attribute match). Any element whose id contains `captcha` anywhere — e.g., `<div id="captcha-help-link">` (an explainer link pointing to Naver's captcha FAQ), `<span id="recaptcha-disclaimer">`, or a hidden tracking div — triggers a `captcha` classification and forces a headed fallback.

The phase context explicitly called out "Captcha false POSITIVES are worse than false negatives" and asked for this to be checked. There is no test covering a page with a non-challenge element matching `[id*=captcha]`.

**Fix:** Either narrow to the known challenge IDs only, or require the element be visible:

```ts
// Option A: narrower selectors
export const CAPTCHA_SELECTORS: readonly string[] = [
  'img[src*=captcha]',
  '#captcha',
  'iframe[src*=captcha]',
  // Drop [id*=captcha] — too broad; the other three cover the real cases.
];

// Option B: require visible in probeCaptchaSelectors
const count = await page.locator(sel).filter({ hasText: /./ }).count();
// or
const visible = await page.locator(sel).first().isVisible().catch(() => false);
```

Add a test: a page where `[id*=captcha]` is present but it's a disclaimer element should NOT classify as captcha.

### M-03: Malformed/zero-byte session file is not validated before handoff to Playwright

**File:** `src/crawler/runner.ts:130-135`, `src/auth/session.ts:27-34`

**Issue:** `sessionExists` returns `true` for any readable file, including a zero-byte file or a file containing non-JSON bytes. `launchBrowser({ storageState: sessionFilePath() })` then passes the path to Playwright which throws `SyntaxError: Unexpected end of JSON input` or similar. The runner's catch maps this to `code: 'unknown'`, leaving the user with a corrupt-session-file state that will reproduce on every subsequent run until they manually `rm .crawl-session.json`.

**Fix:** Add a shape probe in `session.ts` and gate reuse on it:

```ts
// session.ts
export async function sessionLooksValid(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const raw = await readFile(sessionFilePath(cwd), 'utf8');
    if (raw.length === 0) return false;
    const parsed = JSON.parse(raw) as unknown;
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      'cookies' in parsed &&
      Array.isArray((parsed as { cookies: unknown }).cookies)
    );
  } catch {
    return false;
  }
}
```

Then in `runner.ts:130` replace `sessionExists()` with `sessionLooksValid()`. Add session tests covering the zero-byte and garbage-JSON paths.

### M-04: `ensureAuthenticated` duplicates the credential-presence check that lives in `readNaverCredentials`

**File:** `src/auth/index.ts:150-151`

**Issue:** Lines 150-151 re-implement the `typeof ... === 'string' && .length > 0` check that is already the contract of `readNaverCredentials` (naver.ts:49-59). If that contract ever changes (e.g., trimming whitespace, rejecting tab-only values), the duplicate check will drift. The header comment on `naver.ts` notes that credential reading is centralized there precisely to localize redaction behavior; duplicating the presence check here partially defeats that localization.

**Fix:** Export a boolean helper from `naver.ts` and call it from `index.ts`:

```ts
// naver.ts
export function hasNaverCredentials(env: NodeJS.ProcessEnv): boolean {
  return (
    typeof env.NAVER_ID === 'string' &&
    env.NAVER_ID.length > 0 &&
    typeof env.NAVER_PW === 'string' &&
    env.NAVER_PW.length > 0
  );
}

// index.ts (line 150-152)
if (!hasNaverCredentials(env)) { ... }
```

### M-05: Playwright error messages from `submitNaverLoginForm`'s `page.goto` / `page.click` are not passed through `scrubPaths`

**File:** `src/auth/naver.ts:100-109`

**Issue:** When the `catch` wraps the underlying error into `CrawlError('auth_failed', 'login form submission failed: ' + e.message)`, `e.message` can include absolute filesystem paths if Playwright surfaces a trace-viewer or artifact path (it sometimes does in browser-launch errors from the underlying launcher). These flow into `CrawlError.detail`, then into the envelope — and while `runner.ts:206` does scrub the message at the outer boundary, in-transit the path is unmasked and can leak via `console.error` paths, process monitors, or logging that the CLI or callers might add in Phase 4.

The review context item 10 specifically asks about this.

**Fix:** Apply `scrubPaths` at the throw site so redaction is a module-local guarantee, not dependent on the outer catch:

```ts
import { scrubPaths } from '../crawler/output';

// naver.ts:105-108
throw new CrawlError(
  'auth_failed',
  scrubPaths('login form submission failed: ' + (e?.message ?? String(err))),
);
```

Same treatment for `auth_missing_credentials` on line 54-59 (scrubbing is cheap on messages that contain no paths).

## Low

### L-01: Non-null assertions in `readNaverCredentials` bypass TS narrowing

**File:** `src/auth/naver.ts:62`

**Issue:** `return { id: id!, pw: pw! };` uses the non-null assertion operator — the value is guaranteed non-undefined by the earlier `if` branches, but TypeScript can't narrow through the `missing.push(...)` side effect. This is a known TS limitation; the assertion is safe today but defeats `strict` null checks if someone refactors the flow.

**Fix:** Use narrowed local variables that TS can track without `!`:

```ts
const id = env.NAVER_ID;
const pw = env.NAVER_PW;
if (id === undefined || id.length === 0 || pw === undefined || pw.length === 0) {
  const missing: string[] = [];
  if (id === undefined || id.length === 0) missing.push('NAVER_ID');
  if (pw === undefined || pw.length === 0) missing.push('NAVER_PW');
  throw new CrawlError(
    'auth_missing_credentials',
    'missing env var' + (missing.length === 1 ? '' : 's') + ': ' + missing.join(', '),
  );
}
// id and pw are narrowed to `string` here — no ! needed.
return { id, pw };
```

### L-02: `pollUntilLoggedIn` uses `while (now() < deadline)` — a `now` clock that doesn't advance during `sleep` loops forever on a stuck probe

**File:** `src/auth/headed.ts:83-86`

**Issue:** The loop relies on the injected `now()` to advance during `sleep(intervalMs)`. In production, `Date.now()` advances via wall clock, so the loop terminates. In tests where `sleep` is a no-op and `now` returns a constant, the loop would never terminate. The test suite happens to advance `fakeNow` inside `sleep` (headed.test.ts:83-85), but a future test that forgets this will hang the suite with no clear error.

**Fix:** Cap the iteration count as a defense-in-depth belt to the deadline suspenders:

```ts
const maxIterations = Math.ceil(timeoutMs / intervalMs) + 2;
let iter = 0;
while (now() < deadline && iter < maxIterations) {
  await sleep(intervalMs);
  if (await opts.isLoggedIn()) return;
  iter += 1;
}
```

Alternatively, document the test-injection contract explicitly in the jsdoc: "tests MUST advance `now` inside their `sleep` fake".

### L-03: `runHeadedFallback` passes `targetUrl` but never uses it (uses `void targetUrl` to silence the linter)

**File:** `src/auth/index.ts:313-315`

**Issue:** `void targetUrl;` silences TS-unused-parameter warnings. The comment says "Explicit tie-in with targetUrl for future logging (currently unused but reserved)." Reserved parameters with no current consumer are an anti-pattern; if Phase 4 adds the logging, the plumbing is trivial to add then. Currently the parameter is dead weight in the public signature.

**Fix:** Drop the parameter from `runHeadedFallback` and reintroduce it when the logging lands:

```ts
async function runHeadedFallback(
  origBrowser: Browser,
  // removed: targetUrl: string,
  opts?: AuthContextOptions,
): Promise<Page> {
  ...
}
// And update the single callsite.
```

### L-04: Test gap — no coverage for expired-session, malformed-session, or captcha selector false-positive paths

**File:** `src/auth/session.test.ts`, `src/auth/detect.test.ts`, `src/auth/index.test.ts`

**Issue:** The review brief item 8 asks "do tests actually exercise the expired-session path, the malformed-session path, and the captcha-detection false-positive path?" — none of the current test files do. The existing tests cover the happy path, the missing-both-creds path, the stale-session-with-no-creds branch, and the post-submit classification branches, but do not cover:

- A session file that contains valid Playwright JSON but whose cookies the real Naver service would reject (simulated via a post-goto redirect back to `nid.naver.com`).
- A session file that is zero bytes or contains invalid JSON (tied to M-03).
- A page where `[id*=captcha]` matches an innocuous element and URL looks normal (tied to M-02) — should classify as `unknown`, not `captcha`.

**Fix:** Add three tests in `index.test.ts`:

```ts
it('zero-byte session file → treated as absent (no crash on launch)', async () => { ... });
it('captcha selector matches an innocuous element (id="captcha-help") on a non-captcha URL → classifies as unknown', () => { ... });
it('session cookies present but post-goto redirects to nidlogin.login → re-login flow kicks in', async () => { ... });
```

---

_Reviewed: 2026-04-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
