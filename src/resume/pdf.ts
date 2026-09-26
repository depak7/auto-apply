/**
 * Resume JSON -> PDF. A plain single-column layout: easy for ATS parsers to read.
 * Rendered by Chromium (Playwright), which we already use for the browser work.
 */

import { chromium } from "playwright";
import { LAUNCH_ARGS } from "../lib/chromium.ts";
import type { Resume } from "../schemas/index.ts";
import { PAGE, resumeHtml } from "./template.ts";

export async function renderResumePdf(resume: Resume): Promise<Buffer> {
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const page = await browser.newPage();
    await page.setContent(resumeHtml(resume));
    return await page.pdf({
      format: "A4",
      margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
    });
  } finally {
    await browser.close();
  }
}
