// One resume change, as a word-level diff: removed words struck through, added words highlighted.

import { diffWords } from "diff";

const SECTION: Record<string, string> = { summary: "Summary", skills: "Skills" };

/** "experience.0.bullets.2" -> "Experience · role 1 · bullet 3" */
export function pathLabel(path: string): string {
  if (SECTION[path]) return SECTION[path];
  const m = /^(experience|projects)\.(\d+)\.bullets\.(\d+)$/.exec(path);
  if (!m) return path;
  return `${m[1] === "experience" ? "Experience" : "Projects"} · ${m[1] === "experience" ? "role" : "project"} ${Number(m[2]) + 1} · bullet ${Number(m[3]) + 1}`;
}

export function WordDiff({ before, after, inline = false }: { before: string; after: string; inline?: boolean }) {
  const Tag = inline ? "span" : "p";
  return (
    <Tag className={inline ? undefined : "text-[15px] leading-7 text-zinc-700"}>
      {diffWords(before, after).map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one diff never reorder, so position is their identity
        <Part key={i} value={part.value} added={part.added} removed={part.removed} />
      ))}
    </Tag>
  );
}

function Part({ value, added, removed }: { value: string; added?: boolean; removed?: boolean }) {
  if (added) return <ins className="rounded bg-emerald-100/80 px-0.5 text-emerald-900 no-underline">{value}</ins>;
  if (removed) return <del className="rounded bg-red-50 px-0.5 text-red-700/70 decoration-red-300">{value}</del>;
  return <span>{value}</span>;
}

/** A skills reorder: the new order as chips, with the skills that moved up highlighted. */
export function SkillsReorder({ before, after }: { before: string; after: string }) {
  const split = (t: string) =>
    t
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
  const old = split(before);
  const now = split(after);
  const moved = new Set(now.filter((skill, i) => old.indexOf(skill) > i));
  return (
    <div>
      <p className="mb-2 text-sm text-zinc-500">Same skills, in a new order: the ones this job asks for come first.</p>
      <ul className="flex flex-wrap gap-1.5">
        {now.map((skill) => (
          <li
            key={skill}
            className={
              moved.has(skill)
                ? "rounded-md bg-emerald-50 px-2 py-1 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200"
                : "rounded-md bg-zinc-50 px-2 py-1 text-sm text-zinc-600 ring-1 ring-zinc-200"
            }
          >
            {skill}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Remove internal requirement ids ("r13") that sometimes appear in reasons. */
export const cleanReason = (reason: string) =>
  reason
    .replace(/\s*\((?:r\d+(?:,\s*)?)+\)|\s*(?:as per|for|per)\s+r\d+(?:,\s*r\d+)*|\br\d+\b/gi, "")
    .replace(/\s+([.,])/g, "$1")
    .trim();
