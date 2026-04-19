import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  formatDateDir,
  formatRunTimestamp,
  buildPayload,
  resolveOutputTarget,
  scrubPaths,
  writeOutputToFile,
} from './output';
import type { CrawlResult } from './types';

describe('scrubPaths (MD-04)', () => {
  it('Test S1: replaces /home/<user>/... with <HOME>/... while preserving the repo portion', () => {
    const input =
      'at parseConfigFile (/home/ubuntu/work/crawl.io/src/runner.ts:42:10)';
    const out = scrubPaths(input);
    expect(out).toBe('at parseConfigFile (<HOME>/work/crawl.io/src/runner.ts:42:10)');
  });

  it('Test S2: replaces macOS /Users/<user>/... with <HOME>/...', () => {
    const input = 'filePath: /Users/alice/projects/secret/cfg.md';
    const out = scrubPaths(input);
    expect(out).toBe('filePath: <HOME>/projects/secret/cfg.md');
  });

  it('Test S3: replaces Windows C:\\Users\\<user>\\ with <HOME>\\', () => {
    const input = 'at foo (C:\\Users\\bob\\projects\\cfg.md:1:1)';
    const out = scrubPaths(input);
    expect(out).toBe('at foo (<HOME>\\projects\\cfg.md:1:1)');
  });

  it('Test S4: multiline stack-like input — every occurrence is scrubbed', () => {
    const input = [
      'Error: boom',
      '    at parseConfigFile (/home/ubuntu/work/crawl.io/src/config/parser.ts:10:5)',
      '    at runCrawl (/home/ubuntu/work/crawl.io/src/crawler/runner.ts:99:3)',
    ].join('\n');
    const out = scrubPaths(input);
    expect(out).not.toContain('/home/ubuntu');
    expect(out.match(/<HOME>/g)?.length).toBe(2);
    expect(out).toContain('/work/crawl.io/src/config/parser.ts:10:5');
    expect(out).toContain('/work/crawl.io/src/crawler/runner.ts:99:3');
  });

  it('Test S5: input without any home-like path is returned unchanged', () => {
    const input = 'nothing sensitive here — just a plain message';
    expect(scrubPaths(input)).toBe(input);
  });

  it('Test S6: undefined input returns undefined (passthrough for optional stack)', () => {
    expect(scrubPaths(undefined)).toBeUndefined();
  });
});

describe('formatDateDir', () => {
  it('returns local-time YYYYMMDD', () => {
    // Construct from local components — formatter reads local components back.
    const d = new Date(2026, 3, 18, 14, 22, 5); // April 18 2026, 14:22:05 local
    expect(formatDateDir(d)).toBe('20260418');
  });

  it('zero-pads month and day', () => {
    const d = new Date(2026, 0, 5, 0, 0, 0); // Jan 5 2026 local
    expect(formatDateDir(d)).toBe('20260105');
  });
});

describe('formatRunTimestamp', () => {
  it('returns local-time YYYY-MM-DD-HH-mm-ss with seconds', () => {
    const d = new Date(2026, 3, 18, 14, 22, 5);
    expect(formatRunTimestamp(d)).toBe('2026-04-18-14-22-05');
  });

  it('zero-pads every component', () => {
    const d = new Date(2026, 0, 5, 4, 7, 9);
    expect(formatRunTimestamp(d)).toBe('2026-01-05-04-07-09');
  });
});

describe('buildPayload', () => {
  it('success: returns { fields, meta } with ISO startedAt and status=ok', () => {
    const result: CrawlResult = {
      status: 'ok',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 1234,
      fields: { title: 'Hello' },
    };
    expect(buildPayload(result)).toEqual({
      fields: { title: 'Hello' },
      meta: {
        url: 'https://ex.com',
        status: 'ok',
        startedAt: '2026-04-18T01:22:00.000Z',
        durationMs: 1234,
      },
    });
  });

  it('success: empty fields serialize as {}', () => {
    const result: CrawlResult = {
      status: 'ok',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 42,
      fields: {},
    };
    const payload = buildPayload(result) as { fields: Record<string, string> };
    expect(payload.fields).toEqual({});
  });

  it('error without stack: payload has no stack key', () => {
    const result: CrawlResult = {
      status: 'error',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 1234,
      error: { code: 'timeout', message: 'waitFor #post failed' },
    };
    const payload = buildPayload(result);
    expect(payload).toEqual({
      error: { code: 'timeout', message: 'waitFor #post failed' },
      meta: {
        url: 'https://ex.com',
        status: 'error',
        startedAt: '2026-04-18T01:22:00.000Z',
        durationMs: 1234,
      },
    });
    expect(JSON.stringify(payload)).not.toContain('"stack"');
    expect(JSON.stringify(payload)).not.toContain('"fields"');
  });

  it('error with stack: stack included verbatim after scrub', () => {
    const stackText = 'Error: boom\n    at foo (bar.ts:10:5)';
    const result: CrawlResult = {
      status: 'error',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 1234,
      error: { code: 'extraction_failed', message: 'boom', stack: stackText },
    };
    const payload = buildPayload(result) as { error: { stack: string } };
    expect(payload.error.stack).toBe(stackText);
  });
});

describe('resolveOutputTarget', () => {
  it('dir = <configDir>/output/<YYYYMMDD>, stem = run_<YYYY-MM-DD-HH-mm-ss>', () => {
    const d = new Date(2026, 3, 18, 14, 22, 5);
    const { dir, stem } = resolveOutputTarget('/workspace/job/job_1.md', d);
    expect(dir).toBe(join('/workspace/job', 'output', '20260418'));
    expect(stem).toBe('run_2026-04-18-14-22-05');
  });
});

describe('writeOutputToFile', () => {
  it('creates output/<YYYYMMDD>/run_<ts>.json with the expected payload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawl-out-'));
    try {
      const cfg = join(dir, 'cfg.md');
      await writeFile(cfg, '# URL\n', 'utf8');

      const startedAt = new Date(2026, 3, 18, 14, 22, 5);
      const result: CrawlResult = {
        status: 'ok',
        configPath: cfg,
        url: 'https://ex.com',
        startedAt,
        durationMs: 100,
        fields: { title: 'T' },
      };

      const written = await writeOutputToFile(cfg, result);

      expect(written).toBe(
        join(dir, 'output', '20260418', 'run_2026-04-18-14-22-05.json'),
      );

      const onDisk = await readFile(written, 'utf8');
      expect(onDisk.endsWith('\n')).toBe(true);
      const parsed = JSON.parse(onDisk);
      expect(parsed).toEqual({
        fields: { title: 'T' },
        meta: {
          url: 'https://ex.com',
          status: 'ok',
          startedAt: startedAt.toISOString(),
          durationMs: 100,
        },
      });

      // No legacy `# Output` section in the job markdown.
      const cfgOnDisk = await readFile(cfg, 'utf8');
      expect(cfgOnDisk).toBe('# URL\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('two runs at different seconds produce two separate files in the same day folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawl-out-'));
    try {
      const cfg = join(dir, 'cfg.md');
      await writeFile(cfg, '# URL\n', 'utf8');

      const result1: CrawlResult = {
        status: 'ok',
        configPath: cfg,
        url: 'https://ex.com',
        startedAt: new Date(2026, 3, 18, 1, 0, 0),
        durationMs: 100,
        fields: { run: '1' },
      };
      const result2: CrawlResult = {
        status: 'error',
        configPath: cfg,
        url: 'https://ex.com',
        startedAt: new Date(2026, 3, 18, 2, 0, 5),
        durationMs: 200,
        error: { code: 'timeout', message: 'boom' },
      };

      await writeOutputToFile(cfg, result1);
      await writeOutputToFile(cfg, result2);

      const dayDir = join(dir, 'output', '20260418');
      const entries = (await readdir(dayDir)).sort();
      expect(entries).toEqual([
        'run_2026-04-18-01-00-00.json',
        'run_2026-04-18-02-00-05.json',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('same-second collision: second write lands as run_<stem>-2.json (wx-based)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawl-out-'));
    try {
      const cfg = join(dir, 'cfg.md');
      await writeFile(cfg, '# URL\n', 'utf8');

      const startedAt = new Date(2026, 3, 18, 14, 22, 5);
      const baseResult: CrawlResult = {
        status: 'ok',
        configPath: cfg,
        url: 'https://ex.com',
        startedAt,
        durationMs: 100,
        fields: { run: 'A' },
      };
      const otherResult: CrawlResult = {
        ...baseResult,
        fields: { run: 'B' },
      };

      const p1 = await writeOutputToFile(cfg, baseResult);
      const p2 = await writeOutputToFile(cfg, otherResult);

      expect(p1).toBe(
        join(dir, 'output', '20260418', 'run_2026-04-18-14-22-05.json'),
      );
      expect(p2).toBe(
        join(dir, 'output', '20260418', 'run_2026-04-18-14-22-05-2.json'),
      );

      const parsed1 = JSON.parse(await readFile(p1, 'utf8')) as {
        fields: Record<string, string>;
      };
      const parsed2 = JSON.parse(await readFile(p2, 'utf8')) as {
        fields: Record<string, string>;
      };
      expect(parsed1.fields).toEqual({ run: 'A' });
      expect(parsed2.fields).toEqual({ run: 'B' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('concurrent writeOutputToFile calls on the same second — both entries land under distinct filenames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawl-out-'));
    try {
      const cfg = join(dir, 'cfg.md');
      await writeFile(cfg, '# URL\n', 'utf8');

      const startedAt = new Date(2026, 3, 18, 14, 22, 5);
      const mk = (run: string): CrawlResult => ({
        status: 'ok',
        configPath: cfg,
        url: 'https://ex.com',
        startedAt,
        durationMs: 100,
        fields: { run },
      });

      const [p1, p2] = await Promise.all([
        writeOutputToFile(cfg, mk('A')),
        writeOutputToFile(cfg, mk('B')),
      ]);

      expect(p1).not.toBe(p2);
      const dayDir = join(dir, 'output', '20260418');
      const entries = await readdir(dayDir);
      expect(entries.sort()).toEqual([
        'run_2026-04-18-14-22-05-2.json',
        'run_2026-04-18-14-22-05.json',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fs error surfaces — rejects when the parent directory cannot be created', async () => {
    const result: CrawlResult = {
      status: 'ok',
      configPath: '/dev/null/cannot-mkdir-here/cfg.md',
      url: 'https://ex.com',
      startedAt: new Date(2026, 3, 18, 14, 22, 5),
      durationMs: 100,
      fields: {},
    };
    await expect(
      writeOutputToFile('/dev/null/cannot-mkdir-here/cfg.md', result),
    ).rejects.toThrow();
  });
});
