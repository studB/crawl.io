import type { CrawlErrorCode } from './types';

export class CrawlError extends Error {
  readonly code: CrawlErrorCode;
  declare readonly detail?: string;

  constructor(code: CrawlErrorCode, detail?: string) {
    super(detail !== undefined ? `[${code}] ${detail}` : `[${code}]`);
    this.name = 'CrawlError';
    this.code = code;
    if (detail !== undefined) {
      this.detail = detail;
    }
    Object.setPrototypeOf(this, CrawlError.prototype);
  }
}
