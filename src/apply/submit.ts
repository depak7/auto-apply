/**
 * The one place that presses Submit. The agent can't (guards.ts forbids it); this is called
 * only after the user said "submit" for this application.
 *
 * Every check happens BEFORE the click, so failing a check never leaves a half-submitted form.
 * After the click: success is Workday's confirmation URL, nothing else.
 */

import type { Page } from "playwright";

import { isReview, SUBMITTED_URL } from "./guards.ts";
import { readPage } from "./page.ts";

export class NotReadyToSubmit extends Error {}

export type SubmitResult = "confirmed" | "unconfirmed";

/**
 * Click Workday's Submit once. `beforeClick` runs right before the click (the caller records the
 * attempt there, so a crash after the click can never lead to a second one).
 */
export async function clickSubmitOnce(
  page: Page,
  beforeClick: () => void | Promise<void>,
  confirmTimeoutMs = 30_000,
): Promise<SubmitResult> {
  const snap = await readPage(page);
  if (!isReview(snap)) throw new NotReadyToSubmit(`Not on the Review step (on "${snap.step?.name ?? snap.heading}")`);

  const buttons = snap.fields.filter((f) => f.kind === "button" && /^submit$/i.test(f.label.trim()) && !f.disabled);
  if (buttons.length !== 1) throw new NotReadyToSubmit(`Expected exactly one Submit button, found ${buttons.length}`);

  await beforeClick(); // recorded before the click, so a crash after it can never cause a second one
  await page.locator(`[data-aa-idx="${buttons[0]!.idx}"]`).click({ timeout: 10_000 });

  const confirmed = await page.waitForURL(SUBMITTED_URL, { timeout: confirmTimeoutMs }).then(
    () => true,
    () => false,
  );
  return confirmed ? "confirmed" : "unconfirmed";
}
