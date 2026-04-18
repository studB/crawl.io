import { describe, it, expect } from 'vitest';
import { access, mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  SESSION_FILENAME,
  sessionFilePath,
  sessionExists,
  sessionLooksValid,
  readSession,
  writeSession,
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

  // --- M-03: sessionLooksValid ---

  it('sessionLooksValid: missing file → false', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      await expect(sessionLooksValid(dir)).resolves.toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sessionLooksValid: zero-byte file → false (corrupt / truncated session)', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      await writeFile(path.join(dir, SESSION_FILENAME), '', 'utf8');
      await expect(sessionLooksValid(dir)).resolves.toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sessionLooksValid: garbage non-JSON → false', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      await writeFile(path.join(dir, SESSION_FILENAME), 'not json{{{', 'utf8');
      await expect(sessionLooksValid(dir)).resolves.toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sessionLooksValid: valid JSON but missing cookies array → false', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      await writeFile(path.join(dir, SESSION_FILENAME), '{"origins":[]}', 'utf8');
      await expect(sessionLooksValid(dir)).resolves.toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('sessionLooksValid: valid Playwright storageState shape → true', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      await writeFile(
        path.join(dir, SESSION_FILENAME),
        '{"cookies":[],"origins":[]}',
        'utf8',
      );
      await expect(sessionLooksValid(dir)).resolves.toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // --- H-02: writeSession atomicity ---

  it('writeSession: happy path writes the final file via tmp then rename', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      await writeSession(dir, async (tmp) => {
        // The callback gets a tmp path adjacent to the final file — prove
        // by writing to it. Path must live in `dir` so rename is atomic.
        expect(path.dirname(tmp)).toBe(dir);
        expect(tmp).not.toBe(path.join(dir, SESSION_FILENAME));
        await writeFile(tmp, '{"cookies":[],"origins":[]}', 'utf8');
      });
      const final = path.join(dir, SESSION_FILENAME);
      await expect(access(final)).resolves.toBeUndefined();
      await expect(readFile(final, 'utf8')).resolves.toBe(
        '{"cookies":[],"origins":[]}',
      );
      // Tmp must not linger after a successful rename.
      const entries = await readdir(dir);
      expect(entries).toEqual([SESSION_FILENAME]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writeSession: callback throws → tmp is cleaned up and error propagates', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      let threw: unknown;
      try {
        await writeSession(dir, async (tmp) => {
          // Simulate Playwright failing mid-serialize: write a partial tmp,
          // then throw. writeSession MUST clean up the tmp and propagate
          // the original error.
          await writeFile(tmp, 'partial-garbage', 'utf8');
          throw new Error('simulated playwright serialize failure');
        });
      } catch (e) {
        threw = e;
      }
      expect(threw).toBeInstanceOf(Error);
      expect((threw as Error).message).toContain('simulated playwright serialize failure');
      // Final file does NOT exist (rename was never reached).
      const final = path.join(dir, SESSION_FILENAME);
      let exists = true;
      try {
        await access(final);
      } catch {
        exists = false;
      }
      expect(exists).toBe(false);
      // Tmp is cleaned up — directory is empty.
      const entries = await readdir(dir);
      expect(entries).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writeSession: callback throws BEFORE creating the tmp → unlink ENOENT is swallowed, original error propagates', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'crawl-sess-'));
    try {
      let threw: unknown;
      try {
        await writeSession(dir, async (_tmp) => {
          throw new Error('failed before creating tmp');
        });
      } catch (e) {
        threw = e;
      }
      // The original error must propagate — the "tmp never existed" unlink
      // error must NOT shadow it.
      expect(threw).toBeInstanceOf(Error);
      expect((threw as Error).message).toBe('failed before creating tmp');
      const entries = await readdir(dir);
      expect(entries).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
