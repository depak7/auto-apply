/**
 * Activities: the real work the workflow asks for. Each one does one job, saves its result
 * to the store, and moves the status on. Temporal retries an activity that throws, unless
 * the error is marked non-retryable (retrying won't fix a job that doesn't exist).
 *
 * Built by createActivities(deps) so tests can pass an in-memory store and mock models.
 */

import { ApplicationFailure } from "@temporalio/common";
import type { Experimental_EvaluationModel, LanguageModel } from "ai";
import { type FileStore, fileKeys } from "../files/store.ts";
import { extractRequirements } from "../matching/requirements.ts";
import { scoreResume } from "../matching/scoring.ts";
import { renderResumePdf } from "../resume/pdf.ts";
import type { Status, Store } from "../store/store.ts";
import { tailorResume } from "../tailoring/tailor.ts";
import { fetchJob, JobNotFound, NotWorkdayURL } from "../workday/posting.ts";

export interface Deps {
  store: Store;
  text?: LanguageModel; // default: textModel() from src/ai/models.ts
  jev?: Experimental_EvaluationModel; // default: decisionModel()
  files: FileStore;
  render?: typeof renderResumePdf;
  fetch?: typeof fetchJob;
}

export function createActivities({ store, files, text, jev, render = renderResumePdf, fetch = fetchJob }: Deps) {
  const load = async (id: string) => {
    const app = await store.getApplication(id);
    if (!app) throw ApplicationFailure.nonRetryable(`No application ${id}`);
    return app;
  };

  return {
    async setStatus(id: string, status: Status): Promise<void> {
      await store.updateApplication(id, { status });
    },

    async markFailed(id: string, message: string): Promise<void> {
      await store.updateApplication(id, { status: "FAILED", error: message });
    },

    async fetchJobForApplication(id: string): Promise<void> {
      const app = await load(id);
      await store.updateApplication(id, { status: "FETCHING" });
      try {
        const job = await fetch(app.url);
        if (!job.canApply)
          throw ApplicationFailure.nonRetryable("This job is closed: Workday says it cannot be applied to");
        await store.updateApplication(id, { job });
      } catch (e) {
        if (e instanceof NotWorkdayURL || e instanceof JobNotFound) throw ApplicationFailure.nonRetryable(e.message);
        throw e; // network hiccup etc.: let Temporal retry
      }
    },

    async scoreApplication(id: string): Promise<void> {
      const app = await load(id);
      const resume = await store.getResume(app.resumeId);
      if (!app.job || !resume) throw ApplicationFailure.nonRetryable("Job or resume missing");
      await store.updateApplication(id, { status: "SCORING" });
      const requirements = await extractRequirements(app.job, text);
      const score = await scoreResume(resume.resume, requirements, jev);
      await store.updateApplication(id, { score });
    },

    async tailorApplication(id: string): Promise<void> {
      const app = await load(id);
      const resume = await store.getResume(app.resumeId);
      if (!app.score || !resume) throw ApplicationFailure.nonRetryable("Score or resume missing");
      await store.updateApplication(id, { status: "TAILORING" });
      const tailor = await tailorResume(resume.resume, app.score, { text, jev });
      await store.updateApplication(id, { tailor });
    },

    async renderApplicationPdf(id: string): Promise<void> {
      const app = await load(id);
      if (!app.tailor) throw ApplicationFailure.nonRetryable("Nothing to render: tailoring has not run");
      await store.updateApplication(id, { status: "RENDERING" });
      const pdfKey = fileKeys.tailoredResume(id);
      await files.put(pdfKey, await render(app.tailor.tailored), "application/pdf");
      await store.updateApplication(id, { pdfKey });
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;

// The browser worker's activity (src/apply/activities.ts), served on APPLY_QUEUE.
export type { ApplyActivities, ApplyOutcome, SubmitOutcome } from "../apply/activities.ts";
