export type CrawlErrorCode =
  | 'timeout'
  | 'selector_miss'
  | 'network'
  | 'frame_not_found'
  | 'extraction_failed'
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
  fields?: Record<string, string>;
  error?: {
    code: CrawlErrorCode;
    message: string;
    stack?: string;
  };
}
