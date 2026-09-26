/**
 * Scores a parsed resume against a Workday job (fit with Jev, keyword match in code).
 *
 *   npm run tool:score -- "<workday job url>" samples/resume.json     (from tool:parse-resume)
 *
 * Saves samples/score-<reqId>.json (job + requirements + scores) for tool:tailor.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "../src/config.ts";
import { extractRequirements } from "../src/matching/requirements.ts";
import { scoreResume } from "../src/matching/scoring.ts";
import { Resume } from "../src/schemas/index.ts";
import { fetchJob } from "../src/workday/posting.ts";

const [url, resumePath] = process.argv.slice(2);
if (!url || !resumePath) {
  console.error('usage: npm run tool:score -- "<workday job url>" <resume.json>');
  process.exit(1);
}
if (!existsSync(resumePath)) {
  console.error(`error: no parsed resume at ${resumePath}. Run tool:parse-resume first.`);
  process.exit(1);
}

try {
  const resume = Resume.parse(JSON.parse(readFileSync(resumePath, "utf8")));
  const job = await fetchJob(url);
  console.log(`${job.title} · ${job.company}\nresume: ${resume.name}\n`);

  let t = Date.now();
  const requirements = await extractRequirements(job);
  console.log(`${requirements.length} requirements (${Date.now() - t} ms, ${process.env.AI_MODEL})`);

  t = Date.now();
  const score = await scoreResume(resume, requirements);
  console.log(`scored (${Date.now() - t} ms, ${process.env.JEV_MODEL})\n`);

  const mark = { clear: "✓", related: "~", gap: "✗" } as const;
  for (const r of requirements) {
    const item = score.items.find((i) => i.requirementId === r.id)!;
    const conf = item.confidence == null ? "" : `  conf ${item.confidence.toFixed(2)}`;
    console.log(`  ${mark[item.status]} ${item.score.toFixed(2)}/2  ${r.kind.padEnd(4)}  ${r.text}${conf}`);
  }
  const count = (s: string) => score.items.filter((i) => i.status === s).length;
  console.log(
    `\nFIT ${score.overall}/100   clear ${count("clear")} · related ${count("related")} · gaps ${count("gap")}`,
  );
  const kw = score.keywords;
  console.log(
    `KEYWORDS ${kw.percent}%   ${kw.found.length} of ${kw.found.length + kw.missing.length} job terms in the resume`,
  );
  console.log(`  missing: ${kw.missing.join(", ") || "none"}`);
  console.log("  ~ related = tailoring can make these clearer.  ✗ gap = never claimed.");

  const out = join(ROOT, "samples", `score-${job.reqId || job.tenant}.json`);
  writeFileSync(out, JSON.stringify({ job, resumePath, score }, null, 2));
  console.log(`\nsaved ${out}`);
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
