import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { getText } from "../src/resume/edits.ts";
import type { Requirement, ScoreResult } from "../src/schemas/index.ts";
import { insertionOnly } from "../src/tailoring/propose.ts";
import { tailorResume } from "../src/tailoring/tailor.ts";
import { isBetter, pickTargets } from "../src/tailoring/targets.ts";

import { mockJevWith, SAMPLE_RESUME } from "./mocks.ts";

const REQS: Requirement[] = [
  { id: "r1", text: "Operating large-scale storage", kind: "must", keywords: ["large-scale storage"] },
];
const BEFORE: ScoreResult = {
  overall: 50,
  keywords: { percent: 0, found: [], missing: ["large-scale storage"] },
  requirements: REQS,
  items: [{ requirementId: "r1", score: 1, confidence: 0.9, status: "related" }],
};

// A fake rewriter: the first proposal request gets these edits, later ones none, repair requests "no fixes".
function proposal(edits: object[]) {
  let proposed = false;
  return new MockLanguageModelV4({
    doGenerate: async ({ prompt }) => {
      const repair = JSON.stringify(prompt).includes("Fix these rewrites");
      const reply = repair ? { fixes: [] } : { edits: proposed ? [] : edits };
      if (!repair) proposed = true;
      return {
        content: [{ type: "text", text: JSON.stringify(reply) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
const edit = (path: string, after: string) => ({ path, after, requirementIds: ["r1"], reason: "test" });

describe("tailorResume", () => {
  it("keeps a truthful rewrite that raises the score, and fills 'before' from the resume", async () => {
    const text = proposal([edit("experience.0.bullets.0", "Operated large-scale Ceph clusters")]);
    // call 0 = truth check (yes), call 1 = re-score (higher than before)
    const jev = mockJevWith((_, q, call) =>
      q.type === "boolean" ? { type: "boolean", probability: 0.95 } : { type: "score", score: call === 1 ? 2 : 1 },
    );

    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.after.overall).toBe(100);
    expect(getText(result.tailored, "experience.0.bullets.0")).toBe("Operated large-scale Ceph clusters");
    expect(result.edits[0]).toMatchObject({ status: "applied", before: "Ran Ceph clusters", truth: 0.95 });
    expect(getText(result.original, "experience.0.bullets.0")).toBe("Ran Ceph clusters"); // original untouched
  });

  it("drops edits Jev says add work the original doesn't describe, and never re-scores with them", async () => {
    const text = proposal([edit("experience.0.bullets.0", "Led the team that ran Ceph clusters")]);
    const jev = mockJevWith(() => ({ type: "boolean", probability: 0.1 }));

    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.edits[0]).toMatchObject({ status: "unsupported", truth: 0.1 });
    expect(result.tailored).toEqual(SAMPLE_RESUME);
    expect(jev.calls).toHaveLength(1); // truth check only
  });

  it("rejects a technology the resume never mentions in code, without asking Jev", async () => {
    const text = proposal([edit("experience.0.bullets.0", "Ran Ceph clusters and wrote CUDA kernels")]);
    const jev = mockJevWith(() => ({ type: "boolean", probability: 1 }));

    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.edits[0]).toMatchObject({ status: "unsupported", truth: 0, note: "not in your resume: CUDA" });
    expect(jev.calls).toHaveLength(0);
  });

  it("rejects bad paths and skills edits that add a skill, in code, before asking Jev", async () => {
    const text = proposal([
      edit("experience.0.title", "Principal SRE"), // titles are not editable
      edit("skills", "Python, Ceph, CUDA"), // adds a skill
    ]);
    const jev = mockJevWith(() => ({ type: "boolean", probability: 1 }));

    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.edits.map((e) => e.status)).toEqual(["invalid", "invalid"]);
    expect(jev.calls).toHaveLength(0);
  });

  it("keeps a truthful rewrite that leaves the scores unchanged (clearer for a recruiter)", async () => {
    const text = proposal([edit("experience.0.bullets.0", "Kept Ceph clusters running for the whole team")]);
    const jev = mockJevWith((_, q) =>
      q.type === "boolean" ? { type: "boolean", probability: 0.99 } : { type: "score", score: 1 },
    );

    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.edits[0]!.status).toBe("applied");
    expect(getText(result.tailored, "experience.0.bullets.0")).toBe("Kept Ceph clusters running for the whole team");
  });

  it("drops a truthful rewrite that makes the match weaker ('no_gain')", async () => {
    const text = proposal([edit("experience.0.bullets.0", "Kept Ceph clusters running for the whole team")]);
    const jev = mockJevWith(
      (_, q) => (q.type === "boolean" ? { type: "boolean", probability: 0.99 } : { type: "score", score: 0.5 }), // fit drops
    );

    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.edits[0]!.status).toBe("no_gain");
    expect(result.tailored).toEqual(SAMPLE_RESUME);
  });

  it("rejects invented numbers and technologies in code, before asking Jev", async () => {
    const text = proposal([
      edit("experience.0.bullets.0", "Operated 40 Ceph storage clusters"), // "40" is not in the original
      edit("experience.0.bullets.0", "Ran Ceph clusters on AWS"), // AWS is nowhere in the resume
    ]);
    const jev = mockJevWith(() => ({ type: "boolean", probability: 1 }));
    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.edits[0]).toMatchObject({ status: "unsupported", note: "new numbers: 40" });
    expect(result.edits[1]!.status).toBe("invalid"); // same path twice
    expect(jev.calls).toHaveLength(0);
  });

  it("strips markdown from rewrites", async () => {
    const text = proposal([edit("experience.0.bullets.0", "- Ran **Ceph** clusters")]);
    const jev = mockJevWith((_, q) =>
      q.type === "boolean" ? { type: "boolean", probability: 0.95 } : { type: "score", score: 1 },
    );
    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });
    expect(result.edits[0]!.after).toBe("Ran Ceph clusters");
  });

  it("keeps a skills reorder without needing a score gain", async () => {
    const text = proposal([edit("skills", "Ceph, Python")]);
    const jev = mockJevWith(() => ({ type: "score", score: 1 }));

    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.tailored.skills).toEqual(["Ceph", "Python"]);
    expect(result.edits[0]).toMatchObject({ status: "applied", truth: 1 });
  });
});

describe("keywords in tailoring", () => {
  it("keeps a truthful rewrite that adds the job's term even when fit stays the same", async () => {
    const text = proposal([edit("experience.0.bullets.0", "Operated large-scale storage on Ceph clusters")]);
    const jev = mockJevWith(
      (_, q) => (q.type === "boolean" ? { type: "boolean", probability: 0.9 } : { type: "score", score: 1 }), // fit unchanged
    );

    const result = await tailorResume(SAMPLE_RESUME, BEFORE, { text, jev: jev.model });

    expect(result.after.overall).toBe(50);
    expect(result.after.keywords).toMatchObject({ percent: 100, found: ["large-scale storage"] });
    expect(result.edits[0]!.status).toBe("applied");
  });

  it("targets related requirements and clear ones missing a keyword, but never gaps", () => {
    const score: ScoreResult = {
      ...BEFORE,
      requirements: [
        { id: "r1", text: "Ceph", kind: "must", keywords: ["Ceph"] }, // clear, keyword present -> skip
        { id: "r2", text: "Storage", kind: "must", keywords: ["distributed storage"] }, // clear, missing -> target
        { id: "r3", text: "Linux", kind: "must", keywords: ["RHEL"] }, // related -> target
        { id: "r4", text: "CUDA", kind: "nice", keywords: ["CUDA"] }, // gap -> never
      ],
      items: [
        { requirementId: "r1", score: 2, confidence: 1, status: "clear" },
        { requirementId: "r2", score: 2, confidence: 1, status: "clear" },
        { requirementId: "r3", score: 1, confidence: 1, status: "related" },
        { requirementId: "r4", score: 0, confidence: 1, status: "gap" },
      ],
    };
    const targets = pickTargets(SAMPLE_RESUME, score);
    expect(targets.map((t) => t.requirement.id)).toEqual(["r2", "r3"]);
    expect(targets[0]!.missingKeywords).toEqual(["distributed storage"]);
  });

  it("isBetter: one score up, neither down", () => {
    const s = (overall: number, percent: number) => ({ ...BEFORE, overall, keywords: { ...BEFORE.keywords, percent } });
    expect(isBetter(s(50, 40), s(50, 30))).toBe(true); // keywords up
    expect(isBetter(s(55, 30), s(50, 30))).toBe(true); // fit up
    expect(isBetter(s(50, 30), s(50, 30))).toBe(false); // nothing changed
    expect(isBetter(s(45, 60), s(50, 30))).toBe(false); // keywords up but fit down
  });
});

describe("keyword stuffing", () => {
  it("insertionOnly finds pure insertions and nothing else", () => {
    expect(insertionOnly("Built a library", "Built a backend library")).toEqual(["backend"]);
    expect(insertionOnly("Built a library", "Designed a reusable library")).toBeNull(); // real rewrite
    expect(insertionOnly("Built a library", "Built a library")).toBeNull();
  });

  it("drops a second edit that only inserts the same word", async () => {
    const resume = {
      ...SAMPLE_RESUME,
      experience: [{ ...SAMPLE_RESUME.experience[0]!, bullets: ["Ran Ceph clusters", "Wrote tools"] }],
    };
    const text = proposal([
      edit("experience.0.bullets.0", "Ran backend Ceph clusters for teams"),
      edit("experience.0.bullets.1", "Wrote backend tools for teams"),
    ]);
    const jev = mockJevWith((_, q) =>
      q.type === "boolean" ? { type: "boolean", probability: 0.95 } : { type: "score", score: 1 },
    );
    const result = await tailorResume(resume, BEFORE, { text, jev: jev.model });
    expect(result.edits.map((e) => e.status)).toEqual(["applied", "invalid"]);
    expect(result.edits[1]!.note).toMatch(/already added elsewhere/);
  });
});
