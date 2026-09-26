/** Proposed resume edits and the outcome of tailoring a resume to a job. */

import { z } from "zod";

import { ScoreResult } from "./matching.ts";
import { Resume } from "./resume.ts";

export const Edit = z.object({
  id: z.string(), // "e1", "e2"... across all rounds
  round: z.number().int(),
  path: z.string(), // see src/resume/edits.ts
  before: z.string(), // filled in by our code from the resume, never by the model
  after: z.string(),
  requirementIds: z.array(z.string()),
  reason: z.string(),
  truth: z.number().nullable(), // Jev: probability `after` describes only the original line's work
  note: z.string().nullable().default(null), // why it was dropped, in plain words
  status: z.enum([
    "applied", // kept
    "invalid", // bad path, unchanged text, or a skills edit that adds/removes a skill
    "unsupported", // Jev: adds something the original resume does not say
    "no_gain", // truthful, but the round did not raise the score
  ]),
});
export type Edit = z.infer<typeof Edit>;

export const TailorResult = z.object({
  original: Resume,
  tailored: Resume,
  before: ScoreResult,
  after: ScoreResult,
  edits: z.array(Edit), // every proposed edit, with what happened to it
});
export type TailorResult = z.infer<typeof TailorResult>;
