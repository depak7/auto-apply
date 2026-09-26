/**
 * The parts of a resume that tailoring may change, addressed by a path:
 *   "summary"                    the summary paragraph (only if the resume has one)
 *   "skills"                     the skills list, as "a, b, c" (reorder only)
 *   "experience.<i>.bullets.<j>" one experience bullet
 *   "projects.<i>.bullets.<j>"   one project bullet
 * Company names, titles, dates and education are never editable.
 */

import type { Resume } from "../schemas/index.ts";

const EDITABLE = /^(summary|skills|(experience|projects)\.(\d+)\.bullets\.(\d+))$/;

export interface EditableLine {
  path: string;
  text: string;
}

/** Every editable line in the resume, in reading order. This is what the rewriting model sees. */
export function editableLines(r: Resume): EditableLine[] {
  const lines: EditableLine[] = [];
  if (r.summary) lines.push({ path: "summary", text: r.summary });
  for (const [section, entries] of [
    ["experience", r.experience],
    ["projects", r.projects],
  ] as const) {
    entries.forEach((entry, i) => {
      entry.bullets.forEach((text, j) => {
        lines.push({ path: `${section}.${i}.bullets.${j}`, text });
      });
    });
  }
  if (r.skills.length) lines.push({ path: "skills", text: r.skills.join(", ") });
  return lines;
}

/** Text at an editable path, or null if the path is not editable or does not exist. */
export function getText(r: Resume, path: string): string | null {
  const m = EDITABLE.exec(path);
  if (!m) return null;
  if (path === "summary") return r.summary;
  if (path === "skills") return r.skills.length ? r.skills.join(", ") : null;
  const section = m[2] === "experience" ? r.experience : r.projects;
  return section[Number(m[3])]?.bullets[Number(m[4])] ?? null;
}

/** A copy of the resume with the text at `path` replaced. The path must exist (check with getText). */
export function setText(r: Resume, path: string, text: string): Resume {
  const copy: Resume = structuredClone(r);
  const m = EDITABLE.exec(path);
  if (!m || getText(r, path) === null) throw new Error(`Not an editable path: ${path}`);
  if (path === "summary") copy.summary = text;
  else if (path === "skills") copy.skills = splitSkills(text);
  else (m[2] === "experience" ? copy.experience : copy.projects)[Number(m[3])]!.bullets[Number(m[4])] = text;
  return copy;
}

export const splitSkills = (text: string) =>
  text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

/** True if `after` has exactly the same skills as `before`, only in a different order. */
export function isReorderOnly(before: string, after: string): boolean {
  const norm = (t: string) =>
    splitSkills(t)
      .map((s) => s.toLowerCase())
      .sort()
      .join("\n");
  return norm(before) === norm(after);
}

/** Lines that differ between two versions of the same resume: the diff shown to the user. */
export function diffResumes(original: Resume, tailored: Resume): { path: string; before: string; after: string }[] {
  return editableLines(original)
    .map(({ path, text }) => ({ path, before: text, after: getText(tailored, path) ?? text }))
    .filter((d) => d.before !== d.after);
}
