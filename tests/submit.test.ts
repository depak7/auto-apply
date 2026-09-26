/**
 * The Submit click, on a fake Workday served from a fake https origin (so its URL can change
 * to Workday's confirmation path, the way the real one does).
 */

import { type Browser, chromium, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApplyActivities } from "../src/apply/activities.ts";
import { clickSubmitOnce, NotReadyToSubmit } from "../src/apply/submit.ts";
import { MemoryFileStore } from "../src/files/store.ts";
import { SAMPLE_RESUME } from "./mocks.ts";
import { testStore } from "./pglite.ts";

const ORIGIN = "https://fake.myworkdayjobs.test";

function fakeWorkday(opts: { step: string; submitButtons?: number; confirms?: boolean }) {
  const buttons = Array.from(
    { length: opts.submitButtons ?? 1 },
    () =>
      `<button data-automation-id="pageFooterNextButton" onclick="window.clicks = (window.clicks || 0) + 1; ${
        opts.confirms === false ? "" : "history.pushState({}, '', '/en-US/site/jobTasks/completed/application')"
      }">Submit</button>`,
  ).join("");
  return `<!doctype html><html><body>
    <ol><li data-automation-id="progressBarActiveStep">current step 4 of 4 ${opts.step}</li></ol>${buttons}</body></html>`;
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch();
});
afterAll(async () => void (await browser?.close()));

async function open(html: string): Promise<Page> {
  const page = await browser.newPage();
  await page.route(`${ORIGIN}/**`, (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto(`${ORIGIN}/en-US/site/job/x/apply`);
  return page;
}
const clicks = (page: Page) => page.evaluate(() => (globalThis as any).clicks ?? 0);

describe("clickSubmitOnce", () => {
  it("clicks Submit once on Review, records the attempt first, and sees the confirmation", async () => {
    const page = await open(fakeWorkday({ step: "Review" }));
    const order: string[] = [];
    page.on("framenavigated", () => order.push("navigated"));
    const record = () => {
      order.push("recorded");
    };
    const result = await clickSubmitOnce(page, record, 5_000);

    expect(result).toBe("confirmed");
    expect(await clicks(page)).toBe(1);
    expect(order[0]).toBe("recorded"); // the attempt was saved before anything happened
  });

  it("reports 'unconfirmed' when Workday never shows the confirmation", async () => {
    const page = await open(fakeWorkday({ step: "Review", confirms: false }));
    expect(await clickSubmitOnce(page, () => {}, 1_000)).toBe("unconfirmed");
    expect(await clicks(page)).toBe(1);
  });

  it.each([
    ["not on the Review step", { step: "Application Questions" }],
    ["two Submit buttons", { step: "Review", submitButtons: 2 }],
    ["no Submit button", { step: "Review", submitButtons: 0 }],
  ])("refuses, before clicking anything, when %s", async (_, opts) => {
    const page = await open(fakeWorkday(opts));
    let recorded = false;
    const record = () => {
      recorded = true;
    };
    await expect(clickSubmitOnce(page, record, 1_000)).rejects.toThrow(NotReadyToSubmit);
    expect(recorded).toBe(false);
    expect(await clicks(page)).toBe(0);
  });
});

it("submitApplication never clicks twice: an earlier attempt means no browser at all", async () => {
  const store = await testStore();
  const app = await store.createApplication(`${ORIGIN}/site/job/x`, (await store.addResume(SAMPLE_RESUME)).id);
  await store.updateApplication(app.id, { status: "READY_TO_SUBMIT", submitAttemptedAt: "2026-09-25T10:00:00Z" });

  const activities = createApplyActivities({
    store,
    files: new MemoryFileStore(),
    open: async () => {
      throw new Error("must not open a browser");
    },
  });

  expect(await activities.submitApplication(app.id)).toBe("unconfirmed");
  expect((await store.getApplication(app.id))?.status).toBe("SUBMIT_UNCONFIRMED");
});
