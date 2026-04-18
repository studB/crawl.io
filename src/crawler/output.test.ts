import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  formatTimestamp,
  renderEntry,
  appendOutput,
  writeOutputToFile,
} from './output';
import type { CrawlResult } from './types';

/**
 * Pull the JSON payload out of a rendered entry's fenced ```json block.
 * Uses a line-anchored regex so that a triple-backtick substring inside
 * a JSON string value (Test 8) does NOT prematurely terminate the match.
 */
function extractFencedJson(entry: string): unknown {
  const match = entry.match(/^```json\n([\s\S]*?)\n```\s*$/m);
  if (!match || match[1] === undefined) {
    throw new Error('no json fence found in entry:\n' + entry);
  }
  return JSON.parse(match[1]);
}

describe('formatTimestamp', () => {
  it('Test 1: returns YYYY-MM-DD HH:MM (UTC, no seconds)', () => {
    const result = formatTimestamp(new Date('2026-04-18T01:22:00Z'));
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(result).toBe('2026-04-18 01:22');
  });

  it('Test 2: zero-pads single-digit components', () => {
    const result = formatTimestamp(new Date('2026-01-05T04:07:00Z'));
    expect(result).toBe('2026-01-05 04:07');
  });

  it('Test 3: UTC-locked regardless of process.env.TZ', () => {
    const originalTz = process.env['TZ'];
    try {
      process.env['TZ'] = 'America/Los_Angeles';
      const result = formatTimestamp(new Date('2026-04-18T23:59:00Z'));
      expect(result).toBe('2026-04-18 23:59');
    } finally {
      if (originalTz === undefined) {
        delete process.env['TZ'];
      } else {
        process.env['TZ'] = originalTz;
      }
    }
  });
});

describe('renderEntry', () => {
  it('Test 4: success entry lines in order (em-dash H2, italic meta, json fence, trailing newline)', () => {
    const result: CrawlResult = {
      status: 'ok',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 1234,
      fields: { title: 'Hello' },
    };
    const entry = renderEntry(result);

    expect(entry.endsWith('\n')).toBe(true);

    const lines = entry.split('\n');
    // Line 0: H2 heading with em dash U+2014
    expect(lines[0]).toBe('## Run \u2014 2026-04-18 01:22');
    // Line 1: blank line
    expect(lines[1]).toBe('');
    // Line 2: italic meta
    expect(lines[2]).toBe('_count: 1, duration: 1234ms_');
    // Line 3: blank line
    expect(lines[3]).toBe('');
    // Line 4: fence opener — three backticks + "json"
    expect(lines[4]).toBe('\u0060\u0060\u0060json');
    // After the pretty-printed JSON comes the closing fence and a trailing newline
    const closingFenceIdx = lines.lastIndexOf('\u0060\u0060\u0060');
    expect(closingFenceIdx).toBeGreaterThan(4);
    // Strict "trailing newline" check: split on \n produces an empty final element
    expect(lines[lines.length - 1]).toBe('');
  });

  it('Test 5: success JSON payload parses to { fields, meta } with no error key and no configPath', () => {
    const result: CrawlResult = {
      status: 'ok',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 1234,
      fields: { title: 'Hello' },
    };
    const entry = renderEntry(result);
    const parsed = extractFencedJson(entry);

    expect(parsed).toEqual({
      fields: { title: 'Hello' },
      meta: { url: 'https://ex.com', status: 'ok', durationMs: 1234 },
    });
    // configPath is NOT serialized
    expect(JSON.stringify(parsed)).not.toContain('configPath');
    // No error key
    expect(JSON.stringify(parsed)).not.toContain('"error"');
  });

  it('Test 6: error entry — italic is "_error: code, duration: Xms_" and JSON has no fields key and no stack key when stack absent', () => {
    const result: CrawlResult = {
      status: 'error',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 1234,
      error: { code: 'timeout', message: 'waitFor #post failed' },
    };
    const entry = renderEntry(result);

    expect(entry).toContain('_error: timeout, duration: 1234ms_');
    expect(entry).not.toContain('_count:');

    const parsed = extractFencedJson(entry);
    expect(parsed).toEqual({
      error: { code: 'timeout', message: 'waitFor #post failed' },
      meta: { url: 'https://ex.com', status: 'error', durationMs: 1234 },
    });
    expect(JSON.stringify(parsed)).not.toContain('"fields"');
    // Stack was not provided — no "stack" key in the rendered JSON
    expect(entry).not.toContain('"stack"');
  });

  it('Test 7: zero-fields success entry renders _count: 0_ and empty fields object', () => {
    const result: CrawlResult = {
      status: 'ok',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 42,
      fields: {},
    };
    const entry = renderEntry(result);

    expect(entry).toContain('_count: 0, duration: 42ms_');
    const parsed = extractFencedJson(entry) as { fields: Record<string, string> };
    expect(parsed.fields).toEqual({});
  });

  it('Test 8: triple backticks inside error.message do not break the fence — JSON round-trips', () => {
    const message = 'three ticks: \u0060\u0060\u0060';
    const result: CrawlResult = {
      status: 'error',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 7,
      error: { code: 'extraction_failed', message },
    };
    const entry = renderEntry(result);
    const parsed = extractFencedJson(entry) as { error: { message: string } };
    expect(parsed.error.message).toBe(message);
  });

  it('Test 9: error entry WITH stack — parsed JSON includes stack verbatim and raw entry contains "stack":', () => {
    const stackText = 'Error: boom\n    at foo (bar.ts:10:5)';
    const result: CrawlResult = {
      status: 'error',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 1234,
      error: { code: 'extraction_failed', message: 'boom', stack: stackText },
    };
    const entry = renderEntry(result);

    // Raw rendered string contains the "stack" key
    expect(entry).toContain('"stack":');

    const parsed = extractFencedJson(entry);
    expect(parsed).toEqual({
      error: {
        code: 'extraction_failed',
        message: 'boom',
        stack: stackText,
      },
      meta: { url: 'https://ex.com', status: 'error', durationMs: 1234 },
    });
  });
});

describe('appendOutput', () => {
  const sampleEntry = renderEntry({
    status: 'ok',
    configPath: '/tmp/x.md',
    url: 'https://ex.com',
    startedAt: new Date('2026-04-18T01:22:00Z'),
    durationMs: 100,
    fields: { title: 'Sample' },
  });

  it('Test 10: no existing # Output — preserves source byte-for-byte as prefix, adds H1 # Output + entry', () => {
    const source = '# URL\n\nhttps://ex.com\n\n# Selectors\n\n[block]\n';
    const result = appendOutput(source, sampleEntry);

    expect(result.startsWith(source)).toBe(true);
    expect(result).toContain('\n# Output\n\n' + sampleEntry);
  });

  it('Test 11: existing # Output with no prior entries — appends without duplicating the header', () => {
    const source = '# URL\n\nhttps://ex.com\n\n# Output\n';
    const result = appendOutput(source, sampleEntry);

    const headerMatches = result.match(/^# Output\s*$/gim) ?? [];
    expect(headerMatches.length).toBe(1);
    expect(result).toContain(sampleEntry);
  });

  it('Test 12: existing # Output with ONE prior entry — prior entry preserved byte-for-byte, new entry follows it', () => {
    const priorEntry = renderEntry({
      status: 'ok',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:00:00Z'),
      durationMs: 500,
      fields: { a: '1', b: '2' },
    });
    const source = '# URL\n\nhttps://ex.com\n\n# Output\n\n' + priorEntry;
    const result = appendOutput(source, sampleEntry);

    expect(result.includes(priorEntry)).toBe(true);
    expect(result.indexOf(priorEntry)).toBeLessThan(result.indexOf(sampleEntry));
  });

  it('Test 13: case-insensitive # Output recognition (lowercase # output is reused)', () => {
    const source = '# URL\n\nhttps://ex.com\n\n# output\n';
    const result = appendOutput(source, sampleEntry);

    const lowerMatches = result.match(/^# output\s*$/gim) ?? [];
    expect(lowerMatches.length).toBe(1);
    // No new uppercase "# Output" header was added (case matters at the byte level here)
    expect(/^# Output$/m.test(result)).toBe(false);
  });

  it('Test 14: append-at-EOF — new entry lands at the end of file even if # Output is followed by other sections', () => {
    const priorEntry = '## Run \u2014 2026-04-18 00:00\n\n_count: 0, duration: 1ms_\n\n\u0060\u0060\u0060json\n{}\n\u0060\u0060\u0060\n';
    const source = '# Output\n\n' + priorEntry + '\n# TrailingNote\nsome prose\n';
    const result = appendOutput(source, sampleEntry);

    expect(result.trimEnd().endsWith(sampleEntry.trimEnd())).toBe(true);
  });

  it('Test 15: two-run append is idempotent — both entries present, first before second', () => {
    const src = '# URL\n\nhttps://ex.com\n';
    const entry1 = renderEntry({
      status: 'ok',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:00:00Z'),
      durationMs: 100,
      fields: { run: '1' },
    });
    const entry2 = renderEntry({
      status: 'ok',
      configPath: '/tmp/x.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T02:00:00Z'),
      durationMs: 200,
      fields: { run: '2' },
    });
    const result = appendOutput(appendOutput(src, entry1), entry2);

    expect(result).toContain(entry1);
    expect(result).toContain(entry2);
    expect(result.indexOf(entry1)).toBeLessThan(result.indexOf(entry2));
    // And exactly one # Output header
    expect((result.match(/^# Output\s*$/gim) ?? []).length).toBe(1);
  });

  it('Test 16: source without trailing newline is normalized — result always ends with \\n', () => {
    const source = '# URL\n\nhttps://ex.com'; // no trailing newline
    const result = appendOutput(source, sampleEntry);

    expect(result.endsWith('\n')).toBe(true);
    // The original source content must still appear verbatim at the start (after normalization,
    // one newline is added before any new content)
    expect(result.startsWith(source + '\n')).toBe(true);
  });
});

describe('writeOutputToFile', () => {
  it('Test 17: happy path — file content equals appendOutput(originalSource, entry)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawl-out-'));
    try {
      const tmpPath = join(dir, 'cfg.md');
      const originalSource = '# URL\n\nhttps://ex.com\n\n# Selectors\n\n[block]\n';
      await writeFile(tmpPath, originalSource, 'utf8');

      const entry = renderEntry({
        status: 'ok',
        configPath: tmpPath,
        url: 'https://ex.com',
        startedAt: new Date('2026-04-18T01:22:00Z'),
        durationMs: 100,
        fields: { title: 'T' },
      });

      await writeOutputToFile(tmpPath, entry);

      const onDisk = await readFile(tmpPath, 'utf8');
      expect(onDisk).toBe(appendOutput(originalSource, entry));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 18: round-trip preservation — two successive writes keep both entries, first before second', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawl-out-'));
    try {
      const tmpPath = join(dir, 'cfg.md');
      const originalSource = '# URL\n\nhttps://ex.com\n';
      await writeFile(tmpPath, originalSource, 'utf8');

      const entry1 = renderEntry({
        status: 'ok',
        configPath: tmpPath,
        url: 'https://ex.com',
        startedAt: new Date('2026-04-18T01:00:00Z'),
        durationMs: 100,
        fields: { run: '1' },
      });
      const entry2 = renderEntry({
        status: 'error',
        configPath: tmpPath,
        url: 'https://ex.com',
        startedAt: new Date('2026-04-18T02:00:00Z'),
        durationMs: 200,
        error: { code: 'timeout', message: 'boom' },
      });

      await writeOutputToFile(tmpPath, entry1);
      await writeOutputToFile(tmpPath, entry2);

      const onDisk = await readFile(tmpPath, 'utf8');
      expect(onDisk).toContain(entry1);
      expect(onDisk).toContain(entry2);
      expect(onDisk.indexOf(entry1)).toBeLessThan(onDisk.indexOf(entry2));
      expect((onDisk.match(/^# Output\s*$/gim) ?? []).length).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('Test 19: fs error surfaces — rejects with an Error when the path is unreachable', async () => {
    const entry = renderEntry({
      status: 'ok',
      configPath: '/nonexistent/directory/does/not/exist.md',
      url: 'https://ex.com',
      startedAt: new Date('2026-04-18T01:22:00Z'),
      durationMs: 100,
      fields: {},
    });
    await expect(
      writeOutputToFile('/nonexistent/directory/does/not/exist.md', entry),
    ).rejects.toThrow();
  });
});
