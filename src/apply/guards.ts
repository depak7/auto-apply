/**
 * Rules the agent cannot break, whatever the model decides. Checked in code before every action.
 */

import type { Page } from "playwright";

import type { FormField, PageSnapshot } from "./page.ts";

/** Workday's confirmation page after a successful submission. */
export const SUBMITTED_URL = /\/jobTasks\/completed\/application/;

/** The progress bar says we are on the last step, where "Next" is really "Submit". */
export const isReview = (s: PageSnapshot) => /^review$/i.test(s.step?.name ?? "");

// Buttons that submit, or do something that can't be undone. Filling never needs them.
const FORBIDDEN = /\b(submit|withdraw|delete|remove account|sign out|log ?out)\b/i;

/** Why this click is not allowed, or null if it is fine. */
export function forbiddenClick(field: FormField, page: PageSnapshot): string | null {
  if (FORBIDDEN.test(field.label)) return `"${field.label}" could submit or undo something`;
  if (isReview(page) && field.automationId === "pageFooterNextButton") return "Next on Review submits the application";
  return null;
}

/** Elements the agent may act on at all: no bot traps, nothing disabled, nothing in header/footer menus. */
export const actionable = (f: FormField) => !f.honeypot && !f.disabled && !f.chrome;

/** Workday is a single-page app: wait for its network calls to finish, not just "load". */
export async function settle(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}
