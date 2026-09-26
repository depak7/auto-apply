# AutoApply

Tailor your resume to a Workday job, review every change on the resume itself, and let a
browser agent fill in the application. Nothing is submitted until you say so.

- **Match**: reads the job from Workday, extracts its requirements, and scores your resume
  against each one (fit and keyword coverage).
- **Tailor**: rewrites existing resume lines to lead with what the job cares about. Code-level
  rules and model checks reject anything invented, dropped, or exaggerated.
- **Review**: the exact page that will be uploaded, with every change marked and explained.
- **Apply**: a browser agent signs in, fills each page, and uploads the tailored PDF. Questions
  it can't answer from your profile are asked once and remembered.
- **Submit**: only on your command, exactly once, confirmed by Workday.

## How it works

```
 Web UI / HTTP API ──► Temporal workflow (one per application)
                         │
                         ├─ worker (queue "autoapply")
                         │    fetch job ─► extract requirements ─► score ─► tailor ─► render PDF
                         │
                         └─ apply worker (queue "apply", Chromium)
                              fill the form ─► [ask the user] ─► stop at Review ─► submit once

 Postgres: resumes, applications, profile      Files: uploaded resumes, PDFs, screenshots
```

An application moves through `FETCHING → SCORING → TAILORING → AWAITING_APPROVAL →
QUEUED → APPLYING → (NEEDS_INPUT) → READY_TO_SUBMIT → SUBMITTING → SUBMITTED`.
See [docs/architecture.md](docs/architecture.md).

## Tech stack

| Concern | Choice |
| --- | --- |
| Language | TypeScript on Node.js 22+ (run with `tsx`) |
| Workflows and queues | [Temporal](https://temporal.io) |
| HTTP API | [Hono](https://hono.dev) |
| Models | [Vercel AI SDK](https://ai-sdk.dev) via the Vercel AI Gateway: Gemini (parsing), GPT-5 mini (rewriting), [Jev](https://docs.typesafe.ai) (scores and decisions) |
| Browser automation | [Playwright](https://playwright.dev) (Chromium) |
| Storage | PostgreSQL (`pg`, versioned migrations); files on Vercel Blob or local disk |
| Validation | [Zod](https://zod.dev) |
| UI | React, Vite, Tailwind CSS |
| Tooling | Vitest (with PGlite: Postgres in-process), Biome |

## Getting started

Requirements: Node.js 22.13+, Docker (for Postgres), the [Temporal CLI](https://docs.temporal.io/cli), and a
[Vercel AI Gateway](https://vercel.com/ai-gateway) key.

```bash
npm install
npx playwright install chromium
cp .env.example .env            # fill in AI_GATEWAY_API_KEY, WORKDAY_EMAIL, WORKDAY_PASSWORD
npm run web:build
```

Start Postgres (host port 5433; migrations run automatically on startup):

```bash
npm run db
```

Then run the four processes, each in its own terminal:

```bash
npm run temporal       # local Temporal (UI at http://localhost:8233); skip when using Temporal Cloud
npm run worker         # fetch, score, tailor, render
npm run apply-worker   # browser agent
npm run api            # API + UI at http://localhost:3000
```

Or run everything with Docker: `docker compose up -d --build` with Temporal Cloud settings in `.env`,
or add `--profile local-temporal` for a local Temporal server.

## Configuration

All settings are environment variables; see [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key, used for every model |
| `AI_MODEL`, `REWRITE_MODEL`, `JEV_MODEL` | Model IDs for parsing, rewriting, and decisions |
| `WORKDAY_EMAIL`, `WORKDAY_PASSWORD` | Workday account used to apply |
| `APP_PASSWORD` | Protects the web app (required outside your own machine) |
| `DATABASE_URL` | Postgres connection (default matches `npm run db`) |
| `DATABASE_CA_CERT` | CA certificate for a Postgres server with its own CA (e.g. Aiven) |
| `DATABASE_SCHEMA` | Postgres schema for the tables, when the database is shared with other apps |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob private store for files; without it, files go to `DATA_DIR` |
| `DATA_DIR` | Local file storage when no Blob token is set (default `./data`) |
| `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`, `TEMPORAL_API_KEY` | Temporal Cloud connection (empty = local dev server); mTLS via `TEMPORAL_TLS_CLIENT_*` |
| `PORT` | Web port (default 3000) |
| `BROWSER_CDP_URL` | Use a remote browser instead of launching Chromium |

Scoring and tailoring thresholds live in [`src/config.ts`](src/config.ts).

## Project structure

```
src/
  bin/          process entry points: api, worker, apply-worker
  config.ts     environment and tuning thresholds
  schemas/      Zod schemas for every shared type
  lib/          reusable helpers (HTML to text, names and phones, company matching, words)
  ai/           model selection
  workday/      Workday posting URLs and the public jobs API
  resume/       parsing, plain-text form, page template, PDF rendering, editable lines
  matching/     requirement extraction, scoring, keyword coverage
  tailoring/    rewrite loop, prompts, proposal and repair, verification, rules
  apply/        form-filling agent, safety guards, submit, browser activities
  store/        Postgres store, connection, and migrations
  files/        file storage: Vercel Blob, local disk, or memory (tests)
  workflows/    Temporal workflow, activities, queues, client
  server/       HTTP API
web/            React UI
tools/          developer CLIs (npm run tool:*)
tests/          Vitest suites
docs/           architecture and deployment guides
```

## Development

```bash
npm run check        # lint, type-check, and test
npm test             # tests only (Postgres runs in-process via PGlite; no server needed)
npm run format       # format and apply safe lint fixes
npm run web:dev      # UI with hot reload (proxies /api to :3000)
```

Developer tools for working on one stage at a time:

| Command | What it does |
| --- | --- |
| `npm run tool:fetch-job -- <url>` | Print a Workday job posting |
| `npm run tool:parse-resume -- <pdf>` | Parse a resume PDF to JSON |
| `npm run tool:score -- <url> <resume.json>` | Score a resume against a job |
| `npm run tool:tailor -- <score.json>` | Tailor and print the changes |
| `npm run tool:fill -- <url>` | Run the form agent up to Review (never submits) |
| `npm run tool:inspect-page -- <url>` | Show what the agent sees on a page |
| `npm run tool:record-form -- <url>` | Record the fields on each page of an application |
| `npm run tool:check-models` | Check that every configured model answers |

## Safety guarantees

Enforced in code, independent of any model:

- The agent can never click Submit; only `src/apply/submit.ts` can, once, after your command.
  The attempt is recorded before the click and never retried.
- Honeypot fields are never shown to the model or filled.
- Your password is typed by code and never sent to a model.
- Rewrites can't add numbers or technologies absent from your resume, or drop numbers,
  tools, or ownership verbs from the original line.
- Answers come from your resume and profile. Anything else is asked, never guessed.

## Deployment

See [docs/deployment.md](docs/deployment.md).

## Limitations

- Workday only. Other applicant tracking systems need their own sign-in and review handling.
- Single user: one profile and one Workday account.
- Google and LinkedIn sign-in can't be automated; use a Workday email and password account.
