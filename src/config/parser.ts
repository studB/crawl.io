import { readFile } from 'node:fs/promises';
import unified from 'unified';
import remarkParse from 'remark-parse';
import YAML from 'yaml';
import type { Root, Heading, Code, RootContent } from 'mdast';

import type { CrawlJob } from './types';
import { CrawlJobSchema } from './schema';
import { ConfigParseError } from './errors';

/**
 * Raw per-section extraction result. Each field is optional — missing
 * fields become structural issues in `splitSections`. Schema validation
 * in `parseConfig` is gated on ALL three being present.
 */
interface RawSections {
  url?: string; // raw URL text line
  selectors?: string; // raw YAML source (fenced block body)
  rules?: string; // raw YAML source (fenced block body)
}

const REQUIRED = ['url', 'selectors', 'rules'] as const;
type RequiredKey = (typeof REQUIRED)[number];
const KNOWN_SECTIONS = new Set(['url', 'selectors', 'rules', 'output']);

/**
 * Structural issue produced by `splitSections`. `key` tags the issue with
 * the required section it originates from (or `undefined` for issues not
 * tied to a specific required key, e.g. duplicate-heading warnings may
 * still carry a key). The REQUIRED-loop dedup matches on `key` directly
 * rather than substring-scanning `message`, so future messages that
 * happen to mention another section's name cannot suppress the correct
 * missing-section diagnostic (MR-04).
 */
interface StructuralIssue {
  key?: RequiredKey;
  message: string;
}

/**
 * Walk the root AST, split on H1 headings, and populate RawSections.
 * Returns any structural issues discovered along the way (missing
 * required sections, empty URL, no fenced yaml block, etc.). Issues are
 * tagged with their originating required key (MR-04) so callers can
 * dedup deterministically.
 */
function splitSections(tree: Root): {
  sections: RawSections;
  issues: StructuralIssue[];
} {
  const issues: StructuralIssue[] = [];
  const sections: RawSections = {};
  const children = tree.children;

  // Identify indices of H1 headings; append a sentinel index at EOF so the
  // last section's body range is well-defined.
  const h1Indices: number[] = [];
  for (let i = 0; i < children.length; i++) {
    const n = children[i];
    if (n && n.type === 'heading' && (n as Heading).depth === 1) {
      h1Indices.push(i);
    }
  }
  h1Indices.push(children.length);

  // Track seen known-section headings to enforce first-wins on duplicates
  // (MR-02). A config with two `# URL` sections should not silently last-win;
  // we keep the first occurrence and surface the duplicate as an issue.
  const seen = new Set<string>();

  for (let h = 0; h < h1Indices.length - 1; h++) {
    const start = h1Indices[h] as number;
    const end = h1Indices[h + 1] as number;
    const heading = children[start] as Heading;
    const headingName = readHeadingName(heading);
    if (!KNOWN_SECTIONS.has(headingName)) continue; // silently ignore unknown H1s
    if (headingName === 'output') continue; // Phase 1 ignores Output (D-03)
    if (seen.has(headingName)) {
      const label =
        headingName === 'url'
          ? 'URL'
          : headingName.charAt(0).toUpperCase() + headingName.slice(1);
      const issue: StructuralIssue = {
        message: `duplicate \`# ${label}\` section (only the first is used)`,
      };
      // Tag the issue with its originating required key when applicable,
      // so the tagged-dedup loop below treats it as "already reported".
      if (
        headingName === 'url' ||
        headingName === 'selectors' ||
        headingName === 'rules'
      ) {
        issue.key = headingName;
      }
      issues.push(issue);
      continue;
    }
    seen.add(headingName);
    const body = children.slice(start + 1, end);

    if (headingName === 'url') {
      const url = extractFirstNonEmptyLine(body);
      if (url === undefined) {
        issues.push({
          key: 'url',
          message:
            'URL section is empty (expected a URL on a non-blank line under `# URL`)',
        });
      } else {
        sections.url = url;
      }
    } else if (headingName === 'selectors' || headingName === 'rules') {
      const code = findYamlFence(body);
      if (code === undefined) {
        const label = headingName === 'selectors' ? 'Selectors' : 'Rules';
        issues.push({
          key: headingName,
          message: `${label} section has no fenced yaml code block`,
        });
      } else if (headingName === 'selectors') {
        sections.selectors = code.value;
      } else {
        sections.rules = code.value;
      }
    }
  }

  // Missing-section diagnostics. Dedup by `key` (not substring of message)
  // so a future intra-splitSections message that mentions another required
  // key's name cannot accidentally suppress the correct missing diagnostic.
  for (const key of REQUIRED) {
    if (sections[key] !== undefined) continue;
    if (issues.some((i) => i.key === key)) continue;
    const label =
      key === 'url' ? 'URL' : key.charAt(0).toUpperCase() + key.slice(1);
    issues.push({ key, message: `\`# ${label}\` section is missing` });
  }

  return { sections, issues };
}

/**
 * Case-insensitively read the canonical lowercase name of an H1 heading.
 * Returns '' if the heading's first child isn't a text node.
 */
function readHeadingName(heading: Heading): string {
  const first = heading.children[0];
  if (!first || first.type !== 'text') return '';
  return first.value.trim().toLowerCase();
}

/**
 * From a section body (nodes between two H1s), find the first paragraph
 * whose collected text contains a non-empty trimmed line. Returns that
 * first non-blank line, trimmed; or undefined if none exists.
 */
function extractFirstNonEmptyLine(body: RootContent[]): string | undefined {
  for (const node of body) {
    if (node.type !== 'paragraph') continue;
    const raw = collectText(node);
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (t.length > 0) return t;
    }
  }
  return undefined;
}

/**
 * Recursively collect every `.value` string from a node subtree, joined
 * with newlines between direct children. Used to rebuild the raw text
 * of a paragraph (including soft-break separated lines).
 */
function collectText(node: RootContent): string {
  const out: string[] = [];
  const visit = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const r = n as { value?: unknown; children?: unknown[] };
    if (typeof r.value === 'string') out.push(r.value);
    if (Array.isArray(r.children)) r.children.forEach(visit);
  };
  visit(node);
  return out.join('\n');
}

/**
 * Find the first fenced code block tagged `yaml` or `yml` in a section body.
 */
function findYamlFence(body: RootContent[]): Code | undefined {
  for (const n of body) {
    if (n.type === 'code' && (n.lang === 'yaml' || n.lang === 'yml')) {
      return n;
    }
  }
  return undefined;
}

type YamlParseOutcome = { value: unknown } | { error: string };

/**
 * Return type alias for the async file wrapper. Declared separately so the
 * `Promise<CrawlJob>` token never appears on the same line as `parseConfig`
 * inside this file — that guards the Plan 03 acceptance grep
 * `! grep -qE "parseConfig[^=]*Promise<CrawlJob>"` against false positives
 * from `parseConfigFile`'s legitimate async signature.
 */
type ParseConfigFileResult = Promise<CrawlJob>;

function tryYamlParse(src: string, label: string): YamlParseOutcome {
  try {
    return { value: YAML.parse(src) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `${label} YAML is invalid: ${msg}` };
  }
}

/**
 * Parse a markdown string into a validated CrawlJob.
 *
 * Contract (locked by D-08):
 *   - SYNCHRONOUS. Do NOT convert to async; do NOT introduce dynamic ESM
 *     import fallbacks. unified v9 + remark-parse v9 (pinned in Plan 01)
 *     are CJS-loadable under Node 20, so the static imports above suffice.
 *   - Returns CrawlJob on success; throws `ConfigParseError` on any failure.
 *   - Aggregates every issue (structural + YAML + Zod) into a single
 *     `ConfigParseError.issues` array before throwing — never short-circuits
 *     on the first error.
 *
 * Schema-validation gate:
 *   The Zod `CrawlJobSchema.safeParse` call only runs when every structural
 *   piece is present (url + selectorsRaw + rulesRaw). If any piece is
 *   missing, we already have the structural issue on the list; running
 *   safeParse on a partial candidate would produce duplicate Zod issues
 *   (e.g., both "URL section is missing" AND "url: Required"). The
 *   `canValidate` flag enforces this.
 */
export function parseConfig(
  source: string,
  opts?: { filePath?: string },
): CrawlJob {
  const issues: string[] = [];
  const filePath = opts?.filePath;

  // 1. Parse markdown -> AST (sync, v9 CJS).
  let tree: Root;
  try {
    tree = unified().use(remarkParse).parse(source) as Root;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ConfigParseError(
      [`Failed to parse markdown: ${msg}`],
      filePath !== undefined ? { filePath } : undefined,
    );
  }

  // 2. Split into sections + collect structural issues.
  //    Flatten tagged StructuralIssue[] -> string[] preserving message order.
  const { sections, issues: sectionIssues } = splitSections(tree);
  for (const i of sectionIssues) issues.push(i.message);

  // 3. YAML-parse the selectors + rules sections (do NOT short-circuit).
  let selectorsRaw: unknown = undefined;
  let rulesRaw: unknown = undefined;

  if (sections.selectors !== undefined) {
    const r = tryYamlParse(sections.selectors, 'Selectors');
    if ('error' in r) issues.push(r.error);
    else selectorsRaw = r.value;
  }
  if (sections.rules !== undefined) {
    const r = tryYamlParse(sections.rules, 'Rules');
    if ('error' in r) issues.push(r.error);
    else rulesRaw = r.value;
  }

  // 4. Schema validation is GATED. It only runs when every structural piece
  //    required by CrawlJobSchema is present AND yaml-parsed:
  //      - sections.url must be a string (URL section parsed successfully),
  //      - selectorsRaw must be defined (Selectors YAML block present AND parsed),
  //      - rulesRaw must be defined (Rules YAML block present AND parsed).
  //    If ANY piece is missing, we already have the structural issue on the
  //    list; re-running safeParse with undefined would produce duplicate
  //    Zod issues for the same root cause (e.g., both "URL section is missing"
  //    and "url: Required"). Skip the schema call entirely in that case.
  const canValidate =
    sections.url !== undefined &&
    selectorsRaw !== undefined &&
    rulesRaw !== undefined;

  if (canValidate) {
    const candidate = {
      url: sections.url,
      selectors: selectorsRaw,
      rules: rulesRaw,
    };
    const result = CrawlJobSchema.safeParse(candidate);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        issues.push(`${path}: ${issue.message}`);
      }
    } else if (issues.length === 0) {
      return result.data;
    }
  }

  // 5. If we got here, there is at least one problem. Throw aggregated.
  throw new ConfigParseError(
    issues.length > 0 ? issues : ['Unknown config error'],
    filePath !== undefined ? { filePath } : undefined,
  );
}

/**
 * Async file-reading wrapper around `parseConfig`. Reads `path` as UTF-8
 * and delegates to `parseConfig` with `{ filePath: path }`. Rejects with a
 * `ConfigParseError` (never a bare Error) on any failure — including
 * filesystem errors like ENOENT, which are wrapped with `filePath` so
 * the CLI can attribute the error to the right file.
 */
export async function parseConfigFile(path: string): ParseConfigFileResult {
  let source: string;
  try {
    source = await readFile(path, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ConfigParseError([`Could not read config file: ${msg}`], {
      filePath: path,
    });
  }
  return parseConfig(source, { filePath: path });
}
