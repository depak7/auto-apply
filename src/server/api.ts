/**
 * HTTP API (Hono). Built by createApi(deps) so tests can pass an in-memory store and fakes.
 *
 *   POST /resumes                     multipart "file" (PDF) -> parsed resume      {id, name}
 *   GET  /resumes/:id
 *   POST /applications                {url, resumeId} -> starts the workflow        {id, status}
 *   GET  /applications                list (newest first)
 *   GET  /applications/:id            status, scores, and the diff to approve
 *   POST /applications/:id/approve    only while AWAITING_APPROVAL
 *   POST /applications/:id/reject     only while AWAITING_APPROVAL
 *   GET  /applications/:id/resume.pdf the tailored resume (after approval)
 *   POST /applications/:id/answers    {answers: {question: answer}} while NEEDS_INPUT -> saved, filling resumes
 *   POST /applications/:id/submit     only while READY_TO_SUBMIT: click Workday's Submit (once)
 *   GET  /applications/:id/screenshot.png   last page the browser worker saw
 *   GET  /profile, PUT /profile       facts forms ask for that a resume doesn't have
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";

import { type FileStore, fileKeys } from "../files/store.ts";
import { diffResumes } from "../resume/edits.ts";
import { isPdf, parseResume } from "../resume/parse.ts";
import { Profile } from "../schemas/index.ts";
import type { ApplicationRecord, Store } from "../store/store.ts";
import { NotWorkdayURL, parseWorkdayUrl } from "../workday/posting.ts";
import type { Workflows } from "../workflows/client.ts";

export interface ApiDeps {
  store: Store;
  workflows: Workflows;
  files: FileStore;
  parse?: typeof parseResume;
}

const NewApplication = z.object({ url: z.string(), resumeId: z.string() });
const Answers = z.object({ answers: z.record(z.string(), z.string().trim().min(1)) });

export function createApi({ store, workflows, files, parse = parseResume }: ApiDeps) {
  const app = new Hono();

  app.onError((err, c) => c.json({ error: err.message }, 500));

  app.post("/resumes", async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    const pdf = file instanceof File ? Buffer.from(await file.arrayBuffer()) : null;
    if (!pdf || !isPdf(pdf)) return c.json({ error: 'Send a PDF as multipart field "file"' }, 400);
    const resume = await parse(pdf);
    const pdfKey = fileKeys.uploadedResume(randomUUID());
    await files.put(pdfKey, pdf, "application/pdf");
    const record = await store.addResume(resume, pdfKey);
    return c.json({ id: record.id, name: record.name }, 201);
  });

  app.get("/resumes/:id", async (c) => {
    const record = await store.getResume(c.req.param("id"));
    return record ? c.json(record) : c.json({ error: "No such resume" }, 404);
  });

  app.post("/applications", async (c) => {
    const input = NewApplication.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Send JSON {url, resumeId}" }, 400);
    try {
      parseWorkdayUrl(input.data.url); // reject non-Workday URLs before starting anything
    } catch (e) {
      if (e instanceof NotWorkdayURL) return c.json({ error: e.message }, 400);
      throw e;
    }
    if (!(await store.getResume(input.data.resumeId))) return c.json({ error: "No such resume" }, 404);

    const record = await store.createApplication(input.data.url.trim(), input.data.resumeId);
    await workflows.start(record.id);
    return c.json({ id: record.id, status: record.status }, 202);
  });

  app.get("/applications", async (c) => c.json((await store.listApplications()).map(summary)));

  app.get("/resumes", async (c) => c.json((await store.listResumes()) satisfies ResumeSummary[]));

  app.get("/applications/:id", async (c) => {
    const record = await store.getApplication(c.req.param("id"));
    return record ? c.json(detail(record)) : c.json({ error: "No such application" }, 404);
  });

  for (const decision of ["approve", "reject"] as const) {
    app.post(`/applications/:id/${decision}`, async (c) => {
      const record = await store.getApplication(c.req.param("id"));
      if (!record) return c.json({ error: "No such application" }, 404);
      if (record.status !== "AWAITING_APPROVAL") {
        return c.json({ error: `Can only ${decision} while AWAITING_APPROVAL (now ${record.status})` }, 409);
      }
      // Show the decision at once; the workflow moves it on from here.
      await store.updateApplication(record.id, { status: decision === "approve" ? "RENDERING" : "REJECTED" });
      await workflows.signal(record.id, decision);
      return c.json({ id: record.id, decision }, 202);
    });
  }

  app.post("/applications/:id/answers", async (c) => {
    const record = await store.getApplication(c.req.param("id"));
    if (!record) return c.json({ error: "No such application" }, 404);
    if (record.status !== "NEEDS_INPUT")
      return c.json({ error: `No questions to answer (status ${record.status})` }, 409);
    const input = Answers.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Send JSON {answers: {question: answer}}" }, 400);

    const unanswered = (record.questions ?? []).filter((q) => !(q in input.data.answers));
    if (unanswered.length) return c.json({ error: "Answer every question", unanswered }, 400);

    await store.addAnswers(input.data.answers); // kept in the profile: never asked again, for any job
    await store.updateApplication(record.id, { status: "QUEUED", questions: null });
    await workflows.signal(record.id, "answers");
    return c.json({ id: record.id, saved: Object.keys(input.data.answers).length }, 202);
  });

  app.post("/applications/:id/submit", async (c) => {
    const record = await store.getApplication(c.req.param("id"));
    if (!record) return c.json({ error: "No such application" }, 404);
    if (record.status !== "READY_TO_SUBMIT") {
      return c.json({ error: `Can only submit while READY_TO_SUBMIT (now ${record.status})` }, 409);
    }
    if (record.submitAttemptedAt) return c.json({ error: "Submit was already attempted; check Workday" }, 409);
    await store.updateApplication(record.id, { status: "SUBMITTING" });
    await workflows.signal(record.id, "submit");
    return c.json({ id: record.id, decision: "submit" }, 202);
  });

  app.get("/applications/:id/screenshot.png", async (c) => {
    const record = await store.getApplication(c.req.param("id"));
    const image = record?.screenshotKey ? await files.get(record.screenshotKey) : null;
    if (!image) return c.json({ error: "No screenshot yet" }, 404);
    return c.body(new Uint8Array(image), 200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
  });

  app.get("/profile", async (c) => c.json(await store.getProfile()));

  app.put("/profile", async (c) => {
    const input = Profile.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Invalid profile", issues: input.error.issues }, 400);
    return c.json(await store.saveProfile(input.data));
  });

  app.get("/applications/:id/resume.pdf", async (c) => {
    const record = await store.getApplication(c.req.param("id"));
    const pdf = record?.pdfKey ? await files.get(record.pdfKey) : null;
    if (!pdf) return c.json({ error: "No tailored PDF yet" }, 404);
    return c.body(new Uint8Array(pdf), 200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
  });

  return app;
}

// What the UI needs, without the full nested records. Exported as types so the UI shares them.

export type ApplicationSummary = ReturnType<typeof summary>;
export type ApplicationDetail = ReturnType<typeof detail>;
export type ResumeSummary = { id: string; name: string; createdAt: string };

function summary(a: ApplicationRecord) {
  const t = a.tailor;
  return {
    id: a.id,
    status: a.status,
    url: a.url,
    title: a.job?.title ?? null,
    company: a.job?.company ?? null,
    location: a.job?.location ?? null,
    scores: t
      ? {
          fit: { before: t.before.overall, after: t.after.overall },
          keywords: { before: t.before.keywords.percent, after: t.after.keywords.percent },
        }
      : null,
    questions: a.questions ?? [],
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

function detail(a: ApplicationRecord) {
  const t = a.tailor;
  const score = t?.before ?? a.score;
  return {
    ...summary(a),
    error: a.error,
    jobUrl: a.job?.url ?? a.url,
    changes: t
      ? diffResumes(t.original, t.tailored).map((d) => {
          const edit = t.edits.findLast((e) => e.path === d.path && e.status === "applied");
          return { ...d, reason: edit?.reason ?? null };
        })
      : [],
    // Each requirement with its fit before and after tailoring (0..2), for "why this score".
    requirements: score
      ? score.requirements.map((r) => {
          const before = score.items.find((i) => i.requirementId === r.id);
          const after = t?.after.items.find((i) => i.requirementId === r.id) ?? before;
          return {
            id: r.id,
            text: r.text,
            kind: r.kind,
            before: before?.score ?? 0,
            after: after?.score ?? 0,
            status: after?.status ?? "gap",
          };
        })
      : [],
    keywords: t
      ? {
          found: t.after.keywords.found,
          missing: t.after.keywords.missing,
          gained: t.after.keywords.found.filter((k) => !t.before.keywords.found.includes(k)),
        }
      : null,
    // Both versions of the resume, so the UI can show the changes on the resume itself.
    resume: t ? { original: t.original, tailored: t.tailored } : null,
    hasPdf: !!a.pdfKey,
    hasScreenshot: !!a.screenshotKey,
    submitAttempted: !!a.submitAttemptedAt,
  };
}
