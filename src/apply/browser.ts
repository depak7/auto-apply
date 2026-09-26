/**
 * Where the browser comes from. Locally: a Chromium that Playwright starts. In the cloud:
 * set BROWSER_CDP_URL to connect to a remote browser instead. Either way callers
 * get a fresh, empty context: no cookies left over from another application.
 */

import { type Browser, type BrowserContext, chromium } from "playwright";

import { LAUNCH_ARGS, SKIPPED_RESOURCES } from "../lib/chromium.ts";

export interface BrowserSession {
  context: BrowserContext;
  close(): Promise<void>;
}

export async function openBrowser({ headless = true } = {}): Promise<BrowserSession> {
  const cdpUrl = process.env.BROWSER_CDP_URL;
  const browser: Browser = cdpUrl
    ? await chromium.connectOverCDP(cdpUrl)
    : await chromium.launch({ headless, args: LAUNCH_ARGS });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  await context.route("**/*", (route) =>
    SKIPPED_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
  );
  return {
    context,
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}
