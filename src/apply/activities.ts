/**
 * The browser worker's activities.
 *
 * applyToJob: fill an approved application up to Workday's Review page. Never submits.
 *   at_review -> status READY_TO_SUBMIT (+ screenshot)       returns "at_review"
 *   blocked   -> status NEEDS_INPUT (+ the questions)       returns "needs_input"
 *   failed    -> throws (Temporal records it; the workflow marks the application FAILED)
 * Workday keeps the draft, so running it again after the user answers continues where it stopped.
 *
 * submitApplication: after the user said "submit": walk the draft back to Review, click Submit ONCE.
 *   confirmed   -> SUBMITTED            unconfirmed -> SUBMIT_UNCONFIRMED (user checks; never retried)
 *   blocked     -> NEEDS_INPUT          (the form changed: the workflow asks, then fills and waits again)
 */

import { ApplicationFailure } from "@temporalio/common";
import type { Experimental_EvaluationModel, LanguageModel } from "ai";
import type { Page } from "playwright";

import { workdayCredentials } from "../config.ts";
import { type FileStore, fileKeys } from "../files/store.ts";
import type { Store } from "../store/store.ts";
import { runAgent } from "./agent.ts";
import { openBrowser } from "./browser.ts";
import { buildFacts } from "./facts.ts";
import { settle } from "./guards.ts";
import { clickSubmitOnce } from "./submit.ts";

export type ApplyOutcome = "at_review" | "needs_input" | "already_applied";
export type SubmitOutcome = "submitted" | "unconfirmed" | "needs_input" | "already_applied";

export interface ApplyDeps {
  store: Store;
  files: FileStore;
  jev?: Experimental_EvaluationModel;
  text?: LanguageModel;
  headless?: boolean;
  open?: typeof openBrowser;
}

export function createApplyActivities({ store, files, jev, text, headless = true, open = openBrowser }: ApplyDeps) {
  /** Open the application's draft and let the agent bring it to Review. */
  async function toReview(id: string, status: "APPLYING" | "SUBMITTING", then: (page: Page) => Promise<void>) {
    const app = await store.getApplication(id);
    const pdf = app?.pdfKey ? await files.get(app.pdfKey) : null;
    if (!app?.job || !app.tailor || !pdf) {
      throw ApplicationFailure.nonRetryable(
        `Application ${id} is not ready to apply (job, tailored resume and PDF needed)`,
      );
    }
    const creds = workdayCredentials();
    const facts = buildFacts(app.tailor.tailored, await store.getProfile(), creds.email, {
      company: app.job.company,
      tenant: app.job.tenant,
    });
    await store.updateApplication(id, { status, questions: null, error: null });

    const session = await open({ headless });
    try {
      const page = await session.context.newPage();
      await page.goto(app.job.url);
      const result = await runAgent({
        page,
        facts,
        creds,
        resumePdf: { name: resumeFileName(app.tailor.tailored.name), buffer: pdf },
        jev,
        text,
      });
      await files.put(fileKeys.trace(id, Date.now()), Buffer.from(JSON.stringify(result, null, 2)), "application/json");

      if (result.status === "failed") throw new Error(result.reason); // let Temporal's retry policy decide
      if (result.status === "already_applied") {
        await store.updateApplication(id, { status: "ALREADY_APPLIED", screenshotKey: await shot(page, id) });
        return "already_applied" as const;
      }
      if (result.status === "blocked") {
        await store.updateApplication(id, {
          status: "NEEDS_INPUT",
          questions: result.questions,
          screenshotKey: await shot(page, id),
        });
        return "needs_input" as const;
      }
      await then(page);
      return "at_review" as const;
    } finally {
      await session.close();
    }
  }

  /** Save a full-page screenshot and return its key, or null if the page could not be captured. */
  async function shot(page: Page, id: string, name?: string): Promise<string | null> {
    // The Review summary loads after the page: wait for it, since this picture is what the user checks.
    await settle(page, 15_000);
    await page.waitForTimeout(1_500);
    const image = await page.screenshot({ fullPage: true }).catch(() => null);
    if (!image) return null;
    const key = fileKeys.screenshot(id, name);
    await files.put(key, image, "image/png");
    return key;
  }

  return {
    async applyToJob(id: string): Promise<ApplyOutcome> {
      return toReview(id, "APPLYING", async (page) => {
        await store.updateApplication(id, { status: "READY_TO_SUBMIT", screenshotKey: await shot(page, id) });
      });
    },

    async submitApplication(id: string): Promise<SubmitOutcome> {
      // At most one click, ever: the attempt is recorded before clicking, and checked first.
      if ((await store.getApplication(id))?.submitAttemptedAt) {
        await store.updateApplication(id, {
          status: "SUBMIT_UNCONFIRMED",
          error: "Submit was already clicked once; check Workday",
        });
        return "unconfirmed";
      }
      let result: SubmitOutcome = "unconfirmed";
      const reached = await toReview(id, "SUBMITTING", async (page) => {
        const outcome = await clickSubmitOnce(page, async () => {
          await store.updateApplication(id, { submitAttemptedAt: new Date().toISOString() });
        });
        const screenshotKey = await shot(page, id, "submitted");
        if (outcome === "confirmed") {
          await store.updateApplication(id, { status: "SUBMITTED", screenshotKey });
          result = "submitted";
        } else {
          await store.updateApplication(id, {
            status: "SUBMIT_UNCONFIRMED",
            screenshotKey,
            error: "No Workday confirmation after Submit",
          });
        }
      });
      return reached === "at_review" ? result : reached;
    },
  };
}

/** "Priya Test" -> "Priya_Test_Resume.pdf": the name Workday shows next to the upload. */
export function resumeFileName(name: string): string {
  const base = name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return `${base || "Resume"}_Resume.pdf`;
}

export type ApplyActivities = ReturnType<typeof createApplyActivities>;
