/**
 * Resume -> PDF, rendered by Chromium (Playwright) from the same template the review screen shows,
 * at the uploaded resume's paper size. Fonts are embedded, so the PDF looks the same everywhere.
 */

import { readFileSync } from "node:fs";
import { chromium } from "playwright";

import { LAUNCH_ARGS } from "../lib/chromium.ts";
import type { Resume } from "../schemas/index.ts";
import { type Fonts, pageOf, resumeHtml } from "./template.ts";

const font = (file: string) =>
  `data:font/woff2;base64,${readFileSync(new URL(`./fonts/${file}`, import.meta.url)).toString("base64")}`;

let fonts: Fonts | undefined;
/** Computer Modern Serif (SIL OFL, see fonts/OFL.txt), read once. */
function embeddedFonts(): Fonts {
  fonts ??= {
    regular: font("cmu-serif-500-roman.woff2"),
    italic: font("cmu-serif-500-italic.woff2"),
    bold: font("cmu-serif-700-roman.woff2"),
    boldItalic: font("cmu-serif-700-italic.woff2"),
  };
  return fonts;
}

export async function renderResumePdf(resume: Resume): Promise<Buffer> {
  const page = pageOf(resume);
  const browser = await chromium.launch({ args: LAUNCH_ARGS });
  try {
    const tab = await browser.newPage();
    await tab.setContent(resumeHtml(resume, undefined, embeddedFonts()), { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    return await tab.pdf({
      format: page.format,
      margin: { top: page.margin, bottom: page.margin, left: page.margin, right: page.margin },
      printBackground: true,
    });
  } finally {
    await browser.close();
  }
}
