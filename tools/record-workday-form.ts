/**
 * Records the form fields on every page of a Workday application, to study a tenant's forms.
 *
 * You drive the browser by hand; the script records. Whenever the page changes (a new
 * step, or a different set of fields), it saves every form control (label, kind, required,
 * Workday automation id, options) to dumps/<tenant>/NN-<page>.json and prints a table.
 * Close the browser window (or press Ctrl+C) when you reach the Review page.
 *
 * Sign in with email + password. Google/LinkedIn sign-in is refused in automated browsers.
 *
 *   npm run tool:record-form -- "<workday job url>"
 *   npm run tool:record-form -- "<workday job url>" --auto --headless
 *
 * --auto skips the prompts: it dumps the job page, clicks Apply -> Apply Manually ->
 * Sign in with email, dumps each page, and exits.
 *
 * The browser profile is kept in .browser-profile/ so a Workday login survives between runs.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { type BrowserContext, chromium, type Page } from "playwright";

import { isInput, type PageSnapshot, readPage } from "../src/apply/page.ts";
import { ROOT } from "../src/config.ts";
import { NotWorkdayURL, parseWorkdayUrl, type WorkdayJobURL } from "../src/workday/posting.ts";

// The part of the flow that needs no account. Automation ids seen on real Workday pages.
const AUTO_STEPS: [what: string, automationId: string | null][] = [
  ["job page", null],
  ["click Apply", "adventureButton"],
  ["choose Apply Manually", "applyManually"],
  ["choose Sign in with email", "SignInWithEmailButton"],
];

function save(snapshot: PageSnapshot, outDir: string, n: number): string {
  const slug =
    (snapshot.heading || snapshot.title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "page";
  const path = join(outDir, `${String(n).padStart(2, "0")}-${slug}.json`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2));
  return path;
}

function printTable(snapshot: PageSnapshot): void {
  const inputs = snapshot.fields.filter(isInput);
  const buttons = snapshot.fields.filter((f) => !isInput(f));
  const step = snapshot.step ? `step ${snapshot.step.index}/${snapshot.step.total}: ` : "";
  console.log(`\n== ${step}${snapshot.heading || snapshot.title}\n   ${snapshot.url}`);
  console.log(`   ${inputs.length} inputs, ${buttons.length} buttons\n`);
  for (const f of inputs) {
    const label = f.question && f.question !== f.label ? `${f.question} > ${f.label}` : f.label;
    const opts = f.options
      ? `  options=${JSON.stringify(f.options.slice(0, 5))}${f.options.length > 5 ? "..." : ""}`
      : "";
    console.log(
      `   ${f.required ? "*" : " "} [${String(f.idx).padStart(3)}] ${f.kind.padEnd(9)} ${(f.automationId ?? "-").padEnd(45)} ${label.slice(0, 60)}${opts}`,
    );
  }
  const names = buttons.filter((b) => b.label).map((b) => `${b.label} (${b.automationId ?? "-"})`);
  console.log(`\n   buttons: ${names.slice(0, 15).join(", ")}`);
}

/** Click the element with this data-automation-id. Returns false if it never appeared. */
async function clickAutomationId(page: Page, automationId: string, timeoutMs = 8000): Promise<boolean> {
  const el = page.locator(`[data-automation-id="${automationId}"]`).first();
  try {
    await el.waitFor({ state: "visible", timeout: timeoutMs });
    await el.click();
    return true;
  } catch {
    return false;
  }
}

/** Workday is a single-page app: wait for the network to go quiet, not just 'load'. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

/** What makes a page "different": where we are and which fields exist, not what's typed in them. */
const pageKey = (s: PageSnapshot) =>
  JSON.stringify([
    s.url.split("?")[0],
    s.step?.name,
    s.fields.filter(isInput).map((f) => [f.automationId, f.label, f.kind]),
  ]);

/** Poll the active tab once a second; save a page once it has changed and then held still for a second. */
async function recordChanges(browser: BrowserContext, dump: (s: PageSnapshot) => Promise<void>): Promise<void> {
  let closed = false;
  const stop = () => {
    closed = true;
  };
  browser.on("close", stop);
  process.once("SIGINT", stop);

  let saved = "";
  let pending = "";
  while (!closed) {
    await new Promise((r) => setTimeout(r, 1000));
    const page = browser.pages().at(-1); // the newest tab, in case Workday opened one
    if (!page) break;
    const snapshot = await readPage(page).catch(() => null); // mid-navigation: try again next tick
    if (!snapshot) continue;
    const key = pageKey(snapshot);
    if (key !== saved && key === pending) {
      await dump(snapshot);
      saved = key;
    }
    pending = key;
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { auto: { type: "boolean", default: false }, headless: { type: "boolean", default: false } },
  });
  const [url] = positionals;
  if (!url) throw new Error('usage: npm run tool:record-form -- "<workday job url>" [--auto] [--headless]');

  let job: WorkdayJobURL;
  try {
    job = parseWorkdayUrl(url);
  } catch (e) {
    if (e instanceof NotWorkdayURL) {
      console.error(e.message);
      process.exit(1);
    }
    throw e;
  }
  console.log(`tenant=${job.tenant} site=${job.site}\njob=${job.jobPath}`);

  const outDir = join(ROOT, "dumps", job.tenant);
  mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launchPersistentContext(join(ROOT, ".browser-profile"), {
    headless: values.headless,
    viewport: { width: 1280, height: 900 },
  });
  const page = browser.pages()[0] ?? (await browser.newPage());
  await page.goto(job.jobUrl);
  await settle(page);
  let n = 0;

  const dump = async (snapshot?: PageSnapshot) => {
    snapshot ??= await readPage(page);
    printTable(snapshot);
    console.log(`   saved ${save(snapshot, outDir, ++n)}`);
  };

  if (values.auto) {
    for (const [what, automationId] of AUTO_STEPS) {
      if (automationId) {
        const clicked = await clickAutomationId(page, automationId);
        console.log(`\n-> ${what}: ${clicked ? "clicked" : "NOT FOUND"} [${automationId}]`);
        await settle(page);
      }
      await dump();
    }
  } else {
    console.log("\nClick through the application in the browser window. Pages are saved as they change.");
    console.log(
      "Use 'Sign in with email' (Google sign-in is blocked in automated browsers). Close the window when done.",
    );
    await recordChanges(browser, dump);
  }

  await browser.close().catch(() => {}); // may already be closed by the user
}

await main();
