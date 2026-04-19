export interface SelectorSpec {
  selector: string;
  engine: 'css' | 'xpath';
  frame?: string[];
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

export interface CrawlJob {
  url: string;
  selectors: Record<string, SelectorSpec>;
  rules: {
    waitFor?: string;
    timeout: number;
  };
}
