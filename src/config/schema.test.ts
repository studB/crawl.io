import { describe, it, expect } from 'vitest';
import { SelectorSpecSchema, RulesSchema, CrawlJobSchema } from './schema';

describe('SelectorSpecSchema', () => {
  it('applies default engine css when omitted', () => {
    const out = SelectorSpecSchema.parse({ selector: '#foo' });
    expect(out).toEqual({ selector: '#foo', engine: 'css' });
    expect('frame' in out).toBe(false);
  });

  it('preserves engine=xpath when provided', () => {
    const out = SelectorSpecSchema.parse({ selector: '//h1', engine: 'xpath' });
    expect(out.engine).toBe('xpath');
    expect('frame' in out).toBe(false);
  });

  it('accepts a frame array for nested iframes', () => {
    const out = SelectorSpecSchema.parse({
      selector: '#title',
      frame: ['iframe#cafe_main', 'iframe#inner'],
    });
    expect(out.frame).toEqual(['iframe#cafe_main', 'iframe#inner']);
    expect(out.engine).toBe('css');
  });

  it('rejects invalid engine value with a descriptive issue', () => {
    const r = SelectorSpecSchema.safeParse({ selector: '#x', engine: 'dom' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/engine/);
    }
  });

  it('rejects unknown keys under strict mode', () => {
    const r = SelectorSpecSchema.safeParse({ selector: '#x', foo: 'bar' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/foo|unrecognized/i);
    }
  });

  it('rejects missing selector', () => {
    const r = SelectorSpecSchema.safeParse({ engine: 'css' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/selector/);
    }
  });

  it('rejects non-string selector', () => {
    const r = SelectorSpecSchema.safeParse({ selector: 123 });
    expect(r.success).toBe(false);
  });

  it('rejects empty-string selector', () => {
    const r = SelectorSpecSchema.safeParse({ selector: '' });
    expect(r.success).toBe(false);
  });

  it('rejects non-array frame', () => {
    const r = SelectorSpecSchema.safeParse({ selector: '#x', frame: 'iframe#outer' });
    expect(r.success).toBe(false);
  });

  it('first/attributes default to absent keys (defaults stripped)', () => {
    const out = SelectorSpecSchema.parse({ selector: '#x' });
    expect('first' in out).toBe(false);
    expect('attributes' in out).toBe(false);
  });

  it('first: false is preserved on the output object', () => {
    const out = SelectorSpecSchema.parse({ selector: '#x', first: false });
    expect(out.first).toBe(false);
  });

  it('first: true is stripped (matches default)', () => {
    const out = SelectorSpecSchema.parse({ selector: '#x', first: true });
    expect('first' in out).toBe(false);
  });

  it('attributes: true is preserved on the output object', () => {
    const out = SelectorSpecSchema.parse({ selector: '#x', attributes: true });
    expect(out.attributes).toBe(true);
  });

  it('attributes: false is stripped (matches default)', () => {
    const out = SelectorSpecSchema.parse({ selector: '#x', attributes: false });
    expect('attributes' in out).toBe(false);
  });

  it('rejects non-boolean first', () => {
    const r = SelectorSpecSchema.safeParse({ selector: '#x', first: 'yes' });
    expect(r.success).toBe(false);
  });

  it('rejects non-boolean attributes', () => {
    const r = SelectorSpecSchema.safeParse({ selector: '#x', attributes: 1 });
    expect(r.success).toBe(false);
  });
});

describe('RulesSchema', () => {
  it('applies default timeout=30000 when omitted', () => {
    const out = RulesSchema.parse({});
    expect(out).toEqual({ timeout: 30000 });
    expect('waitFor' in out).toBe(false);
  });

  it('preserves waitFor when provided and fills default timeout', () => {
    const out = RulesSchema.parse({ waitFor: '#ready' });
    expect(out.waitFor).toBe('#ready');
    expect(out.timeout).toBe(30000);
  });

  it('preserves a custom timeout', () => {
    const out = RulesSchema.parse({ timeout: 5000 });
    expect(out.timeout).toBe(5000);
    expect('waitFor' in out).toBe(false);
  });

  it('rejects negative timeout', () => {
    const r = RulesSchema.safeParse({ timeout: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects non-numeric timeout', () => {
    const r = RulesSchema.safeParse({ timeout: 'slow' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown top-level key (strict mode)', () => {
    const r = RulesSchema.safeParse({ retries: 3 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/retries|unrecognized/i);
    }
  });
});

describe('CrawlJobSchema', () => {
  it('parses a full valid job with defaults applied', () => {
    const out = CrawlJobSchema.parse({
      url: 'https://cafe.naver.com/xxx',
      collectors: { title: { selector: 'h1' } },
      rules: {},
    });
    expect(out.url).toBe('https://cafe.naver.com/xxx');
    expect(out.collectors?.['title']?.engine).toBe('css');
    expect(out.rules.timeout).toBe(30000);
    expect('waitFor' in out.rules).toBe(false);
  });

  it('round-trips a multi-field job with frame arrays and xpath engine', () => {
    const out = CrawlJobSchema.parse({
      url: 'https://cafe.naver.com/xxx/1',
      collectors: {
        title: { selector: '//h1', engine: 'xpath', frame: ['iframe#cafe_main'] },
        body: { selector: 'div.se-main-container' },
      },
      rules: { waitFor: 'iframe#cafe_main', timeout: 15000 },
    });
    expect(out.collectors?.['title']?.engine).toBe('xpath');
    expect(out.collectors?.['title']?.frame).toEqual(['iframe#cafe_main']);
    expect(out.collectors?.['body']?.engine).toBe('css');
    expect(out.rules.waitFor).toBe('iframe#cafe_main');
    expect(out.rules.timeout).toBe(15000);
  });

  it('rejects invalid url', () => {
    const r = CrawlJobSchema.safeParse({
      url: 'not a url',
      collectors: { a: { selector: '#x' } },
      rules: {},
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty collectors map', () => {
    const r = CrawlJobSchema.safeParse({
      url: 'https://x.test',
      collectors: {},
      rules: {},
    });
    expect(r.success).toBe(false);
  });

  it('rejects a job declaring BOTH collectors and actions (XOR refine)', () => {
    const r = CrawlJobSchema.safeParse({
      url: 'https://x.test',
      collectors: { a: { selector: '#x' } },
      actions: [{ action: 'click', selector: 'button' }],
      rules: {},
    });
    expect(r.success).toBe(false);
  });

  it('rejects a job declaring NEITHER collectors nor actions (XOR refine)', () => {
    const r = CrawlJobSchema.safeParse({
      url: 'https://x.test',
      rules: {},
    });
    expect(r.success).toBe(false);
  });

  it('parses an Actions-only job (no collectors) with default engine on selector actions', () => {
    const r = CrawlJobSchema.safeParse({
      url: 'https://x.test',
      actions: [
        { action: 'type', selector: 'textarea', value: 'hi' },
        { action: 'click', selector: 'button.submit' },
        { action: 'waitFor', selector: '.ack' },
        { action: 'goto', url: 'https://x.test/next' },
      ],
      rules: {},
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.collectors).toBeUndefined();
      expect(r.data.actions?.length).toBe(4);
    }
  });

  it('rejects unknown top-level key (strict mode)', () => {
    const r = CrawlJobSchema.safeParse({
      url: 'https://x.test',
      collectors: { a: { selector: '#x' } },
      rules: {},
      extraKey: 'nope',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toMatch(/extraKey|unrecognized/i);
    }
  });
});
