/**
 * Test-environment shim for hosts where Chromium's shared-library dependencies
 * (libnspr4, libnss3, libnssutil3, libasound) are NOT installed system-wide.
 *
 * On a typical CI image or dev workstation with `playwright install-deps` run,
 * this file is a no-op. It is only active when a host is missing the libs AND
 * they have been staged to a repo-local directory (see `PLAYWRIGHT_LIBS_DIR`).
 *
 * How to stage the libs without sudo (e.g. under WSL or a rootless container):
 *
 *   mkdir -p /tmp/playwright-libs && cd /tmp/playwright-libs
 *   apt-get download libnspr4 libnss3 libasound2t64
 *   for deb in *.deb; do dpkg-deb -x "$deb" /tmp/playwright-libs/; done
 *
 * The resulting `/tmp/playwright-libs/usr/lib/x86_64-linux-gnu/` is then added
 * to `LD_LIBRARY_PATH` — Chromium, launched by Playwright from this worker,
 * inherits the augmented env and resolves its shared libraries.
 *
 * This is a dev-host convenience, not production code. The crawler itself
 * (src/crawler/*) does not touch LD_LIBRARY_PATH — downstream users install
 * the libs via `playwright install-deps` or their OS package manager.
 */

import { existsSync } from 'node:fs';

const PLAYWRIGHT_LIBS_DIR = '/tmp/playwright-libs/usr/lib/x86_64-linux-gnu';

if (process.platform === 'linux' && existsSync(PLAYWRIGHT_LIBS_DIR)) {
  const existing = process.env['LD_LIBRARY_PATH'] ?? '';
  const already = existing
    .split(':')
    .some((p) => p === PLAYWRIGHT_LIBS_DIR);
  if (!already) {
    process.env['LD_LIBRARY_PATH'] =
      existing.length > 0 ? `${PLAYWRIGHT_LIBS_DIR}:${existing}` : PLAYWRIGHT_LIBS_DIR;
  }
}
