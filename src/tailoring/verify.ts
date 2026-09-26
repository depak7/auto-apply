/**
 * Checking rewrites before they are used: hard rules in code first, then two focused questions
 * to Jev per line (does it add anything? does it keep everything?).
 */

import { type Experimental_EvaluationModel, experimental_evaluate } from "ai";
import { TAILORING } from "../config.ts";
import { isSkillsPath } from "../resume/edits.ts";
import { resumeToText } from "../resume/text.ts";
import type { Edit, Requirement, Resume } from "../schemas/index.ts";
import { droppedFacts, inventedNumbers, inventedTerms } from "./rules.ts";

export async function verifyEdits(
  original: Resume,
  requirements: Requirement[],
  edits: Edit[],
  jev: Experimental_EvaluationModel,
): Promise<Edit[]> {
  // A skills reorder was already proven safe in code (same skills, new order).
  for (const e of edits) if (isSkillsPath(e.path) && e.status === "applied") e.truth = 1;

  // 1. Hard rules in code: no new numbers, no technologies the resume never mentions.
  const resumeText = resumeToText(original);
  const jobKeywords = requirements.flatMap((r) => r.keywords);
  for (const e of edits.filter((e) => e.status === "applied" && !isSkillsPath(e.path))) {
    const numbers = inventedNumbers(e.before, e.after);
    const terms = inventedTerms(e.before, e.after, resumeText, jobKeywords);
    const dropped = droppedFacts(e.before, e.after);
    if (numbers.length || terms.length || dropped.length) {
      e.status = "unsupported";
      e.truth = 0;
      e.note = [
        numbers.length && `new numbers: ${numbers.join(", ")}`,
        terms.length && `not in your resume: ${terms.join(", ")}`,
        dropped.length && `leaves out: ${dropped.join(", ")}`,
      ]
        .filter(Boolean)
        .join("; ");
    }
  }

  // 2. Jev, one focused question per line: does the rewrite claim anything the original line doesn't?
  // Small state on purpose (the two lines and the skills), since Jev is more accurate without noise.
  const toCheck = edits.filter((e) => e.status === "applied" && !isSkillsPath(e.path));
  if (toCheck.length === 0) return edits;
  const result = await experimental_evaluate({
    model: jev,
    state: {
      candidate_skills: original.skills,
      lines: Object.fromEntries(toCheck.map((e) => [e.id, { original: e.before, rewritten: e.after }])),
    },
    questions: Object.fromEntries(
      toCheck.flatMap((e) => [
        [
          `${e.id}_keeps`,
          {
            type: "boolean" as const,
            instructions: `Does lines.${e.id}.rewritten keep every achievement, purpose, and outcome that lines.${e.id}.original states?`,
            criteria: {
              true: "Everything the original accomplishes is still there, even if worded more briefly or in a different order.",
              false:
                "Something the original states is gone (e.g. 'enabling archived tickets to be searched in place' was cut), or ownership is weakened ('Owned' -> 'Implemented').",
            },
          },
        ],
        [
          e.id,
          {
            type: "boolean" as const,
            instructions: `Does lines.${e.id}.rewritten describe only the work that lines.${e.id}.original describes?`,
            criteria: {
              true:
                "Same work, reworded or reordered. Naming a technology from candidate_skills that fits this work, or " +
                "describing stated work in the job's words (e.g. 'event-driven' for a Kafka-based system), is the same work.",
              false:
                "It adds a task, responsibility, scope, or result the original doesn't state " +
                "(e.g. 'led a team' when the original says 'built', or 'reduced costs' when no saving is mentioned).",
            },
          },
        ],
      ]),
    ),
  });

  const p = (id: string) => {
    const a = result.answers[id];
    return a?.type === "boolean" ? a.probability : 0;
  };
  for (const e of toCheck) {
    const adds = p(e.id); // P(describes only the original's work)
    const keeps = p(`${e.id}_keeps`); // P(keeps everything the original states)
    e.truth = Math.min(adds, keeps);
    if (adds < TAILORING.truthMin) {
      e.status = "unsupported";
      e.note = "adds something the original line doesn't say";
    } else if (keeps < TAILORING.keepsMin) {
      e.status = "unsupported";
      e.note = "leaves out something the original line says";
    }
  }
  return edits;
}
