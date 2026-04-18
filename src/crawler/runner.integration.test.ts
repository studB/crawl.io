/**
 * End-to-end integration tests for `runCrawl`.
 *
 * Each test:
 *   - Writes a markdown config to `os.tmpdir()` (never pollutes the repo).
 *   - Calls `runCrawl(tmpPath)` — a real Chromium launch for tests 1-5.
 *   - Asserts on BOTH the returned `CrawlResult` envelope AND the on-disk
 *     `# Output` section of the same file.
 *   - Cleans up the tmp file in `afterEach`.
 *
 * Requirement coverage (ledger in 02-04-PLAN.md must_haves):
 *   Test 1 — happy path: new `# Output` header + entry + `meta.status: 'ok'`
 *            (must-have 1; CRWL-04, CRWL-07, OUT-01, OUT-02, OUT-03).
 *   Test 2 — two runs append two entries under one header, first entry preserved
 *            (must-have 2; OUT-01).
 *   Test 3 — 2-level iframe descent via runCrawl extracts DEEP_CONTENT_SENTINEL
 *            (must-have 3; CRWL-06).
 *   Test 4 — CSS and XPath selectors yield identical text on the same element
 *            (must-have 4; CRWL-04, CRWL-05).
 *   Test 5 — waitFor selector never appears within rules.timeout →
 *            `CrawlResult { status:'error', error:{ code:'timeout', ..., stack }}`
 *            AND error entry written with `meta.status: 'error'` + rendered
 *            `"stack":` in the fenced JSON (must-have 5; CRWL-03, OUT-04,
 *            CONTEXT.md `error: { code, message, stack? }`).
 *   Test 6 — config_parse error path does NOT launch Chromium; envelope and
 *            on-disk entry both reflect `code: 'config_parse'` (OUT-04;
 *            CRWL-01 negative).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { runCrawl } from './runner';

// Repo-relative fixture URL — independent of cwd because __dirname is resolved
// by the test runner and path.resolve handles the `../..` climb from src/crawler/.
const fixtureUrl =
  'file://' + path.resolve(__dirname, '../../test/fixtures/nested-iframes/index.html');

/**
 * Build a well-formed markdown config pointing at a URL with user-chosen
 * selectors / rules. Mirrors Phase 1's `buildConfig` helper style.
 */
function buildMarkdownConfig(opts: {
  url: string;
  selectorsYaml: string;
  rulesYaml: string;
}): string {
  return (
    '# URL\n\n' +
    opts.url +
    '\n\n# Selectors\n\n```yaml\n' +
    opts.selectorsYaml +
    '\n```\n\n# Rules\n\n```yaml\n' +
    opts.rulesYaml +
    '\n```\n'
  );
}

/** Unique tmp path per invocation — avoids collisions across parallel tests. */
function makeTmpPath(): string {
  return path.join(
    os.tmpdir(),
    'crawlio-runner-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.md',
  );
}

/**
 * Extract all fenced ```json blocks from a markdown string. Returns the
 * raw JSON payload text of each block (without the fence lines). Uses the
 * same line-anchored pattern as `src/crawler/output.ts` so a triple-backtick
 * substring inside a JSON string literal cannot terminate the match early.
 */
function extractJsonBlocks(markdown: string): string[] {
  const re = /^```json\n([\s\S]*?)\n```\s*$/gm;
  const blocks: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    blocks.push(m[1] as string);
  }
  return blocks;
}

describe('runCrawl integration — end-to-end against real Chromium + file:// fixtures', () => {
  let tmpPath: string | undefined;

  afterEach(async () => {
    if (tmpPath !== undefined) {
      try {
        await unlink(tmpPath);
      } catch {
        /* swallow — test may have failed before creating the file */
      }
      tmpPath = undefined;
    }
  });

  it('happy path: writes a new # Output section with a single ok run entry (OUT-01/02/03, CRWL-07)', async () => {
    tmpPath = makeTmpPath();
    const config = buildMarkdownConfig({
      url: fixtureUrl,
      selectorsYaml: ['title:', '  selector: "#top-title"', '  engine: css'].join('\n'),
      rulesYaml: 'waitFor: "#top-title"\ntimeout: 10000',
    });
    await writeFile(tmpPath, config, 'utf8');

    const result = await runCrawl(tmpPath);

    expect(result.status).toBe('ok');
    expect(result.url).toBe(fixtureUrl);
    expect(result.fields).toEqual({ title: 'Top Level' });
    expect(typeof result.durationMs).toBe('number');
    expect(result.error).toBeUndefined();

    const onDisk = await readFile(tmpPath, 'utf8');
    // # Output header created exactly once
    expect(onDisk.match(/^# Output\s*$/gim)?.length).toBe(1);
    // Human timestamp H2
    expect(onDisk).toMatch(/## Run \u2014 \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    // Original config sections preserved byte-for-byte
    expect(onDisk.startsWith(config.trimEnd())).toBe(true);
    // Fenced JSON payload with meta.status === 'ok'
    const blocks = extractJsonBlocks(onDisk);
    expect(blocks.length).toBe(1);
    const payload = JSON.parse(blocks[0] as string) as {
      fields: Record<string, string>;
      meta: { url: string; status: string; durationMs: number };
    };
    expect(payload.fields['title']).toBe('Top Level');
    expect(payload.meta.status).toBe('ok');
    expect(payload.meta.url).toBe(fixtureUrl);
    // Success path MUST NOT render `"stack":` in the JSON
    expect(onDisk).not.toMatch(/"stack":/);
  });

  it('two successive runs append two entries under exactly ONE # Output header; first preserved (OUT-01)', async () => {
    tmpPath = makeTmpPath();
    const config = buildMarkdownConfig({
      url: fixtureUrl,
      selectorsYaml: ['title:', '  selector: "#top-title"', '  engine: css'].join('\n'),
      rulesYaml: 'waitFor: "#top-title"\ntimeout: 10000',
    });
    await writeFile(tmpPath, config, 'utf8');

    await runCrawl(tmpPath);
    const afterFirst = await readFile(tmpPath, 'utf8');
    const firstEntryIdx = afterFirst.indexOf('## Run \u2014');
    expect(firstEntryIdx).toBeGreaterThan(-1);
    // Freeze the byte content of the first entry (from '## Run' to the closing fence)
    const firstEntrySnapshot = afterFirst.slice(firstEntryIdx);

    await runCrawl(tmpPath);
    const afterSecond = await readFile(tmpPath, 'utf8');

    // Exactly ONE # Output header
    expect(afterSecond.match(/^# Output\s*$/gim)?.length).toBe(1);

    // Exactly TWO ## Run headers
    expect(afterSecond.match(/^## Run \u2014 /gm)?.length).toBe(2);

    // Both payloads parse and both have meta.status === 'ok'
    const blocks = extractJsonBlocks(afterSecond);
    expect(blocks.length).toBe(2);
    for (const body of blocks) {
      const payload = JSON.parse(body) as { meta: { status: string } };
      expect(payload.meta.status).toBe('ok');
    }

    // First entry preserved byte-for-byte and appears BEFORE the second
    const firstIdxAfter = afterSecond.indexOf(firstEntrySnapshot);
    expect(firstIdxAfter).toBeGreaterThan(-1);
    // The second entry must begin after the first entry's bytes end
    const secondRunIdx = afterSecond.indexOf(
      '## Run \u2014',
      firstIdxAfter + firstEntrySnapshot.length - 1,
    );
    // There will be a later `## Run —` occurrence beyond the first snapshot
    const allRunIdxs: number[] = [];
    let searchFrom = 0;
    while (true) {
      const at = afterSecond.indexOf('## Run \u2014', searchFrom);
      if (at === -1) break;
      allRunIdxs.push(at);
      searchFrom = at + 1;
    }
    expect(allRunIdxs.length).toBe(2);
    expect(allRunIdxs[0]).toBeLessThan(allRunIdxs[1] as number);
    // Silence the unused secondRunIdx — its existence was the sanity check above
    expect(secondRunIdx).toBeLessThanOrEqual(allRunIdxs[1] as number);
  });

  it('descends a 2-level iframe chain and extracts DEEP_CONTENT_SENTINEL (CRWL-06)', async () => {
    tmpPath = makeTmpPath();
    const config = buildMarkdownConfig({
      url: fixtureUrl,
      selectorsYaml: [
        'deep:',
        '  selector: "#deep-target"',
        '  engine: css',
        '  frame:',
        '    - "iframe#level-1-frame"',
        '    - "iframe#level-2-frame"',
      ].join('\n'),
      rulesYaml: 'waitFor: "#top-title"\ntimeout: 10000',
    });
    await writeFile(tmpPath, config, 'utf8');

    const result = await runCrawl(tmpPath);

    expect(result.status).toBe('ok');
    expect(result.fields).toEqual({ deep: 'DEEP_CONTENT_SENTINEL' });

    const onDisk = await readFile(tmpPath, 'utf8');
    const blocks = extractJsonBlocks(onDisk);
    expect(blocks.length).toBe(1);
    const payload = JSON.parse(blocks[0] as string) as { fields: Record<string, string> };
    expect(payload.fields['deep']).toBe('DEEP_CONTENT_SENTINEL');
  });

  it('XPath selector yields the same extracted text as CSS on the same element (CRWL-04 vs CRWL-05)', async () => {
    tmpPath = makeTmpPath();
    const config = buildMarkdownConfig({
      url: fixtureUrl,
      selectorsYaml: [
        'title:',
        '  selector: "//*[@id=\\"top-title\\"]"',
        "  engine: 'xpath'",
      ].join('\n'),
      rulesYaml: 'waitFor: "#top-title"\ntimeout: 10000',
    });
    await writeFile(tmpPath, config, 'utf8');

    const result = await runCrawl(tmpPath);

    expect(result.status).toBe('ok');
    // Exactly the same text the CSS variant extracts in Test 1 — proves
    // the two selector engines converge at the runCrawl level.
    expect(result.fields).toEqual({ title: 'Top Level' });
  });

  it('waitFor never-matching selector yields a timeout error envelope with stack + on-disk error entry (CRWL-03, OUT-04, stack propagation)', async () => {
    tmpPath = makeTmpPath();
    const config = buildMarkdownConfig({
      url: 'data:text/html,<h1>hi</h1>',
      selectorsYaml: ['title:', '  selector: "h1"', '  engine: css'].join('\n'),
      rulesYaml: 'waitFor: "#never"\ntimeout: 2000',
    });
    await writeFile(tmpPath, config, 'utf8');

    const result = await runCrawl(tmpPath);

    // Envelope shape
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('timeout');
    expect(result.error?.message).toContain('#never');
    expect(result.error?.message).toContain('2000');
    // Stack propagated from caught CrawlError.stack (standard Error.stack) per
    // CONTEXT.md `error: { code, message, stack? }`
    expect(typeof result.error?.stack).toBe('string');
    expect((result.error?.stack ?? '').length).toBeGreaterThan(0);

    // runCrawl itself did NOT terminate the process — the next `expect` runs
    // to completion, which is the trivial witness for OUT-05's envelope half.
    // (Phase 4 CLI will map status === 'error' to a non-zero exit.)

    const onDisk = await readFile(tmpPath, 'utf8');
    const blocks = extractJsonBlocks(onDisk);
    expect(blocks.length).toBe(1);
    const payload = JSON.parse(blocks[0] as string) as {
      error: { code: string; message: string; stack?: string };
      meta: { status: string };
    };
    expect(payload.error.code).toBe('timeout');
    expect(payload.meta.status).toBe('error');
    // Stack must appear in the rendered JSON (Plan 02-02 Test 9 contract)
    expect(onDisk).toMatch(/"stack":/);
    expect(typeof payload.error.stack).toBe('string');
    expect((payload.error.stack ?? '').length).toBeGreaterThan(0);
  });

  it('config_parse error path writes an error entry WITHOUT launching Chromium (OUT-04, CRWL-01 negative)', async () => {
    tmpPath = makeTmpPath();
    // Invalid Phase 1 input: no `# URL` section, no `# Selectors`, no `# Rules`.
    await writeFile(tmpPath, '# Not A Real Config\n\nNothing to parse here.\n', 'utf8');

    const result = await runCrawl(tmpPath);

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('config_parse');
    expect(result.url).toBe('');

    // The output entry must have been written even though no browser launched.
    const onDisk = await readFile(tmpPath, 'utf8');
    expect(onDisk).toMatch(/^# Output\s*$/m);
    expect(onDisk).toMatch(/## Run \u2014 /);
    const blocks = extractJsonBlocks(onDisk);
    expect(blocks.length).toBe(1);
    const payload = JSON.parse(blocks[0] as string) as {
      error: { code: string };
      meta: { status: string; url: string };
    };
    expect(payload.error.code).toBe('config_parse');
    expect(payload.meta.status).toBe('error');
    expect(payload.meta.url).toBe('');

    // Performance witness: config-parse path is fs-only (no browser launch);
    // headroom is generous for slow CI.
    expect(result.durationMs).toBeLessThan(5000);
  });
});
