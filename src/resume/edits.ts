/**
 * The parts of a resume that tailoring may change, addressed by a path:
 *   "summary"                              the summary paragraph (only if the resume has one)
 *   "skills.<g>"                           one skill group, as "a, b, c" (reorder only)
 *   "skills"                               the skills list, for resumes without groups (reorder only)
 *   "experience.<i>.bullets.<j>"           one experience bullet
 *   "projects.<i>.bullets.<j>"             one project bullet
 *   "sections.<s>.entries.<e>.bullets.<j>" one bullet of another section (e.g. achievements)
 * Company names, titles, dates, headings and education are never editable.
 */

import type { Resume } from "../schemas/index.ts";

const EDITABLE =
  /^(summary|skills(?:\.(\d+))?|(experience|projects)\.(\d+)\.bullets\.(\d+)|sections\.(\d+)\.entries\.(\d+)\.bullets\.(\d+))$/;

/** Skills lines may only be reordered, never reworded. */
export const isSkillsPath = (path: string) => /^skills(\.\d+)?$/.test(path);

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
  r.sections.forEach((section, s) => {
    section.entries.forEach((entry, e) => {
      entry.bullets.forEach((text, j) => {
        lines.push({ path: `sections.${s}.entries.${e}.bullets.${j}`, text });
      });
    });
  });
  if (r.skillGroups.length) {
    r.skillGroups.forEach((g, i) => {
      if (g.items.length) lines.push({ path: `skills.${i}`, text: g.items.join(", ") });
    });
  } else if (r.skills.length) lines.push({ path: "skills", text: r.skills.join(", ") });
  return lines;
}

/** Text at an editable path, or null if the path is not editable or does not exist. */
export function getText(r: Resume, path: string): string | null {
  const m = EDITABLE.exec(path);
  if (!m) return null;
  if (path === "summary") return r.summary;
  if (path === "skills") return r.skills.length ? r.skills.join(", ") : null;
  if (m[2] !== undefined) return r.skillGroups[Number(m[2])]?.items.join(", ") || null;
  if (m[3]) return (m[3] === "experience" ? r.experience : r.projects)[Number(m[4])]?.bullets[Number(m[5])] ?? null;
  return r.sections[Number(m[6])]?.entries[Number(m[7])]?.bullets[Number(m[8])] ?? null;
}

/** A copy of the resume with the text at `path` replaced. The path must exist (check with getText). */
export function setText(r: Resume, path: string, text: string): Resume {
  const copy: Resume = structuredClone(r);
  const m = EDITABLE.exec(path);
  if (!m || getText(r, path) === null) throw new Error(`Not an editable path: ${path}`);
  if (path === "summary") copy.summary = text;
  else if (path === "skills") copy.skills = splitSkills(text);
  else if (m[2] !== undefined) {
    copy.skillGroups[Number(m[2])]!.items = splitSkills(text);
    copy.skills = [...new Set(copy.skillGroups.flatMap((g) => g.items))];
  } else if (m[3])
    (m[3] === "experience" ? copy.experience : copy.projects)[Number(m[4])]!.bullets[Number(m[5])] = text;
  else copy.sections[Number(m[6])]!.entries[Number(m[7])]!.bullets[Number(m[8])] = text;
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
