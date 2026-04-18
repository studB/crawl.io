import { describe, it, expect, vi } from 'vitest';

import { descendToFrame } from './frame';

// These tests are PURE — no Playwright import, no browser launch. They lock the
// fold-left semantics of descendToFrame and the no-op early-return behavior.
// Frame-presence failures are detected in extract.ts, not here.

describe('descendToFrame', () => {
  it('returns the page unchanged when framePath is undefined (no frameLocator call)', () => {
    const frameLocator = vi.fn();
    const fakePage = { frameLocator } as unknown as Parameters<typeof descendToFrame>[0];

    const result = descendToFrame(fakePage);

    expect(result).toBe(fakePage);
    expect(frameLocator).toHaveBeenCalledTimes(0);
  });

  it('returns the page unchanged when framePath is an empty array (same as undefined)', () => {
    const frameLocator = vi.fn();
    const fakePage = { frameLocator } as unknown as Parameters<typeof descendToFrame>[0];

    const result = descendToFrame(fakePage, []);

    expect(result).toBe(fakePage);
    expect(frameLocator).toHaveBeenCalledTimes(0);
  });

  it('single-level descent: calls frameLocator(selector) exactly once and returns its result', () => {
    const fakeFrame = { tag: 'level-1' };
    const frameLocator = vi.fn().mockReturnValue(fakeFrame);
    const fakePage = { frameLocator } as unknown as Parameters<typeof descendToFrame>[0];

    const result = descendToFrame(fakePage, ['iframe#main']);

    expect(frameLocator).toHaveBeenCalledTimes(1);
    expect(frameLocator).toHaveBeenCalledWith('iframe#main');
    expect(result).toBe(fakeFrame);
  });

  it('two-level descent: folds left so the second frameLocator is invoked on the first result', () => {
    const fakeDeep = { tag: 'level-2' };
    const midFrameLocator = vi.fn().mockReturnValue(fakeDeep);
    const fakeMid = { frameLocator: midFrameLocator, tag: 'level-1' };

    const topFrameLocator = vi.fn().mockReturnValue(fakeMid);
    const fakePage = { frameLocator: topFrameLocator } as unknown as Parameters<typeof descendToFrame>[0];

    const result = descendToFrame(fakePage, ['iframe.a', 'iframe.b']);

    expect(topFrameLocator).toHaveBeenCalledTimes(1);
    expect(topFrameLocator).toHaveBeenCalledWith('iframe.a');
    expect(midFrameLocator).toHaveBeenCalledTimes(1);
    expect(midFrameLocator).toHaveBeenCalledWith('iframe.b');
    expect(result).toBe(fakeDeep);
  });

  it('three-level descent: fold goes arbitrarily deep and preserves call order', () => {
    const fakeDeepest = { tag: 'level-3' };
    const level2FrameLocator = vi.fn().mockReturnValue(fakeDeepest);
    const fakeLevel2 = { frameLocator: level2FrameLocator, tag: 'level-2' };

    const level1FrameLocator = vi.fn().mockReturnValue(fakeLevel2);
    const fakeLevel1 = { frameLocator: level1FrameLocator, tag: 'level-1' };

    const topFrameLocator = vi.fn().mockReturnValue(fakeLevel1);
    const fakePage = { frameLocator: topFrameLocator } as unknown as Parameters<typeof descendToFrame>[0];

    const result = descendToFrame(fakePage, ['iframe.a', 'iframe.b', 'iframe.c']);

    expect(topFrameLocator).toHaveBeenCalledWith('iframe.a');
    expect(level1FrameLocator).toHaveBeenCalledWith('iframe.b');
    expect(level2FrameLocator).toHaveBeenCalledWith('iframe.c');
    // Verify the deepest frame is returned (arbitrary-depth fold).
    expect(result).toBe(fakeDeepest);

    // And confirm each sub-frameLocator was called exactly once.
    expect(topFrameLocator).toHaveBeenCalledTimes(1);
    expect(level1FrameLocator).toHaveBeenCalledTimes(1);
    expect(level2FrameLocator).toHaveBeenCalledTimes(1);
  });
});
