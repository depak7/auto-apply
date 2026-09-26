/**
 * The one place that presses Submit. The agent can't (guards.ts forbids it); this is called
 * only after the user said "submit" for this application.
 *
 * Every check happens BEFORE the click, so failing a check never leaves a half-submitted form.
 * After the click: success is the board's confirmation page (Workday's completed-application URL,
 * Lever's /thanks), nothing else.
 */

import type { Page } from "playwright";

import type { JobBoard } from "../boards/types.ts";
import { workday } from "../boards/workday.ts";
import { readPage } from "./page.ts";

export class NotReadyToSubmit extends Error {}

export type SubmitResult = "confirmed" | "unconfirmed";

/**
 * Click the board's Submit once. `beforeClick` runs right before the click (the caller records the
 * attempt there, so a crash after the click can never lead to a second one).
 */
export async function clickSubmitOnce(
  page: Page,
  beforeClick: () => void | Promise<void>,
  confirmTimeoutMs = 30_000,
  board: JobBoard = workday,
): Promise<SubmitResult> {
  const snap = await readPage(page);
  if (!board.formComplete(snap)) {
    throw new NotReadyToSubmit(`The form isn't complete (on "${snap.step?.name ?? snap.heading}")`);
  }

  const buttons = board.submitButtons(snap);
  if (buttons.length !== 1) throw new NotReadyToSubmit(`Expected exactly one Submit button, found ${buttons.length}`);

  await beforeClick(); // recorded before the click, so a crash after it can never cause a second one
  await page.locator(`[data-aa-idx="${buttons[0]!.idx}"]`).click({ timeout: 10_000 });

  const confirmed = await page
    .waitForURL((url) => board.submitted(url.href), { timeout: confirmTimeoutMs })
    .then(
      () => true,
      () => false,
    );
  return confirmed ? "confirmed" : "unconfirmed";
}
