# Architecture

## Processes

| Process | Entry point | Responsibility |
| --- | --- | --- |
| Temporal | `npm run temporal` | Workflow state, timers, and task queues |
| API | `src/bin/api.ts` | HTTP API under `/api`, the UI, and Google sign-in |
| Worker | `src/bin/worker.ts` | Runs workflows and the `autoapply` queue: fetch, score, tailor, render |
| Apply worker | `src/bin/apply-worker.ts` | Runs the `apply` queue: the browser agent and submission (one at a time) |

The API never does slow work itself. It records the user's decision, updates the status,
and signals the application's workflow.

## Application lifecycle

`src/workflows/application.ts` defines the whole process. It contains no I/O, because
Temporal replays workflow code after a restart; every side effect is an activity.

```
fetchJobForApplication ─► scoreApplication ─► tailorApplication
      └─► AWAITING_APPROVAL ──(approve | reject | 7 days)
              └─► renderApplicationPdf
                    └─► applyToJob ──► needs_input ─► NEEDS_INPUT ──(answers)─► applyToJob ...
                                  ──► already_applied ─► ALREADY_APPLIED
                                  ──► at_review ─► READY_TO_SUBMIT ──(submit | 7 days)
                                                        └─► submitApplication ─► SUBMITTED
                                                                              ─► SUBMIT_UNCONFIRMED
```

Signals: `approve`, `reject`, `answers`, `submit`. Filling may be retried once, since it
never submits. Submitting is never retried.

## Modules

| Module | Role |
| --- | --- |
| `schemas/` | Zod schemas. Each one validates data, types it, and defines structured model output |
| `workday/` | Parses posting URLs and reads a posting from Workday's public jobs API |
| `resume/` | Parses a PDF into a `Resume`, renders the page template and PDF, defines editable lines |
| `matching/` | Extracts requirements (text model), scores each one (Jev), measures keyword coverage (code) |
| `tailoring/` | The rewrite loop: targets, proposals, repairs, verification, and code rules |
| `apply/` | The form agent: page snapshot, facts, decisions, guards, values, submit |
| `store/` | Postgres access and migrations. JSON columns are validated with their schemas when read |
| `files/` | File storage by key: Vercel Blob, local disk, or memory |
| `workflows/` | The workflow, its activities, queue names, and the API's client |
| `lib/` | Stateless helpers shared across modules |

## Models

| Role | Default | Used for |
| --- | --- | --- |
| Text | `google/gemini-2.5-flash` | Parsing resume PDFs, extracting requirements, short form answers |
| Rewrite | `openai/gpt-5-mini` | Rewriting resume lines |
| Decision | `typesafe-ai/jev` | Scores, the agent's next action, and yes/no checks |

Jev returns typed answers with calibrated probabilities. Decisions that stop work or commit
an answer are gated on those probabilities (see `STOP_MIN_CONFIDENCE`, `OPTION_MIN_SUPPORT`,
and `TAILORING` in `src/config.ts`).

## Tailoring

`tailoring/tailor.ts` runs up to two rounds:

1. **Targets**: requirements the resume shows only partly, or shows without the job's terms.
   Requirements the resume doesn't show at all are never targeted.
2. **Propose**: the rewrite model rewrites existing lines. Each line is sent with the numbers
   and technologies it must keep.
3. **Repair**: rewrites that break a code rule are sent back once, with the exact problem.
4. **Verify**: code rules (`tailoring/rules.ts`), then two Jev questions per line: does it add
   anything, and does it keep everything?
5. **Re-score**: rewrites are kept unless fit or keyword coverage gets worse.

## The form agent

Each step of `apply/agent.ts`:

1. **Observe**: `snapshot.js` lists the page's controls and numbers them. Honeypots, header and
   footer controls, and error summaries are marked.
2. **Decide**: one Jev request asks for the operation and, speculatively, the target for each
   kind of operation.
3. **Guard**: forbidden clicks are refused, stale decisions are dropped, and answers are
   checked against the facts.
4. **Act**: click, fill (values from `apply/values.ts`), or upload.

The run ends at Review (confirmed by Workday's progress bar), when a question needs the user,
or when the page is recognized as already applied.

## Storage

- **Postgres** (`DATABASE_URL`): `resumes`, `applications`, and `profile`. Nested values (job,
  score, tailoring result, questions) are `jsonb`, validated with their Zod schemas when read.
- **Files**: uploaded resumes, tailored PDFs, screenshots, and agent traces, addressed by key
  (`applications/<id>/resume.pdf`). A private Vercel Blob store when `BLOB_READ_WRITE_TOKEN` is
  set, else `DATA_DIR/files/`. The database stores keys. No process reads another's disk, so
  the processes can run on separate machines.
- **Temporal** keeps its own state (`data/temporal.db` for the development server).

`store/db.ts` defines the small `Db` interface (query, exec, transaction). `store/migrations.ts`
holds versioned migrations; every process runs pending ones at startup, serialized by an
advisory lock, so the API and workers can start together. Tests run the same migrations and SQL
on PGlite (Postgres compiled to WebAssembly) instead of a server.
