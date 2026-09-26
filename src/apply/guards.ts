/**
 * Rules the agent cannot break, whatever the model decides. Checked in code before every action.
 */

import type { Page } from "playwright";

import type { JobBoard } from "../boards/types.ts";
import type { FormField, PageSnapshot } from "./page.ts";

// Buttons that submit, or do something that can't be undone. Filling never needs them.
const FORBIDDEN = /\b(submit|withdraw|delete|remove account|sign out|log ?out)\b/i;

/** Why this click is not allowed, or null if it is fine. */
export function forbiddenClick(field: FormField, page: PageSnapshot, board: JobBoard): string | null {
  if (FORBIDDEN.test(field.label)) return `"${field.label}" could submit or undo something`;
  if (board.submitButtons(page).some((b) => b.idx === field.idx)) return `"${field.label}" submits the application`;
  return null;
}

/** Elements the agent may act on at all: no bot traps, nothing disabled, nothing in header/footer menus. */
export const actionable = (f: FormField) => !f.honeypot && !f.disabled && !f.chrome;

/** Required fields that are still empty or marked invalid (a file field counts as empty with no file). */
export const openRequiredFields = (page: PageSnapshot): FormField[] =>
  page.fields.filter(
    (f) =>
      !f.honeypot &&
      !f.chrome &&
      f.required &&
      (f.invalid ||
        f.value === "" ||
        f.value == null ||
        f.value === false ||
        (Array.isArray(f.value) && !f.value.length)),
  );

/** Single-page apps (Workday, Lever): wait for their network calls to finish, not just "load". */
export async function settle(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
}
