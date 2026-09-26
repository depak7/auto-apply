/**
 * The API with an in-memory store and a fake Temporal: no servers, no models.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFileStore } from "../src/files/store.ts";
import { EMPTY_PROFILE } from "../src/schemas/index.ts";
import { createApi } from "../src/server/api.ts";
import type { Store } from "../src/store/store.ts";
import type { Workflows } from "../src/workflows/client.ts";
import { SAMPLE_RESUME } from "./mocks.ts";
import { testStore } from "./pglite.ts";

const URL_OK = "https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/US/Engineer_JR1";

let store: Store;
let files: MemoryFileStore;
let started: string[];
let signals: [string, string][];
let api: ReturnType<typeof createApi>;

beforeEach(async () => {
  store = await testStore();
  files = new MemoryFileStore();
  started = [];
  signals = [];
  const workflows: Workflows = {
    start: async (id) => void started.push(id),
    signal: async (id, decision) => void signals.push([id, decision]),
  };
  api = createApi({ store, workflows, files, parse: async () => SAMPLE_RESUME });
});

const post = (path: string, body: unknown) =>
  api.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("POST /resumes", () => {
  it("accepts a PDF upload and stores the parsed resume", async () => {
    const form = new FormData();
    form.append("file", new File(["%PDF-1.4"], "cv.pdf", { type: "application/pdf" }));
    const res = await api.request("/resumes", { method: "POST", body: form });
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
    expect((await api.request("/resumes", { method: "POST", body: form })).status).toBe(400);
  });
});

describe("POST /applications", () => {
  it("creates the application and starts its workflow", async () => {
    const resume = await store.addResume(SAMPLE_RESUME);
    const res = await post("/applications", { url: URL_OK, resumeId: resume.id });
    expect(res.status).toBe(202);
    const { id, status } = await res.json();
    expect(status).toBe("CREATED");
    expect(started).toEqual([id]);
  });

  it("rejects non-Workday URLs and unknown resumes without starting anything", async () => {
    const resume = await store.addResume(SAMPLE_RESUME);
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
    const app = await store.createApplication(URL_OK, (await store.addResume(SAMPLE_RESUME)).id);

    expect((await post(`/applications/${app.id}/approve`, {})).status).toBe(409); // still CREATED
    await store.updateApplication(app.id, { status: "AWAITING_APPROVAL" });
    expect((await post(`/applications/${app.id}/approve`, {})).status).toBe(202);
    expect((await post("/applications/nope/reject", {})).status).toBe(404);

    expect(signals).toEqual([[app.id, "approve"]]);
    expect((await store.getApplication(app.id))?.status).toBe("RENDERING"); // the UI sees the decision at once
  });
});

it("GET /applications/:id shows status and an empty diff before tailoring", async () => {
  const app = await store.createApplication(URL_OK, (await store.addResume(SAMPLE_RESUME)).id);
  const res = await api.request(`/applications/${app.id}`);
  expect(await res.json()).toMatchObject({ id: app.id, status: "CREATED", changes: [], hasPdf: false, scores: null });
});

describe("answers and profile", () => {
  it("saves answers into the profile and signals the workflow, only while NEEDS_INPUT", async () => {
    const app = await store.createApplication(URL_OK, (await store.addResume(SAMPLE_RESUME)).id);
    expect((await post(`/applications/${app.id}/answers`, { answers: { x: "y" } })).status).toBe(409);

    await store.updateApplication(app.id, { status: "NEEDS_INPUT", questions: ["Do you have a PAN number?*"] });
    const missing = await post(`/applications/${app.id}/answers`, { answers: { other: "Yes" } });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ unanswered: ["Do you have a PAN number?*"] });

    expect(
      (await post(`/applications/${app.id}/answers`, { answers: { "Do you have a PAN number?*": "Yes" } })).status,
    ).toBe(202);
    expect((await store.getProfile()).answers).toMatchObject({ "Do you have a PAN number?*": "Yes" });
    expect(signals).toEqual([[app.id, "answers"]]);
    expect(await store.getApplication(app.id)).toMatchObject({ status: "QUEUED", questions: null });
  });

  it("PUT /profile validates and saves; GET returns it", async () => {
    const bad = await api.request("/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(bad.status).toBe(400);

    const profile = { ...EMPTY_PROFILE, firstName: "Asha", answers: { "notice period": "30 days" } };
    const res = await api.request("/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    expect(res.status).toBe(200);
    expect(await (await api.request("/profile")).json()).toEqual(profile);
  });
});

it("POST /submit only while READY_TO_SUBMIT, and never after an attempt", async () => {
  const app = await store.createApplication(URL_OK, (await store.addResume(SAMPLE_RESUME)).id);
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
    const resume = await store.addResume(SAMPLE_RESUME);
    const app = await store.createApplication(URL_OK, resume.id);
    expect((await api.request(`/applications/${app.id}/resume.pdf`)).status).toBe(404);

    await files.put("applications/x/resume.pdf", Buffer.from("%PDF-1.7 tailored"), "application/pdf");
    await store.updateApplication(app.id, { pdfKey: "applications/x/resume.pdf" });
    const res = await api.request(`/applications/${app.id}/resume.pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.7 tailored");
  });
});
