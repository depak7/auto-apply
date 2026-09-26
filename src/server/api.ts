/**
 * HTTP API (Hono). Built by createApi(deps) so tests can pass an in-memory store and fakes.
 * Every route except /auth/* needs a signed-in user, and only sees that user's data.
 *
 *   GET  /auth/config                 how to sign in: {googleClientId} or local development
 *   POST /auth/google                 {credential} (Google ID token) -> session cookie
 *   POST /auth/local                  local development only -> session cookie
 *   POST /auth/logout
 *   GET  /me                          the user and whether their Workday login is set
 *
 *   POST /resumes                     multipart "file" (PDF) -> parsed resume; fills the profile's empty fields
 *   GET  /resumes, GET /resumes/:id
 *   POST /applications                {url, resumeId} -> starts the workflow        {id, status}
 *   GET  /applications                list (newest first)
 *   GET  /applications/:id            status, scores, and the diff to approve
 *   POST /applications/:id/approve    only while AWAITING_APPROVAL
 *   POST /applications/:id/reject     only while AWAITING_APPROVAL
 *   GET  /applications/:id/resume.pdf the tailored resume (after approval)
 *   POST /applications/:id/answers    {answers: {question: answer}} while NEEDS_INPUT -> saved, filling resumes
 *   POST /applications/:id/code       {code} while NEEDS_CODE -> typed into Workday's verification page
 *   POST /applications/:id/submit     only while READY_TO_SUBMIT: click Workday's Submit (once)
 *   GET  /applications/:id/screenshot.png   last page the browser worker saw
 *   GET  /profile, PUT /profile       facts forms ask for that a resume doesn't have
 *   GET  /workday-account, PUT /workday-account   {email, password?}: the login the agent applies with
 */

import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { boardFor, NotAJobURL } from "../boards/index.ts";
import { type FileStore, fileKeys } from "../files/store.ts";
import type { SecretBox } from "../lib/secrets.ts";
import { diffResumes } from "../resume/edits.ts";
import { isPdf, parseResume } from "../resume/parse.ts";
import { fillProfileFromResume } from "../resume/profile.ts";
import { Profile } from "../schemas/index.ts";
import type { ApplicationRecord, Store } from "../store/store.ts";
import type { Workflows } from "../workflows/client.ts";
import { type AuthConfig, endSession, LOCAL_IDENTITY, sessionUser, startSession, verifyGoogleIdToken } from "./auth.ts";

export interface ApiDeps {
  store: Store;
  workflows: Workflows;
  files: FileStore;
  auth: AuthConfig;
  secrets: SecretBox;
  parse?: typeof parseResume;
}

const NewApplication = z.object({ url: z.string(), resumeId: z.string() });
const Answers = z.object({ answers: z.record(z.string(), z.string().trim().min(1)) });
const Code = z.object({ code: z.string().trim().min(1).max(64) });
const GoogleSignIn = z.object({ credential: z.string().min(1) });
const WorkdayLogin = z.object({ email: z.email(), password: z.string().min(1).optional() });

export function createApi({ store, workflows, files, auth, secrets, parse = parseResume }: ApiDeps) {
  const app = new Hono<{ Variables: { userId: string } }>();

  app.onError((err, c) => c.json({ error: err.message }, 500));

  // Sign-in

  app.get("/auth/config", (c) => c.json({ googleClientId: auth.googleClientId ?? null }));

  app.post("/auth/google", async (c) => {
    if (!auth.googleClientId) return c.json({ error: "Google sign-in is not configured" }, 404);
    const input = GoogleSignIn.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Send JSON {credential}" }, 400);
    const verify = auth.verifyGoogle ?? verifyGoogleIdToken;
    const who = await verify(input.data.credential, auth.googleClientId).catch(() => null);
    if (!who) return c.json({ error: "Google sign-in could not be verified" }, 401);
    const user = await store.signIn(who);
    await startSession(c, user.id, auth);
    return c.json(user);
  });

  app.post("/auth/local", async (c) => {
    if (auth.googleClientId) return c.json({ error: "Use Google sign-in" }, 404);
    const user = await store.signIn(LOCAL_IDENTITY);
    await startSession(c, user.id, auth);
    return c.json(user);
  });

  app.post("/auth/logout", (c) => {
    endSession(c, auth);
    return c.json({ ok: true });
  });

  // Everything below needs a signed-in user.
  app.use("*", async (c, next) => {
    const userId = await sessionUser(c, auth);
    if (!userId || !(await store.getUser(userId))) return c.json({ error: "Sign in first" }, 401);
    c.set("userId", userId);
    await next();
  });

  app.get("/me", async (c) => {
    const userId = c.get("userId");
    const [user, workday] = await Promise.all([store.getUser(userId), store.getWorkdayAccount(userId)]);
    return c.json({ user: user!, workday: workday ? { email: workday.email, updatedAt: workday.updatedAt } : null });
  });

  // Resumes

  app.post("/resumes", async (c) => {
    const userId = c.get("userId");
    const body = await c.req.parseBody();
    const file = body.file;
    const pdf = file instanceof File ? Buffer.from(await file.arrayBuffer()) : null;
    if (!pdf || !isPdf(pdf)) return c.json({ error: 'Send a PDF as multipart field "file"' }, 400);
    const resume = await parse(pdf);
    const pdfKey = fileKeys.uploadedResume(randomUUID());
    await files.put(pdfKey, pdf, "application/pdf");
    const record = await store.addResume(userId, resume, pdfKey);
    // Contact details the profile doesn't have yet come from the resume; the user's own edits stay.
    await store.saveProfile(userId, fillProfileFromResume(await store.getProfile(userId), resume));
    return c.json({ id: record.id, name: record.name }, 201);
  });

  app.get("/resumes", async (c) => c.json((await store.listResumes(c.get("userId"))) satisfies ResumeSummary[]));

  app.get("/resumes/:id", async (c) => {
    const record = await store.getResume(c.req.param("id"), c.get("userId"));
    return record ? c.json(record) : c.json({ error: "No such resume" }, 404);
  });

  // Applications

  app.post("/applications", async (c) => {
    const userId = c.get("userId");
    const input = NewApplication.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Send JSON {url, resumeId}" }, 400);
    let board: ReturnType<typeof boardFor>;
    try {
      board = boardFor(input.data.url); // reject unsupported links before starting anything
    } catch (e) {
      if (e instanceof NotAJobURL) return c.json({ error: e.message }, 400);
      throw e;
    }
    if (!(await store.getResume(input.data.resumeId, userId))) return c.json({ error: "No such resume" }, 404);
    if (board.needsLogin && !(await store.getWorkdayAccount(userId))) {
      return c.json({ error: "Add your Workday login in your profile first", needs: "workday_account" }, 409);
    }

    const record = await store.createApplication(userId, input.data.url.trim(), input.data.resumeId);
    await workflows.start(record.id);
    return c.json({ id: record.id, status: record.status }, 202);
  });

  app.get("/applications", async (c) => c.json((await store.listApplications(c.get("userId"))).map(summary)));

  app.get("/applications/:id", async (c) => {
    const record = await store.getApplication(c.req.param("id"), c.get("userId"));
    return record ? c.json(detail(record)) : c.json({ error: "No such application" }, 404);
  });

  for (const decision of ["approve", "reject"] as const) {
    app.post(`/applications/:id/${decision}`, async (c) => {
      const record = await store.getApplication(c.req.param("id"), c.get("userId"));
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
    const userId = c.get("userId");
    const record = await store.getApplication(c.req.param("id"), userId);
    if (!record) return c.json({ error: "No such application" }, 404);
    if (record.status !== "NEEDS_INPUT")
      return c.json({ error: `No questions to answer (status ${record.status})` }, 409);
    const input = Answers.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Send JSON {answers: {question: answer}}" }, 400);

    const unanswered = (record.questions ?? []).filter((q) => !(q in input.data.answers));
    if (unanswered.length) return c.json({ error: "Answer every question", unanswered }, 400);

    await store.addAnswers(userId, input.data.answers); // kept in the profile: never asked again, for any job
    await store.updateApplication(record.id, { status: "QUEUED", questions: null });
    await workflows.signal(record.id, "answers");
    return c.json({ id: record.id, saved: Object.keys(input.data.answers).length }, 202);
  });

  // The browser is waiting on Workday's verification page; the agent picks the code up from here.
  app.post("/applications/:id/code", async (c) => {
    const record = await store.getApplication(c.req.param("id"), c.get("userId"));
    if (!record) return c.json({ error: "No such application" }, 404);
    if (record.status !== "NEEDS_CODE") return c.json({ error: `No code is needed (status ${record.status})` }, 409);
    const input = Code.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Send JSON {code}" }, 400);
    await store.updateApplication(record.id, { code: input.data.code, status: "APPLYING", questions: null });
    return c.json({ id: record.id }, 202);
  });

  app.post("/applications/:id/submit", async (c) => {
    const record = await store.getApplication(c.req.param("id"), c.get("userId"));
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
    const record = await store.getApplication(c.req.param("id"), c.get("userId"));
    const image = record?.screenshotKey ? await files.get(record.screenshotKey) : null;
    if (!image) return c.json({ error: "No screenshot yet" }, 404);
    return c.body(new Uint8Array(image), 200, { "Content-Type": "image/png", "Cache-Control": "no-store" });
  });

  app.get("/applications/:id/resume.pdf", async (c) => {
    const record = await store.getApplication(c.req.param("id"), c.get("userId"));
    const pdf = record?.pdfKey ? await files.get(record.pdfKey) : null;
    if (!pdf) return c.json({ error: "No tailored PDF yet" }, 404);
    return c.body(new Uint8Array(pdf), 200, { "Content-Type": "application/pdf", "Cache-Control": "no-store" });
  });

  // Profile and Workday login

  app.get("/profile", async (c) => c.json(await store.getProfile(c.get("userId"))));

  app.put("/profile", async (c) => {
    const input = Profile.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Invalid profile", issues: input.error.issues }, 400);
    return c.json(await store.saveProfile(c.get("userId"), input.data));
  });

  app.get("/workday-account", async (c) => {
    const account = await store.getWorkdayAccount(c.get("userId"));
    return c.json(account ? { email: account.email, updatedAt: account.updatedAt } : null);
  });

  // The password is encrypted before it is stored, and is never sent back.
  app.put("/workday-account", async (c) => {
    const userId = c.get("userId");
    const input = WorkdayLogin.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: "Send JSON {email, password}" }, 400);
    const current = await store.getWorkdayAccount(userId);
    if (!input.data.password && !current) return c.json({ error: "Enter your Workday password" }, 400);
    const sealed = input.data.password ? secrets.seal(input.data.password) : current!.passwordSealed;
    await store.saveWorkdayAccount(userId, input.data.email.trim(), sealed);
    return c.json({ email: input.data.email.trim() });
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
