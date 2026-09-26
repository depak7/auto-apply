/**
 * The agent on a fake Workday-style page, in a real headless browser, with a scripted Jev.
 * Checks the rules that must hold whatever the model decides.
 */

import { Experimental_EvaluationMockModelV4, MockLanguageModelV4 } from "ai/test";
import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { stepLog } from "../src/apply/activities.ts";
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
    badLogin: () => progress(1, 3, 'Create Account/Sign In') +
      '<label for="em">Email Address*</label><input id="em" required>' +
      '<label for="pw">Password*</label><input id="pw" type="password" required>' +
      '<p id="err"></p>' +
      '<button onclick="window.signIns = (window.signIns || 0) + 1; err.textContent = \\'You may have entered the wrong email address or password or your account might be locked.\\'">Sign In</button>' +
      '<button onclick="window.created = true; show(window.afterCreate)">Create Account</button>',
    verify: () => progress(1, 3, 'Create Account/Sign In') +
      '<p>We sent a code to your email.</p><label for="vc">Verification Code*</label><input id="vc" required>' +
      '<button onclick="window.code = vc.value; show(\\'info\\')">Verify</button>',
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
      const recent = (state as { recent_actions?: string[] }).recent_actions ?? [];
      if (recent.at(-1)?.startsWith("Sign-in failed")) {
        const key = pick("click", /"Create Account"/);
        if (key) return answer("CLICK", "click", key);
      }
      for (const [op, q, re] of [
        ["CLICK", "click", /PAN number.*"Yes"|"Do you have a PAN number\?\* > Yes"/],
        ["CLICK", "click", /"Worked here before\?\* > Yes" unchecked/],
        ["CLICK", "click", /"Apply Manually"/],
        ["CLICK", "click", /"Apply"/],
        ["FILL", "fill", /"Email Address\*" required empty/],
        ["FILL", "fill", /"Password\*" required empty/],
        ["CLICK", "click", /"Sign In"/],
        ["FILL", "fill", /"Verification Code\*" required empty/],
        ["CLICK", "click", /"Verify"/],
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
    expect(result.trace.some((t) => t.operation === "AT_REVIEW" && /the page disagrees/.test(t.result))).toBe(true);
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

describe("verification codes", () => {
  it("asks the user for the code, types it, and never sends it to a model", async () => {
    await page.evaluate(() => (globalThis as any).show("verify"));
    const text = recordingTextModel();
    const asked: string[] = [];
    const result = await runAgent({
      page,
      facts,
      creds,
      resumePdf: pdf,
      jev: scriptedJev().model,
      text: text.model,
      maxSteps: 3,
      askCode: async (question) => {
        asked.push(question);
        return "482913";
      },
    });
    expect(asked).toEqual(["Verification Code*"]);
    expect(await page.evaluate(() => (globalThis as any).code)).toBe("482913");
    expect(result.trace.some((t) => /verification code \(from the user\)/.test(t.result))).toBe(true);
    expect(text.prompts.join("")).not.toContain("482913");
    expect(text.prompts.join("")).not.toContain("Verification Code");
  });

  it("fails without retrying when no code arrives", async () => {
    await page.evaluate(() => (globalThis as any).show("verify"));
    const result = await runAgent({
      page,
      facts,
      creds,
      resumePdf: pdf,
      jev: scriptedJev().model,
      text: recordingTextModel().model,
      maxSteps: 3,
      askCode: async () => null,
    });
    expect(result).toMatchObject({ status: "failed", retry: false });
  });
});

describe("a refused sign-in", () => {
  it("tries Create Account once with the same login, then carries on", async () => {
    await page.evaluate(() => {
      (globalThis as any).afterCreate = "info";
      (globalThis as any).show("badLogin");
    });
    const result = await runAgent({
      page,
      facts,
      creds,
      resumePdf: pdf,
      jev: scriptedJev().model,
      text: recordingTextModel().model,
      maxSteps: 12,
    });
    expect(await page.evaluate(() => (globalThis as any).created)).toBe(true);
    expect(await page.evaluate(() => (globalThis as any).signIns)).toBe(1);
    expect(result.trace.some((t) => t.operation === "SIGN_IN_FAILED")).toBe(true);
  });

  it("refused again: stops with a clear reason instead of clicking Sign In over and over", async () => {
    await page.evaluate(() => {
      (globalThis as any).afterCreate = "badLogin"; // the new account's form is refused too
      (globalThis as any).show("badLogin");
    });
    const result = await runAgent({
      page,
      facts,
      creds,
      resumePdf: pdf,
      jev: scriptedJev().model,
      text: recordingTextModel().model,
      maxSteps: 20,
    });
    expect(result).toMatchObject({ status: "failed", retry: false });
    expect((result as { reason: string }).reason).toMatch(/didn't accept your Workday login/);
    expect(await page.evaluate(() => (globalThis as any).signIns)).toBe(2);
  });
});

it("step logs leave typed values out", () => {
  const line = stepLog("a86f510d-46bd-4ea6-b5a1-579419a402f4", {
    n: 14,
    step: "2 of 4: My Information",
    operation: "FILL",
    target: 'text "Phone Number*" required empty',
    result: 'typed "9876543210" (facts)',
    confidence: 0.93,
    ms: 812,
  });
  expect(line).toBe(
    '[a86f510d] 14 [2 of 4: My Information] FILL text "Phone Number*" required empty -> typed (facts) (812 ms p=0.93)',
  );
  expect(line).not.toContain("9876543210");
});
