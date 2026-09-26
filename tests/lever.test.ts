import { readFileSync } from "node:fs";
import { Experimental_EvaluationMockModelV4, MockLanguageModelV4 } from "ai/test";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runAgent } from "../src/apply/agent.ts";
import { candidates } from "../src/apply/decide.ts";
import { buildFacts } from "../src/apply/facts.ts";
import { readPage } from "../src/apply/page.ts";
import { clickSubmitOnce, NotReadyToSubmit } from "../src/apply/submit.ts";
import { boardFor, NotAJobURL } from "../src/boards/index.ts";
import { companyName, jobFromLever, lever, parseLeverUrl } from "../src/boards/lever.ts";
import { workday } from "../src/boards/workday.ts";
import { EMPTY_PROFILE } from "../src/schemas/index.ts";
import { SAMPLE_RESUME } from "./mocks.ts";

const POSTING = "https://jobs.lever.co/brillio-2/170fb4c9-1346-49f1-9014-d56a36cae2c3";

describe("Lever URLs and postings", () => {
  it("parses job and apply links, including the EU host", () => {
    for (const url of [POSTING, `${POSTING}/apply?lever-source=Job%20postings%20feed`]) {
      expect(parseLeverUrl(url)).toMatchObject({
        company: "brillio-2",
        applyUrl: `${POSTING}/apply`,
        apiUrl: "https://api.lever.co/v0/postings/brillio-2/170fb4c9-1346-49f1-9014-d56a36cae2c3?mode=json",
      });
    }
    expect(parseLeverUrl(POSTING.replace("jobs.lever.co", "jobs.eu.lever.co")).apiUrl).toContain("api.eu.lever.co");
    expect(() => parseLeverUrl("https://jobs.lever.co/brillio-2")).toThrow(NotAJobURL);
  });

  it("maps a posting to a job, with the requirements lists in the description", () => {
    const data = JSON.parse(readFileSync(new URL("./fixtures/lever_posting_brillio.json", import.meta.url), "utf8"));
    const job = jobFromLever(parseLeverUrl(POSTING), data);
    expect(job).toMatchObject({
      board: "lever",
      title: "Senior Engineer - R01571651",
      company: "Brillio",
      location: "Bangalore, Karnataka, India",
      applyUrl: `${POSTING}/apply`,
      canApply: true,
    });
    expect(job.description).toContain("Job requirements");
    expect(job.description.length).toBeGreaterThan(1000);
    expect(companyName("acme-corp")).toBe("Acme Corp");
  });

  it("picks the board from the link, and rejects other sites", () => {
    expect(boardFor(POSTING)).toBe(lever);
    expect(boardFor("https://nvidia.wd5.myworkdayjobs.com/Site/job/US/X_JR1")).toBe(workday);
    expect(() => boardFor("https://boards.greenhouse.io/x/jobs/1")).toThrow(/Workday .* or Lever/);
  });
});

// A small Lever-style form: fields wrapped in their labels, "✱" for required, a native select.
const FAKE_LEVER = (complete = false) => `<!doctype html><html><body><form id="f" onsubmit="return false">
  <button type="button" onclick="window.linkedin = true">Apply with LinkedIn</button>
  <label><div class="application-label">Resume/CV <span class="required">✱</span></div>
    <input type="file" id="cv" name="resume"></label>
  <label><div class="application-label">Full name<span class="required">✱</span></div><input id="name" name="name" ${complete ? 'value="Asha Rao"' : ""}></label>
  <label><div class="application-label">Email<span class="required">✱</span></div><input type="email" id="email" name="email" ${complete ? 'value="asha@example.com"' : ""}></label>
  <label><div class="application-label">GitHub URL</div><input id="gh" name="urls[GitHub]"></label>
  <label><div class="application-label">What is your age range?</div>
    <select id="age"><option value="">Select...</option><option>18-24</option><option>25-34</option></select></label>
  <button type="button" id="btn-submit" onclick="window.submitted = true; history.pushState({}, '', location.pathname + '/thanks')">SUBMIT APPLICATION</button>
</form></body></html>`;

function scriptedJev() {
  const seen: string[][] = [];
  const model = new Experimental_EvaluationMockModelV4({
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: async ({ state, questions }) => {
      const s = state as { page: { elements: string[] } };
      seen.push(s.page.elements);
      const pick = (q: string, re: RegExp) =>
        Object.entries((questions[q] as { criteria?: Record<string, string> } | undefined)?.criteria ?? {}).find(
          ([, d]) => re.test(d),
        )?.[0];
      const answer = (operation: string, q?: string, key?: string) => {
        const answers: Record<string, { type: "choice"; choice: string }> = {
          operation: { type: "choice", choice: operation },
        };
        for (const id of Object.keys(questions)) {
          if (id === "operation") continue;
          const first = Object.keys((questions[id] as { criteria: Record<string, string> }).criteria)[0]!;
          answers[id] = { type: "choice", choice: id === q && key ? key : first };
        }
        return { answers, warnings: [], providerMetadata: { typesafe: { confidence: { operation: 0.95 } } } };
      };
      const upload = pick("upload", /file/);
      if (upload && !s.page.elements.some((e) => /file .*value=/.test(e)) && seen.length < 3)
        return answer("UPLOAD", "upload", upload);
      const empty = pick("fill", /required empty/);
      if (empty) return answer("FILL", "fill", empty);
      return answer("AT_REVIEW");
    },
  });
  return { model, seen };
}

const textModel = () =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify({ value: "Asha Rao", source: "facts" }) }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    }),
  });

let browser: Browser;
let page: Page;

/** Serve the fake form at a Lever-style address, so the page can move on to /thanks like the real one. */
async function openForm(complete = false) {
  const url = "https://jobs.lever.co/acme/00000000-0000-4000-8000-000000000000/apply";
  await page.unrouteAll();
  await page.route("https://jobs.lever.co/**", (route) =>
    route.fulfill({ contentType: "text/html", body: FAKE_LEVER(complete) }),
  );
  await page.goto(url);
}
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
afterAll(async () => {
  await browser.close();
});

describe("the agent on a Lever form", () => {
  it("fills the required fields, attaches the resume, and stops before Submit", async () => {
    await openForm();
    const creds = { email: "asha@example.com", password: "" };
    const jev = scriptedJev();
    const result = await runAgent({
      page,
      board: lever,
      facts: buildFacts(SAMPLE_RESUME, EMPTY_PROFILE, creds.email),
      creds,
      resumePdf: { name: "cv.pdf", buffer: Buffer.from("%PDF-1.4 fake") },
      jev: jev.model,
      text: textModel(),
      maxSteps: 12,
    });

    expect(result.status).toBe("at_review");
    expect(await page.inputValue("#name")).toBe("Asha Rao");
    expect(await page.inputValue("#email")).toBe("asha@example.com"); // typed by code
    expect(await page.evaluate(() => (document.querySelector("#cv") as HTMLInputElement).files?.length)).toBe(1);
    expect(await page.evaluate(() => (globalThis as any).submitted)).toBeUndefined();
    expect(await page.evaluate(() => (globalThis as any).linkedin)).toBeUndefined();
  });

  it("never offers Submit or 'Apply with LinkedIn' as something to click", async () => {
    await openForm();
    const snap = await readPage(page);
    const labels = candidates(snap, new Set(), lever).click.map((f) => f.label);
    expect(labels.join(" ")).not.toMatch(/submit|linkedin/i);
  });
});

describe("submitting on Lever", () => {
  it("refuses while required fields are empty", async () => {
    await openForm(false);
    let recorded = false;
    await expect(
      clickSubmitOnce(
        page,
        () => {
          recorded = true;
        },
        1_000,
        lever,
      ),
    ).rejects.toThrow(NotReadyToSubmit);
    expect(recorded).toBe(false);
  });

  it("clicks once on a complete form, records it first, and confirms by the /thanks page", async () => {
    await openForm(true);
    await page.setInputFiles("#cv", { name: "cv.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF") });
    let recordedFirst = false;
    const outcome = await clickSubmitOnce(
      page,
      async () => {
        recordedFirst = !(await page.evaluate(() => (globalThis as any).submitted));
      },
      5_000,
      lever,
    );
    expect(recordedFirst).toBe(true);
    expect(outcome).toBe("confirmed");
    expect(await page.evaluate(() => (globalThis as any).submitted)).toBe(true);
  });
});

it("a page with a single upload field still gives Jev a valid choice (at least two options)", async () => {
  const { decide } = await import("../src/apply/decide.ts");
  let uploadOptions: string[] = [];
  const jev = new Experimental_EvaluationMockModelV4({
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: async ({ questions }) => {
      uploadOptions = Object.keys((questions.upload as { criteria: Record<string, string> }).criteria);
      const answers = Object.fromEntries(
        Object.entries(questions).map(([id, q]) => [
          id,
          { type: "choice" as const, choice: Object.keys((q as { criteria: Record<string, string> }).criteria)[0]! },
        ]),
      );
      return { answers, warnings: [] };
    },
  });
  await openForm();
  await decide(await readPage(page), buildFacts(SAMPLE_RESUME, EMPTY_PROFILE, "a@b.c"), [], jev, new Set(), lever);
  expect(uploadOptions.length).toBeGreaterThanOrEqual(2);
  expect(uploadOptions).toContain("none");
});
