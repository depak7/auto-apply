/**
 * Tailors a resume to a job and prints the changes and the score change.
 *
 *   npm run tool:tailor -- samples/score-<reqId>.json
 *
 * Uses the job, resume and requirements saved by tool:score, so "before" and "after" are scored
 * against the same requirement list. Saves samples/tailored-<reqId>.json.
 */

import { readFileSync, writeFileSync } from "node:fs";

import { TAILORING } from "../src/config.ts";
import { diffResumes } from "../src/resume/edits.ts";
import { Job, Resume, ScoreResult } from "../src/schemas/index.ts";
import { tailorResume } from "../src/tailoring/tailor.ts";

const scorePath = process.argv[2];
if (!scorePath) {
  console.error("usage: npm run tool:tailor -- samples/score-<reqId>.json   (from tool:score)");
  process.exit(1);
}

try {
  const saved = JSON.parse(readFileSync(scorePath, "utf8"));
  const job = Job.parse(saved.job);
  const before = ScoreResult.parse(saved.score);
  const resume = Resume.parse(JSON.parse(readFileSync(saved.resumePath, "utf8")));
  console.log(`${job.title} · ${job.company}\nresume: ${resume.name}\n`);

  const started = Date.now();
  const result = await tailorResume(resume, before);
  console.log(`tailored in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

  const [kwBefore, kwAfter] = [result.before.keywords, result.after.keywords];
  console.log(
    `FIT ${result.before.overall} → ${result.after.overall}   KEYWORDS ${kwBefore.percent}% → ${kwAfter.percent}%`,
  );
  const gained = kwAfter.found.filter((k) => !kwBefore.found.includes(k));
  if (gained.length) console.log(`  now matches: ${gained.join(", ")}`);
  console.log("");
  for (const r of before.requirements) {
    const b = result.before.items.find((i) => i.requirementId === r.id)!;
    const a = result.after.items.find((i) => i.requirementId === r.id)!;
    const unsure = (b.confidence ?? 1) < TAILORING.unsureBelow ? "  (Jev unsure)" : "";
    const moved = Math.abs(a.score - b.score) >= 0.05 ? `→ ${a.score.toFixed(2)}` : "      ";
    console.log(`  ${b.score.toFixed(2)} ${moved}  ${r.id.padEnd(3)} ${r.text.slice(0, 80)}${unsure}`);
  }

  const diff = diffResumes(result.original, result.tailored);
  console.log(`\nCHANGES (${diff.length})  ← what you approve`);
  for (const d of diff) {
    const edit = result.edits.findLast((e) => e.path === d.path && e.status === "applied");
    console.log(`\n  [${d.path}]  helps ${edit?.requirementIds.join(", ")}  truth ${edit?.truth?.toFixed(2)}`);
    console.log(`  - ${d.before}\n  + ${d.after}`);
    if (edit) console.log(`    why: ${edit.reason}`);
  }

  const dropped = result.edits.filter((e) => e.status !== "applied");
  if (dropped.length) {
    console.log(`\nDROPPED (${dropped.length})`);
    for (const e of dropped) {
      const truth = e.truth == null ? "" : ` truth ${e.truth.toFixed(2)}`;
      console.log(`\n  ${e.status}${truth}  [${e.path}]\n  + ${e.after}`);
    }
  }

  const out = scorePath.replace(/score-/, "tailored-");
  writeFileSync(out, JSON.stringify({ job, ...result }, null, 2));
  console.log(`\nsaved ${out}`);
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
