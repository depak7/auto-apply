/**
 * Asking the rewrite model for edits, checking their shape in code, and sending rewrites that
 * break a rule back once with the exact problem.
 */

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

import { TAILORING } from "../config.ts";
import { words } from "../lib/words.ts";
import { editableLines, getText, isReorderOnly, isSkillsPath } from "../resume/edits.ts";
import { resumeToText } from "../resume/text.ts";
import type { Edit, Requirement, Resume } from "../schemas/index.ts";
import { REWRITE_SYSTEM } from "./prompts.ts";
import { droppedFacts, inventedNumbers, inventedTerms, mustKeep, plainText, trivialChange } from "./rules.ts";
import type { Target } from "./targets.ts";

const Proposal = z.object({
  edits: z.array(
    z.object({
      path: z.string().describe('Path of the line to change, exactly as given, e.g. "experience.0.bullets.1"'),
      after: z.string().describe("The full new text for that line"),
      requirementIds: z.array(z.string()).describe('Requirement ids this helps, e.g. ["r3"]'),
      reason: z
        .string()
        .describe("One short sentence in plain words for the candidate: what changed and why. No requirement ids."),
    }),
  ),
});

export async function proposeEdits(
  resume: Resume,
  targets: Target[],
  round: number,
  idOffset: number,
  model: LanguageModel,
): Promise<Edit[]> {
  // Each line comes with what its rewrite must keep, so the rewriter doesn't drop it.
  const lines = editableLines(resume)
    .map((l) => {
      const keep = isSkillsPath(l.path) ? [] : mustKeep(l.text);
      const mustKeepLine = keep.length ? `\n    must keep: ${keep.join(", ")}` : "";
      return `[${l.path}] ${l.text}${mustKeepLine}`;
    })
    .join("\n");
  const reqs = targets
    .map(({ requirement: r, missingKeywords: k }) => {
      const missing = k.length ? `\n    job terms not yet in the resume: ${k.join(", ")}` : "";
      return `${r.id} (${r.kind}): ${r.text}${missing}`;
    })
    .join("\n");
  const { output } = await generateText({
    model,
    temperature: 0,
    system: REWRITE_SYSTEM,
    output: Output.object({ schema: Proposal }),
    prompt:
      `Requirements to show more clearly:\n${reqs}\n\n` +
      `Technologies you may mention (the candidate's own; no others): ${resume.skills.join(", ")}\n\n` +
      `Full resume for context:\n${resumeToText(resume)}\n\nEditable lines:\n${lines}\n\n` +
      `Return at most ${TAILORING.maxEditsPerRound} edits.`,
  });

  const seen = new Set<string>();
  const insertedSoFar = new Set<string>();
  return output.edits.slice(0, TAILORING.maxEditsPerRound).map((p, i) => {
    const before = getText(resume, p.path);
    const after = plainText(p.after);
    const onlyInserts = before !== null && !isSkillsPath(p.path) ? insertionOnly(before, after) : null;
    const repetitive = !!onlyInserts && onlyInserts.every((w) => insertedSoFar.has(w));
    const trivial = before !== null && !isSkillsPath(p.path) && trivialChange(before, after);
    const valid =
      before !== null &&
      after !== "" &&
      after !== before &&
      !seen.has(p.path) &&
      !repetitive &&
      !trivial &&
      (!isSkillsPath(p.path) || isReorderOnly(before, after));
    seen.add(p.path);
    for (const w of onlyInserts ?? []) insertedSoFar.add(w);
    return {
      id: `e${idOffset + i + 1}`,
      round,
      path: p.path,
      before: before ?? "",
      after,
      requirementIds: p.requirementIds,
      reason: p.reason,
      truth: null,
      note: repetitive
        ? `only adds "${onlyInserts!.join(" ")}", already added elsewhere`
        : trivial
          ? "changes almost nothing"
          : null,
      status: valid ? "applied" : "invalid",
    };
  });
}

/**
 * If `after` is `before` with words inserted and nothing else changed, the inserted words
 * (lowercased); otherwise null. "Built a library" -> "Built a backend library" gives ["backend"].
 */
export function insertionOnly(before: string, after: string): string[] | null {
  const a = words(before);
  const b = words(after);
  const inserted: string[] = [];
  let i = 0;
  for (const w of b) {
    if (i < a.length && a[i] === w) i++;
    else inserted.push(w);
  }
  return i === a.length && inserted.length > 0 ? inserted : null;
}

const Repairs = z.object({
  fixes: z.array(z.object({ id: z.string(), after: z.string().describe("The corrected full line, plain text") })),
});

export async function repairEdits(
  original: Resume,
  requirements: Requirement[],
  edits: Edit[],
  model: LanguageModel,
  problemForAll?: string, // when the problem was found by Jev rather than by the code rules
): Promise<Edit[]> {
  const resumeText = resumeToText(original);
  const jobKeywords = requirements.flatMap((r) => r.keywords);
  const problems = edits
    .filter((e) => e.status === "applied" && !isSkillsPath(e.path))
    .map((e) => {
      const issues = [
        ...inventedNumbers(e.before, e.after).map((n) => `adds the number ${n}, which the original doesn't have`),
        ...inventedTerms(e.before, e.after, resumeText, jobKeywords).map(
          (t) => `mentions ${t}, which is not in the candidate's resume`,
        ),
        ...droppedFacts(e.before, e.after).map((t) => `leaves out ${t}`),
        ...(problemForAll ? [problemForAll] : []),
      ];
      return { e, issues };
    })
    .filter((x) => x.issues.length);
  if (problems.length === 0) return edits;

  const { output } = await generateText({
    model,
    temperature: 0,
    system: REWRITE_SYSTEM,
    output: Output.object({ schema: Repairs }),
    prompt:
      "Fix these rewrites. Keep the improvement, but fix every listed problem.\n\n" +
      problems
        .map(
          ({ e, issues }) => `id: ${e.id}\noriginal: ${e.before}\nrewrite: ${e.after}\nproblems: ${issues.join("; ")}`,
        )
        .join("\n\n"),
  });
  for (const fix of output.fixes) {
    const e = edits.find((x) => x.id === fix.id);
    if (e) e.after = plainText(fix.after);
  }
  return edits;
}
