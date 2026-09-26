/**
 * Resume PDF -> structured Resume, using a text model through the Vercel AI SDK.
 * The PDF is sent as-is: the model reads the layout (columns, tables) itself, so no
 * PDF-to-text library is needed.
 */

import { generateText, type LanguageModel, Output } from "ai";

import { textModel } from "../ai/models.ts";
import { Resume } from "../schemas/index.ts";

const SYSTEM = `You extract resumes into structured data.
Rules:
- Copy text exactly as written. Do not rephrase, summarise, fix grammar, or translate.
- Never add anything that is not in the document. If a field is missing, use null or an empty list.
- Keep the order used in the resume.`;

/** True if `data` starts with the PDF signature. */
export const isPdf = (data: Uint8Array) => Buffer.from(data.subarray(0, 5)).toString("latin1") === "%PDF-";

export async function parseResume(pdf: Buffer, model: LanguageModel = textModel()): Promise<Resume> {
  if (!isPdf(pdf)) throw new Error("Expected a PDF file");

  const { output } = await generateText({
    model,
    temperature: 0,
    system: SYSTEM,
    output: Output.object({ schema: Resume }), // the SDK validates the reply against the Zod schema
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: pdf, mediaType: "application/pdf" },
          { type: "text", text: "Extract this resume." },
        ],
      },
    ],
  });
  return output;
}
