/**
 * Show exactly what the agent sees on a page: every element, and whether Jev is offered it.
 *   npm run tool:inspect-page -- "<url>"
 */

import { chromium } from "playwright";
import { describe } from "../src/apply/decide.ts";
import { actionable } from "../src/apply/guards.ts";
import { readPage } from "../src/apply/page.ts";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
await p.goto(process.argv[2]!);
await p.waitForLoadState("networkidle").catch(() => {});
const s = await readPage(p);
for (const f of s.fields)
  console.log(
    actionable(f) ? "  SEEN  " : "  hidden",
    `e${f.idx}`,
    f.chrome ? "(chrome)" : "",
    describe(f),
    f.automationId ?? "",
  );
console.log("errors:", s.errors);
await b.close();
