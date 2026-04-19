import type { FieldValue } from '../config/types';

import type { ActionResult } from './actions';

export type CrawlErrorCode =
  | 'timeout'
  | 'selector_miss'
  | 'network'
  | 'frame_not_found'
  | 'extraction_failed'
  | 'action_failed'
  | 'config_parse'
  | 'auth_missing_credentials'
  | 'auth_failed'
  | 'captcha_unresolved'
  | 'unknown';

export interface CrawlResult {
  status: 'ok' | 'error';
  configPath: string;
  url: string;
  startedAt: Date;
  durationMs: number;
  /** Populated when the job declared `collectors`. Mutually exclusive with `actions`. */
  fields?: Record<string, FieldValue>;
  /** Populated when the job declared `actions`. Mutually exclusive with `fields`. */
  actions?: ActionResult[];
  error?: {
    code: CrawlErrorCode;
    message: string;
    stack?: string;
  };
}
