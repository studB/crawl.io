import { z } from 'zod';
import type { ActionStep, CrawlJob, SelectorSpec } from './types';

/**
 * Shared selector shape used by both collectors and selector-driven actions.
 * Keeps engine/frame normalization in one place.
 */
const BaseSelectorShape = {
  selector: z.string().min(1, 'selector must be a non-empty string'),
  engine: z.enum(['css', 'xpath']).default('css'),
  frame: z.array(z.string().min(1)).optional(),
} as const;

/**
 * SelectorSpecSchema — validates a single entry in the collectors map.
 *
 * Defaults: engine omitted -> 'css' (D-07). first -> true, attributes -> false.
 * Strict mode: unknown keys rejected (CFG-06).
 * Transform: optional fields stripped when they match the default so
 * exactOptionalPropertyTypes objects stay minimal.
 */
export const SelectorSpecSchema = z
  .strictObject({
    ...BaseSelectorShape,
    first: z.boolean().default(true),
    attributes: z.boolean().default(false),
  })
  .transform((v): SelectorSpec => {
    const out: SelectorSpec = { selector: v.selector, engine: v.engine };
    if (v.frame !== undefined) out.frame = v.frame;
    if (v.first === false) out.first = false;
    if (v.attributes === true) out.attributes = true;
    return out;
  });

/**
 * ActionStepSchema — discriminated union on `action`.
 *
 * Each variant reuses `BaseSelectorShape` where relevant, so a click/type/waitFor
 * gets the same engine default + frame-array validation as a collector.
 */
const GotoActionSchema = z.strictObject({
  action: z.literal('goto'),
  url: z.url('goto.url must be a valid URL'),
});

const ClickActionSchema = z.strictObject({
  action: z.literal('click'),
  ...BaseSelectorShape,
});

const TypeActionSchema = z.strictObject({
  action: z.literal('type'),
  ...BaseSelectorShape,
  value: z.string(),
});

const WaitForActionSchema = z.strictObject({
  action: z.literal('waitFor'),
  ...BaseSelectorShape,
});

export const ActionStepSchema = z
  .discriminatedUnion('action', [
    GotoActionSchema,
    ClickActionSchema,
    TypeActionSchema,
    WaitForActionSchema,
  ])
  .transform((v): ActionStep => {
    // Normalize: strip optional `frame` when omitted (mirrors SelectorSpec convention
    // under exactOptionalPropertyTypes).
    if (v.action === 'goto') return { action: 'goto', url: v.url };
    if (v.action === 'type') {
      const base = v.frame === undefined
        ? { action: 'type' as const, selector: v.selector, engine: v.engine, value: v.value }
        : { action: 'type' as const, selector: v.selector, engine: v.engine, frame: v.frame, value: v.value };
      return base;
    }
    // click | waitFor
    const kind = v.action;
    return v.frame === undefined
      ? { action: kind, selector: v.selector, engine: v.engine }
      : { action: kind, selector: v.selector, engine: v.engine, frame: v.frame };
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
 * Contract:
 *   - url must be a valid URL string.
 *   - EITHER `collectors` (non-empty Record<string, SelectorSpec>) OR
 *     `actions` (non-empty ActionStep[]) must be defined — never both,
 *     never neither. The XOR is enforced by a `.refine` after parsing.
 *   - Collector keys starting with `_` are RESERVED for YAML anchor templates.
 *   - rules is a RulesSchema result.
 *   - Strict mode: unknown top-level keys rejected (CFG-06).
 */
export const CrawlJobSchema = z
  .strictObject({
    url: z.url('url must be a valid URL'),
    collectors: z
      .record(
        z
          .string()
          .min(1)
          .regex(
            /^(?!_)/,
            'collector names cannot start with "_" (reserved for YAML anchor templates)',
          ),
        SelectorSpecSchema,
      )
      .refine((s) => Object.keys(s).length > 0, {
        message: 'collectors must declare at least one named field',
      })
      .optional(),
    actions: z.array(ActionStepSchema).min(1, 'actions must declare at least one step').optional(),
    rules: RulesSchema,
  })
  .superRefine((v, ctx) => {
    const hasCollectors = v.collectors !== undefined;
    const hasActions = v.actions !== undefined;
    if (hasCollectors && hasActions) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message:
          'a job must declare EITHER `collectors` OR `actions`, not both',
      });
    }
    if (!hasCollectors && !hasActions) {
      ctx.addIssue({
        code: 'custom',
        path: [],
        message:
          'a job must declare either `collectors` or `actions`',
      });
    }
  });

// Compile-time sanity: the schema's parsed shape must be compatible with the
// public CrawlJob type (modulo exactOptionalPropertyTypes, which insists an
// absent optional be undefined-free — Zod always includes `undefined`, so we
// do a structural subset check via a mapped cast rather than direct assignment).
export type _CrawlJobSchemaOutput = z.infer<typeof CrawlJobSchema>;
const _assertShape = (x: _CrawlJobSchemaOutput): CrawlJob =>
  x as unknown as CrawlJob;
void _assertShape;
