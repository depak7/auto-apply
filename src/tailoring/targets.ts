/** Which requirements tailoring works on, and how to compare scores between rounds. */

import { containsKeyword } from "../matching/keywords.ts";
import { resumeToText } from "../resume/text.ts";
import type { Requirement, Resume, ScoreResult } from "../schemas/index.ts";

export interface Target {
  requirement: Requirement;
  missingKeywords: string[]; // job terms for this requirement not yet in the resume
}

/** Requirements worth rewording for: "related" ones, and "clear" ones missing the job's terms. Never gaps. */
export function pickTargets(resume: Resume, score: ScoreResult): Target[] {
  const text = resumeToText(resume);
  return score.requirements.flatMap((requirement) => {
    const status = score.items.find((i) => i.requirementId === requirement.id)?.status;
    const missingKeywords = requirement.keywords.filter((k) => !containsKeyword(text, k));
    const worthIt = status === "related" || (status === "clear" && missingKeywords.length > 0);
    return worthIt ? [{ requirement, missingKeywords }] : [];
  });
}

/** Neither fit nor keywords went down. */
export const notWorse = (next: ScoreResult, prev: ScoreResult) =>
  next.overall >= prev.overall && next.keywords.percent >= prev.keywords.percent;

/** One of fit / keywords went up, and neither went down. */
export const isBetter = (next: ScoreResult, prev: ScoreResult) =>
  next.overall >= prev.overall &&
  next.keywords.percent >= prev.keywords.percent &&
  (next.overall > prev.overall || next.keywords.percent > prev.keywords.percent);
