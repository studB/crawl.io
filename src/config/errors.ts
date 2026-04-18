export interface ConfigParseErrorOptions {
  filePath?: string;
}

export class ConfigParseError extends Error {
  readonly issues: string[];
  declare readonly filePath?: string;

  constructor(issues: string[], opts?: ConfigParseErrorOptions) {
    super(issues.join('\n'));
    this.name = 'ConfigParseError';
    this.issues = issues;
    if (opts?.filePath !== undefined) {
      this.filePath = opts.filePath;
    }
    Object.setPrototypeOf(this, ConfigParseError.prototype);
  }
}
