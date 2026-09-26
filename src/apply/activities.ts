/**
 * The browser worker's activities.
 *
 * applyToJob: fill an approved application up to Workday's Review page. Never submits.
 *   at_review -> status READY_TO_SUBMIT (+ screenshot)       returns "at_review"
 *   blocked   -> status NEEDS_INPUT (+ the questions)       returns "needs_input"
 *   a verification code is asked -> status NEEDS_CODE while the browser waits (up to CODE_WAIT_MS)
 *   failed    -> throws (Temporal records it; the workflow marks the application FAILED)
 * Workday keeps the draft, so running it again after the user answers continues where it stopped.
 *
 * submitApplication: after the user said "submit": walk the draft back to Review, click Submit ONCE.
 *   confirmed   -> SUBMITTED            unconfirmed -> SUBMIT_UNCONFIRMED (user checks; never retried)
 *   blocked     -> NEEDS_INPUT          (the form changed: the workflow asks, then fills and waits again)
 */

import { setTimeout as sleep } from "node:timers/promises";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import type { Experimental_EvaluationModel, LanguageModel } from "ai";
import type { Page } from "playwright";

import { boardOf } from "../boards/index.ts";
import type { JobBoard } from "../boards/types.ts";
import { type FileStore, fileKeys } from "../files/store.ts";
import type { SecretBox } from "../lib/secrets.ts";
import type { Profile } from "../schemas/index.ts";
import type { Store } from "../store/store.ts";
import { runAgent, type TraceEntry } from "./agent.ts";
import { openBrowser } from "./browser.ts";
import { buildFacts } from "./facts.ts";
import { settle } from "./guards.ts";
import { clickSubmitOnce } from "./submit.ts";

export type ApplyOutcome = "at_review" | "needs_input" | "already_applied";
export type SubmitOutcome = "submitted" | "unconfirmed" | "needs_input" | "already_applied";

/** How long the browser waits on a verification page for the user to enter the code. */
export const CODE_WAIT_MS = 10 * 60_000;
const CODE_POLL_MS = 3_000;

export interface ApplyDeps {
  store: Store;
  files: FileStore;
  secrets: SecretBox;
  jev?: Experimental_EvaluationModel;
  text?: LanguageModel;
  headless?: boolean;
  open?: typeof openBrowser;
}

export function createApplyActivities({
  store,
  files,
  secrets,
  jev,
  text,
  headless = true,
  open = openBrowser,
}: ApplyDeps) {
  /** Open the application's draft and let the agent bring it to Review. */
  async function toReview(
    id: string,
    status: "APPLYING" | "SUBMITTING",
    then: (page: Page, board: JobBoard) => Promise<void>,
  ) {
    const app = await store.getApplication(id);
    const pdf = app?.pdfKey ? await files.get(app.pdfKey) : null;
    if (!app?.job || !app.tailor || !pdf) {
      throw ApplicationFailure.nonRetryable(
        `Application ${id} is not ready to apply (job, tailored resume and PDF needed)`,
      );
    }
    if (!app.userId) throw ApplicationFailure.nonRetryable(`Application ${id} has no owner`);
    const board = boardOf(app.job);
    const profile = await store.getProfile(app.userId);
    const creds = await credentialsFor(app.userId, board, profile);
    const facts = buildFacts(app.tailor.tailored, profile, creds.email, {
      company: app.job.company,
      tenant: app.job.tenant,
    });
    await store.updateApplication(id, { status, questions: null, error: null });

    const session = await open({ headless });
    heartbeat();
    try {
      const page = await session.context.newPage();
      await page.goto(board.startUrl(app.job));
      heartbeat();
      const result = await runAgent({
        page,
        facts,
        creds,
        resumePdf: { name: resumeFileName(app.tailor.tailored.name), buffer: pdf },
        jev,
        text,
        board,
        askCode: (question) => waitForCode(id, question, status),
        onStep: (entry) => {
          heartbeat(); // alive: a restarted or sleeping machine is noticed within the heartbeat timeout
          console.log(stepLog(id, entry));
        },
      });
      await files.put(fileKeys.trace(id, Date.now()), Buffer.from(JSON.stringify(result, null, 2)), "application/json");
      console.log(`[${id.slice(0, 8)}] run ended: ${result.status}${"reason" in result ? ` (${result.reason})` : ""}`);

      if (result.status === "failed") {
        // Show where it stopped.
        await store.updateApplication(id, { screenshotKey: await shot(page, id) }).catch(() => {});
        // Otherwise let Temporal's retry policy decide (e.g. the page broke; a fresh browser may do better).
        if (result.retry === false) throw ApplicationFailure.nonRetryable(result.reason);
        throw new Error(result.reason);
      }
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
      await then(page, board);
      return "at_review" as const;
    } finally {
      await session.close();
    }
  }

  /**
   * The email (and, for boards with accounts, the password) the agent types. Workday needs the
   * user's own login; the password is decrypted only here and typed by code, never sent to a model.
   * Lever has no accounts: the contact email from the profile.
   */
  async function credentialsFor(userId: string, board: JobBoard, profile: Profile) {
    if (!board.needsLogin) {
      const email = profile.email ?? (await store.getUser(userId))?.email;
      if (!email) throw ApplicationFailure.nonRetryable("Add your contact email to your profile, then apply again");
      return { email, password: "" };
    }
    const account = await store.getWorkdayAccount(userId);
    if (!account) throw ApplicationFailure.nonRetryable("Add your Workday login in your profile, then apply again");
    return { email: account.email, password: secrets.open(account.passwordSealed) };
  }

  /** Show the user a code box (NEEDS_CODE) and wait for the code they type; the browser stays on the page. */
  async function waitForCode(id: string, question: string, status: "APPLYING" | "SUBMITTING") {
    await store.updateApplication(id, { status: "NEEDS_CODE", questions: [question], code: null });
    const deadline = Date.now() + CODE_WAIT_MS;
    while (Date.now() < deadline) {
      heartbeat();
      const code = await store.takeCode(id);
      if (code) {
        await store.updateApplication(id, { status, questions: null });
        return code;
      }
      await sleep(CODE_POLL_MS);
    }
    await store.updateApplication(id, { status, questions: null });
    return null;
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
          error: "Submit was already clicked once; check the job board",
        });
        return "unconfirmed";
      }
      let result: SubmitOutcome = "unconfirmed";
      const reached = await toReview(id, "SUBMITTING", async (page, board) => {
        const recordAttempt = async () => {
          await store.updateApplication(id, { submitAttemptedAt: new Date().toISOString() });
        };
        const outcome = await clickSubmitOnce(page, recordAttempt, 30_000, board);
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

/**
 * One log line per agent step, e.g. `[a86f510d] 14 [My Information] FILL text "Phone Number*" -> typed (facts)`.
 * Typed values are left out: logs are not the place for a candidate's details.
 */
export function stepLog(id: string, e: TraceEntry): string {
  const result = e.result.replace(/(typed|chose) "[^"]*"/, "$1");
  const conf = e.confidence == null ? "" : ` p=${e.confidence.toFixed(2)}`;
  return `[${id.slice(0, 8)}] ${e.n} [${e.step.slice(0, 40)}] ${e.operation}${e.target ? ` ${e.target.slice(0, 80)}` : ""} -> ${result.slice(0, 140)} (${e.ms} ms${conf})`;
}

/** Tell Temporal the activity is alive while it waits (a no-op outside a Temporal worker, e.g. in tests). */
function heartbeat() {
  try {
    Context.current().heartbeat();
  } catch {}
}

/** "Priya Test" -> "Priya_Test_Resume.pdf": the name Workday shows next to the upload. */
export function resumeFileName(name: string): string {
  const base = name.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return `${base || "Resume"}_Resume.pdf`;
}

export type ApplyActivities = ReturnType<typeof createApplyActivities>;
