/**
 * Score a resume against a job's requirements: fit with Jev, plus keyword match in code.
 *
 * One Jev call asks one Score question per requirement (Jev answers each independently).
 * Everything numeric happens in code: Jev's docs say it is not a calculator.
 */

import { type Experimental_EvaluationModel, experimental_evaluate } from "ai";

import { decisionModel } from "../ai/models.ts";
import { SCORING } from "../config.ts";
import { resumeToText } from "../resume/text.ts";
import type { Requirement, RequirementScore, Resume, ScoreResult } from "../schemas/index.ts";
import { keywordCoverage } from "./keywords.ts";

// Ordered levels, index = score. Descriptive and literal, because Jev reads criteria literally.
export const LEVELS = [
  "Not shown: nothing in the resume demonstrates this requirement",
  "Related: the resume shows adjacent or partial experience, but not this requirement itself",
  "Clearly shown: the resume directly demonstrates this requirement",
];

export async function scoreResume(
  resume: Resume,
  requirements: Requirement[],
  model: Experimental_EvaluationModel = decisionModel(),
): Promise<ScoreResult> {
  const questions = Object.fromEntries(
    requirements.map((r) => [
      r.id,
      {
        type: "score" as const,
        instructions: `Does the resume show that the candidate meets this job requirement: "${r.text}"?`,
        criteria: LEVELS,
      },
    ]),
  );

  const result = await experimental_evaluate({ model, state: { resume: resumeToText(resume) }, questions });

  // TypeSafe puts its confidence per question id in provider metadata (other providers don't have it).
  const confidence = (result.providerMetadata?.typesafe?.confidence ?? {}) as Record<string, number>;

  const items: RequirementScore[] = requirements.map((r) => {
    const answer = result.answers[r.id];
    if (answer?.type !== "score") throw new Error(`Jev returned no score for ${r.id}`);
    return {
      requirementId: r.id,
      score: answer.score,
      confidence: confidence[r.id] ?? null,
      status: statusOf(answer.score),
    };
  });

  return {
    overall: overallScore(requirements, items),
    keywords: keywordCoverage(resume, requirements),
    requirements,
    items,
  };
}

export function statusOf(score: number): RequirementScore["status"] {
  if (score < SCORING.gapBelow) return "gap";
  if (score < SCORING.clearFrom) return "related";
  return "clear";
}

/** 0..100: each requirement's score as a fraction of the top level, weighted by must/nice. */
export function overallScore(requirements: Requirement[], items: RequirementScore[]): number {
  const top = LEVELS.length - 1;
  let earned = 0;
  let possible = 0;
  for (const r of requirements) {
    const item = items.find((i) => i.requirementId === r.id);
    const weight = r.kind === "must" ? SCORING.mustWeight : SCORING.niceWeight;
    earned += weight * ((item?.score ?? 0) / top);
    possible += weight;
  }
  return possible ? Math.round((100 * earned) / possible) : 0;
}
