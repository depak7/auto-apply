/**
 * Tailor a resume to one job without inventing anything.
 *
 * Each round (up to `TAILORING.maxRounds`):
 *   1. pick targets: "related" requirements, and "clear" ones missing the job's keywords (never gaps)
 *   2. propose rewrites of existing lines, and repair any that break a code rule
 *   3. verify: code rules, then Jev (adds nothing? keeps everything?), with one more repair for lost content
 *   4. re-score fit and keywords against the same requirements
 *   5. keep truthful rewrites unless a score went down; run another round only if one went up
 */

import type { Experimental_EvaluationModel, LanguageModel } from "ai";

import { decisionModel, rewriteModel } from "../ai/models.ts";
import { TAILORING } from "../config.ts";
import { scoreResume } from "../matching/scoring.ts";
import { isSkillsPath, setText } from "../resume/edits.ts";
import type { Edit, Resume, ScoreResult, TailorResult } from "../schemas/index.ts";
import { proposeEdits, repairEdits } from "./propose.ts";
import { isBetter, notWorse, pickTargets } from "./targets.ts";
import { verifyEdits } from "./verify.ts";

export interface Models {
  text?: LanguageModel;
  jev?: Experimental_EvaluationModel;
}

export async function tailorResume(original: Resume, before: ScoreResult, models: Models = {}): Promise<TailorResult> {
  const text = models.text ?? rewriteModel();
  const jev = models.jev ?? decisionModel();
  const requirements = before.requirements; // same list every round, so scores are comparable

  let current = original;
  let currentScore = before;
  const edits: Edit[] = [];

  for (let round = 1; round <= TAILORING.maxRounds; round++) {
    const targets = pickTargets(current, currentScore);
    if (targets.length === 0) break;

    // Each line is rewritten at most once: later rounds don't rewrite rewrites.
    const done = new Set(edits.filter((e) => e.status === "applied").map((e) => e.path));
    const proposed = (await proposeEdits(current, targets, round, edits.length, text)).map((e) =>
      done.has(e.path) && e.status === "applied" ? { ...e, status: "invalid" as const, note: "already rewritten" } : e,
    );
    const repaired = await repairEdits(original, requirements, proposed, text);
    let checked = await verifyEdits(original, requirements, repaired, jev);

    // Jev found something left out: one more try, keeping every clause, then check again.
    const lossy = checked.filter((e) => e.note === "leaves out something the original line says");
    if (lossy.length) {
      for (const e of lossy) e.status = "applied";
      await repairEdits(
        original,
        requirements,
        lossy,
        text,
        "leaves out part of the original: keep every clause, only reorder and reword",
      );
      const rechecked = await verifyEdits(original, requirements, lossy, jev);
      checked = checked.map((e) => rechecked.find((r) => r.id === e.id) ?? e);
    }
    edits.push(...checked);

    const good = checked.filter((e) => e.status === "applied");
    if (good.length === 0) break;

    // A skills reorder is kept on its own merits: scoring ignores order, but a recruiter reading
    // the resume does not. Text edits must earn their place by raising the score.
    const reorders = good.filter((e) => isSkillsPath(e.path));
    const rewrites = good.filter((e) => !isSkillsPath(e.path));
    current = reorders.reduce((r, e) => setText(r, e.path, e.after), current);
    if (rewrites.length === 0) break;

    const candidate = rewrites.reduce((r, e) => setText(r, e.path, e.after), current);
    const candidateScore = await scoreResume(candidate, requirements, jev);
    if (!notWorse(candidateScore, currentScore)) {
      for (const e of rewrites) e.status = "no_gain"; // a truthful rewrite that makes the match weaker: drop it
      break;
    }
    const improved = isBetter(candidateScore, currentScore);
    current = candidate;
    currentScore = candidateScore;
    if (!improved) break; // clearer wording, same scores: keep it, but don't rewrite the rewrites
  }

  return { original, tailored: current, before, after: currentScore, edits };
}
