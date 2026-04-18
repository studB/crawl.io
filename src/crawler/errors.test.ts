import { describe, it, expect } from 'vitest';

import { CrawlError } from './errors';
import type { CrawlErrorCode } from './types';

describe('CrawlError', () => {
  it('is an instance of Error and CrawlError, with name + code + detail + formatted message', () => {
    const err = new CrawlError('timeout', 'waitFor #post failed after 30000ms');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CrawlError);
    expect(err.name).toBe('CrawlError');
    expect(err.code).toBe('timeout');
    expect(err.detail).toBe('waitFor #post failed after 30000ms');
    // message format: [code] detail
    expect(err.message).toBe('[timeout] waitFor #post failed after 30000ms');
    expect(err.message).toContain('timeout');
    expect(err.message).toContain('waitFor #post failed after 30000ms');
  });

  it('omits detail entirely when not provided (exactOptionalPropertyTypes compliant)', () => {
    const err = new CrawlError('network');
    expect(err.code).toBe('network');
    // Property must NOT exist on the instance when detail is omitted.
    expect('detail' in err).toBe(false);
    expect(err.detail).toBeUndefined();
    // Message has no trailing space, no trailing colon.
    expect(err.message).toBe('[network]');
  });

  it('accepts every CrawlErrorCode literal and round-trips it as err.code', () => {
    const codes: CrawlErrorCode[] = [
      'timeout',
      'selector_miss',
      'network',
      'frame_not_found',
      'extraction_failed',
      'config_parse',
      'auth_missing_credentials',
      'auth_failed',
      'captcha_unresolved',
      'unknown',
    ];
    for (const code of codes) {
      const err = new CrawlError(code);
      expect(err.code).toBe(code);
      expect(err).toBeInstanceOf(CrawlError);
    }
    // Lock the union size so accidentally removing a variant fails the test.
    expect(codes).toHaveLength(10);
  });

  it('has the CrawlError prototype wired via Object.setPrototypeOf for cross-realm instanceof', () => {
    // Mirrors src/config/errors.test.ts — confirms the prototype-chain fix.
    const err = new CrawlError('extraction_failed', 'nth-child(3) had no text');
    expect(Object.getPrototypeOf(err)).toBe(CrawlError.prototype);
    expect(err instanceof CrawlError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('exposes code and detail as readonly at the TypeScript level', () => {
    const err = new CrawlError('selector_miss', 'h1 not found');
    // @ts-expect-error code is readonly
    err.code = 'network';
    // @ts-expect-error detail is readonly
    err.detail = 'changed';
    // Runtime assignment is NOT blocked (readonly is compile-time only) —
    // the guarantee here is the compile-time check, so we just assert that
    // the test file itself typechecks with @ts-expect-error consuming the
    // errors. Runtime state is intentionally not asserted.
    expect(err.name).toBe('CrawlError');
  });
});
