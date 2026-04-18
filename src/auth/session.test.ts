import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  SESSION_FILENAME,
  sessionFilePath,
  sessionExists,
  readSession,
} from './session';

describe('session module', () => {
  it('SESSION_FILENAME is the locked literal ".crawl-session.json"', () => {
    expect(SESSION_FILENAME).toBe('.crawl-session.json');
  });

  it('sessionFilePath joins the supplied cwd with SESSION_FILENAME', () => {
    const p = sessionFilePath('/tmp/example');
    expect(p).toBe(path.resolve('/tmp/example', '.crawl-session.json'));
  });

  it('sessionExists returns false when the file is missing', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      await expect(sessionExists(dir)).resolves.toBe(false);
      await expect(readSession(dir)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sessionExists + readSession round-trip a written session', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      const payload = '{"cookies":[],"origins":[]}';
      await writeFile(path.join(dir, SESSION_FILENAME), payload, 'utf8');
      await expect(sessionExists(dir)).resolves.toBe(true);
      await expect(readSession(dir)).resolves.toBe(payload);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
