import { z } from 'zod';
import type { CrawlJob, SelectorSpec } from './types';

/**
 * SelectorSpecSchema — validates a single entry in the selectors map.
 *
 * Defaults: engine omitted -> 'css' (D-07).
 * Strict mode: unknown keys rejected (CFG-06).
 * Transform: when frame is omitted, strip the key entirely so the output
 * object satisfies exactOptionalPropertyTypes (no `frame: undefined` fields).
 */
export const SelectorSpecSchema = z
  .strictObject({
    selector: z.string().min(1, 'selector must be a non-empty string'),
    engine: z.enum(['css', 'xpath']).default('css'),
    frame: z.array(z.string().min(1)).optional(),
    first: z.boolean().default(true),
    attributes: z.boolean().default(false),
  })
  .transform((v): SelectorSpec => {
    const out: SelectorSpec = { selector: v.selector, engine: v.engine };
    if (v.frame !== undefined) out.frame = v.frame;
    // Strip optional fields when they match the default so SelectorSpec
    // objects stay minimal and equality-testable (mirrors the `frame` convention).
    if (v.first === false) out.first = false;
    if (v.attributes === true) out.attributes = true;
    return out;
  });

/**
 * RulesSchema — validates the { waitFor?, timeout } rules block.
 *
 * Defaults: timeout omitted -> 30000 ms (D-07).
 * Strict mode: unknown keys rejected (CFG-06).
 * Transform: when waitFor is omitted, strip the key entirely for
 * exactOptionalPropertyTypes compliance.
 */
export const RulesSchema = z
  .strictObject({
    waitFor: z.string().min(1).optional(),
    timeout: z.number().int().positive().default(30000),
  })
  .transform((v): { waitFor?: string; timeout: number } => {
    return v.waitFor === undefined
      ? { timeout: v.timeout }
      : { waitFor: v.waitFor, timeout: v.timeout };
  });

/**
 * CrawlJobSchema — validates a full raw CrawlJob.
 *
 * - url must be a valid URL string.
 * - selectors is a Record<string, SelectorSpec> with at least one entry.
 *   Keys starting with `_` are RESERVED for YAML anchor templates only
 *   (e.g. `_base: &b ...`). Such keys must not appear as real selectors
 *   and are rejected here — use anchors to factor shared spec fragments.
 * - rules is a RulesSchema result.
 * - Strict mode: unknown top-level keys rejected (CFG-06).
 */
export const CrawlJobSchema = z
  .strictObject({
    url: z.url('url must be a valid URL'),
    selectors: z
      .record(
        z
          .string()
          .min(1)
          .regex(
            /^(?!_)/,
            'selector names cannot start with "_" (reserved for YAML anchor templates)',
          ),
        SelectorSpecSchema,
      )
      .refine((s) => Object.keys(s).length > 0, {
        message: 'selectors must declare at least one named field',
      }),
    rules: RulesSchema,
  });

// Compile-time guarantee that the schema's parsed output is assignable to the
// public CrawlJob type. If the schema ever drifts from types.ts, tsc fails
// here before runtime — the assignment direction checks output -> CrawlJob.
export type _CrawlJobSchemaOutput = z.infer<typeof CrawlJobSchema>;
const _assertShape = (x: _CrawlJobSchemaOutput): CrawlJob => x;
void _assertShape;
