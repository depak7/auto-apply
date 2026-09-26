/**
 * The whole life of one application, as a Temporal workflow.
 *
 *   fetch job -> score -> tailor -> wait for approve/reject -> render PDF
 *   -> fill (browser worker) -> [NEEDS_INPUT: wait for answers -> fill again] -> READY_TO_SUBMIT
 *   -> wait for "submit" -> click Submit once -> SUBMITTED (or SUBMIT_UNCONFIRMED)
 *
 * Temporal runs this in a sandbox and replays it after crashes, so it must be deterministic:
 * no network, files, clock or randomness here. All real work happens in activities; this
 * file only decides the order. Import only types and side-effect-free modules.
 */

import { condition, defineSignal, proxyActivities, setHandler } from "@temporalio/workflow";

import type { Activities, ApplyActivities } from "./activities.ts";
import { APPLY_QUEUE } from "./queues.ts";

export const approveSignal = defineSignal("approve");
export const rejectSignal = defineSignal("reject");
/** The user answered the NEEDS_INPUT questions (the answers are already saved in the profile). */
export const answersSignal = defineSignal("answers");
/** The user looked at the filled Review page and said: submit it. */
export const submitSignal = defineSignal("submit");

/** How long an application waits for the user (approval, or answers) before it expires. */
export const APPROVAL_WINDOW = "7 days";
const MAX_APPLY_ROUNDS = 5; // answer -> apply cycles before giving up

const work = proxyActivities<Activities>({
  startToCloseTimeout: "5 minutes", // model calls take seconds; this is a generous ceiling
  retry: { maximumAttempts: 3 },
});

// Scheduled on the apply queue. It sits there, QUEUED, until a browser worker picks it up.
// Filling never submits, so one retry (e.g. the browser crashed) is safe.
const browser = proxyActivities<ApplyActivities>({
  taskQueue: APPLY_QUEUE,
  startToCloseTimeout: "20 minutes",
  retry: { maximumAttempts: 2 },
});

// Submitting is never retried by Temporal: one click, ever (the activity also records the attempt first).
const submitter = proxyActivities<ApplyActivities>({
  taskQueue: APPLY_QUEUE,
  startToCloseTimeout: "20 minutes",
  retry: { maximumAttempts: 1 },
});

export async function applicationWorkflow(applicationId: string): Promise<string> {
  let decision: "approve" | "reject" | undefined;
  let answered = false;
  let submitRequested = false;
  // The first decision wins.
  setHandler(approveSignal, () => {
    decision ??= "approve";
  });
  setHandler(rejectSignal, () => {
    decision ??= "reject";
  });
  setHandler(answersSignal, () => {
    answered = true;
  });
  setHandler(submitSignal, () => {
    submitRequested = true;
  });

  /** NEEDS_INPUT: wait for the user's answers. False if they never came. */
  const waitForAnswers = async () => {
    answered = false;
    if (await condition(() => answered, APPROVAL_WINDOW)) return true;
    await work.setStatus(applicationId, "EXPIRED");
    return false;
  };

  try {
    await work.fetchJobForApplication(applicationId);
    await work.scoreApplication(applicationId);
    await work.tailorApplication(applicationId);

    await work.setStatus(applicationId, "AWAITING_APPROVAL");
    const decided = await condition(() => decision !== undefined, APPROVAL_WINDOW);
    if (!decided) {
      await work.setStatus(applicationId, "EXPIRED");
      return "EXPIRED";
    }
    if (decision === "reject") {
      await work.setStatus(applicationId, "REJECTED");
      return "REJECTED";
    }

    await work.renderApplicationPdf(applicationId);

    for (let round = 1; round <= MAX_APPLY_ROUNDS; round++) {
      await work.setStatus(applicationId, "QUEUED");
      const filled = await browser.applyToJob(applicationId); // APPLYING -> READY_TO_SUBMIT / NEEDS_INPUT
      if (filled === "already_applied") return "ALREADY_APPLIED";
      if (filled === "needs_input") {
        if (!(await waitForAnswers())) return "EXPIRED";
        continue; // fill again: Workday kept the draft
      }

      // READY_TO_SUBMIT: nothing is sent until the user says so.
      submitRequested = false;
      if (!(await condition(() => submitRequested, APPROVAL_WINDOW))) {
        await work.setStatus(applicationId, "EXPIRED");
        return "EXPIRED";
      }
      const sent = await submitter.submitApplication(applicationId); // SUBMITTING -> SUBMITTED / SUBMIT_UNCONFIRMED
      if (sent === "submitted") return "SUBMITTED";
      if (sent === "unconfirmed") return "SUBMIT_UNCONFIRMED";
      if (sent === "already_applied") return "ALREADY_APPLIED";
      if (!(await waitForAnswers())) return "EXPIRED"; // the form asked something new: answer, fill, confirm again
    }
    throw new Error(`Still missing answers after ${MAX_APPLY_ROUNDS} rounds`);
  } catch (err) {
    await work.markFailed(applicationId, errorMessage(err));
    throw err;
  }
}

// Temporal wraps activity errors (ActivityFailure -> cause: ApplicationFailure); show the root message.
function errorMessage(err: unknown): string {
  let e = err as { message?: string; cause?: unknown } | undefined;
  while (e?.cause) e = e.cause as typeof e;
  return e?.message ?? String(err);
}
