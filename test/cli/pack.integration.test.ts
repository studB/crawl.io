/**
 * Phase 4 Plan 03 — npm packaging integration tests.
 *
 * Three end-to-end publish-readiness gates:
 *
 *   1. `npm pack --dry-run --json` — parse the JSON manifest and assert
 *      the tarball allowlist (dist/, package.json, README.md, LICENSE)
 *      and denylist (src/, test/, .planning/, node_modules/, vitest
 *      config, tsconfig). T-04-05 / T-04-09 mitigation lives here.
 *   2. Real `npm pack --pack-destination <tmp>` → `tar -xzf` → assert
 *      `<tmp>/package/dist/bin/crawl.js` exists, is executable, first
 *      line is `#!/usr/bin/env node` (shebang survived compress/extract
 *      round-trip — T-04-12 mitigation), and running it with
 *      `--help` exits 0. `NODE_PATH` points at the repo's node_modules
 *      so `commander` is resolvable without running `npm install`
 *      inside the extracted tree — the test cares about BIN integrity
 *      and shebang preservation, not about reproducing npm's install
 *      mechanics.
 *   3. `npm publish --dry-run` — the final CLI-05 publish-readiness
 *      gate. Must exit 0 AND the command must advertise a tarball
 *      manifest (`tarball` / `filename` mention + package name).
 *
 * Subprocess safety:
 *   - Every spawn has an explicit `setTimeout(kill('SIGKILL'), …)` so a
 *     hung `npm pack` / `tar` / `npm publish` cannot hang the vitest
 *     worker (T-04-11 mitigation).
 *   - Test 3 NEVER invokes `npm publish` without `--dry-run` — the
 *     flag is a hard-coded string literal in the args array (T-04-10).
 *
 * Skip gate: `SKIP_PACK_TESTS=1` opts out locally — useful for
 * bandwidth-constrained dev loops. Default is to run.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO_ROOT = process.cwd();
const BIN = path.resolve(REPO_ROOT, 'dist/bin/crawl.js');

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface SpawnOpts {
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

/**
 * Spawn an executable and buffer its output. Explicit timeout so a hung
 * subprocess cannot hang the vitest worker. Uses shell=false to avoid
 * word-splitting surprises; all args are passed as an array.
 */
function runCmd(cmd: string, args: readonly string[], opts?: SpawnOpts): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      cwd: opts?.cwd ?? REPO_ROOT,
      env: opts?.env ?? { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
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

interface PackManifestFile {
  readonly path: string;
  readonly size: number;
  readonly mode: number;
}

interface PackManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly files: readonly PackManifestFile[];
  readonly entryCount: number;
}

const SKIP = process.env['SKIP_PACK_TESTS'] === '1';

describe.skipIf(SKIP)('npm packaging integration', () => {
  // Ensure dist is present. prepack would build on every pack anyway, but
  // Test 1 inspects the ALREADY-present dist the first time through, so
  // guard against a cold checkout with no dist/ yet.
  //
  // IN-01 side effect: on a cold checkout (no dist/), this beforeAll
  // runs `npm run build` which writes to dist/. Subsequent `git status`
  // will show dist/ as untracked (dist/ is gitignored so it does NOT
  // pollute the working tree in a tracked sense, but the directory is
  // created as a side effect of running this integration test).
  // Acceptable for an integration test; flagged for discoverability.
  beforeAll(async () => {
    if (!existsSync(BIN)) {
      const r = await runCmd('npm', ['run', 'build'], { timeoutMs: 120_000 });
      if (r.code !== 0) {
        throw new Error(
          `npm run build failed (exit ${r.code}) — cannot run pack tests.\nstderr:\n${r.stderr}`,
        );
      }
    }
  }, 120_000);

  it('npm pack --dry-run --json lists the correct tarball contents', async () => {
    const r = await runCmd('npm', ['pack', '--dry-run', '--json'], { timeoutMs: 120_000 });
    expect(r.code).toBe(0);

    const parsed = JSON.parse(r.stdout) as readonly PackManifestEntry[];
    expect(parsed.length).toBe(1);
    const entry = parsed[0] as PackManifestEntry;
    expect(entry.name).toBe('crawl.io');

    const paths = entry.files.map((f) => f.path);

    // Expected inclusions — each asserted explicitly so a failure names
    // the exact missing file.
    const expectedIncluded: readonly string[] = [
      'dist/index.js',
      'dist/index.d.ts',
      'dist/bin/crawl.js',
      'dist/cli/cli.js',
      'dist/cli/run.js',
      'dist/cli/exit.js',
      'package.json',
      'README.md',
      'LICENSE',
    ];
    for (const want of expectedIncluded) {
      expect(paths, `missing from tarball: ${want}`).toContain(want);
    }

    // Forbidden prefixes — any path starting with one of these leaks
    // private source / tests / planning docs into the tarball.
    const forbiddenPrefixes: readonly string[] = [
      'src/',
      'test/',
      '.planning/',
      'node_modules/',
    ];
    for (const pfx of forbiddenPrefixes) {
      const leaks = paths.filter((p) => p.startsWith(pfx));
      expect(leaks, `tarball leaked ${pfx} paths: ${leaks.join(', ')}`).toEqual([]);
    }

    // Specific files that must NOT be in the tarball even at the root.
    const forbiddenSpecific: readonly string[] = [
      'vitest.config.ts',
      'tsconfig.json',
      '.gitignore',
      '.gitattributes',
    ];
    for (const bad of forbiddenSpecific) {
      expect(paths, `tarball leaked ${bad}`).not.toContain(bad);
    }
  }, 120_000);

  it('npm pack produces a .tgz; extracted dist/bin/crawl.js has the shebang and --help exits 0', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'crawl-pack-'));
    try {
      const packResult = await runCmd('npm', ['pack', '--pack-destination', tmp], {
        timeoutMs: 120_000,
      });
      expect(packResult.code).toBe(0);
      // The tarball filename is echoed to stdout by npm pack
      expect(packResult.stdout).toMatch(/crawl\.io-\d+\.\d+\.\d+\.tgz/);

      // Find the actual tarball (version may advance without needing a test edit)
      const entries = await readdir(tmp);
      const tarballs = entries.filter((e) => e.startsWith('crawl.io-') && e.endsWith('.tgz'));
      expect(tarballs.length).toBe(1);
      const tarball = path.join(tmp, tarballs[0] as string);

      // Extract
      const extract = await runCmd('tar', ['-xzf', tarball, '-C', tmp], { timeoutMs: 30_000 });
      expect(extract.code).toBe(0);

      // After extraction, content lives under `<tmp>/package/`
      const extractedBin = path.join(tmp, 'package', 'dist', 'bin', 'crawl.js');
      expect(existsSync(extractedBin)).toBe(true);

      // Shebang survived tarball round-trip (T-04-12)
      const content = await readFile(extractedBin, 'utf8');
      const firstLine = content.split('\n')[0] ?? '';
      expect(firstLine).toBe('#!/usr/bin/env node');

      // Executable bit preserved through .gitattributes + npm pack
      const info = await stat(extractedBin);
      // On POSIX: at least owner-executable (0100); on Windows CI this is
      // advisory only (fs.stat mode has different meaning). Guard with
      // a platform check.
      if (process.platform !== 'win32') {
        expect(info.mode & 0o100).not.toBe(0);
      }

      // Run the extracted bin — NODE_PATH points at the repo's node_modules
      // so `commander` (the only runtime dep the bin imports) resolves.
      // After `npm install -g`, npm materializes dependencies adjacent to
      // the package; this NODE_PATH shim is the test-local equivalent.
      const helpEnv: NodeJS.ProcessEnv = {
        ...process.env,
        NODE_PATH: path.resolve(REPO_ROOT, 'node_modules'),
      };
      const help = await runCmd(process.execPath, [extractedBin, '--help'], {
        timeoutMs: 15_000,
        env: helpEnv,
      });
      expect(help.code).toBe(0);
      expect(help.stdout).toContain('run');
      expect(help.stdout).toMatch(/Usage: crawl/i);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 180_000);

  it('npm publish --dry-run exits 0 — final CLI-05 publish-readiness gate', async () => {
    // --dry-run is a hard-coded literal — see threat model T-04-10.
    const r = await runCmd('npm', ['publish', '--dry-run'], { timeoutMs: 120_000 });
    expect(r.code).toBe(0);

    // Evidence npm ran the full pipeline (tarball manifest output), not
    // just a cheap exit-on-validation.
    const combined = r.stdout + r.stderr;
    expect(combined).toMatch(/crawl\.io@0\.1\.0/);
    expect(combined.toLowerCase()).toMatch(/tarball|filename/);

    // Sanity: even under --dry-run, `npm publish` must not have pushed
    // anything — evidenced by the command exiting cleanly within our
    // timeout and advertising the dry-run mode in its output.
    expect(combined.toLowerCase()).toContain('dry-run');
  }, 180_000);
});
