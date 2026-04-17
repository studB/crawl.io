<!-- GSD:project-start source:PROJECT.md -->
## Project

**crawl.io**

A TypeScript CLI web crawler configured entirely through markdown files. Each markdown file describes one single-page crawl job — URL, selectors, rules — and the crawler writes extracted data back into that same file as an Output section with a run timestamp. Primary target is Naver Cafe (behind login, heavy iframe use); the tool is generic enough to work on other sites with the same structure.

**Core Value:** **One markdown file fully describes a crawl job and carries its own results.** The config, the selectors, and the extracted data live in the same file — a crawler run is just "open file, read job, run Playwright, append result section, save." Everything else (the CLI, iframe traversal, login session, error handling) exists to make that loop reliable for a real Naver Cafe page.

### Constraints

- **Tech stack**: TypeScript + Node 20 LTS + Playwright — fixed by user.
- **Tech stack**: CLI only, no server component — the whole tool is `crawl run <file.md>` invoked from a terminal.
- **Security**: Credentials must come from env vars; storage-state file (`.crawl-session.json`) must be git-ignored by default.
- **Distribution**: Must be publishable to npm — implies a `bin` entry, a proper build step, and no hard-coded local paths.
- **Compatibility**: Config format is markdown sections (`# URL`, `# Selectors`, `# Output`) with YAML-in-code-blocks for structured fields — this is the contract, tool must not break it.
- **Testing**: Tests run against real Naver Cafe URLs (user's choice) — implies tests require credentials and network, and may be excluded from any future CI.
- **Tech stack**: TypeScript `strict` mode plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on in `tsconfig.json` — code must honor them, no loosening.
<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->
## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
