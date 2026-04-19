<!-- GSD:project-start source:PROJECT.md -->
## Project

**crawl.io**

A TypeScript CLI web crawler configured entirely through markdown files. Each markdown file describes one single-page crawl job — URL, selectors, rules — and the crawler writes extracted data back into that same file as an Output section with a run timestamp. Primary target is Naver Cafe (behind login, heavy iframe use); the tool is generic enough to work on other sites with the same structure.

**Core Value:** **One markdown file fully describes a crawl job and carries its own results.** The config, the selectors, and the extracted data live in the same file — a crawler run is just "open file, read job, run Playwright, append result section, save." Everything else (the CLI, iframe traversal, login session, error handling) exists to make that loop reliable for a real Naver Cafe page.