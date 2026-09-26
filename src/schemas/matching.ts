/** Requirements extracted from a job, and how well a resume meets them. */

import { z } from "zod";

export const Requirement = z.object({
  id: z.string(), // "r1", "r2"... assigned in code, used as the Jev question id
  text: z.string(),
  kind: z.enum(["must", "nice"]),
  keywords: z.array(z.string()).default([]), // the job's exact terms an ATS would search for
});
export type Requirement = z.infer<typeof Requirement>;

export const RequirementScore = z.object({
  requirementId: z.string(),
  score: z.number(), // 0..2 from Jev: 0 not shown, 1 related, 2 clearly shown
  confidence: z.number().nullable(), // Jev's confidence in that score, 0..1
  status: z.enum(["gap", "related", "clear"]),
});
export type RequirementScore = z.infer<typeof RequirementScore>;

export const KeywordCoverage = z.object({
  percent: z.number().int(), // 0..100: share of the job's keywords found word for word in the resume
  found: z.array(z.string()),
  missing: z.array(z.string()),
});
export type KeywordCoverage = z.infer<typeof KeywordCoverage>;

export const ScoreResult = z.object({
  overall: z.number().int(), // 0..100 fit, from Jev's scores, weighted in code
  keywords: KeywordCoverage, // exact-term match, computed in code (what ATS filters look for)
  requirements: z.array(Requirement),
  items: z.array(RequirementScore),
});
export type ScoreResult = z.infer<typeof ScoreResult>;
