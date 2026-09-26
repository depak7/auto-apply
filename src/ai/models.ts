/**
 * Which models we use. Both go through the Vercel AI Gateway, so one key (AI_GATEWAY_API_KEY)
 * covers everything and switching models is a .env change.
 *
 *   textModel()     writes/extracts text: resume parsing, rewriting. AI_MODEL="provider/model"
 *   decisionModel() Jev: scores, choices, yes/no with probabilities.  JEV_MODEL
 */

import { gateway, type LanguageModel } from "ai";

import { requireEnv } from "../config.ts";

export const DEFAULT_TEXT_MODEL = "google/gemini-2.5-flash"; // on the gateway free tier; reads PDFs
export const DEFAULT_JEV_MODEL = "typesafe-ai/jev";
export const DEFAULT_REWRITE_MODEL = "openai/gpt-5-mini"; // writes noticeably better resume bullets; on the free tier

export function textModel(modelId = process.env.AI_MODEL || DEFAULT_TEXT_MODEL): LanguageModel {
  requireEnv("AI_GATEWAY_API_KEY"); // fail early with a clear message; the SDK reads it from the env
  return gateway(modelId);
}

/** For experimental_evaluate(). A string model id resolves through the gateway. */
export function decisionModel(modelId = process.env.JEV_MODEL || DEFAULT_JEV_MODEL): string {
  requireEnv("AI_GATEWAY_API_KEY");
  return modelId;
}

/** For rewriting resume lines (tailoring). Separate from textModel(), which also reads PDFs. */
export function rewriteModel(modelId = process.env.REWRITE_MODEL || DEFAULT_REWRITE_MODEL): LanguageModel {
  requireEnv("AI_GATEWAY_API_KEY");
  return gateway(modelId);
}
