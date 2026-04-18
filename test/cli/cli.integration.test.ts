/**
 * Phase 4 Plan 03 — CLI integration tests.
 *
 * Spawn the BUILT binary (`dist/bin/crawl.js`) in a child process and assert
 * end-to-end behavior of the CLI contract shipped by Plan 01:
 *
 *   1. `crawl --help`          — top-level usage with run subcommand + tagline
 *   2. `crawl run --help`      — env vars (NAVER_ID/NAVER_PW/CRAWL_HEADED_TIMEOUT_MS)
 *                                 + exit codes 0/1 + <file> positional
 *   3. `crawl run <missing>`   — pre-flight fail → exit 1 + scrubbed stderr +
 *                                 NO Chromium launch
 *   4. `crawl run --quiet <missing>` — both streams zero bytes, exit 1
 *   5. `crawl run -v <missing>` — stderr has the pre-flight line (exit 1)
 *   5b. `crawl run -v <existing-but-broken>` — stderr has the `→ parsing`
 *                                 verbose arrow AND the `config_parse:` summary
 *                                 (fires AFTER pre-flight passes; existing-
 *                                 file path is the only way to exercise the
 *                                 verbose arrow progress line on a failure)
 *   6. (gated) `crawl run <valid-public>` — real network happy path against
 *                                 example.com when RUN_CLI_NETWORK_TESTS=1
 *
 * All tests call the binary through `child_process.spawn` (no `execa` dep),
 * capture stdout/stderr as strings, and assert on the observed bytes.
 *
 * TypeScript strict — no `any`; shapes declared via `RunResult` interface.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

const BIN = path.resolve(process.cwd(), 'dist/bin/crawl.js');

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface RunOpts {
  timeoutMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn the built binary in a child process and buffer its output. Every
 * invocation has an explicit timeout (SIGKILL) so a hung subprocess cannot
 * hang the vitest worker.
 */
function runBin(args: readonly string[], opts?: RunOpts): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd: opts?.cwd ?? process.cwd(),
      env: opts?.env ?? { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString('utf8');
    });
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString('utf8');
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), opts?.timeoutMs ?? 60_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

const GATED = process.env['RUN_CLI_NETWORK_TESTS'] === '1';

describe('crawl CLI integration', () => {
  // Guard: if dist/bin/crawl.js is missing, fail loudly. The test pipeline
  // either builds explicitly before running vitest, or the prepack chain
  // runs. If neither has happened yet, these tests can't proceed — bail out
  // with a message pointing the developer at Plan 04-01's build step.
  beforeAll(() => {
    if (!existsSync(BIN)) {
      throw new Error(
        `dist/bin/crawl.js not found at ${BIN}. Run "npm run build" first (see Phase 4 Plan 01).`,
      );
    }
    const firstLine = readFileSync(BIN, 'utf8').split('\n')[0] ?? '';
    if (!firstLine.startsWith('#!')) {
      throw new Error(
        `dist/bin/crawl.js is missing the shebang on line 1 (got: ${JSON.stringify(firstLine)}).`,
      );
    }
  });

  it('crawl --help prints top-level usage with the run subcommand and tagline', async () => {
    const r = await runBin(['--help'], { timeoutMs: 10_000 });
    expect(r.code).toBe(0);
    // Commander's default prefix
    expect(r.stdout).toMatch(/Usage: crawl/i);
    // The only subcommand is listed under Commands
    expect(r.stdout).toContain('run');
    // Project tagline (from package.json.description, rendered via commander)
    expect(r.stdout).toContain('Markdown-configured');
    // --help must not leak anything to stderr
    expect(r.stderr).toBe('');
  });

  it('crawl run --help lists NAVER_ID, NAVER_PW, CRAWL_HEADED_TIMEOUT_MS + exit codes 0 and 1', async () => {
    const r = await runBin(['run', '--help'], { timeoutMs: 10_000 });
    expect(r.code).toBe(0);
    // Usage line with the positional arg
    expect(r.stdout).toMatch(/Usage: crawl run/i);
    expect(r.stdout).toContain('<file>');
    // Env var block — required env vars
    expect(r.stdout).toContain('NAVER_ID');
    expect(r.stdout).toContain('NAVER_PW');
    expect(r.stdout).toContain('CRAWL_HEADED_TIMEOUT_MS');
    // Exit code block — must mention both codes near the word "exit"
    expect(r.stdout).toMatch(/exit/i);
    expect(r.stdout).toMatch(/\b0\b/);
    expect(r.stdout).toMatch(/\b1\b/);
    // Help output does not contaminate stderr
    expect(r.stderr).toBe('');
  });

  it('crawl run <nonexistent>.md exits 1 with scrubbed stderr and never launches Chromium', async () => {
    const missing = `/tmp/gsd-plan04-test-missing-${process.pid}-${Date.now()}.md`;
    const r = await runBin(['run', missing], { timeoutMs: 10_000 });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('config not found:');
    // The basename substring survives any path-scrubbing transform
    expect(r.stderr).toContain('gsd-plan04-test-missing-');
    // Success summary must NOT have been written
    expect(r.stdout).toBe('');
    // Pre-flight fails before runCrawl is called — no browser bootstrap path
    const combined = r.stdout + r.stderr;
    expect(combined.toLowerCase()).not.toContain('chromium');
    expect(combined.toLowerCase()).not.toContain('playwright');
    expect(combined.toLowerCase()).not.toContain('launching');
  });

  it('crawl run --quiet <nonexistent>.md suppresses BOTH streams and still exits 1', async () => {
    const missing = `/tmp/gsd-plan04-quiet-missing-${process.pid}-${Date.now()}.md`;
    const r = await runBin(['run', '--quiet', missing], { timeoutMs: 10_000 });
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe('');
  });

  it('crawl run -v <nonexistent>.md still writes the pre-flight error to stderr and exits 1', async () => {
    const missing = `/tmp/gsd-plan04-verbose-missing-${process.pid}-${Date.now()}.md`;
    const r = await runBin(['run', '-v', missing], { timeoutMs: 10_000 });
    expect(r.code).toBe(1);
    expect(r.stderr.length).toBeGreaterThan(0);
    expect(r.stderr).toContain('config not found:');
  });

  // Companion to the --verbose test: an EXISTING but syntactically broken
  // config file exercises the verbose progress path (`→ parsing config` +
  // `→ writing output`) that runs AFTER pre-flight passes. A nonexistent
  // path can't reach that code — pre-flight returns early — so we need an
  // existing fixture to witness the arrow hints. The config_parse failure
  // in runCrawl still maps to exit 1 via resolveExitCode.
  it('crawl run -v <existing-but-broken>.md emits the → parsing arrow and summary before exiting 1', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-cli-verbose-'));
    const broken = path.join(dir, 'broken.md');
    try {
      await writeFile(broken, 'not a valid crawl config\n', 'utf8');
      const r = await runBin(['run', '-v', broken], { timeoutMs: 15_000 });
      expect(r.code).toBe(1);
      // Arrow progress line fired — U+2192 →
      expect(r.stderr).toContain('\u2192');
      expect(r.stderr).toContain('parsing');
      // Error summary for the config_parse code
      expect(r.stderr).toContain('config_parse');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // Sentinel: when the network gate is CLOSED, record a single informative
  // skip line so CI / reviewers see the test exists but is intentionally
  // skipped. Mirrors the Phase 3 gated-integration pattern.
  describe.skipIf(GATED)('network-gated happy path (skipped)', () => {
    it.skip('CLI network test skipped — set RUN_CLI_NETWORK_TESTS=1 to run', () => {
      // This block is intentionally a no-op. The real assertions live in the
      // `skipIf(!GATED)` sibling below.
    });
  });

  describe.skipIf(!GATED)('network-gated happy path (live)', () => {
    let tempDir: string | undefined;

    afterEach(async () => {
      if (tempDir !== undefined) {
        await rm(tempDir, { recursive: true, force: true });
        tempDir = undefined;
      }
    });

    it('crawl run <valid-public-fixture>.md exits 0 and round-trips Output to disk', async () => {
      // Copy the repo fixture to a throwaway dir so the post-run writeback
      // does not dirty the working tree.
      tempDir = await mkdtemp(path.join(os.tmpdir(), 'crawl-cli-happy-'));
      const src = path.resolve(process.cwd(), 'test/fixtures/cli/minimal-public.md');
      const job = path.join(tempDir, 'job.md');
      await writeFile(job, await readFile(src, 'utf8'), 'utf8');

      const r = await runBin(['run', job], { timeoutMs: 60_000 });
      expect(r.code).toBe(0);
      // stdout summary: `✓ <field>: <value>` — first field is `title`
      expect(r.stdout).toContain('title');
      // Output section was written back
      const onDisk = await readFile(job, 'utf8');
      expect(onDisk).toMatch(/^# Output/m);
    });
  });
});
