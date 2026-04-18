/**
 * Unit coverage for the `run` subcommand handler — 7 behaviors locked by
 * 04-01-PLAN.md Task 2.
 *
 * All tests drive `runHandler` with injected `RunDeps` (no real fs, no real
 * runCrawl, no Chromium). The seventh behavior covers `registerRunCommand`
 * help-text introspection via commander's own API — no child_process spawn.
 */

import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { homedir } from 'node:os';

import {
  runHandler,
  registerRunCommand,
  type RunDeps,
} from './run';
import type { CrawlResult, CrawlErrorCode } from '../crawler/types';

// --- Fixture helpers --------------------------------------------------------

/** Build a mock RunDeps whose stdout/stderr write into arrays for assertion. */
function makeDeps(overrides: Partial<RunDeps> = {}): {
  deps: RunDeps;
  stdout: string[];
  stderr: string[];
  runCrawlCalls: string[];
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const runCrawlCalls: string[] = [];

  const deps: RunDeps = {
    runCrawl: overrides.runCrawl ?? (async (p: string): Promise<CrawlResult> => {
      runCrawlCalls.push(p);
      return okResult(p);
    }),
    stdout: overrides.stdout ?? ((line: string) => { stdout.push(line); }),
    stderr: overrides.stderr ?? ((line: string) => { stderr.push(line); }),
    pathExists: overrides.pathExists ?? (async () => true),
  };
  // Wrap runCrawl to keep the call-log even when override is supplied.
  if (overrides.runCrawl !== undefined) {
    const original = overrides.runCrawl;
    deps.runCrawl = async (p: string): Promise<CrawlResult> => {
      runCrawlCalls.push(p);
      return original(p);
    };
  }
  return { deps, stdout, stderr, runCrawlCalls };
}

function okResult(configPath: string, fields: Record<string, string> = { title: 'Example' }): CrawlResult {
  return {
    status: 'ok',
    configPath,
    url: 'https://example.com/',
    startedAt: new Date(0),
    durationMs: 123,
    fields,
  };
}

function errorResult(
  configPath: string,
  code: CrawlErrorCode,
  message: string,
): CrawlResult {
  return {
    status: 'error',
    configPath,
    url: 'https://example.com/',
    startedAt: new Date(0),
    durationMs: 42,
    error: { code, message },
  };
}

// --- Test body --------------------------------------------------------------

describe('runHandler — pre-flight', () => {
  it('Behavior 1: non-existent config path returns 1, stderr has scrubbed "config not found:", runCrawl NOT called', async () => {
    const { deps, stderr, runCrawlCalls } = makeDeps({
      pathExists: async () => false,
    });
    // Use a path inside the home directory so we can assert it was scrubbed.
    const home = homedir();
    const file = home + '/nowhere/phantom-cfg.md';

    const code = await runHandler({ file, verbose: false, quiet: false }, deps);

    expect(code).toBe(1);
    expect(runCrawlCalls).toEqual([]);
    // Exactly one stderr line, prefixed with the literal "✗ config not found:".
    const joined = stderr.join('\n');
    expect(joined).toContain('✗ config not found:');
    // Path redaction: the literal home directory string must NOT appear in
    // the stderr output (scrubPaths replaces it with <HOME>). We only assert
    // when the home directory is a meaningful prefix — containerized CI
    // occasionally runs with homedir() === '/' or '', in which case the
    // scrubber is a no-op and the assertion is vacuously true.
    if (home && home.length > 1) {
      expect(joined).not.toContain(home);
      expect(joined).toContain('<HOME>');
    }
  });
});

describe('runHandler — success path', () => {
  it('Behavior 2: success with fields writes "✓ title: X" to stdout and returns 0', async () => {
    const file = '/tmp/cfg.md';
    const { deps, stdout, stderr } = makeDeps({
      pathExists: async () => true,
      runCrawl: async () => okResult(file, { title: 'X' }),
    });

    const code = await runHandler({ file, verbose: false, quiet: false }, deps);

    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toBe('✓ title: X');
  });

  it('success with empty fields falls back to "✓ crawl ok (…ms)" summary', async () => {
    const file = '/tmp/cfg.md';
    const { deps, stdout } = makeDeps({
      pathExists: async () => true,
      runCrawl: async () => ({
        status: 'ok',
        configPath: file,
        url: 'https://example.com/',
        startedAt: new Date(0),
        durationMs: 55,
      }),
    });

    const code = await runHandler({ file, verbose: false, quiet: false }, deps);

    expect(code).toBe(0);
    expect(stdout).toHaveLength(1);
    expect(stdout[0]).toBe('✓ crawl ok (55ms)');
  });

  it('long first-field value is truncated to 80 chars with … suffix', async () => {
    const file = '/tmp/cfg.md';
    const longValue = 'A'.repeat(200);
    const { deps, stdout } = makeDeps({
      pathExists: async () => true,
      runCrawl: async () => okResult(file, { title: longValue }),
    });

    await runHandler({ file, verbose: false, quiet: false }, deps);

    expect(stdout).toHaveLength(1);
    const line = stdout[0] ?? '';
    expect(line.startsWith('✓ title: ')).toBe(true);
    expect(line.endsWith('…')).toBe(true);
    // The visible payload (after "✓ title: " and before the ellipsis) is
    // exactly 80 characters of the truncated value.
    const payload = line.slice('✓ title: '.length, -1);
    expect(payload).toHaveLength(80);
  });
});

describe('runHandler — error path', () => {
  it('Behavior 3: error envelope writes "✗ <code>: <message>" to stderr and returns 1', async () => {
    const file = '/tmp/cfg.md';
    const msg = "waitFor X timed out after 30000ms";
    const { deps, stdout, stderr } = makeDeps({
      pathExists: async () => true,
      runCrawl: async () => errorResult(file, 'timeout', msg),
    });

    const code = await runHandler({ file, verbose: false, quiet: false }, deps);

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toHaveLength(1);
    expect(stderr[0]).toBe('✗ timeout: ' + msg);
  });
});

describe('runHandler — flags', () => {
  it('Behavior 4a: --quiet suppresses stdout AND stderr on success (exit 0)', async () => {
    const file = '/tmp/cfg.md';
    const { deps, stdout, stderr } = makeDeps({
      pathExists: async () => true,
      runCrawl: async () => okResult(file),
    });

    const code = await runHandler({ file, verbose: false, quiet: true }, deps);

    expect(code).toBe(0);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
  });

  it('Behavior 4b: --quiet suppresses stdout AND stderr on error (exit 1)', async () => {
    const file = '/tmp/cfg.md';
    const { deps, stdout, stderr } = makeDeps({
      pathExists: async () => true,
      runCrawl: async () => errorResult(file, 'timeout', 'nope'),
    });

    const code = await runHandler({ file, verbose: false, quiet: true }, deps);

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
  });

  it('Behavior 4c: --quiet suppresses the pre-flight "config not found" stderr too', async () => {
    const file = '/nowhere/missing.md';
    const { deps, stdout, stderr } = makeDeps({
      pathExists: async () => false,
    });

    const code = await runHandler({ file, verbose: false, quiet: true }, deps);

    expect(code).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
  });

  it('Behavior 5: --verbose emits at least one stage-progress line to stderr', async () => {
    const file = '/tmp/cfg.md';
    const { deps, stderr } = makeDeps({
      pathExists: async () => true,
      runCrawl: async () => okResult(file),
    });

    await runHandler({ file, verbose: true, quiet: false }, deps);

    // At least one stderr line must mention one of the documented stages.
    const joined = stderr.join('\n').toLowerCase();
    const hit =
      /parsing|launching|navigating|extracting|writing/.test(joined);
    expect(hit).toBe(true);
  });
});

describe('runHandler — defensive error handling', () => {
  it('Behavior 7: runCrawl throwing is caught, handler returns 1 and never re-throws', async () => {
    const file = '/tmp/cfg.md';
    const { deps, stderr } = makeDeps({
      pathExists: async () => true,
      runCrawl: async () => {
        throw new Error('unexpected explosion');
      },
    });

    // Must not throw — the handler catches and maps to exit 1.
    const code = await runHandler({ file, verbose: false, quiet: false }, deps);

    expect(code).toBe(1);
    // Stderr got an "unknown" classification with the scrubbed message.
    const joined = stderr.join('\n');
    expect(joined).toContain('✗ unknown:');
    expect(joined).toContain('unexpected explosion');
  });
});

describe('registerRunCommand', () => {
  it('Behavior 6: registers a `run <file>` subcommand with a required positional + help mentioning NAVER_ID and NAVER_PW', () => {
    const program = new Command();
    program.name('crawl').exitOverride();
    registerRunCommand(program);

    // Exactly one subcommand registered by this call.
    expect(program.commands).toHaveLength(1);
    const run = program.commands[0];
    expect(run).toBeDefined();
    if (!run) throw new Error('unreachable — already asserted defined');
    expect(run.name()).toBe('run');

    // Commander v12 stores positional args on `registeredArguments` (public
    // API since v11). A required arg has `required === true`.
    const args = (run as unknown as {
      registeredArguments: ReadonlyArray<{ name: string; required: boolean }>;
    }).registeredArguments;
    expect(args).toHaveLength(1);
    const arg0 = args[0];
    expect(arg0).toBeDefined();
    if (!arg0) throw new Error('unreachable');
    expect(arg0.required).toBe(true);

    // Help text must reference the key env vars AND the exit code table.
    // commander v12 renders `addHelpText('after', …)` hooks via
    // `outputHelp()` (event-emitter path), NOT via `helpInformation()`
    // (which returns only the core usage + options block). Capture the
    // full render via a configureOutput writer — this is the exact path
    // runtime `crawl run --help` takes to stdout.
    let help = '';
    run.configureOutput({ writeOut: (s) => { help += s; } });
    run.outputHelp();
    expect(help).toContain('NAVER_ID');
    expect(help).toContain('NAVER_PW');
    expect(help).toContain('CRAWL_HEADED_TIMEOUT_MS');
    // Exit code table — plan requires strings 0 and 1 appear in the
    // help block alongside the word "exit".
    expect(help.toLowerCase()).toContain('exit');
    expect(help).toMatch(/\b0\b/);
    expect(help).toMatch(/\b1\b/);
  });
});
