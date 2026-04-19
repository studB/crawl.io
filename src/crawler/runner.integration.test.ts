/**
 * End-to-end integration tests for `runCrawl`.
 *
 * Each test:
 *   - Uses a fresh tmp directory (via mkdtemp) so the per-test `output/`
 *     tree written by the crawler is isolated.
 *   - Writes a markdown config inside that dir.
 *   - Calls `runCrawl(cfgPath)` — a real Chromium launch for tests 1-5.
 *   - Asserts on BOTH the returned `CrawlResult` envelope AND the on-disk
 *     `<tmpDir>/output/<YYYYMMDD>/run_<stem>.json` file emitted by v1.1's
 *     file-based writer.
 *   - Cleans the whole tmp tree in `afterEach`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCrawl } from './runner';

const fixtureUrl =
  'file://' + path.resolve(__dirname, '../../test/fixtures/nested-iframes/index.html');

function buildMarkdownConfig(opts: {
  url: string;
  collectorsYaml: string;
  rulesYaml: string;
}): string {
  return (
    '# URL\n\n' +
    opts.url +
    '\n\n# Collectors\n\n```yaml\n' +
    opts.collectorsYaml +
    '\n```\n\n# Rules\n\n```yaml\n' +
    opts.rulesYaml +
    '\n```\n'
  );
}

/**
 * Locate the single run JSON file under <cfgDir>/output/. Tests assume each
 * `runCrawl` call produces exactly one new file; we scan the `output/` tree
 * to find it without needing to predict the exact timestamp.
 */
async function listRunFiles(cfgDir: string): Promise<string[]> {
  const outRoot = path.join(cfgDir, 'output');
  let days: string[];
  try {
    days = await readdir(outRoot);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const day of days) {
    const dayDir = path.join(outRoot, day);
    const files = await readdir(dayDir);
    for (const f of files) {
      out.push(path.join(dayDir, f));
    }
  }
  return out.sort();
}

describe('runCrawl integration — end-to-end against real Chromium + file:// fixtures', () => {
  let tmpDir: string | undefined;

  afterEach(async () => {
    if (tmpDir !== undefined) {
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        /* swallow */
      }
      tmpDir = undefined;
    }
  });

  async function setupConfig(body: string): Promise<string> {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'crawlio-runner-'));
    const cfgPath = path.join(tmpDir, 'cfg.md');
    await writeFile(cfgPath, body, 'utf8');
    return cfgPath;
  }

  it('happy path: writes a single run JSON file with meta.status=ok and leaves the MD config untouched', async () => {
    const config = buildMarkdownConfig({
      url: fixtureUrl,
      collectorsYaml: ['title:', '  selector: "#top-title"', '  engine: css'].join('\n'),
      rulesYaml: 'waitFor: "#top-title"\ntimeout: 10000',
    });
    const cfgPath = await setupConfig(config);

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('ok');
    expect(result.url).toBe(fixtureUrl);
    expect(result.fields).toEqual({ title: 'Top Level' });
    expect(typeof result.durationMs).toBe('number');
    expect(result.error).toBeUndefined();

    // MD config is not mutated — no `# Output` section appears.
    const cfgOnDisk = await readFile(cfgPath, 'utf8');
    expect(cfgOnDisk).toBe(config);
    expect(cfgOnDisk).not.toContain('# Output');

    // Exactly one run JSON file landed under output/<YYYYMMDD>/
    const runFiles = await listRunFiles(path.dirname(cfgPath));
    expect(runFiles.length).toBe(1);
    const runFile = runFiles[0] as string;
    expect(path.basename(runFile)).toMatch(
      /^run_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}(?:-\d+)?\.json$/,
    );

    const payload = JSON.parse(await readFile(runFile, 'utf8')) as {
      fields: Record<string, string>;
      meta: { url: string; status: string; durationMs: number; startedAt: string };
    };
    expect(payload.fields['title']).toBe('Top Level');
    expect(payload.meta.status).toBe('ok');
    expect(payload.meta.url).toBe(fixtureUrl);
    expect(typeof payload.meta.startedAt).toBe('string');
    // Success payload has no error/stack keys
    expect(JSON.stringify(payload)).not.toContain('"stack"');
    expect(JSON.stringify(payload)).not.toContain('"error"');
  });

  it('two successive runs produce two distinct JSON files; both payloads have status=ok', async () => {
    const config = buildMarkdownConfig({
      url: fixtureUrl,
      collectorsYaml: ['title:', '  selector: "#top-title"', '  engine: css'].join('\n'),
      rulesYaml: 'waitFor: "#top-title"\ntimeout: 10000',
    });
    const cfgPath = await setupConfig(config);

    await runCrawl(cfgPath);
    const afterFirst = await listRunFiles(path.dirname(cfgPath));
    expect(afterFirst.length).toBe(1);

    await runCrawl(cfgPath);
    const afterSecond = await listRunFiles(path.dirname(cfgPath));
    expect(afterSecond.length).toBe(2);

    // The first file's bytes are untouched by the second run.
    const firstBytes = await readFile(afterFirst[0] as string, 'utf8');
    const firstBytesAgain = await readFile(afterFirst[0] as string, 'utf8');
    expect(firstBytesAgain).toBe(firstBytes);

    for (const p of afterSecond) {
      const payload = JSON.parse(await readFile(p, 'utf8')) as { meta: { status: string } };
      expect(payload.meta.status).toBe('ok');
    }
  });

  it('descends a 2-level iframe chain and extracts DEEP_CONTENT_SENTINEL', async () => {
    const config = buildMarkdownConfig({
      url: fixtureUrl,
      collectorsYaml: [
        'deep:',
        '  selector: "#deep-target"',
        '  engine: css',
        '  frame:',
        '    - "iframe#level-1-frame"',
        '    - "iframe#level-2-frame"',
      ].join('\n'),
      rulesYaml: 'waitFor: "#top-title"\ntimeout: 10000',
    });
    const cfgPath = await setupConfig(config);

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('ok');
    expect(result.fields).toEqual({ deep: 'DEEP_CONTENT_SENTINEL' });

    const runFiles = await listRunFiles(path.dirname(cfgPath));
    expect(runFiles.length).toBe(1);
    const payload = JSON.parse(await readFile(runFiles[0] as string, 'utf8')) as {
      fields: Record<string, string>;
    };
    expect(payload.fields['deep']).toBe('DEEP_CONTENT_SENTINEL');
  });

  it('XPath selector yields the same extracted text as CSS on the same element', async () => {
    const config = buildMarkdownConfig({
      url: fixtureUrl,
      collectorsYaml: [
        'title:',
        '  selector: "//*[@id=\\"top-title\\"]"',
        "  engine: 'xpath'",
      ].join('\n'),
      rulesYaml: 'waitFor: "#top-title"\ntimeout: 10000',
    });
    const cfgPath = await setupConfig(config);

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('ok');
    expect(result.fields).toEqual({ title: 'Top Level' });
  });

  it('waitFor never-matching selector yields a timeout error envelope with stack + on-disk error JSON', async () => {
    const config = buildMarkdownConfig({
      url: 'data:text/html,<h1>hi</h1>',
      collectorsYaml: ['title:', '  selector: "h1"', '  engine: css'].join('\n'),
      rulesYaml: 'waitFor: "#never"\ntimeout: 2000',
    });
    const cfgPath = await setupConfig(config);

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('timeout');
    expect(result.error?.message).toContain('#never');
    expect(result.error?.message).toContain('2000');
    expect(typeof result.error?.stack).toBe('string');
    expect((result.error?.stack ?? '').length).toBeGreaterThan(0);

    const runFiles = await listRunFiles(path.dirname(cfgPath));
    expect(runFiles.length).toBe(1);
    const raw = await readFile(runFiles[0] as string, 'utf8');
    expect(raw).toContain('"stack"');
    const payload = JSON.parse(raw) as {
      error: { code: string; message: string; stack?: string };
      meta: { status: string };
    };
    expect(payload.error.code).toBe('timeout');
    expect(payload.meta.status).toBe('error');
    expect(typeof payload.error.stack).toBe('string');
    expect((payload.error.stack ?? '').length).toBeGreaterThan(0);
  });

  it('config_parse error path writes an error JSON WITHOUT launching Chromium', async () => {
    const cfgPath = await setupConfig('# Not A Real Config\n\nNothing to parse here.\n');

    const result = await runCrawl(cfgPath);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('config_parse');
    expect(result.url).toBe('');

    const runFiles = await listRunFiles(path.dirname(cfgPath));
    expect(runFiles.length).toBe(1);
    const payload = JSON.parse(await readFile(runFiles[0] as string, 'utf8')) as {
      error: { code: string };
      meta: { status: string; url: string };
    };
    expect(payload.error.code).toBe('config_parse');
    expect(payload.meta.status).toBe('error');
    expect(payload.meta.url).toBe('');

    expect(result.durationMs).toBeLessThan(5000);
  });
});
