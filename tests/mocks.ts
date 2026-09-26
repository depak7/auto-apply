/**
 * Offline stand-ins for the real models, from the AI SDK's own test helpers.
 */

import { Experimental_EvaluationMockModelV4, MockLanguageModelV4 } from "ai/test";

import { Resume } from "../src/schemas/index.ts";

/** A text model that always replies with `replyText` (or, given a list, each in turn, repeating the last). */
export function mockTextModel(replyText: string | string[]) {
  const replies = Array.isArray(replyText) ? replyText : [replyText];
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: replies[Math.min(call++, replies.length - 1)]! }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
        outputTokens: { total: 20, text: 20, reasoning: undefined },
      },
      warnings: [],
    }),
  });
}

type EvaluateOptions = Parameters<Experimental_EvaluationMockModelV4["doEvaluate"]>[0];
type Question = EvaluateOptions["questions"][string];
export type MockAnswer = { type: "score"; score: number } | { type: "boolean"; probability: number };

/** A Jev stand-in. `answer` decides each answer; `call` counts evaluate() calls from 0. Records every call. */
export function mockJevWith(
  answer: (id: string, question: Question, call: number) => MockAnswer,
  confidence: Record<string, number> = {},
) {
  const calls: EvaluateOptions[] = [];
  const model = new Experimental_EvaluationMockModelV4({
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: async (options) => {
      const call = calls.push(options) - 1;
      const answers = Object.fromEntries(Object.entries(options.questions).map(([id, q]) => [id, answer(id, q, call)]));
      return { answers, warnings: [], providerMetadata: { typesafe: { confidence } } };
    },
  });
  return { model, calls };
}

/** A Jev stand-in that answers every Score question with the given score (by question id). */
export function mockJev(scores: Record<string, number>, confidence: Record<string, number> = {}) {
  return mockJevWith((id) => ({ type: "score", score: scores[id] ?? 0 }), confidence);
}

/** A resume as stored before skill groups, sections, and links existed: the defaults fill them in. */
export const SAMPLE_RESUME: Resume = Resume.parse({
  name: "Asha Rao",
  email: "asha@example.com",
  phone: null,
  location: "Bengaluru",
  links: ["https://github.com/asha"],
  summary: null,
  experience: [
    { company: "Acme", title: "SRE", location: null, start: "2021", end: null, bullets: ["Ran Ceph clusters"] },
  ],
  education: [{ school: "IIT", degree: "B.Tech", field: "CS", start: null, end: "2020", details: [] }],
  projects: [],
  skills: ["Python", "Ceph"],
  certifications: [],
});

/** A resume laid out like a typical one-page LaTeX resume. */
export const LAID_OUT = Resume.parse({
  ...SAMPLE_RESUME,
  name: "ASHA RAO",
  headline: "Site Reliability Engineer — Storage",
  contactLinks: [{ label: "GitHub", url: "https://github.com/asha" }],
  skillGroups: [
    { label: "Languages", items: ["Python", "Go"] },
    { label: "Storage", items: ["Ceph"] },
  ],
  skills: ["Python", "Go", "Ceph"],
  experience: [{ ...SAMPLE_RESUME.experience[0]!, tech: "Ceph, Python", bold: ["Ceph"] }],
  projects: [
    { name: "Stor – S3 gateway", links: [{ label: "Live", url: "https://stor.dev/" }], bullets: ["Built it"] },
  ],
  sections: [
    {
      title: "Achievements & Open Source",
      entries: [
        {
          heading: null,
          subheading: null,
          date: null,
          location: null,
          bullets: ["Hackathon — 1st: Won"],
          bold: ["Hackathon — 1st:"],
        },
      ],
    },
  ],
  layout: [
    { kind: "skills", title: "Technical Skills" },
    { kind: "experience", title: "Experience" },
    { kind: "other", title: "Achievements & Open Source" },
    { kind: "projects", title: "Projects" },
    { kind: "education", title: "Education" },
  ],
  page: "letter",
});
