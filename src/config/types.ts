/**
 * Shared selector shape. `SelectorSpec` extends it with collection-only options
 * (first/attributes); action steps reuse the base without those fields.
 */
export interface BaseSelector {
  selector: string;
  engine: 'css' | 'xpath';
  frame?: string[];
}

export interface SelectorSpec extends BaseSelector {
  /** When false, collect all matches via `locator.all()`. Default: true. */
  first?: boolean;
  /** When true, include the element's HTML attributes in the output. Default: false. */
  attributes?: boolean;
}

export interface FieldWithAttrs {
  text: string;
  attributes: Record<string, string>;
}

/**
 * Shape of a single extracted field value:
 *   - string                   — default: first match, text only
 *   - string[]                 — first: false, attributes: false
 *   - FieldWithAttrs           — first: true,  attributes: true
 *   - FieldWithAttrs[]         — first: false, attributes: true
 */
export type FieldValue = string | string[] | FieldWithAttrs | FieldWithAttrs[];

/**
 * Discriminated union on `action`. v1 set — extend with press/select/check later.
 *
 *   - goto      — navigate the top-level page
 *   - click     — click a resolved element (frame-aware)
 *   - type      — fill an input with a static string (frame-aware)
 *   - waitFor   — wait for a selector to appear (commonly used to confirm success)
 */
export type ActionStep =
  | { action: 'goto'; url: string }
  | ({ action: 'click' } & BaseSelector)
  | ({ action: 'type'; value: string } & BaseSelector)
  | ({ action: 'waitFor' } & BaseSelector);

export type ActionKind = ActionStep['action'];

export interface CrawlJob {
  url: string;
  /** Exactly one of `collectors` or `actions` is defined. Enforced by CrawlJobSchema. */
  collectors?: Record<string, SelectorSpec>;
  actions?: ActionStep[];
  rules: {
    waitFor?: string;
    timeout: number;
  };
}
