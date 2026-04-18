#!/usr/bin/env node
/**
 * crawl — CLI entry point.
 *
 * Shebang preservation: TypeScript 5+ emits a leading `#!` line verbatim
 * in CJS output, so `dist/bin/crawl.js` begins with `#!/usr/bin/env node`.
 * `package.json`'s `bin` field (populated in Plan 02) points at that
 * compiled file so `npm install -g crawl.io` symlinks `crawl` → this
 * script on the user's PATH. Plan 01 verifies `head -1 dist/bin/crawl.js`
 * matches the shebang exactly; Plan 03 re-verifies after a pack round-trip.
 *
 * This file is intentionally thin: import runCli, invoke it, catch any
 * top-level unhandled rejection and translate it into a scrubbed stderr
 * line + exit 1. All subcommand-specific exit logic lives in
 * src/cli/run.ts (runHandler returns 0 | 1, commander's action wrapper
 * calls the platform exit primitive).
 */

import { runCli } from '../cli/cli';
import { scrubPaths } from '../crawler/output';

runCli().catch((err: unknown) => {
  // MD-04 / T-04-01: route the fatal message through scrubPaths so any
  // absolute home-directory path surfaced by an upstream throw (commander
  // internal, require resolution, a future refactor) is redacted BEFORE
  // it hits stderr. Stack is deliberately suppressed — if a future
  // maintainer adds a verbose stack dump here, scrub it too.
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write('\u2717 fatal: ' + scrubPaths(msg) + '\n');
  process.exit(1);
});
