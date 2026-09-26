import { describe, expect, it } from "vitest";

import { extractRequirements } from "../src/matching/requirements.ts";
import { LEVELS, overallScore, scoreResume, statusOf } from "../src/matching/scoring.ts";
import type { Job, Requirement } from "../src/schemas/index.ts";
import { mockJev, mockTextModel, SAMPLE_RESUME } from "./mocks.ts";

const REQS: Requirement[] = [
  { id: "r1", text: "Python", kind: "must", keywords: ["Python"] },
  { id: "r2", text: "Ceph", kind: "must", keywords: ["Ceph", "distributed storage"] },
  { id: "r3", text: "CUDA", kind: "nice", keywords: ["CUDA"] },
];

describe("statusOf", () => {
  it.each([
    [0, "gap"],
    [0.49, "gap"],
    [0.5, "related"],
    [1.49, "related"],
    [1.5, "clear"],
    [2, "clear"],
  ] as const)("%s -> %s", (score, status) => expect(statusOf(score)).toBe(status));
});

describe("overallScore", () => {
  const items = (s: number[]) =>
    s.map((score, i) => ({ requirementId: `r${i + 1}`, score, confidence: null, status: statusOf(score) }));

  it("is 100 when everything is clearly shown and 0 when nothing is", () => {
    expect(overallScore(REQS, items([2, 2, 2]))).toBe(100);
    expect(overallScore(REQS, items([0, 0, 0]))).toBe(0);
  });

  it("weights must-haves double", () => {
    // musts fully shown (2 x weight 2), nice missing (weight 1): 4 of 5 -> 80
    expect(overallScore(REQS, items([2, 2, 0]))).toBe(80);
    // nice fully shown, musts missing: 1 of 5 -> 20
    expect(overallScore(REQS, items([0, 0, 2]))).toBe(20);
  });
});

describe("scoreResume", () => {
  it("asks Jev one Score question per requirement and combines the answers", async () => {
    const { model, calls } = mockJev({ r1: 2, r2: 1, r3: 0 }, { r1: 0.99, r2: 0.6 });
    const result = await scoreResume(SAMPLE_RESUME, REQS, model);

    const questions = calls[0]!.questions;
    expect(Object.keys(questions)).toEqual(["r1", "r2", "r3"]);
    expect(questions.r1).toMatchObject({ type: "score", criteria: LEVELS });
    expect(JSON.stringify(questions.r2)).toContain("Ceph");
    expect(JSON.stringify(calls[0]!.state)).toContain("Ran Ceph clusters"); // resume text is the state
    expect(JSON.stringify(calls[0]!.state)).not.toContain("asha@example.com"); // contact details left out

    expect(result.items.map((i) => i.status)).toEqual(["clear", "related", "gap"]);
    expect(result.items.map((i) => i.confidence)).toEqual([0.99, 0.6, null]);
    expect(result.overall).toBe(60); // (2*1 + 2*0.5 + 1*0) / 5
    expect(result.keywords).toEqual({
      percent: 50,
      found: ["Python", "Ceph"],
      missing: ["distributed storage", "CUDA"],
    });
  });
});

describe("extractRequirements", () => {
  it("assigns our own ids r1..rN and keeps the kinds", async () => {
    const reply = JSON.stringify({
      requirements: [
        { text: " Python ", kind: "must", keywords: [" Python ", ""] },
        { text: "CUDA", kind: "nice", keywords: ["CUDA"] },
      ],
    });
    const job = { title: "Engineer", description: "..." } as Job;
    expect(await extractRequirements(job, mockTextModel(reply))).toEqual([
      { id: "r1", text: "Python", kind: "must", keywords: ["Python"] },
      { id: "r2", text: "CUDA", kind: "nice", keywords: ["CUDA"] },
    ]);
  });
});
