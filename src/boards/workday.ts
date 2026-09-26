/** Workday: several pages behind a per-company account, ending on a Review page. */

import { fetchJob } from "../workday/posting.ts";
import type { JobBoard } from "./types.ts";

export const workday: JobBoard = {
  id: "workday",
  name: "Workday",
  owns: (url) => /\.wd\d+\.myworkdayjobs\.com$/i.test(url.hostname),
  fetchJob,
  startUrl: (job) => job.url,
  needsLogin: true,
  goal: `This is Workday: several pages behind a sign-in, ending on a Review page.
- On the job description page, click "Apply". If a dialog offers ways to start the application, choose "Apply Manually".
- The candidate may already have an account: if a "Sign In" link or button is offered, sign in first with the
  candidate's email and password. Create an account only if sign-in says the account does not exist.
- Tick any required consent or agreement checkbox.
- When every required field on the page is filled, click "Save and Continue" (or "Next").
- On the Review page, stop: choose AT_REVIEW.`,
  // Trust the progress bar, not the model.
  formComplete: (page) => /^review$/i.test(page.step?.name ?? ""),
  submitButtons: (page) =>
    page.fields.filter((f) => f.kind === "button" && !f.disabled && /^submit$/i.test(f.label.trim())),
  submitted: (url) => /\/jobTasks\/completed\/application/.test(url),
};
