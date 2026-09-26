/**
 * The agent on a fake Workday-style page, in a real headless browser, with a scripted Jev.
 * Checks the rules that must hold whatever the model decides.
 */

import { Experimental_EvaluationMockModelV4, MockLanguageModelV4 } from "ai/test";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { runAgent } from "../src/apply/agent.ts";
import { candidates } from "../src/apply/decide.ts";
import { buildFacts } from "../src/apply/facts.ts";
import { readPage } from "../src/apply/page.ts";
import { EMPTY_PROFILE } from "../src/schemas/index.ts";
import { SAMPLE_RESUME } from "./mocks.ts";

// A tiny single-page "Workday": job -> dialog -> sign in -> My Information -> Review.
const FAKE_WORKDAY = `<!doctype html><html><body><main id="app"></main><script>
  const app = document.getElementById("app");
  window.submitted = false;
  const progress = (i, n, name) => '<ol><li data-automation-id="progressBarActiveStep">current step ' + i + ' of ' + n + ' ' + name + '</li></ol>';
  const pages = {
    job: () => '<h2>Engineer</h2><a href="#" data-automation-id="adventureButton" onclick="show(\\'dialog\\');return false">Apply</a>',
    dialog: () => '<div role="dialog"><a href="#" data-automation-id="applyManually" onclick="show(\\'signin\\');return false">Apply Manually</a></div>',
    signin: () => progress(1, 3, 'Create Account/Sign In') +
      '<label for="em">Email Address*</label><input id="em" data-automation-id="email" required>' +
      '<label for="pw">Password*</label><input id="pw" type="password" data-automation-id="password" required>' +
      '<input data-automation-id="beecatcher" aria-label="Enter website. This input is for robots only, do not enter if you\\'re human.">' +
      '<button data-automation-id="signInSubmitButton" onclick="window.pw = pw.value; window.bee = document.querySelector(\\'[data-automation-id=beecatcher]\\').value; show(\\'info\\')">Sign In</button>',
    applied: () => '<h2>Engineer</h2><p>You applied for this job on September 22, 2026</p><button>View Application</button>',
    stuck: () => progress(2, 3, 'My Information') + '<button>My Information</button>',
    exEmployee: () => progress(2, 3, 'Application Questions') +
      '<fieldset data-automation-id="formField-ex"><legend>Worked here before?*</legend>' +
      '<input type="radio" name="ex" id="exy"><label for="exy">Yes</label>' +
      '<input type="radio" name="ex" id="exn"><label for="exn">No</label></fieldset>',
    pan: () => progress(2, 3, 'Application Questions') +
      '<fieldset data-automation-id="formField-pan"><legend>Do you have a PAN number?*</legend>' +
      '<input type="checkbox" id="py"><label for="py">Yes</label></fieldset>',
    info: () => progress(2, 3, 'My Information') +
      '<label for="gn">Given Name(s)*</label><input id="gn" required>' +
      '<label for="cv">Resume*</label><input id="cv" type="file" required>' +
      '<button data-automation-id="pageFooterNextButton" onclick="window.gn = gn.value; window.cv = cv.files.length; show(\\'review\\')">Save and Continue</button>',
    review: () => progress(3, 3, 'Review') +
      '<button data-automation-id="pageFooterNextButton" onclick="window.submitted = true">Submit</button>',
  };
  window.show = (name) => { app.innerHTML = pages[name](); };
  show("job");
</script></body></html>`;

/** A scripted Jev: picks the element whose description matches the first rule that applies. */
function scriptedJev(opts: { claimReviewEarly?: boolean; support?: number | ((option: string) => number) } = {}) {
  const seen: string[][] = []; // every element list Jev was shown
  let uploaded = false;
  const model = new Experimental_EvaluationMockModelV4({
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: async ({ state, questions }) => {
      if (questions.supported) {
        // the "do the facts support this answer?" check
        const option = (state as { option: string }).option;
        const probability = typeof opts.support === "function" ? opts.support(option) : (opts.support ?? 0.1);
        return { answers: { supported: { type: "boolean" as const, probability } }, warnings: [] };
      }
      const s = state as { page: { step: string | null; elements: string[] } };
      seen.push(s.page.elements);
      const pick = (q: string, re: RegExp) => {
        const criteria = (questions[q] as { criteria?: Record<string, string> } | undefined)?.criteria ?? {};
        return Object.entries(criteria).find(([, d]) => re.test(d))?.[0];
      };
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

      if (
        opts.claimReviewEarly &&
        /My Information/.test(s.page.step ?? "") &&
        !seen.flat().some((e) => /Given.*value=/.test(e))
      ) {
        opts.claimReviewEarly = false;
        return answer("AT_REVIEW");
      }
      if (/Review/.test(s.page.step ?? "")) return answer("AT_REVIEW");
      for (const [op, q, re] of [
        ["CLICK", "click", /PAN number.*"Yes"|"Do you have a PAN number\?\* > Yes"/],
        ["CLICK", "click", /"Worked here before\?\* > Yes" unchecked/],
        ["CLICK", "click", /"Apply Manually"/],
        ["CLICK", "click", /"Apply"/],
        ["FILL", "fill", /"Email Address\*" required empty/],
        ["FILL", "fill", /"Password\*" required empty/],
        ["CLICK", "click", /"Sign In"/],
        ["FILL", "fill", /"Given Name\(s\)\*" required empty/],
        ["UPLOAD", "upload", /file/],
        ["CLICK", "click", /"Save and Continue"/],
      ] as const) {
        if (q === "upload" && uploaded) continue; // attach the resume once
        const key = pick(q, re);
        if (key) {
          if (q === "upload") uploaded = true;
          return answer(op, q, key);
        }
      }
      return answer("WAIT");
    },
  });
  return { model, seen };
}

function recordingTextModel() {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      return {
        content: [{ type: "text", text: JSON.stringify({ value: "Asha", source: "facts" }) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

let browser: Browser;
let page: Page;
const creds = { email: "asha@example.com", password: "S3cret-pass!" };
const facts = buildFacts(SAMPLE_RESUME, EMPTY_PROFILE, creds.email);
const pdf = { name: "cv.pdf", buffer: Buffer.from("%PDF-1.4 fake") };

beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => void (await browser?.close()));
beforeEach(async () => {
  page = await browser.newPage();
  await page.setContent(FAKE_WORKDAY);
});

describe("runAgent on a fake Workday", () => {
  it("signs in, fills, uploads, stops at Review, and never submits", async () => {
    const jev = scriptedJev();
    const text = recordingTextModel();
    const result = await runAgent({
      page,
      facts,
      creds,
      resumePdf: pdf,
      jev: jev.model,
      text: text.model,
      maxSteps: 30,
    });

    expect(result.status).toBe("at_review");
    const pageState = await page.evaluate(() => ({
      submitted: (globalThis as any).submitted,
      pw: (globalThis as any).pw,
      bee: (globalThis as any).bee,
      gn: (globalThis as any).gn,
      cv: (globalThis as any).cv,
    }));
    expect(pageState).toEqual({ submitted: false, pw: creds.password, bee: "", gn: "Asha", cv: 1 });

    // The password never went to a model, and the honeypot was never offered to Jev.
    expect(text.prompts.join()).not.toContain(creds.password);
    expect(jev.seen.flat().some((e) => /robots only/.test(e))).toBe(false);
  });

  it("ignores AT_REVIEW until the progress bar really says Review", async () => {
    const jev = scriptedJev({ claimReviewEarly: true });
    const result = await runAgent({
      page,
      facts,
      creds,
      resumePdf: pdf,
      jev: jev.model,
      text: recordingTextModel().model,
      maxSteps: 30,
    });

    expect(result.status).toBe("at_review");
    expect(result.trace.some((t) => t.operation === "AT_REVIEW" && /progress bar disagrees/.test(t.result))).toBe(true);
  });

  it("never offers Submit or the honeypot as a target", async () => {
    await page.evaluate(() => (globalThis as any).show("review"));
    expect(candidates(await readPage(page)).click.map((f) => f.label)).not.toContain("Submit");

    await page.evaluate(() => (globalThis as any).show("signin"));
    const c = candidates(await readPage(page));
    expect(c.fill.map((f) => f.label)).toEqual(["Email Address*", "Password*"]);
  });
});

it("does not tick a Yes/No answer the facts don't support: it asks instead", async () => {
  await page.evaluate(() => (globalThis as any).show("pan"));
  const result = await runAgent({
    page,
    facts,
    creds,
    resumePdf: pdf,
    jev: scriptedJev({ support: 0.1 }).model,
    text: recordingTextModel().model,
    maxSteps: 5,
  });

  expect(result).toMatchObject({ status: "blocked", questions: ["Do you have a PAN number?*"] });
  expect(await page.isChecked("#py")).toBe(false);
});

it("stops at once when Workday says this job was already applied to", async () => {
  await page.evaluate(() => (globalThis as any).show("applied"));
  const result = await runAgent({
    page,
    facts,
    creds,
    resumePdf: pdf,
    jev: scriptedJev().model,
    text: recordingTextModel().model,
    maxSteps: 5,
  });
  expect(result.status).toBe("already_applied");
  expect(result.trace).toHaveLength(0); // not a single click
});

it("stuck with nothing to ask is a failure, never an empty list of questions", async () => {
  await page.evaluate(() => (globalThis as any).show("stuck"));
  const result = await runAgent({
    page,
    facts,
    creds,
    resumePdf: pdf,
    jev: scriptedJev().model,
    text: recordingTextModel().model,
    maxSteps: 20,
  });
  expect(result).toMatchObject({ status: "failed" });
  expect((result as { reason: string }).reason).toMatch(/Couldn't move forward on "My Information"/);
});

it("when Jev's answer isn't supported, picks the option that is ('No' instead of 'Yes')", async () => {
  await page.evaluate(() => (globalThis as any).show("exEmployee"));
  const jev = scriptedJev({ support: (option) => (option === "No" ? 0.98 : 0.02) });
  await runAgent({ page, facts, creds, resumePdf: pdf, jev: jev.model, text: recordingTextModel().model, maxSteps: 2 });

  expect(await page.isChecked("#exn")).toBe(true);
  expect(await page.isChecked("#exy")).toBe(false);
});
