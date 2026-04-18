/**
 * Top-level commander program for the `crawl` binary.
 *
 * Two exports:
 *   - `buildProgram()` — pure factory returning a wired Command. No argv
 *     parse, no I/O, no side effects. Unit tests can construct the program
 *     and introspect its subcommands without consuming argv or touching the
 *     platform exit primitive.
 *   - `runCli(argv)` — the entry point wired by src/bin/crawl.ts. Builds
 *     the program, parses argv asynchronously, and returns when parsing
 *     finishes. Each subcommand's own action handler owns its final
 *     exit (runHandler returns an exit code and `registerRunCommand`'s
 *     action wrapper calls the platform exit primitive — keeps the
 *     orchestration concern out of this file).
 *
 * Extensibility (CLI-02): adding a second verb (e.g., `validate`, `init`)
 * is a one-liner here — call a new `registerValidateCommand(program)`
 * alongside `registerRunCommand(program)`. `src/bin/crawl.ts` stays
 * untouched; `runHandler` stays untouched; the existing `run` tests stay
 * green because registerRunCommand registers ONLY the `run` subcommand.
 */

import { Command } from 'commander';

import { registerRunCommand } from './run';

/**
 * Build the top-level `crawl` commander program.
 *
 * Pure factory — no argv consumption, no I/O, no side effects. The caller
 * (`runCli` or a unit test) drives it via `parseAsync` or introspection.
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('crawl')
    .description(
      'Markdown-configured web crawler — one .md file fully describes a crawl job and carries its own results.',
    )
    .version('0.1.0');

  registerRunCommand(program);

  // Print help after a commander-level error (unknown command, missing arg)
  // so users don't get a bare "error: unknown command" with no hints.
  program.showHelpAfterError();

  return program;
}

/**
 * Entry point used by src/bin/crawl.ts. Parses argv and returns when
 * parsing finishes. Each subcommand's action handler owns its own
 * terminal exit — this function never calls the platform exit primitive.
 */
export async function runCli(argv: readonly string[] = process.argv): Promise<void> {
  const program = buildProgram();
  await program.parseAsync([...argv]);
}
