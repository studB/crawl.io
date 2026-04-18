import { describe, it, expect } from 'vitest';
import { ConfigParseError } from './errors';

describe('ConfigParseError', () => {
  it('is an instance of Error and ConfigParseError', () => {
    const err = new ConfigParseError(['missing url']);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConfigParseError);
    expect(err.name).toBe('ConfigParseError');
  });

  it('exposes the issues array passed in', () => {
    const issues = ['missing url', 'invalid yaml in selectors'];
    const err = new ConfigParseError(issues);
    expect(err.issues).toEqual(issues);
  });

  it('joins issues into the message', () => {
    const err = new ConfigParseError(['a', 'b']);
    expect(err.message).toBe('a\nb');
  });

  it('omits filePath when not provided', () => {
    const err = new ConfigParseError(['x']);
    expect(err.filePath).toBeUndefined();
    expect('filePath' in err).toBe(false);
  });

  it('stores filePath when provided', () => {
    const err = new ConfigParseError(['x'], { filePath: '/tmp/job.md' });
    expect(err.filePath).toBe('/tmp/job.md');
  });
});
