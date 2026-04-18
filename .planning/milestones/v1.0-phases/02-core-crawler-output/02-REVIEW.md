---
phase: 02-core-crawler-output
depth: standard
status: findings
reviewed: 2026-04-18T05:41:35Z
file_count: 20
finding_count: 9
blocker_count: 0
high_count: 0
medium_count: 4
low_count: 5
files_reviewed_list:
  - src/crawler/types.ts
  - src/crawler/errors.ts
  - src/crawler/browser.ts
  - src/crawler/frame.ts
  - src/crawler/extract.ts
  - src/crawler/output.ts
  - src/crawler/runner.ts
  - src/crawler/index.ts
  - src/index.ts
  - src/crawler/errors.test.ts
  - src/crawler/frame.test.ts
  - src/crawler/extract.test.ts
  - src/crawler/extract.integration.test.ts
  - src/crawler/output.test.ts
  - src/crawler/runner.integration.test.ts
  - test/fixtures/nested-iframes/index.html
  - test/fixtures/nested-iframes/level-1.html
  - test/fixtures/nested-iframes/level-2.html
  - test/setup/playwright-env.ts
  - vitest.config.ts
---

# Phase 2: Code Review Report

**Reviewed:** 2026-04-18T05:41:35Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** findings

## Summary

Phase 2 delivers a coherent, well-layered crawler: `runner.ts` cleanly composes `browser`, `frame`, `extract`, and `output` with a single public surface (`runCrawl`, `CrawlError`, `CrawlResult`, `CrawlErrorCode`). Must-haves from 02-CONTEXT.md are honored: the `finalize` closure funnels every return through a single write path, the browser is torn down in `finally` with swallowed errors, `rules.timeout` is applied to BOTH `page.goto` and `waitForReady`, the `frame_not_found` classification lives only in `extract.ts`, and `renderEntry` emits conditional `stack` via spread to satisfy `exactOptionalPropertyTypes`. TypeScript strict flags are respected throughout — no `any`, no non-null assertions, no index-access shortcuts. Tests cover the headline CRWL requirements (2-level iframe descent, CSS/XPath parity, timeout error mapping, config_parse bypass, two-run append idempotence).

No blockers or high-severity issues. Four medium-severity concerns relate to robustness of the markdown writeback layer (CRLF mixing, false-positive `# Output` detection inside fenced code blocks, same-file concurrent-run race, and user-facing absolute-path leakage via serialized stack / issue strings). Five low-severity notes cover test-file type-safety casts, minor consistency improvements, and documentation gaps.

## Medium Issues

### MD-01: Mixed line endings after writeback on CRLF config files

**File:** `src/crawler/output.ts:95-102` (`appendOutput`)
**Category:** Bug / Code Quality
**Issue:** `source.endsWith('\n')` returns `true` for a file that ends with `\r\n`, but the appended entry is built with `\n` separators only (see the H2/italic/fence builder in `renderEntry`). A config file authored on Windows (or with a `.gitattributes` `eol=crlf` setting) will end up with mixed `\r\n` in the preserved config section and `\n` in every appended run entry. This violates the "preserve config sections byte-for-byte" contract the first time, and silently produces a two-encoding file on subsequent runs.

**Fix:** Detect the source's newline style once and thread it through `appendOutput` / `renderEntry`. Minimal patch in `appendOutput`:

```ts
export function appendOutput(source: string, entry: string): string {
  const nl = source.includes('\r\n') ? '\r\n' : '\n';
  const src = source.endsWith(nl) ? source : source + nl;
  const normEntry = nl === '\r\n' ? entry.replace(/\n/g, '\r\n') : entry;
  const hasOutputHeader = /^# Output\s*$/im.test(src);
  if (hasOutputHeader) return src + nl + normEntry;
  return src + nl + '# Output' + nl + nl + normEntry;
}
```

Alternatively, normalize the source to `\n` on read and document it — but that breaks byte-for-byte preservation.

### MD-02: `# Output` header detector has false positives inside fenced code blocks

**File:** `src/crawler/output.ts:97` (`hasOutputHeader`)
**Category:** Bug
**Issue:** `/^# Output\s*$/im.test(src)` matches any line that is literally `# Output`, regardless of whether the line is inside a fenced code block (e.g., a user documenting the format itself). A config whose selectors YAML or free-form narrative contains an illustrative ` ```markdown\n# Output\n``` ` will make `appendOutput` skip the header-creation step, and subsequent runs will write entries with no owning `# Output` H1 preceding them on disk. The comment at the top of `output.ts` explicitly calls out this risk ("# Output is the last H1"), but the implementation doesn't defend against it.

**Fix:** Parse fenced code-block ranges before testing. A simple approach — ignore lines that fall between unescaped ` ``` ` fences:

```ts
function hasOutputHeaderOutsideFences(src: string): boolean {
  let inFence = false;
  for (const line of src.split(/\r?\n/)) {
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (!inFence && /^# Output\s*$/i.test(line)) return true;
  }
  return false;
}
```

Acceptable alternative: document the limitation as a constraint of the config format (user must not include a literal `# Output` line anywhere in their config body) and add a Phase 1 validation to reject such configs early.

### MD-03: Concurrent `runCrawl` on the same config path races on readback/writeback

**File:** `src/crawler/output.ts:110-114` (`writeOutputToFile`) and `src/crawler/runner.ts:60-165` (`runCrawl` finalize)
**Category:** Bug / Concurrency
**Issue:** `writeOutputToFile` does `readFile` → `appendOutput` → `writeFile`. Two `runCrawl` invocations targeting the SAME `configPath` that complete nearly simultaneously will each read the pre-run source, each append their own entry, and the later `writeFile` will clobber the earlier one — one run's entry is silently lost. The review_context called this out explicitly as a concern to evaluate. The current code has no locking, no file-lock fd, and no append-only fs primitive.

The review_context's question "two runCrawl calls in parallel on different config paths — do they interfere?" — answer: no, those are independent. But on the same path, yes.

**Fix:** Document the single-writer-per-file invariant in `runCrawl`'s JSDoc (simplest), or adopt an atomic append pattern. For v1, a documentation fix is acceptable given that the typical invocation is one-shot from a CLI; but the JSDoc on `runCrawl` currently promises "ALWAYS writes a run entry before returning" without qualification, which is a stronger claim than the implementation can guarantee under concurrent calls.

Suggested doc patch in `runner.ts`:

```ts
/**
 * ...
 * 9. Concurrency: runCrawl is safe to call in parallel on DIFFERENT config
 *    paths (each run owns its own browser). Parallel calls on the SAME path
 *    are NOT safe — the readFile→writeFile append is non-atomic and the
 *    later writer will clobber the earlier run's entry. Callers that need
 *    per-file parallelism must serialize their own invocations.
 */
```

### MD-04: Error stack / ConfigParseError issues are rendered into user-facing markdown verbatim

**File:** `src/crawler/runner.ts:104, 111, 152` and `src/crawler/output.ts:46-80` (`renderEntry` error branch)
**Category:** Security / Information Disclosure
**Issue:** When an error occurs, `runCrawl` populates `error.stack` from `(err as Error)?.stack`, and for `ConfigParseError` the `message` is built from `err.issues.join('; ')`. Both of these can contain absolute filesystem paths (`at parseConfigFile (/home/jane/projects/secret-project/src/…)` in a V8 stack, or `filePath: /Users/corp/…` in an issue string). These strings are then serialized into the `# Output` section of the user's markdown file, which is typically checked into git alongside the config. This leaks:

  - The user's home-directory structure and username.
  - Internal project directory names that may themselves be confidential.
  - `node_modules` paths that expose dependency versions to anyone who reads the committed markdown.

This is low-probability-of-exploit but breaks the "markdown file carries its own results" promise in an adversarial or shared-repo setting.

**Fix:** Redact absolute paths before serializing the `stack` string. Minimal patch in `renderEntry` (or in the `errorPayload` helper in runner.ts):

```ts
function redactStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;
  // Collapse absolute paths to a basename-only form.
  return stack
    .replace(/(?:\/[^\s:()]+)+\/([^\s:()/]+):(\d+):(\d+)/g, '.../$1:$2:$3')
    .replace(process.cwd(), '<cwd>');
}
```

Acceptable alternative: make `stack` inclusion opt-in via a config flag (`rules.includeStack: true`) and default to omitting it. The `CrawlResult` type keeps `stack?: string` either way.

## Low Issues

### LW-01: `runner.ts` uses `return finalize(...)` in two paths and `return await finalize(...)` in two others

**File:** `src/crawler/runner.ts:101, 108` (non-await) vs `145, 159` (await)
**Category:** Code Quality / Consistency
**Issue:** Inside an `async` function, `return promise` and `return await promise` are behaviorally equivalent for the final resolved value, but `return await` additionally lets a `try/catch` in the same function catch rejections from the awaited promise. In the config-parse error branches (lines 101, 108) there is no surrounding `try`, so the difference is moot — but the inconsistency is a small reader-hostile signal. Future refactors that wrap `runCrawl` in an outer try/catch will surprise anyone who expects identical handling across return sites.

**Fix:** Use `return await finalize(...)` in all four sites for uniformity.

### LW-02: `extract.ts` per-field timeout is a hardcoded 5000ms constant

**File:** `src/crawler/extract.ts:29` (`EXTRACT_TIMEOUT_MS`)
**Category:** Code Quality / Magic Number
**Issue:** The 5-second per-field cap is documented as "a rendered page should return text in well under a second," but it's not configurable and it's not derived from `rules.timeout`. On a slow target (Naver Cafe under load, or a nested iframe that hydrates just after `waitFor` fires), this cap can produce a `selector_miss` / `frame_not_found` classification where the real cause is just a slow frame. The ceiling is defensible but the magic number is not surfaced.

**Fix:** Either derive it (e.g., `Math.min(rules.timeout, 5000)` or pass a separate `rules.extractTimeout` from Phase 1 config), or at minimum export the constant so the runner's JSDoc / the Phase-3 work can reference it. Document-only fix acceptable for v1.

### LW-03: `errors.ts` uses `detail` as both readonly-declared and conditional-assigned

**File:** `src/crawler/errors.ts:5, 11-13`
**Category:** Code Quality
**Issue:** `declare readonly detail?: string` + `if (detail !== undefined) this.detail = detail;` is idiomatic for `exactOptionalPropertyTypes`, and the `errors.test.ts` "property not in instance when detail omitted" test pins the behavior. But the `declare` keyword suppresses the emit — a reader unfamiliar with `exactOptionalPropertyTypes` may read this and assume `detail` is always present. A single-line comment explaining the pattern would help future maintainers.

**Fix:** Add a brief inline comment:

```ts
// `declare` + conditional assign omits the key entirely when detail is
// undefined — satisfies exactOptionalPropertyTypes and mirrors the
// renderEntry/errorPayload conditional-spread pattern elsewhere.
declare readonly detail?: string;
```

### LW-04: `runner.integration.test.ts` relies on `allRunIdxs[1] as number` casts that `noUncheckedIndexedAccess` would otherwise catch

**File:** `src/crawler/runner.integration.test.ts:189, 191`
**Category:** Test Quality / Type Safety
**Issue:** The expected length is asserted (`expect(allRunIdxs.length).toBe(2)`), and then the code casts the element as `number` to access it. Under `noUncheckedIndexedAccess` the element type is `number | undefined`; the cast hides a real (if unreachable) undefined. A `const [first, second] = allRunIdxs;` destructure with a non-null assertion is equally ugly but at least localizes the "I know this exists" claim. Alternatively, use `expect(allRunIdxs).toHaveLength(2)` and then `const [first, second] = allRunIdxs as [number, number]`.

**Fix:** Replace the ad-hoc casts with a single tuple cast after the length assertion:

```ts
expect(allRunIdxs).toHaveLength(2);
const [first, second] = allRunIdxs as [number, number];
expect(first).toBeLessThan(second);
```

### LW-05: `frame.test.ts` helper `as unknown as Parameters<typeof descendToFrame>[0]` is boilerplate across five tests

**File:** `src/crawler/frame.test.ts:12, 22, 33, 48, 68`
**Category:** Test Quality / DRY
**Issue:** Every test builds a fake page with `{ frameLocator } as unknown as Parameters<typeof descendToFrame>[0]`. The double-cast is unavoidable without Playwright type surgery, but it repeats five times. A tiny helper would localize the unsafe cast and document the intent:

```ts
function fakePage(frameLocator: (sel: string) => unknown): Page {
  return { frameLocator } as unknown as Page;
}
```

**Fix:** Extract the helper; non-blocking.

## Out-of-scope concerns (noted for completeness, not flagged as findings)

- **`data:`, `javascript:`, `file://` URLs accepted by `page.goto`.** Phase 1's URL validator owns the scheme allow-list; Phase 2 forwards whatever it receives. The integration tests intentionally use `file://` and `data:`, so the runner cannot reject them without a Phase-1 change.
- **Triple-backtick injection via extracted text.** Ruled safe by construction: `JSON.stringify(payload, null, 2)` escapes embedded newlines inside string values (`\n`), so a scraped field cannot produce a line whose sole contents are three backticks. `output.test.ts` Test 8 pins this.
- **Browser teardown order.** `closeBrowser` goes page → context → browser with each step wrapped in a swallowing try/catch; a partial teardown from a mid-launch crash cannot leak the Chromium process. The integration tests spawn 11 browsers across Test 1-6 + runner tests and the vitest hook timeout is 60s — if a leak existed, parallel runs would flake on Chromium lock contention. No evidence of that in the test contracts.
- **`finalize` defined inside the async function re-reads `startNs` from closure scope.** Correct; `startNs` is a `const bigint` captured once.
- **`page` is on the browser handle but the runner only uses `handle.page.goto` before extractFields(handle.page, ...).** Single-page usage is intentional per v1 (OUT-02 in the plan); parallel per-run browsers are not an issue.

---

_Reviewed: 2026-04-18T05:41:35Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
