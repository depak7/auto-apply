/**
 * Job description -> a short list of atomic requirements, each "must" or "nice".
 * A text model does this (Jev cannot write text). Jev then scores each one separately:
 * its docs recommend one narrow question each, combined in code.
 */

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

import { textModel } from "../ai/models.ts";
import type { Job, Requirement } from "../schemas/index.ts";

const SYSTEM = `You turn a job description into the list of requirements a candidate is judged on.
Rules:
- One requirement per item: a single skill, technology, qualification, or kind of experience.
  Split "Python and Go" into two items. Keep the job's own wording.
- "must": required, "what we need to see", "you have", minimum qualifications.
  "nice": preferred, "ways to stand out", "bonus", "plus".
- Leave out company description, benefits, salary, location, and equal-opportunity text.
- Return 8 to 15 items, most important first.
- keywords: 0 to 3 terms per item that a resume keyword filter would search for, spelled as in the job text.
  Only the core term: a technology, tool, method, or domain (1 to 4 words).
  Good: "Python", "RHEL", "Docker", "distributed filesystems", "large scale storage".
  Bad: "Python programming" (use "Python"), "8+ years", "Bachelor's degree", "variety of workloads".
  Degrees, years of experience, and generic phrases get no keywords.`;

const ModelOutput = z.object({
  requirements: z.array(
    z.object({
      text: z.string().describe('Short requirement, e.g. "8+ years operating large-scale storage"'),
      kind: z.enum(["must", "nice"]),
      keywords: z.array(z.string()).describe('0-3 core terms, e.g. "Python", "RHEL"'),
    }),
  ),
});

export async function extractRequirements(job: Job, model: LanguageModel = textModel()): Promise<Requirement[]> {
  const { output } = await generateText({
    model,
    temperature: 0,
    system: SYSTEM,
    output: Output.object({ schema: ModelOutput }),
    prompt: `Job title: ${job.title}\n\n${job.description}`,
  });
  // Ids are ours, not the model's: stable, unique, and safe to use as Jev question ids.
  return output.requirements.map((r, i) => ({
    id: `r${i + 1}`,
    text: r.text.trim(),
    kind: r.kind,
    keywords: r.keywords.map((k) => k.trim()).filter(Boolean),
  }));
}
