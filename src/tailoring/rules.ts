/**
 * Hard rules for rewritten resume lines, checked in code before any model is asked.
 * A rewrite may reword and reorder; it may not invent numbers or technologies.
 */

import { words } from "../lib/words.ts";
import { containsKeyword } from "../matching/keywords.ts";

/** Numbers as plain digits: "100K+" -> "100", "99.95%" -> "99.95", "1,200" -> "1200". */
export const numbersIn = (text: string) => [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, ""));

/** Numbers in `after` that `before` doesn't have. Any is an invented figure. */
export function inventedNumbers(before: string, after: string): string[] {
  const known = new Set(numbersIn(before));
  return [...new Set(numbersIn(after).filter((n) => !known.has(n)))];
}

// Words that look like a technology or product: AWS, PostgreSQL, JavaScript, C++, C#, Java8, gRPC, Node.js.
const TECH_TOKEN =
  /(?<![\w.])(?:[A-Z]{2,}[\w+#.]*|[A-Z][a-z]+[A-Z][\w]*|[a-z]+[A-Z][\w]*|[A-Za-z]+(?:\+\+|#)|[A-Za-z]+\d+|[A-Za-z]+\.js)(?![\w])/g;

/**
 * Technologies the rewrite introduces that the candidate's resume never mentions. Mentioning a
 * tool the resume lists elsewhere (e.g. in skills) is fine. Job keywords count only when they name
 * something ("Apache Camel", "AWS"): descriptive ones ("large-scale storage") are how tailoring
 * describes existing work in the job's words, and are left to the Jev check.
 */
export function inventedTerms(before: string, after: string, resumeText: string, jobKeywords: string[] = []): string[] {
  const named = jobKeywords.filter((k) => /[A-Z0-9]/.test(k) && containsKeyword(after, k));
  const candidates = [...new Set([...(after.match(TECH_TOKEN) ?? []), ...named])];
  return candidates.filter((term) => !containsKeyword(before, term) && !containsKeyword(resumeText, term));
}

/** Rewrites must be plain text: strip markdown the model sometimes adds (**bold**, `code`, leading "- "). */
export const plainText = (text: string) =>
  text
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*[-*•]\s+/, "")
    .replace(/\s+/g, " ")
    .trim();

// Verbs that say what role the person had. A rewrite may not trade them for weaker ones ("Architected" -> "Built").
const OWNERSHIP = ["architect", "own", "led", "lead", "spearhead", "design", "found", "mentor", "manag", "establish"];

/** Numbers, named technologies and ownership verbs in `before` that `after` leaves out. */
export function droppedFacts(before: string, after: string): string[] {
  const numbers = new Set(numbersIn(after));
  const lostNumbers = numbersIn(before).filter((n) => !numbers.has(n));
  const lostTerms = (before.match(TECH_TOKEN) ?? []).filter((t) => !containsKeyword(after, t));
  const afterWords = words(after);
  const lostRoles = words(before)
    .filter((w) => OWNERSHIP.some((stem) => w.startsWith(stem)))
    .filter((w) => {
      const stem = OWNERSHIP.find((s) => w.startsWith(s))!;
      return !afterWords.some((x) => x.startsWith(stem));
    });
  return [...new Set([...lostNumbers, ...lostTerms, ...lostRoles])];
}

/** True if the rewrite changes almost nothing (punctuation, or a single word): not worth reviewing. */
export function trivialChange(before: string, after: string): boolean {
  const a = words(before).map((w) => w.replace(/[.,;:]+$/, ""));
  const b = words(after).map((w) => w.replace(/[.,;:]+$/, ""));
  const setA = new Set(a);
  const setB = new Set(b);
  const changed = a.filter((w) => !setB.has(w)).length + b.filter((w) => !setA.has(w)).length;
  // A restructured sentence reorders what the lines share; a trivial edit keeps the order.
  const sameOrder = a.filter((w) => setB.has(w)).join(" ") === b.filter((w) => setA.has(w)).join(" ");
  return sameOrder && changed <= 2;
}

/** What a rewrite of this line must keep: its numbers and named technologies. Told to the rewriter up front. */
export const mustKeep = (line: string) => [...new Set([...numbersIn(line), ...(line.match(TECH_TOKEN) ?? [])])];
