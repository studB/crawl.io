import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseConfig, parseConfigFile } from './parser';
import { ConfigParseError } from './errors';
import type { CrawlJob } from './types';

/**
 * Helper: build a well-formed config markdown string from individual pieces.
 * Any piece passed as `null` is omitted entirely (so we can exercise
 * missing-section paths).
 */
function buildConfig(parts: {
  url?: string | null;
  collectorsYaml?: string | null;
  actionsYaml?: string | null;
  rulesYaml?: string | null;
  outputBlock?: string | null;
  extraSection?: string | null;
  urlHeading?: string;
  collectorsHeading?: string;
  actionsHeading?: string;
  rulesHeading?: string;
  collectorsProse?: string;
  yamlLang?: string; // 'yaml' or 'yml'
}): string {
  const urlHeading = parts.urlHeading ?? '# URL';
  const collectorsHeading = parts.collectorsHeading ?? '# Collectors';
  const actionsHeading = parts.actionsHeading ?? '# Actions';
  const rulesHeading = parts.rulesHeading ?? '# Rules';
  const lang = parts.yamlLang ?? 'yaml';
  const sections: string[] = [];

  if (parts.url !== null) {
    const urlBody = parts.url === undefined ? 'https://cafe.naver.com/example/article/123' : parts.url;
    sections.push(`${urlHeading}\n\n${urlBody}`);
  }
  // Default: include collectors (backward-compat for every pre-existing test).
  // Tests wanting an Actions-only job pass `collectorsYaml: null` and populate
  // `actionsYaml` explicitly.
  if (parts.collectorsYaml !== null && !(parts.actionsYaml !== null && parts.actionsYaml !== undefined && parts.collectorsYaml === undefined)) {
    const body =
      parts.collectorsYaml ??
      [
        'title:',
        '  selector: h1.title',
        'body:',
        "  selector: \"//div[@id='main']\"",
        '  engine: xpath',
        'author:',
        '  selector: span.author',
        '  frame:',
        '    - iframe#cafe_main',
      ].join('\n');
    const prose = parts.collectorsProse ? `${parts.collectorsProse}\n\n` : '';
    sections.push(`${collectorsHeading}\n\n${prose}\`\`\`${lang}\n${body}\n\`\`\``);
  }
  if (parts.actionsYaml !== null && parts.actionsYaml !== undefined) {
    sections.push(`${actionsHeading}\n\n\`\`\`${lang}\n${parts.actionsYaml}\n\`\`\``);
  }
  if (parts.rulesYaml !== null) {
    const body = parts.rulesYaml ?? 'waitFor: h1.title\ntimeout: 15000';
    sections.push(`${rulesHeading}\n\n\`\`\`${lang}\n${body}\n\`\`\``);
  }
  if (parts.outputBlock !== null && parts.outputBlock !== undefined) {
    sections.push(`# Output\n\n${parts.outputBlock}`);
  }
  if (parts.extraSection) {
    sections.push(parts.extraSection);
  }
  return sections.join('\n\n') + '\n';
}

function catchConfigError(fn: () => unknown): ConfigParseError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigParseError) return e;
    throw new Error(`Expected ConfigParseError, got: ${(e as Error).constructor.name}`);
  }
  throw new Error('Expected ConfigParseError, got no throw');
}

describe('parseConfig — success', () => {
  it('parses a full well-formed config (URL + Collectors + Rules + Output) into CrawlJob', () => {
    const md = buildConfig({
      outputBlock: '<!-- Phase 2 appends here -->\n\n```json\n{"prior":"run"}\n```',
    });
    const job: CrawlJob = parseConfig(md);
    expect(job.url).toBe('https://cafe.naver.com/example/article/123');
    expect(Object.keys(job.collectors!).sort()).toEqual(['author', 'body', 'title']);
    expect(job.rules.timeout).toBe(15000);
    expect('waitFor' in job.rules).toBe(true);
    expect(job.rules.waitFor).toBe('h1.title');
    // Nothing from the Output section leaks through. Actions must be absent
    // (XOR with collectors) and Output section content must not appear.
    expect('actions' in job).toBe(false);
    expect(Object.keys(job).sort()).toEqual(['collectors', 'rules', 'url']);
  });

  it('engine: xpath round-trips as engine === "xpath" (CFG-03)', () => {
    const md = buildConfig({
      collectorsYaml: ['body:', "  selector: \"//div[@id='main']\"", '  engine: xpath'].join('\n'),
    });
    const job = parseConfig(md);
    expect(job.collectors!.body?.engine).toBe('xpath');
    expect(job.collectors!.body?.selector).toBe("//div[@id='main']");
  });

  it('frame array round-trips as string[] with length >= 2 (CFG-04)', () => {
    const md = buildConfig({
      collectorsYaml: [
        'author:',
        '  selector: span.name',
        '  frame:',
        '    - iframe#outer',
        '    - iframe#inner',
      ].join('\n'),
    });
    const job = parseConfig(md);
    expect(job.collectors!.author?.frame).toEqual(['iframe#outer', 'iframe#inner']);
    expect(job.collectors!.author?.frame?.length).toBe(2);
  });

  it('engine defaults to "css" when omitted', () => {
    const md = buildConfig({
      collectorsYaml: ['title:', '  selector: h1.title'].join('\n'),
    });
    const job = parseConfig(md);
    expect(job.collectors!.title?.engine).toBe('css');
  });

  it('rules.timeout defaults to 30000 when omitted (CFG-05)', () => {
    const md = buildConfig({ rulesYaml: 'waitFor: h1' });
    const job = parseConfig(md);
    expect(job.rules.timeout).toBe(30000);
  });

  it('omits rules.waitFor key entirely when the YAML does not supply it (exactOptionalPropertyTypes)', () => {
    const md = buildConfig({ rulesYaml: 'timeout: 5000' });
    const job = parseConfig(md);
    expect('waitFor' in job.rules).toBe(false);
    expect(job.rules.timeout).toBe(5000);
  });

  it('prose around the yaml block inside # Collectors is ignored (D-02)', () => {
    const md = buildConfig({
      collectorsProse:
        'Some explanatory prose that should be ignored.\nEven multiple lines.\nAnd a trailing comment line.',
    });
    const job = parseConfig(md);
    expect(Object.keys(job.collectors!).length).toBeGreaterThan(0);
  });

  it('ignores an unknown top-level `# Notes` section silently', () => {
    const md = buildConfig({
      extraSection: '# Notes\n\nJust some freeform prose the user wanted to keep.',
    });
    const job = parseConfig(md);
    expect(job.url).toBe('https://cafe.naver.com/example/article/123');
  });

  it('tolerates lowercase heading casing: `# url` still matches', () => {
    const md = buildConfig({
      urlHeading: '# url',
      collectorsHeading: '# collectors',
      rulesHeading: '# rules',
    });
    const job = parseConfig(md);
    expect(job.url).toBe('https://cafe.naver.com/example/article/123');
  });

  it('accepts `yml` lang tag in fenced code blocks as an alias of yaml', () => {
    const md = buildConfig({ yamlLang: 'yml' });
    const job = parseConfig(md);
    expect(job.url).toBeTruthy();
    expect(Object.keys(job.collectors!).length).toBeGreaterThan(0);
  });

  it('accepts URL written as a list item (MR-03)', () => {
    const base = buildConfig({ url: null });
    const withList = base.replace('# Collectors', '# URL\n\n- https://ex.test\n\n# Collectors');
    const job = parseConfig(withList);
    expect(job.url).toBe('https://ex.test');
  });

  it('accepts URL written inside a blockquote (MR-03)', () => {
    const base = buildConfig({ url: null });
    const withQuote = base.replace('# Collectors', '# URL\n\n> https://ex.test\n\n# Collectors');
    const job = parseConfig(withQuote);
    expect(job.url).toBe('https://ex.test');
  });

  it('accepts URL inside a fenced code block (MR-03)', () => {
    const base = buildConfig({ url: null });
    const withCode = base.replace(
      '# Collectors',
      '# URL\n\n```\nhttps://ex.test\n```\n\n# Collectors',
    );
    const job = parseConfig(withCode);
    expect(job.url).toBe('https://ex.test');
  });

  it('Output section can be arbitrary / malformed without affecting parsing (D-03)', () => {
    const md = buildConfig({
      outputBlock: 'this is intentionally not a valid yaml\n```not-yaml\n{{{ broken\n```',
    });
    const job = parseConfig(md);
    expect(job.url).toBe('https://cafe.naver.com/example/article/123');
  });
});

describe('parseConfig — errors', () => {
  it('throws ConfigParseError (not a generic Error) on missing URL section', () => {
    const md = buildConfig({ url: null });
    expect(() => parseConfig(md)).toThrowError(ConfigParseError);
  });

  it('missing `# URL` section produces EXACTLY ONE url-related issue (no duplicate Zod "url: Required")', () => {
    const md = buildConfig({ url: null });
    const err = catchConfigError(() => parseConfig(md));
    const urlIssues = err.issues.filter((m) => /url/i.test(m));
    // Exactly one structural URL issue, no derivative Zod "url: Required"/"url: invalid URL".
    expect(urlIssues.length).toBe(1);
    expect(urlIssues[0]).toMatch(/url/i);
    expect(urlIssues[0]).toMatch(/missing|required/i);
  });

  it('`# URL` present but empty reports an empty-URL structural issue', () => {
    const md = buildConfig({ url: '' });
    const err = catchConfigError(() => parseConfig(md));
    const urlIssues = err.issues.filter((m) => /url/i.test(m));
    expect(urlIssues.length).toBe(1);
    expect(urlIssues[0]).toMatch(/empty/i);
  });

  it('missing BOTH `# Collectors` and `# Actions` reports a single XOR-missing structural issue', () => {
    const md = buildConfig({ collectorsYaml: null });
    const err = catchConfigError(() => parseConfig(md));
    const xorIssues = err.issues.filter((m) => /collectors/i.test(m) && /actions/i.test(m));
    expect(xorIssues.length).toBeGreaterThanOrEqual(1);
    expect(xorIssues[0]).toMatch(/either|declare/i);
  });

  it('missing `# Rules` section reports a structural issue and no duplicate Zod "rules: Required" (LR-03)', () => {
    const md = buildConfig({ rulesYaml: null });
    const err = catchConfigError(() => parseConfig(md));
    const rulesIssues = err.issues.filter((m) => /rules/i.test(m));
    expect(rulesIssues.length).toBe(1);
    expect(rulesIssues[0]).toMatch(/missing/i);
  });

  it('`# Collectors` without a fenced yaml block reports a structural "no fenced yaml block" issue', () => {
    const md =
      '# URL\n\nhttps://cafe.naver.com/x/1\n\n# Collectors\n\nprose only, no fence\n\n# Rules\n\n```yaml\ntimeout: 5000\n```\n';
    const err = catchConfigError(() => parseConfig(md));
    const collectorsIssues = err.issues.filter((m) => /collectors/i.test(m));
    expect(collectorsIssues.length).toBeGreaterThanOrEqual(1);
    expect(collectorsIssues.some((m) => /yaml/i.test(m))).toBe(true);
  });

  it('invalid YAML inside `# Collectors` surfaces the yaml parse error message', () => {
    const md = buildConfig({ collectorsYaml: '  : :\n\t--- not yaml ---\n:: broken' });
    const err = catchConfigError(() => parseConfig(md));
    const yamlIssues = err.issues.filter((m) => /collectors/i.test(m));
    expect(yamlIssues.length).toBeGreaterThanOrEqual(1);
    expect(yamlIssues[0]).toMatch(/invalid|yaml/i);
  });

  it('schema issue: engine set to "dom" produces a schema-path issue mentioning engine', () => {
    const md = buildConfig({
      collectorsYaml: ['title:', '  selector: h1', '  engine: dom'].join('\n'),
    });
    const err = catchConfigError(() => parseConfig(md));
    const engineIssue = err.issues.find((m) => /engine/i.test(m));
    expect(engineIssue).toBeDefined();
  });

  it('schema issue: frame given as a string (not array) produces a frame-path issue', () => {
    const md = buildConfig({
      collectorsYaml: ['title:', '  selector: h1', '  frame: "iframe#main"'].join('\n'),
    });
    const err = catchConfigError(() => parseConfig(md));
    const frameIssue = err.issues.find((m) => /frame/i.test(m));
    expect(frameIssue).toBeDefined();
  });

  it('unknown top-level key inside rules YAML (e.g., retries: 3) is reported (CFG-06)', () => {
    const md = buildConfig({ rulesYaml: 'timeout: 5000\nretries: 3' });
    const err = catchConfigError(() => parseConfig(md));
    const rulesIssue = err.issues.find((m) => /rules/i.test(m) || /retries/i.test(m));
    expect(rulesIssue).toBeDefined();
  });

  it('AGGREGATION: both collectors YAML AND rules YAML broken -> >= 2 issues, one per section', () => {
    const md =
      '# URL\n\nhttps://cafe.naver.com/x/1\n\n# Collectors\n\n```yaml\n  :::\n broken\n```\n\n# Rules\n\n```yaml\n: :\nnope\n```\n';
    const err = catchConfigError(() => parseConfig(md));
    expect(err.issues.length).toBeGreaterThanOrEqual(2);
    expect(err.issues.some((m) => /collectors/i.test(m))).toBe(true);
    expect(err.issues.some((m) => /rules/i.test(m))).toBe(true);
  });

  it('filePath propagation: parseConfig(bad, { filePath }) throws an error whose .filePath === the argument', () => {
    const md = buildConfig({ url: null });
    const err = catchConfigError(() => parseConfig(md, { filePath: '/tmp/x.md' }));
    expect(err.filePath).toBe('/tmp/x.md');
  });

  it('throws ConfigParseError (uses toThrowError helper for the class assertion)', () => {
    expect(() => parseConfig('')).toThrowError(ConfigParseError);
  });

  it('empty collectors map (valid YAML `{}`) produces a schema issue about at-least-one collector', () => {
    const md = buildConfig({ collectorsYaml: '{}' });
    const err = catchConfigError(() => parseConfig(md));
    expect(err.issues.some((m) => /collectors/i.test(m))).toBe(true);
  });

  it('url section present but only whitespace -> reports as empty', () => {
    const md = buildConfig({ url: '   \n   \n' });
    const err = catchConfigError(() => parseConfig(md));
    const urlIssues = err.issues.filter((m) => /url/i.test(m));
    expect(urlIssues.length).toBe(1);
    expect(urlIssues[0]).toMatch(/empty/i);
  });

  it('duplicate `# URL` headings are flagged (first-wins) with a duplicate-labeled issue (MR-02)', () => {
    // Two `# URL` headings in the same file: the first wins, the duplicate
    // is reported so the user notices leftover / pasted sections.
    const md =
      '# URL\n\nhttps://cafe.naver.com/first/1\n\n# URL\n\nhttps://cafe.naver.com/second/2\n\n# Collectors\n\n```yaml\ntitle:\n  selector: h1\n```\n\n# Rules\n\n```yaml\ntimeout: 5000\n```\n';
    const err = catchConfigError(() => parseConfig(md));
    const dupIssue = err.issues.find((m) => /duplicate/i.test(m) && /url/i.test(m));
    expect(dupIssue).toBeDefined();
  });

  it('missing `# URL` produces exactly one url-tagged "missing" issue — tagged-dedup not substring-dedup (MR-04)', () => {
    // Guards against regression to substring-based dedup: the new
    // tagged-dedup path emits exactly one url-bearing issue whose wording
    // is the "missing" diagnostic (not accidentally suppressed by some
    // other section's error that mentions "url").
    const md = buildConfig({ url: null });
    const err = catchConfigError(() => parseConfig(md));
    const urlIssues = err.issues.filter((m) => /url/i.test(m));
    expect(urlIssues.length).toBe(1);
    expect(urlIssues[0]).toMatch(/missing/i);
  });

  it('YAML anchor host key (`_base`) is rejected as a selector name (MR-01)', () => {
    // `_base` is a real YAML anchor template pattern: `_base: &b ...` then
    // `title: *b`. The anchor host should not leak into the selectors map;
    // the schema rejects any selector name starting with `_`.
    const md = buildConfig({
      collectorsYaml: [
        '_base: &b',
        '  selector: h1',
        'title: *b',
      ].join('\n'),
    });
    const err = catchConfigError(() => parseConfig(md));
    const anchorIssue = err.issues.find((m) => /_/.test(m) && /collector/i.test(m));
    expect(anchorIssue).toBeDefined();
    expect(anchorIssue).toMatch(/_/);
  });
});

describe('parseConfigFile', () => {
  it('happy path: reads a valid config file and returns a CrawlJob', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawl-io-parser-'));
    const file = join(dir, 'job.md');
    try {
      await writeFile(file, buildConfig({}), 'utf8');
      const job = await parseConfigFile(file);
      expect(job.url).toBe('https://cafe.naver.com/example/article/123');
      expect(Object.keys(job.collectors!).length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects with ConfigParseError when the file does not exist, preserving filePath', async () => {
    const missing = '/does/not/exist.md';
    await expect(parseConfigFile(missing)).rejects.toBeInstanceOf(ConfigParseError);
    try {
      await parseConfigFile(missing);
    } catch (e) {
      const err = e as ConfigParseError;
      expect(err.filePath).toBe(missing);
      expect(err.issues[0]).toMatch(/read|ENOENT/i);
    }
  });

  it('propagates parseConfig errors with filePath populated when the file is malformed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawl-io-parser-'));
    const file = join(dir, 'bad.md');
    try {
      await writeFile(file, buildConfig({ url: null }), 'utf8');
      await expect(parseConfigFile(file)).rejects.toBeInstanceOf(ConfigParseError);
      try {
        await parseConfigFile(file);
      } catch (e) {
        const err = e as ConfigParseError;
        expect(err.filePath).toBe(file);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('parseConfig — actions + XOR', () => {
  it('parses an Actions-only job (no Collectors) into job.actions and leaves collectors absent', () => {
    const md = buildConfig({
      collectorsYaml: null,
      actionsYaml: [
        '- action: type',
        '  selector: textarea.comment',
        '  value: "hello"',
        '- action: click',
        '  selector: button.submit',
      ].join('\n'),
      rulesYaml: 'timeout: 10000',
    });
    const job = parseConfig(md);
    expect(job.actions).toBeDefined();
    expect(job.actions?.length).toBe(2);
    expect(job.actions?.[0]?.action).toBe('type');
    expect(job.actions?.[1]?.action).toBe('click');
    expect('collectors' in job).toBe(false);
  });

  it('rejects a job that declares BOTH Collectors and Actions (XOR violation)', () => {
    // Explicitly pass BOTH sections — the helper defaults to dropping
    // collectors when actions is set, so we force-inclusion here.
    const md = buildConfig({
      collectorsYaml: 'title:\n  selector: h1',
      actionsYaml: '- action: click\n  selector: button',
      rulesYaml: 'timeout: 10000',
    });
    const err = catchConfigError(() => parseConfig(md));
    const xorIssues = err.issues.filter((m) => /collectors/i.test(m) && /actions/i.test(m));
    expect(xorIssues.length).toBeGreaterThanOrEqual(1);
    expect(xorIssues[0]).toMatch(/not both|EITHER/i);
  });

  it('Action step with unknown `action` discriminator value surfaces a schema issue', () => {
    const md = buildConfig({
      collectorsYaml: null,
      actionsYaml: '- action: teleport\n  selector: anywhere',
      rulesYaml: 'timeout: 5000',
    });
    const err = catchConfigError(() => parseConfig(md));
    const actionIssue = err.issues.find((m) => /action/i.test(m));
    expect(actionIssue).toBeDefined();
  });

  it('type action without `value` field produces a schema issue', () => {
    const md = buildConfig({
      collectorsYaml: null,
      actionsYaml: '- action: type\n  selector: textarea',
      rulesYaml: 'timeout: 5000',
    });
    const err = catchConfigError(() => parseConfig(md));
    const valueIssue = err.issues.find((m) => /value/i.test(m));
    expect(valueIssue).toBeDefined();
  });

  it('goto action with an invalid URL surfaces a schema issue', () => {
    const md = buildConfig({
      collectorsYaml: null,
      actionsYaml: '- action: goto\n  url: not-a-url',
      rulesYaml: 'timeout: 5000',
    });
    const err = catchConfigError(() => parseConfig(md));
    expect(err.issues.some((m) => /url/i.test(m))).toBe(true);
  });
});

describe('parser module invariants', () => {
  it('parseConfig is a synchronous Function (NOT an AsyncFunction)', () => {
    // Locks D-08: parseConfig must remain sync. If a future edit converts it to
    // `async function parseConfig(...)` this test fails immediately.
    expect(parseConfig.constructor.name).toBe('Function');
    expect(parseConfig.constructor.name).not.toBe('AsyncFunction');
  });

  it('parseConfigFile is an AsyncFunction (its signature returns a Promise)', () => {
    expect(parseConfigFile.constructor.name).toBe('AsyncFunction');
  });

  it('parser source does not import playwright / puppeteer / chromium (parser must not launch a browser)', () => {
    // CFG-06 "clear error before any browser" is implicit if Phase 1's parser
    // source never imports browser libs. Phase 2 legitimately adds playwright
    // to prod deps (for src/crawler/*), so this test no longer guards
    // package.json — it guards the actual parser source file against
    // accidentally pulling a browser in.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('node:path') as typeof import('node:path');
    const parserSrc = fs.readFileSync(
      path.resolve(__dirname, 'parser.ts'),
      'utf8',
    );
    expect(parserSrc).not.toMatch(/from\s+['"]playwright['"]/);
    expect(parserSrc).not.toMatch(/require\(['"]playwright['"]\)/);
    expect(parserSrc).not.toMatch(/from\s+['"]puppeteer['"]/);
    expect(parserSrc).not.toMatch(/require\(['"]puppeteer['"]\)/);
    expect(parserSrc).not.toMatch(/from\s+['"]chromium['"]/);
  });
});
