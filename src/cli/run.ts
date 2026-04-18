/**
 * `crawl run <file>` — the only subcommand in v1.
 *
 * Boundary:
 *   - CLI → library: we reach for `runCrawl` through the public barrel
 *     `../index`, never into `../crawler/runner` directly (CLI-02: the
 *     library surface is the public contract).
 *   - CLI → fs: the pre-flight existence check uses `fs.access`. On miss,
 *     we emit `✗ config not found: <scrubbed>` to stderr and return `1`
 *     WITHOUT invoking `runCrawl` — fail fast, no Chromium launch for a
 *     typo'd path (see 04-CONTEXT.md §Specific Ideas).
 *   - Exit code mapping: delegated to `resolveExitCode` (pure function in
 *     ./exit.ts) so OUT-05 is enforced in exactly one place.
 *
 * The handler is test-friendly: every side-effect goes through the
 * `RunDeps` dependency bundle (runCrawl, stdout, stderr, pathExists),
 * and the handler NEVER calls the platform exit primitive itself —
 * only `registerRunCommand`'s action wrapper does. Tests can therefore
 * call `runHandler(args, mockDeps)` directly and assert on the return
 * code and the mock stdout/stderr buffers without touching the real
 * process, real fs, or real Chromium.
 *
 * Security:
 *   - T-04-01 mitigation: the pre-flight error passes the resolved
 *     absolute path through `scrubPaths` before writing it to stderr,
 *     matching the library's MD-04 path-redaction boundary.
 *   - T-04-02: the error summary `message` is forwarded verbatim from
 *     `result.error.message`, which runCrawl already scrubs internally
 *     before populating — no additional scrubbing needed on the CLI
 *     side (verified by the plan's acceptance tests).
 */

import { Command } from 'commander';
import { access } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';

import { runCrawl } from '../index';
import type { CrawlResult } from '../index';
import { scrubPaths } from '../crawler/output';
import { resolveExitCode } from './exit';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunOptions {
  readonly verbose: boolean;
  readonly quiet: boolean;
}

export interface RunDeps {
  runCrawl: (configPath: string) => Promise<CrawlResult>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  pathExists: (absPath: string) => Promise<boolean>;
}

/**
 * Default dependency bundle — wired to real fs + real runCrawl. Production
 * callers (registerRunCommand's action wrapper) use this; tests substitute.
 */
export const defaultRunDeps: RunDeps = {
  runCrawl,
  stdout: (line: string) => { process.stdout.write(line + '\n'); },
  stderr: (line: string) => { process.stderr.write(line + '\n'); },
  pathExists: async (p: string): Promise<boolean> => {
    try {
      await access(p);
      return true;
    } catch {
      return false;
    }
  },
};

const SUMMARY_MAX_LEN = 80;

/**
 * Truncate a string value for the single-line summary. Values longer than
 * `SUMMARY_MAX_LEN` characters are cut at that length and suffixed with a
 * horizontal ellipsis. The visible payload (pre-ellipsis) is always
 * exactly `SUMMARY_MAX_LEN` characters for long inputs.
 *
 * WR-04(a): collapse whitespace runs (including \r?\n) to a single space
 * BEFORE measuring length. An extracted field matched from a `<pre>` or
 * multi-paragraph text node would otherwise span multiple stdout lines
 * and break the documented single-line `✓ <field>: <value>` contract
 * and any downstream shell piping expecting one line per run.
 */
function truncateForSummary(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  if (oneLine.length <= SUMMARY_MAX_LEN) return oneLine;
  return oneLine.slice(0, SUMMARY_MAX_LEN) + '\u2026';
}

/**
 * Format the success summary line for `deps.stdout`.
 *
 * Shape: `✓ <firstFieldName>: <truncatedValue>` when there is at least
 * one extracted field; otherwise `✓ crawl ok (<durationMs>ms)`.
 */
function successSummary(result: CrawlResult): string {
  const fields = result.fields;
  if (fields !== undefined) {
    const entries = Object.entries(fields);
    if (entries.length > 0) {
      const first = entries[0];
      if (first !== undefined) {
        const [name, value] = first;
        return '\u2713 ' + name + ': ' + truncateForSummary(value);
      }
    }
  }
  // IN-04: Math.round guarantees integer ms output even if a future
  // CrawlResult carries a fractional durationMs.
  return '\u2713 crawl ok (' + Math.round(result.durationMs) + 'ms)';
}

/**
 * Format the error summary line for `deps.stderr`.
 *
 * Shape: `✗ <code>: <message>`. Both `code` and `message` come from the
 * already-scrubbed envelope populated by runCrawl.
 */
function errorSummary(result: CrawlResult): string {
  const err = result.error;
  if (err === undefined) {
    return '\u2717 unknown: crawl failed without detail';
  }
  return '\u2717 ' + err.code + ': ' + err.message;
}

/**
 * Core run-subcommand logic.
 *
 * Contract:
 *   - Always returns `0 | 1` (never throws out of the function — catches
 *     and classifies any exception as `unknown`).
 *   - Never calls the platform exit primitive. The caller
 *     (registerRunCommand's action wrapper) does that AFTER this
 *     function returns.
 *   - Respects `quiet` on every output site (including the pre-flight
 *     "config not found" stderr message).
 *   - Respects `verbose` by emitting a single `→ parsing config (<path>)`
 *     line to stderr before handing off to runCrawl.
 */
export async function runHandler(
  args: { file: string } & RunOptions,
  deps: RunDeps = defaultRunDeps,
): Promise<0 | 1> {
  const abs = resolvePath(args.file);
  const { verbose, quiet } = args;

  // Pre-flight: fail fast on a typo'd path BEFORE launching Chromium.
  const exists = await deps.pathExists(abs);
  if (!exists) {
    if (!quiet) {
      deps.stderr('\u2717 config not found: ' + scrubPaths(abs));
    }
    return 1;
  }

  if (verbose && !quiet) {
    deps.stderr('\u2192 parsing config (' + scrubPaths(abs) + ')');
  }

  let result: CrawlResult;
  try {
    result = await deps.runCrawl(abs);
  } catch (err: unknown) {
    // Defensive: runCrawl's 02-04 contract says it never throws — every
    // failure comes back as `status: 'error'`. We still guard in case a
    // future refactor leaks an exception (better to surface a clean exit 1
    // than crash the CLI).
    //
    // WR-04(b): err.stack is INTENTIONALLY not emitted here. If a future
    // maintainer adds a verbose-mode stack dump (e.g., `if (verbose)
    // deps.stderr(err.stack)`), they MUST route it through scrubPaths
    // first — otherwise the home-directory path embedded in a Node stack
    // frame would bypass the MD-04 / T-04-01 redaction contract.
    if (!quiet) {
      const raw = err instanceof Error ? err.message : String(err);
      deps.stderr('\u2717 unknown: ' + scrubPaths(raw));
    }
    return 1;
  }

  if (verbose && !quiet) {
    deps.stderr('\u2192 writing output (' + result.durationMs + 'ms)');
  }

  if (!quiet) {
    if (result.status === 'ok') {
      deps.stdout(successSummary(result));
    } else {
      deps.stderr(errorSummary(result));
    }
  }

  return resolveExitCode(result);
}

/**
 * Attach the `run` subcommand to a commander program.
 *
 * Returns the program so callers can chain further subcommand registrations
 * (CLI-02: subcommand structure is the extension axis, no edits to
 * src/bin/crawl.ts or this handler required to add `validate`, `init`, etc.).
 */
export function registerRunCommand(program: Command): Command {
  program
    .command('run <file>')
    .description('Run a single crawl job defined by the given markdown file')
    .option('-v, --verbose', 'print every stage with timing', false)
    .option('-q, --quiet', 'suppress stdout and stderr (exit code only)', false)
    .addHelpText(
      'after',
      [
        '',
        'Environment variables:',
        '  NAVER_ID                   Naver login id (required for Naver Cafe targets)',
        '  NAVER_PW                   Naver login password (required for Naver Cafe targets)',
        '  CRAWL_HEADED_TIMEOUT_MS    Optional — headed-fallback poll timeout (ms, default 300000)',
        '',
        'Exit codes:',
        '  0  success — crawl completed and output was written',
        '  1  failure — any error (config parse, timeout, auth, extraction, etc.)',
        '',
      ].join('\n'),
    )
    .action(async (file: string, opts: { verbose?: boolean; quiet?: boolean }) => {
      const code = await runHandler({
        file,
        verbose: Boolean(opts.verbose),
        quiet: Boolean(opts.quiet),
      });
      process.exit(code);
    });

  return program;
}
