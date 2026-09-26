/**
 * Keyword match: which of the job's exact terms appear in the resume, word for word.
 * Pure code, no model. This is roughly what ATS keyword filters do, and the part of a score
 * that honest rewording (using the job's words for what the resume already says) can raise.
 */

import { resumeToText } from "../resume/text.ts";
import type { KeywordCoverage, Requirement, Resume } from "../schemas/index.ts";

/** Lowercase, and turn anything except letters, digits, + and # into single spaces ("C++", "C#" survive). */
const normalize = (text: string) =>
  ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim()} `;

/** True if `keyword` appears in `text` as whole words ("Go" does not match "Google"). */
export const containsKeyword = (text: string, keyword: string) => normalize(text).includes(normalize(keyword));

/** All requirements' keywords, de-duplicated ignoring case, in first-seen order. */
export function uniqueKeywords(requirements: Requirement[]): string[] {
  const seen = new Map<string, string>();
  for (const k of requirements.flatMap((r) => r.keywords)) {
    const key = normalize(k).trim();
    if (key && !seen.has(key)) seen.set(key, k.trim());
  }
  return [...seen.values()];
}

export function keywordCoverage(resume: Resume, requirements: Requirement[]): KeywordCoverage {
  const text = resumeToText(resume);
  const all = uniqueKeywords(requirements);
  const found = all.filter((k) => containsKeyword(text, k));
  const missing = all.filter((k) => !found.includes(k));
  return { percent: all.length ? Math.round((100 * found.length) / all.length) : 0, found, missing };
}
