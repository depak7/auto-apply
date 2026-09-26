/**
 * Runs the form-filling agent on a Workday application, stopping at Review (never submits).
 *
 *   npm run tool:fill -- "<workday job url>"
 *   npm run tool:fill -- "<workday job url>" --resume samples/resume.json --pdf samples/resume.pdf --headed
 *
 * Facts come from samples/profile.json (created empty on first run) and, if given, a parsed
 * resume. Without --resume the agent knows only the profile: it will block, not invent.
 * Every step is printed and screenshotted to data/runs/<time>/.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";

import { runAgent } from "../src/apply/agent.ts";
import { openBrowser } from "../src/apply/browser.ts";
import { buildFacts } from "../src/apply/facts.ts";
import { DATA_DIR, ROOT, workdayCredentials } from "../src/config.ts";
import { EMPTY_PROFILE, Profile, Resume } from "../src/schemas/index.ts";
import { parseWorkdayUrl } from "../src/workday/posting.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    resume: { type: "string" },
    pdf: { type: "string" },
    headed: { type: "boolean", default: false },
    "max-steps": { type: "string", default: "80" },
  },
});
const [url] = positionals;
if (!url) throw new Error('usage: npm run tool:fill -- "<workday job url>" [--resume r.json --pdf r.pdf] [--headed]');

const profilePath = join(ROOT, "samples", "profile.json");
if (!existsSync(profilePath)) {
  writeFileSync(profilePath, JSON.stringify(EMPTY_PROFILE, null, 2));
  console.log(`created ${profilePath}: fill it in (anything left null is asked, never guessed)`);
}
const profile = Profile.parse(JSON.parse(readFileSync(profilePath, "utf8")));
const resume = values.resume ? Resume.parse(JSON.parse(readFileSync(values.resume, "utf8"))) : null;
const creds = workdayCredentials();
const facts = buildFacts(resume, profile, creds.email);

const job = parseWorkdayUrl(url);
const runDir = join(DATA_DIR, "runs", new Date().toISOString().replace(/[:.]/g, "-"));
mkdirSync(runDir, { recursive: true });

const session = await openBrowser({ headless: !values.headed });
const page = await session.context.newPage();
try {
  await page.goto(job.jobUrl);
  console.log(`${job.jobUrl}\nfacts: ${resume ? `resume of ${resume.name} + ` : "no resume, "}profile\n`);

  const result = await runAgent({
    page,
    facts,
    creds,
    resumePdf: values.pdf ? { name: basename(values.pdf), buffer: readFileSync(values.pdf) } : null,
    maxSteps: Number(values["max-steps"]),
    onStep: async (e, p) => {
      const conf = e.confidence == null ? "" : ` conf ${e.confidence.toFixed(2)}`;
      console.log(
        `${String(e.n).padStart(3)} [${e.step.slice(0, 32)}] ${e.operation} ${e.target ?? ""} → ${e.result}  (${e.ms} ms${conf})`,
      );
      await p.screenshot({ path: join(runDir, `${String(e.n).padStart(3, "0")}.png`) }).catch(() => {});
    },
  });

  console.log(`\nRESULT: ${result.status}`);
  if (result.status === "blocked") {
    console.log(`reason: ${result.reason}`);
    for (const q of result.questions) console.log(`  ? ${q}`);
  }
  if (result.status === "failed") console.log(`reason: ${result.reason}`);
  writeFileSync(join(runDir, "trace.json"), JSON.stringify(result, null, 2));
  console.log(`trace + screenshots: ${runDir}`);
} finally {
  await session.close();
}
