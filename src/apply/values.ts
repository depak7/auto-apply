/**
 * What to type into a field. Code decides the sensitive ones; the text model answers the rest
 * from the candidate facts only, and says "unknown" rather than guess.
 */

import { generateText, type LanguageModel, Output } from "ai";
import { z } from "zod";

import { textModel } from "../ai/models.ts";
import type { Credentials } from "./agent.ts";
import type { Facts } from "./facts.ts";
import type { FormField } from "./page.ts";

export type Value = { value: string; source: "credentials" | "facts" | "written" } | { missing: string };

const SYSTEM = `You fill one field of a job application form for a candidate.
- If the candidate facts contain the answer, return it exactly as given.
- For an open-ended question about the candidate's experience or interest, write at most 3 short sentences using only the facts.
- Personal details (salary, notice period, dates, ID numbers, work authorization, sponsorship, relatives, past employment
  at this company) must come from the facts. If they are not there, return null. Never guess.`;

const Answer = z.object({
  value: z.string().nullable().describe("What to type, or null if the facts do not contain it"),
  source: z.enum(["facts", "written"]).describe('"facts" if copied from the facts, "written" if composed'),
});

export async function valueFor(
  field: FormField,
  facts: Facts,
  creds: Credentials,
  model: LanguageModel = textModel(),
): Promise<Value> {
  // Secrets and the login email never go to a model.
  if (field.kind === "password") return { value: creds.password, source: "credentials" };
  if (field.kind === "email" || /e-?mail/i.test(field.label)) return { value: creds.email, source: "credentials" };

  const question =
    field.question && field.question !== field.label ? `${field.question} (${field.label})` : field.label;
  // A select: the answer must be one of its options (placeholders like "Select..." are not answers).
  const options =
    field.kind === "select" ? (field.options ?? []).filter((o) => !/^select\b|^choose\b|^--/i.test(o)) : [];
  const choices = options.length
    ? `\nChoose exactly one of these options, copied exactly, or null if the facts don't say:\n${options.map((o) => `- ${o}`).join("\n")}`
    : "";
  const { output } = await generateText({
    model,
    temperature: 0,
    system: SYSTEM,
    output: Output.object({ schema: Answer }),
    prompt: `Field: ${question}${field.required ? " (required)" : ""}${choices}\n\nCandidate facts:\n${JSON.stringify(facts, null, 2)}`,
  });
  const value = output.value?.trim();
  if (!value) return { missing: question };
  if (options.length) {
    const option = options.find((o) => o.toLowerCase() === value.toLowerCase());
    return option ? { value: option, source: "facts" } : { missing: question };
  }
  return { value, source: output.source };
}
