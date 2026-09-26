import { describe, expect, it } from "vitest";

import { containsKeyword, keywordCoverage, uniqueKeywords } from "../src/matching/keywords.ts";
import type { Requirement } from "../src/schemas/index.ts";
import { SAMPLE_RESUME } from "./mocks.ts";

describe("containsKeyword", () => {
  it.each([
    ["Ran Ceph clusters", "ceph", true], // case-insensitive
    ["Large-scale storage", "large scale storage", true], // hyphens and spaces are the same
    ["Built it in Go.", "Go", true], // punctuation around a word
    ["Worked at Google", "Go", false], // whole words only
    ["C++ and C#", "C++", true],
    ["C++ and C#", "C#", true],
    ["Python", "Python 3", false],
  ])("%j contains %j: %s", (text, keyword, expected) => {
    expect(containsKeyword(text, keyword)).toBe(expected);
  });
});

it("uniqueKeywords drops duplicates across requirements, ignoring case and punctuation", () => {
  const reqs = [
    { id: "r1", text: "", kind: "must", keywords: ["Linux", "RHEL"] },
    { id: "r2", text: "", kind: "nice", keywords: ["linux", " RHEL ", "large-scale storage"] },
    { id: "r3", text: "", kind: "nice", keywords: ["large scale storage"] },
  ] satisfies Requirement[];
  expect(uniqueKeywords(reqs)).toEqual(["Linux", "RHEL", "large-scale storage"]);
});

it("keywordCoverage reports percent, found and missing", () => {
  const reqs: Requirement[] = [
    { id: "r1", text: "", kind: "must", keywords: ["Ceph", "Python"] },
    { id: "r2", text: "", kind: "must", keywords: ["CUDA", "asha@example.com"] }, // contact details are not searched
  ];
  expect(keywordCoverage(SAMPLE_RESUME, reqs)).toEqual({
    percent: 50,
    found: ["Ceph", "Python"],
    missing: ["CUDA", "asha@example.com"],
  });
});
