# crawl.io

Markdown-configured Playwright automation — one `.md` file fully describes a crawl or an action sequence, and the tool writes the run result to JSON.

## What it does

One markdown file fully describes a job. Point the tool at a `.md` file, the tool runs Playwright against the declared URL, and executes one of two modes:

- **Collectors mode** — extract named fields (text + optional HTML attributes) from the page.
- **Actions mode** — drive a sequence of steps (`goto` / `click` / `type` / `waitFor`) against the page. Good for posting comments, filling forms, or any scripted interaction.

A job declares **either** `# Collectors` **or** `# Actions`, never both. Results from each run are written to a standalone JSON file under `<jobDir>/output/<YYYYMMDD>/run_<YYYY-MM-DD-HH-mm-ss>.json` — the job markdown itself is not mutated.

Primary target is Naver Cafe (login-gated, iframe-heavy); the tool is generic enough to work on any single-page target that matches the same config shape.

## Install

```bash
npm install -g crawl.io
```

Requires Node.js 20 LTS or newer. The first run downloads the Playwright Chromium binary automatically.

## Quick start — Collectors (data extraction)

Create a job file, say `job.md`:

````markdown
# URL

https://example.com/

# Collectors

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

On success, the tool writes `job/output/20260419/run_2026-04-19-14-22-05.json` (next to the job file) with the extracted fields and run metadata. Re-running produces additional files; nothing is overwritten.

### Collector options

Per-field switches inside a collector entry:

| Key          | Default | Effect                                                                                  |
| ------------ | ------- | --------------------------------------------------------------------------------------- |
| `selector`   | —       | CSS (default) or XPath query                                                            |
| `engine`     | `css`   | Set to `xpath` to treat `selector` as XPath                                             |
| `frame`      | —       | Array of iframe selectors (outermost → innermost) to descend before resolving           |
| `first`      | `true`  | `false` → collect every match as an array                                               |
| `attributes` | `false` | `true` → return `{ text, attributes }` instead of just text (`href`, `class`, …)        |

Example with the full set:

````markdown
# Collectors

```yaml
links:
  selector: a.article
  first: false
  attributes: true
  frame:
    - iframe#cafe_main
```
````

Output shape (JSON):

- `first: true,  attributes: false` → `"title": "Hello"`
- `first: true,  attributes: true`  → `"title": { "text": "Hello", "attributes": { "href": "..." } }`
- `first: false, attributes: false` → `"title": ["a", "b"]`
- `first: false, attributes: true`  → `"title": [{ "text": "a", "attributes": {...} }, ...]`

## Quick start — Actions (scripted interaction)

Use `# Actions` instead of `# Collectors` to drive a page — for example, to post a comment on a Naver Cafe article:

````markdown
# URL

https://cafe.naver.com/.../articles/123

# Actions

```yaml
- action: type
  selector: textarea.comment_inbox_text
  value: "좋은 글 감사합니다"
  frame:
    - iframe#cafe_main
- action: click
  selector: button.btn_register
  frame:
    - iframe#cafe_main
- action: waitFor
  selector: .comment_registered
  frame:
    - iframe#cafe_main
```

# Rules

```yaml
waitFor: iframe#cafe_main
timeout: 30000
```
````

### Action kinds

| `action`  | Required keys             | Optional keys    | Effect                                            |
| --------- | ------------------------- | ---------------- | ------------------------------------------------- |
| `goto`    | `url`                     | —                | Navigate the top-level page                       |
| `click`   | `selector`                | `engine`, `frame`| Click the first matching element                  |
| `type`    | `selector`, `value`       | `engine`, `frame`| Fill an input/textarea with a static string       |
| `waitFor` | `selector`                | `engine`, `frame`| Wait for the selector to appear (success probe)   |

Steps run sequentially. A failing step aborts the run with a classified error (`selector_miss`, `frame_not_found`, `timeout`, `action_failed`); prior steps remain executed on the page.

## Environment variables

| Variable                  | Purpose                                                              | Required                    | Default  |
| ------------------------- | -------------------------------------------------------------------- | --------------------------- | -------- |
| `NAVER_ID`                | Naver login id                                                       | Yes, for Naver Cafe targets | —        |
| `NAVER_PW`                | Naver login password                                                 | Yes, for Naver Cafe targets | —        |
| `CRAWL_HEADED_TIMEOUT_MS` | Headed-fallback poll timeout (captcha / 2FA manual resolve), in ms   | No                          | `300000` |

Credentials are read only inside the auth layer and never interpolated into logs or error messages. The storage-state file (`.crawl-session.json`) is written to the working directory on first successful Naver login and reused on subsequent runs; it is git-ignored by default.

## Exit codes

| Code | Meaning                                                                       |
| ---- | ----------------------------------------------------------------------------- |
| `0`  | Success — a run JSON landed under `<jobDir>/output/<YYYYMMDD>/`               |
| `1`  | Failure — any error (config invalid, timeout, auth, network, action step)     |

v1 does not subdivide failure into distinct exit codes. The per-run JSON still carries a structured `error.code` (`timeout`, `selector_miss`, `frame_not_found`, `action_failed`, `auth_failed`, `config_parse`, …) for programmatic inspection.

## CLI

```bash
crawl run <file.md>            # run the job
crawl run -v <file.md>         # verbose progress to stderr
crawl run --quiet <file.md>    # suppress all stdout/stderr
crawl --help
crawl run --help
```

## Status

v1.1 scope: single-page jobs, markdown-file config, Naver Cafe login flow, Collectors + Actions modes. Future verbs (`crawl init`, `crawl validate`) will attach without breaking the top-level interface.
