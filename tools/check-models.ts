/**
 * Checks that the configured models answer through the Vercel AI Gateway.
 *
 *   npm run tool:check-models
 */

import { experimental_evaluate, generateText } from "ai";

import { decisionModel, rewriteModel, textModel } from "../src/ai/models.ts";

for (const [role, model] of [
  ["text", textModel()],
  ["rewrite", rewriteModel()],
] as const) {
  const { text } = await generateText({ model, prompt: "Reply with exactly: ok" });
  console.log(`${role} model: "${text.trim()}"`);
}

const result = await experimental_evaluate({
  model: decisionModel(),
  state: { candidate: "5 years running Ceph and Lustre storage clusters", job: "Senior HPC Storage Engineer" },
  questions: {
    fit: {
      type: "score",
      instructions: "How clearly does the candidate's experience show what the job needs?",
      criteria: ["not shown", "related", "clearly shown"],
    },
  },
});
console.log("decision model (Jev):", JSON.stringify(result.answers.fit));
