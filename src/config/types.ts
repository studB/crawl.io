export interface SelectorSpec {
  selector: string;
  engine: 'css' | 'xpath';
  frame?: string[];
}

export interface CrawlJob {
  url: string;
  selectors: Record<string, SelectorSpec>;
  rules: {
    waitFor?: string;
    timeout: number;
  };
}
