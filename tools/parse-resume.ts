/**
 * Parses a resume PDF into structured Resume JSON.
 *
 *   npm run tool:parse-resume                       # reads samples/resume.pdf
 *   npm run tool:parse-resume -- path/to/resume.pdf
 *
 * Prints a summary and saves the full result next to the PDF (resume.pdf -> resume.json),
 * so later steps can reuse it without calling the model again.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ROOT } from "../src/config.ts";
import { parseResume } from "../src/resume/parse.ts";
import type { Resume } from "../src/schemas/index.ts";

const pdfPath = process.argv[2] ?? join(ROOT, "samples", "resume.pdf");
const jsonPath = pdfPath.replace(/\.pdf$/i, ".json");

if (!existsSync(pdfPath)) {
  console.error(`error: no resume at ${pdfPath}. Put your PDF there or pass a path.`);
  process.exit(1);
}

console.log(`parsing ${pdfPath} with ${process.env.AI_MODEL || "default model"} ...`);
const started = Date.now();
let resume: Resume;
try {
  resume = await parseResume(readFileSync(pdfPath));
} catch (e) {
  console.error(`error: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
console.log(`done in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);

console.log(`${resume.name} · ${[resume.email, resume.phone, resume.location].filter(Boolean).join(" · ")}`);
if (resume.links.length) console.log(resume.links.join("  "));
if (resume.summary) console.log(`\n${resume.summary}`);

console.log("\nEXPERIENCE");
for (const e of resume.experience) {
  console.log(`  ${e.title} @ ${e.company}  (${e.start} – ${e.end ?? "Present"})`);
  for (const b of e.bullets) console.log(`    - ${b}`);
}
console.log("\nEDUCATION");
for (const ed of resume.education) {
  console.log(`  ${[ed.degree, ed.field].filter(Boolean).join(", ")} · ${ed.school} ${ed.end ?? ""}`);
}
if (resume.projects.length) console.log(`\nPROJECTS: ${resume.projects.map((p) => p.name).join(", ")}`);
console.log(`\nSKILLS: ${resume.skills.join(", ")}`);
if (resume.certifications.length) console.log(`CERTIFICATIONS: ${resume.certifications.join(", ")}`);

writeFileSync(jsonPath, JSON.stringify(resume, null, 2));
console.log(`\nsaved ${jsonPath}`);
