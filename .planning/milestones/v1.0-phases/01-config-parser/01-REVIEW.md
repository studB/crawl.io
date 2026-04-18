---
phase: 01-config-parser
depth: standard
status: findings
reviewed: 2026-04-18T10:40:00Z
file_count: 11
files_reviewed_list:
  - src/config/types.ts
  - src/config/schema.ts
  - src/config/errors.ts
  - src/config/parser.ts
  - src/config/index.ts
  - src/index.ts
  - src/config/schema.test.ts
  - src/config/errors.test.ts
  - src/config/parser.test.ts
  - package.json
  - tsconfig.json
finding_count: 9
blocker_count: 0
high_count: 0
medium_count: 4
low_count: 5
---

# Phase 01 (Config Parser) — Code Review

**Reviewed:** 2026-04-18
**Depth:** standard
**Files Reviewed:** 11
**Status:** findings (no blockers; 4 medium, 5 low)

## Summary

The Phase 1 config parser is solidly engineered. Typecheck passes under `strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes`, all 56 tests pass, and the key design invariants are enforced at runtime (sync `parseConfig`, `canValidate` gate suppresses duplicate Zod issues, `ConfigParseError` aggregates every issue, CJS interop with `unified@9`/`remark-parse@9` works with the static imports as written). I found zero blockers and zero high-severity issues.

The findings below are UX/robustness concerns and test-coverage gaps, not correctness or security bugs:

- **Medium:** silent "last-duplicate-H1-wins" behavior, YAML anchor/alias keys leak into the selectors map, non-paragraph URL positions (list, blockquote, code block) are reported as empty, and the `REQUIRED`-loop dedup uses substring matching (currently safe, but a latent footgun).
- **Low:** redundant `as Heading` casts, minor test gaps (no "missing Rules" dedup test, no `require('../../package.json')` JSON typing guard), `ConfigParseErrorOptions` is not re-exported from the barrel, and there are two pieces of dead-style plumbing (`_assertShape`, the `ParseConfigFileResult` type alias) that future maintainers may misread.

Nothing on this list blocks Phase 2. I'd recommend fixing MR-01 (anchor leakage) and MR-04 (substring dedup) opportunistically before locking the config format.

## Medium

### MR-01: YAML anchor/alias top-level keys leak into the selectors map

**File:** `src/config/parser.ts` (YAML-parse step, lines 217-221) / `src/config/schema.ts` (lines 51-60)
**Issue:** Users often factor shared selector fragments via YAML anchors, e.g.:

```yaml
_base: &b
  selector: h1
title: *b
```

The parser currently accepts this and ends up with `selectors = { _base: {...}, title: {...} }` — the anchor host becomes a real selector entry. Confirmed at runtime:

```
ANCHOR => {"url":"...","selectors":{"_base":{"selector":"h1","engine":"css"},"title":{"selector":"h1","engine":"css"}},...}
```

This is surprising behavior: from the user's mental model, `_base` is a template, not a selector. Phase 2 will then try to extract `_base` from the page.

**Fix:** Decide and document. Two clean options:

1. Reject any selector name starting with `_` in `CrawlJobSchema` (treat as reserved):
   ```ts
   selectors: z.record(z.string().min(1).regex(/^(?!_)/, 'selector names cannot start with "_"'), SelectorSpecSchema)
   ```
2. Or explicitly allow anchor-only prefix and filter `_`-prefixed keys in the schema's `.transform(...)`.

Either choice needs a test and a note in the CONTEXT/README that anchors with a reserved prefix are intended for templating only.

### MR-02: Duplicate `# URL` / `# Selectors` / `# Rules` headings silently last-wins

**File:** `src/config/parser.ts:49-78` (the section loop)
**Issue:** `splitSections` walks every H1 in order and assigns `sections.url`, `sections.selectors`, `sections.rules` unconditionally on each match. Later H1s of the same name overwrite earlier ones with no warning. Verified at runtime: a file with two `# URL` headings silently uses the second.

This is risky in a tool that edits the file back (Phase 2 appends `# Output`) because any user-level mistake (e.g., leftover template section after a paste) disappears into last-wins with no signal.

**Fix:** Detect duplicates inside the loop and push an issue:

```ts
const seen = new Set<string>();
// ...inside loop, after headingName is computed:
if (seen.has(headingName)) {
  issues.push(`duplicate \`# ${label(headingName)}\` section (only the first is used)`);
  continue;
}
seen.add(headingName);
```

…and use `continue` (or alternatively reject, locking "first-wins"). Add a test: two `# URL` headings produce a `duplicate` issue.

### MR-03: URL inside a list / blockquote / fenced code block is reported as empty

**File:** `src/config/parser.ts:109-119` (`extractFirstNonEmptyLine`)
**Issue:** The function only looks at `node.type === 'paragraph'`. Verified at runtime: URLs written as `- https://…`, `> https://…`, or inside a code fence all produce `"URL section is empty"`. Given the CLI prints `\`# URL\`` in the error, users will reasonably think their URL line wasn't seen at all — the real cause (non-paragraph markdown) won't be obvious.

The locked contract (D-02: "first non-blank line under `# URL`") doesn't forbid this, but the error message is misleading.

**Fix:** Broaden extraction to fall back to the full `collectText(body[0])` for any first child of type `paragraph | list | blockquote | code` when no paragraph-line wins, and split that collected text by lines the same way. Keep the existing tests green and add:

```ts
it('accepts URL written as a list item', () => {
  const md = buildConfig({ url: null });
  const withList = md.replace('# Selectors', '# URL\n\n- https://ex.test\n\n# Selectors');
  expect(parseConfig(withList).url).toBe('https://ex.test');
});
```

Or, if the contract is intentionally strict, improve the diagnostic to distinguish "no paragraph under `# URL`" from "empty URL line", so the user knows to unwrap the list/quote.

### MR-04: Missing-section dedup uses `includes(key)` substring matching — latent footgun

**File:** `src/config/parser.ts:83-89`
**Issue:**

```ts
for (const key of REQUIRED) {
  if (sections[key] !== undefined) continue;
  if (issues.some((m) => m.toLowerCase().includes(key))) continue;  // <-- substring
  ...
}
```

Today this is safe because all issues emitted inside `splitSections` itself (`"URL section is empty…"`, `"Selectors section has no fenced yaml code block"`, `"Rules section has no fenced yaml code block"`) only contain their own key name. But the suppressor is string-based, not key-specific: any future intra-`splitSections` message that mentions another required key would suppress the correct missing-section diagnostic. This is a maintainability landmine that the test suite does not currently cover.

**Fix:** Make the structural issues carry their origin key explicitly and dedup against that, not against string content:

```ts
type StructuralIssue = { key?: typeof REQUIRED[number]; message: string };
// splitSections returns { issues: StructuralIssue[] } and tags each push
// with its originating key ('url' for the empty-URL message, etc.).
// The REQUIRED loop then does: if (issues.some(i => i.key === key)) continue;
```

Alternatively, generate the "missing" message straight inside `splitSections` at the point you KNOW a key was not set (and simply don't emit it when you already pushed a more specific issue for that key). Add a test asserting the correct diagnostic still fires when another section's error happens to mention the missing key.

## Low

### LR-01: Redundant `as Heading` casts after `type === 'heading'` narrowing

**File:** `src/config/parser.ts:43,52`
**Issue:** After `n && n.type === 'heading'`, TypeScript narrows `n` to `Heading` via the mdast discriminated union — the `(n as Heading).depth` cast is a no-op, and likewise `children[start] as Heading` (the index is computed from a block where we already verified `depth === 1`).

**Fix:** Drop the casts:
```ts
if (n && n.type === 'heading' && n.depth === 1) { h1Indices.push(i); }
...
const heading = children[start];
if (!heading || heading.type !== 'heading') continue; // defensive; narrows automatically
```
This removes three `as` tokens, tightens type safety, and makes it obvious when types drift.

### LR-02: `parse(source) as Root` escape hatch — prefer inferred typing

**File:** `src/config/parser.ts:200`
**Issue:** `unified().use(remarkParse).parse(source) as Root` silently discards whatever type `unified` returns. Under `@types/unified`, `.parse()` returns `Node`; the cast is necessary only because the plugin's attacher type isn't inferred. This is fine today but makes it a silent point of failure if `@types/mdast` or `unified` typings change.

**Fix:** Either add a lightweight runtime assert (`if (tree.type !== 'root') throw ...`) to turn the cast into an actual narrowing, or type it via a helper:
```ts
function parseMarkdown(src: string): Root {
  const t = unified().use(remarkParse).parse(src);
  if (!t || (t as any).type !== 'root') throw new Error('remark-parse returned non-root');
  return t as Root;
}
```

### LR-03: Test gap — no dedup assertion for missing `# Rules`

**File:** `src/config/parser.test.ts` (describe `parseConfig — errors`)
**Issue:** Tests assert "no duplicate 'url: Required' Zod issue when URL section is missing" and the equivalent for Selectors, but there's no matching test for Rules. Given the `canValidate` gate is the load-bearing invariant for this phase, the third case should be locked down too.

**Fix:** Add:
```ts
it('missing `# Rules` section reports a structural issue and no duplicate Zod "rules: Required"', () => {
  const md = buildConfig({ rulesYaml: null });
  const err = catchConfigError(() => parseConfig(md));
  const rulesIssues = err.issues.filter((m) => /rules/i.test(m));
  expect(rulesIssues.length).toBe(1);
  expect(rulesIssues[0]).toMatch(/missing/i);
});
```

### LR-04: `ConfigParseErrorOptions` is not re-exported from the public barrel

**File:** `src/config/index.ts` (+ `src/index.ts`)
**Issue:** `ConfigParseError` is public surface; its constructor accepts `ConfigParseErrorOptions`, but consumers who want to construct (or subclass) the error can't name the options type from the package's public exports.

**Fix:** Add to the barrel:
```ts
// src/config/index.ts
export { ConfigParseError } from './errors';
export type { ConfigParseErrorOptions } from './errors';
```
and mirror the type re-export in `src/index.ts`. If the design decision is that consumers should not construct this error (only catch it), add a one-line comment in `errors.ts` saying so and this finding is moot.

### LR-05: Dead-style plumbing readers may misinterpret

**File:** `src/config/schema.ts:65-67` (`_assertShape` + `void _assertShape`) and `src/config/parser.ts:156-159` (`ParseConfigFileResult` alias)
**Issue:** Both are load-bearing (`_assertShape` is a compile-time contract between schema output and `CrawlJob`; `ParseConfigFileResult` is a grep-trap for the acceptance test `! grep -qE "parseConfig[^=]*Promise<CrawlJob>"`). But to a reader they look like dead code or an over-abstraction. The JSDoc on `ParseConfigFileResult` is good; the `_assertShape` / `void _assertShape` pattern has no comment explaining that the compile-time assignment IS the assertion.

**Fix:** Replace the void with a standard TS "assignability assertion" idiom that's universally understood:
```ts
// Compile-time: schema output must be assignable to CrawlJob. Drift -> tsc fail.
export type _CrawlJobSchemaOutput = z.infer<typeof CrawlJobSchema>;
type _AssertAssignable = _CrawlJobSchemaOutput extends CrawlJob ? true : never;
const _schemaMatchesType: _AssertAssignable = true;
```
and add a one-line comment above the `ParseConfigFileResult` alias saying "do not inline — protects Plan 03 grep."

Or, if the current patterns are intentional, at least prefix both with a brief comment describing the contract they're guarding, so future readers don't "refactor" them away.

## Additional Observations (non-findings)

These were checked and are clean — listing them so the next reviewer doesn't re-walk the same ground:

- **CJS interop:** `require('unified')` is a function; `require('remark-parse')` is a function with `keys=[]`. Both work as written with `unified().use(remarkParse)`. No ESM-interop trap.
- **yaml.parse safety:** `yaml` v2 defaults are safe by design (no arbitrary code execution; tags like `!!js/function` are not enabled without explicit `customTags`). No change needed.
- **Path traversal / file read:** `parseConfigFile` only reads whatever path the user passed and reports it verbatim in the error's `filePath`. That is the intended contract; no leak.
- **Hardcoded secrets / credentials:** None. Parser does not touch env, network, or storage. Matches the "no browser until Phase 2" guard test at `parser.test.ts:344-356`.
- **Dangerous functions:** No `eval`, `new Function`, `exec`, `child_process`, or dynamic `require` in Phase 1 source.
- **`exactOptionalPropertyTypes` compliance:** Both `SelectorSpecSchema.transform` and `RulesSchema.transform` correctly strip `undefined` keys rather than set them.
- **Non-null assertions:** None (`!` only appears inside regexes / strings, not as a TS operator). `as` casts are minimal (three; covered above).
- **`.gitignore`:** `.crawl-session.json` is listed (line 3) as required by the CLAUDE.md constraint. This won't be exercised until Phase 2 but is already correct.
- **`canValidate` gate:** Runtime-verified. Missing-URL → 1 URL issue, no `"url: Required"` Zod duplicate. Same for Selectors. (Rules case is not yet tested — see LR-03.)
- **Aggregation (CFG-06):** Runtime-verified. Both Selectors YAML and Rules YAML broken → both errors surface in `err.issues`.
- **Multi-document YAML (`---` inside a fenced block):** Produces a clean error via `yaml.parse`. Good.

---

_Reviewed: 2026-04-18T10:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
