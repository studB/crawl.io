# crawl.io

Markdown-configured Playwright web crawler — one `.md` file describes a crawl job and carries its own results back in the same file.

## What it does

One markdown file fully describes a crawl job and carries its own results. Point the tool at a `.md` file, the tool runs Playwright against the declared URL, extracts the named selectors, and writes the results back into the same file as a timestamped `# Output` section.

Primary target is Naver Cafe (login-gated, iframe-heavy); the tool is generic enough to work on any single-page target that matches the same config shape.

## Install

```bash
npm install -g crawl.io
```

Requires Node.js 20 LTS or newer. The first run downloads the Playwright Chromium binary automatically.

## Quick start

Create a job file, say `job.md`:

````markdown
# URL

https://example.com/

# Selectors

```yaml
title:
  selector: h1
```

# Rules

```yaml
waitFor: h1
timeout: 30000
```
````

Run the crawl:

```bash
crawl run job.md
```

On success, the tool appends a new `# Output` section to `job.md` containing a human-readable timestamp and a fenced JSON block with the extracted fields. Re-running preserves prior entries and appends a new one — existing Output entries are never overwritten.

For the full flag list and help text, run `crawl --help` or `crawl run --help`.

## Environment variables

| Variable                  | Purpose                                                              | Required                       | Default  |
| ------------------------- | -------------------------------------------------------------------- | ------------------------------ | -------- |
| `NAVER_ID`                | Naver login id                                                       | Yes, for Naver Cafe targets    | —        |
| `NAVER_PW`                | Naver login password                                                 | Yes, for Naver Cafe targets    | —        |
| `CRAWL_HEADED_TIMEOUT_MS` | Headed-fallback poll timeout (captcha / 2FA manual resolve), in ms   | No                             | `300000` |

Credentials are read only inside the auth layer and never interpolated into logs or error messages. The storage-state file (`.crawl-session.json`) is written to the working directory on first successful Naver login and reused on subsequent runs; it is git-ignored by default.

## Exit codes

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| `0`  | Success — a `# Output` entry was appended to the job file    |
| `1`  | Failure — any error (config invalid, timeout, auth, network) produces a non-zero exit |

Any failure is a non-zero exit; v1 does not subdivide error types into distinct codes.

## Status

v1 scope: single-page crawls, markdown-file config, one Naver Cafe login flow. Future verbs (`crawl init`, `crawl validate`) will attach without breaking the top-level interface.
