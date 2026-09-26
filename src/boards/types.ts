/**
 * A job board (applicant tracking system) the app can apply through. Everything that differs
 * between boards lives behind this interface; the agent, Jev, tailoring and the Submit guard are shared.
 */

import type { FormField, PageSnapshot } from "../apply/page.ts";
import type { Job } from "../schemas/index.ts";

export type BoardId = "workday" | "lever";

export interface JobBoard {
  id: BoardId;
  name: string;
  /** True if `url` is a posting on this board. */
  owns(url: URL): boolean;
  /** Read the posting from the board's public API. */
  fetchJob(url: string): Promise<Job>;
  /** Where the agent starts: the job page (Workday) or the application form (Lever). */
  startUrl(job: Job): string;
  /** Whether applying needs the user's own account on the board (Workday: one per company). */
  needsLogin: boolean;
  /** Board-specific instructions for Jev, added to the shared goal. */
  goal: string;
  /** The form is complete: only the final Submit is left (Workday's Review page, Lever's filled form). */
  formComplete(page: PageSnapshot): boolean;
  /** The final Submit button(s) on the page: never offered to the agent, clicked only by submit.ts. */
  submitButtons(page: PageSnapshot): FormField[];
  /** The board's confirmation page after a successful submission. */
  submitted(url: string): boolean;
}

/** The URL is not a posting on any supported board. */
export class NotAJobURL extends Error {}

/** The board has no posting at this URL (removed, or a typo). */
export class JobNotFound extends Error {}
