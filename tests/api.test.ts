/**
 * The API with an in-memory store, a fake Temporal, and a fake Google: no servers, no models.
 * Requests are made as a signed-in user (Asha) unless a test says otherwise.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/files/store.ts";
import { SecretBox } from "../src/lib/secrets.ts";
import { EMPTY_PROFILE } from "../src/schemas/index.ts";
import { createApi } from "../src/server/api.ts";
import type { Identity, Store } from "../src/store/store.ts";
import type { Workflows } from "../src/workflows/client.ts";
import { SAMPLE_RESUME } from "./mocks.ts";
import { testStore } from "./pglite.ts";

const URL_OK = "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/Engineer_JR1";

// Google ID tokens the fake Google accepts.
const PEOPLE: Record<string, Identity> = {
  "token-asha": { sub: "g-asha", email: "asha@example.com", name: "Asha Rao", picture: null },
  "token-ben": { sub: "g-ben", email: "ben@example.com", name: "Ben", picture: null },
};
const secrets = new SecretBox(Buffer.alloc(32, 9).toString("base64"));

let store: Store;
let files: MemoryFileStore;
let started: string[];
let signals: [string, string][];
let api: ReturnType<typeof createApi>;
let me: string; // Asha's user id
let cookie: string; // Asha's session

beforeEach(async () => {
  store = await testStore();
  files = new MemoryFileStore();
  started = [];
  signals = [];
  const workflows: Workflows = {
    start: async (id) => void started.push(id),
    signal: async (id, decision) => void signals.push([id, decision]),
  };
  api = createApi({
    store,
    workflows,
    files,
    secrets,
    parse: async () => SAMPLE_RESUME,
    auth: {
      googleClientId: "test-client",
      sessionSecret: "test-secret",
      secureCookies: false,
      verifyGoogle: async (credential) => {
        const who = PEOPLE[credential];
        if (!who) throw new Error("bad token");
        return who;
      },
    },
  });
  ({ id: me, cookie } = await signIn("token-asha"));
});

async function signIn(credential: string) {
  const res = await api.request("/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });
  expect(res.status).toBe(200);
  return { id: (await res.json()).id as string, cookie: res.headers.get("Set-Cookie")!.split(";")[0]! };
}

/** A request as Asha (or as whoever `as` is the cookie of). */
const request = (path: string, init: RequestInit = {}, as = cookie) =>
  api.request(path, { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: as } });

const post = (path: string, body: unknown, as = cookie) =>
  request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, as);

const addWorkdayLogin = () => store.saveWorkdayAccount(me, "asha@example.com", secrets.seal("pw"));

describe("POST /resumes", () => {
  it("accepts a PDF upload and stores the parsed resume", async () => {
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" }));
    const res = await request("/resumes", { method: "POST", body: form });
    expect(res.status).toBe(201);
    const { id, name } = await res.json();
    expect(name).toBe("Asha Rao");
    const key = (await store.getResume(id))?.pdfKey;
    expect(key).toMatch(/^resumes\/[0-9a-f-]{36}\.pdf$/);
    expect(files.files.get(key!)?.toString()).toBe("%PDF-1.4");
  });

  it("rejects non-PDF files", async () => {
    const form = new FormData();
    form.append("file", new File(["hi"], "cv.pdf")); // named .pdf, but not a PDF
    expect((await request("/resumes", { method: "POST", body: form })).status).toBe(400);
  });
});

describe("POST /applications", () => {
  it("creates the application and starts its workflow", async () => {
    await addWorkdayLogin();
    const resume = await store.addResume(me, SAMPLE_RESUME);
    const res = await post("/applications", { url: URL_OK, resumeId: resume.id });
    expect(res.status).toBe(202);
    const { id, status } = await res.json();
    expect(status).toBe("CREATED");
    expect(started).toEqual([id]);
  });

  it("asks for the Workday login before applying", async () => {
    const resume = await store.addResume(me, SAMPLE_RESUME);
    const res = await post("/applications", { url: URL_OK, resumeId: resume.id });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ needs: "workday_account" });
    expect(started).toEqual([]);
  });

  it("rejects non-Workday URLs and unknown resumes without starting anything", async () => {
    const resume = await store.addResume(me, SAMPLE_RESUME);
    expect(
      (await post("/applications", { url: "https://boards.greenhouse.io/x/jobs/1", resumeId: resume.id })).status,
    ).toBe(400);
    expect((await post("/applications", { url: URL_OK, resumeId: "nope" })).status).toBe(404);
    expect((await post("/applications", { nonsense: true })).status).toBe(400);
    expect(started).toEqual([]);
  });
});

describe("approve / reject", () => {
  it("signals the workflow only while AWAITING_APPROVAL", async () => {
    const app = await store.createApplication(me, URL_OK, (await store.addResume(me, SAMPLE_RESUME)).id);

    expect((await post(`/applications/${app.id}/approve`, {})).status).toBe(409); // still CREATED
    await store.updateApplication(app.id, { status: "AWAITING_APPROVAL" });
    expect((await post(`/applications/${app.id}/approve`, {})).status).toBe(202);
    expect((await post("/applications/nope/reject", {})).status).toBe(404);

    expect(signals).toEqual([[app.id, "approve"]]);
    expect((await store.getApplication(app.id))?.status).toBe("RENDERING"); // the UI sees the decision at once
  });
});

it("GET /applications/:id shows status and an empty diff before tailoring", async () => {
  const app = await store.createApplication(me, URL_OK, (await store.addResume(me, SAMPLE_RESUME)).id);
  const res = await request(`/applications/${app.id}`);
  expect(await res.json()).toMatchObject({ id: app.id, status: "CREATED", changes: [], hasPdf: false, scores: null });
});

describe("answers and profile", () => {
  it("saves answers into the profile and signals the workflow, only while NEEDS_INPUT", async () => {
    const app = await store.createApplication(me, URL_OK, (await store.addResume(me, SAMPLE_RESUME)).id);
    expect((await post(`/applications/${app.id}/answers`, { answers: { x: "y" } })).status).toBe(409);

    await store.updateApplication(app.id, { status: "NEEDS_INPUT", questions: ["Do you have a PAN number?*"] });
    const missing = await post(`/applications/${app.id}/answers`, { answers: { other: "Yes" } });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ unanswered: ["Do you have a PAN number?*"] });

    expect(
      (await post(`/applications/${app.id}/answers`, { answers: { "Do you have a PAN number?*": "Yes" } })).status,
    ).toBe(202);
    expect((await store.getProfile(me)).answers).toMatchObject({ "Do you have a PAN number?*": "Yes" });
    expect(signals).toEqual([[app.id, "answers"]]);
    expect(await store.getApplication(app.id)).toMatchObject({ status: "QUEUED", questions: null });
  });

  it("PUT /profile validates and saves; GET returns it", async () => {
    const bad = await request("/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(bad.status).toBe(400);

    const profile = { ...EMPTY_PROFILE, firstName: "Asha", answers: { "notice period": "30 days" } };
    const res = await request("/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    expect(res.status).toBe(200);
    expect(await (await request("/profile")).json()).toEqual(profile);
  });
});

it("POST /submit only while READY_TO_SUBMIT, and never after an attempt", async () => {
  const app = await store.createApplication(me, URL_OK, (await store.addResume(me, SAMPLE_RESUME)).id);
  expect((await post(`/applications/${app.id}/submit`, {})).status).toBe(409);

  await store.updateApplication(app.id, { status: "READY_TO_SUBMIT" });
  expect((await post(`/applications/${app.id}/submit`, {})).status).toBe(202);
  expect(signals).toEqual([[app.id, "submit"]]);
  expect((await store.getApplication(app.id))?.status).toBe("SUBMITTING");

  await store.updateApplication(app.id, { submitAttemptedAt: new Date().toISOString() });
  expect((await post(`/applications/${app.id}/submit`, {})).status).toBe(409);
});

describe("GET /applications/:id/resume.pdf", () => {
  it("serves the tailored PDF from the file store", async () => {
    const resume = await store.addResume(me, SAMPLE_RESUME);
    const app = await store.createApplication(me, URL_OK, resume.id);
    expect((await request(`/applications/${app.id}/resume.pdf`)).status).toBe(404);

    await files.put("applications/x/resume.pdf", Buffer.from("%PDF-1.7 tailored"), "application/pdf");
    await store.updateApplication(app.id, { pdfKey: "applications/x/resume.pdf" });
    const res = await request(`/applications/${app.id}/resume.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.7 tailored");
  });
});

describe("sign-in", () => {
  it("needs a session for everything but /auth", async () => {
    expect((await api.request("/applications")).status).toBe(401);
    expect((await api.request("/profile")).status).toBe(401);
    expect((await api.request("/auth/config")).status).toBe(200);
    expect(await (await api.request("/auth/config")).json()).toEqual({ googleClientId: "test-client" });
  });

  it("rejects a Google token that doesn't verify, and forged cookies", async () => {
    const res = await api.request("/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential: "forged" }),
    });
    expect(res.status).toBe(401);
    const [name, value] = cookie.split("=");
    const tampered = `${name}=${value!.replace(/^[^.]+/, "00000000-0000-4000-8000-000000000000")}`;
    expect((await request("/me", {}, tampered)).status).toBe(401);
  });

  it("returns the signed-in user; signing in again is the same user", async () => {
    const res = await request("/me");
    expect(await res.json()).toMatchObject({
      user: { id: me, email: "asha@example.com", name: "Asha Rao" },
      workday: null,
    });
    expect((await signIn("token-asha")).id).toBe(me);
  });

  it("keeps each user's data to themselves", async () => {
    const resume = await store.addResume(me, SAMPLE_RESUME);
    const app = await store.createApplication(me, URL_OK, resume.id);
    const ben = (await signIn("token-ben")).cookie;

    expect(await (await request("/applications", {}, ben)).json()).toEqual([]);
    expect(await (await request("/resumes", {}, ben)).json()).toEqual([]);
    expect((await request(`/applications/${app.id}`, {}, ben)).status).toBe(404);
    expect((await request(`/resumes/${resume.id}`, {}, ben)).status).toBe(404);
    expect((await post(`/applications/${app.id}/submit`, {}, ben)).status).toBe(404);
    expect((await post("/applications", { url: URL_OK, resumeId: resume.id }, ben)).status).toBe(404);
    expect((await request("/applications")).status).toBe(200); // Asha still sees hers
  });
});

describe("Workday login", () => {
  const put = (body: unknown) =>
    request("/workday-account", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("stores the password encrypted and never returns it", async () => {
    expect((await put({ email: "asha@example.com" })).status).toBe(400); // no password yet
    expect((await put({ email: "asha@example.com", password: "S3cret!" })).status).toBe(200);

    const saved = await store.getWorkdayAccount(me);
    expect(saved?.passwordSealed).not.toContain("S3cret!");
    expect(secrets.open(saved!.passwordSealed)).toBe("S3cret!");
    const shown = await (await request("/workday-account")).json();
    expect(shown).toMatchObject({ email: "asha@example.com" });
    expect(JSON.stringify(shown)).not.toContain("S3cret");
  });

  it("changes the email and keeps the password when none is sent", async () => {
    await put({ email: "asha@example.com", password: "S3cret!" });
    await put({ email: "asha.rao@example.com" });
    const saved = await store.getWorkdayAccount(me);
    expect(saved?.email).toBe("asha.rao@example.com");
    expect(secrets.open(saved!.passwordSealed)).toBe("S3cret!");
  });
});

describe("POST /applications/:id/code", () => {
  it("hands the code to the waiting browser, once", async () => {
    const app = await store.createApplication(me, URL_OK, (await store.addResume(me, SAMPLE_RESUME)).id);
    expect((await post(`/applications/${app.id}/code`, { code: "123456" })).status).toBe(409); // not waiting

    await store.updateApplication(app.id, { status: "NEEDS_CODE", questions: ["Verification Code"] });
    expect((await post(`/applications/${app.id}/code`, { code: " " })).status).toBe(400);
    expect((await post(`/applications/${app.id}/code`, { code: "123456" })).status).toBe(202);
    expect((await store.getApplication(app.id))?.status).toBe("APPLYING");
    expect(await store.takeCode(app.id)).toBe("123456");
    expect(await store.takeCode(app.id)).toBeNull(); // used once
  });
});

it("fills the profile's empty fields from an uploaded resume, keeping what the user entered", async () => {
  await store.saveProfile(me, { ...EMPTY_PROFILE, firstName: "Ash" });
  const form = new FormData();
  form.append("file", new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" }));
  expect((await request("/resumes", { method: "POST", body: form })).status).toBe(201);

  const profile = await (await request("/profile")).json();
  expect(profile.firstName).toBe("Ash"); // the user's own value stays
  expect(profile.lastName).toBe(SAMPLE_RESUME.name.split(" ").slice(1).join(" "));
  expect(profile.email).toBe(SAMPLE_RESUME.email);
  expect(profile.links).toEqual(SAMPLE_RESUME.links);
});
