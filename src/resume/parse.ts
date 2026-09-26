/**
 * Resume PDF -> structured Resume, using a text model through the Vercel AI SDK.
 * The PDF is sent as-is: the model reads the layout (columns, tables, bold) itself. Link URLs
 * are not visible on the page, so they are read from the PDF by code and listed for the model.
 */

import { generateText, type LanguageModel, Output } from "ai";

import { textModel } from "../ai/models.ts";
import { isOngoing } from "../lib/words.ts";
import { Resume } from "../schemas/index.ts";
import { type BoldRun, type PdfInfo, type PdfLink, readPdfInfo } from "./pdf-info.ts";

const SYSTEM = `You extract resumes into structured data.
Rules:
- Copy text exactly as written. Do not rephrase, summarise, fix grammar, or translate. Keep every punctuation
  mark as printed, including dashes (— and –), "|", ":" and brackets.
- Never add anything that is not in the document. If a field is missing, use null or an empty list.
- Keep the order used in the resume.
- Keep every section under its own heading. A section that is not summary, skills, experience, projects,
  education or certifications (e.g. "Achievements & Open Source") goes in \`sections\` with its title,
  never into projects. Put each heading in \`layout\`, in the order they appear.
- For links, use the real URLs from the list of links given with the document, matched by their visible text
  and the line they are on. Never use the visible text as the URL.
- List the phrases printed in bold inside bullets in each entry's \`bold\`, exactly as written.
- A bullet that starts with a bold lead-in (e.g. "Award — 2nd place: Built ...") stays one bullet, word for word;
  its lead-in goes in \`bold\`. Use an entry heading only for a separate line above the bullets.`;

/** What the model extracts; \`links\` and \`skills\` are derived from it by code. */
const Extraction = Resume.omit({ links: true, skills: true, page: true });

/** True if `data` starts with the PDF signature. */
export const isPdf = (data: Uint8Array) => Buffer.from(data.subarray(0, 5)).toString("latin1") === "%PDF-";

export async function parseResume(pdf: Buffer, model: LanguageModel = textModel()): Promise<Resume> {
  if (!isPdf(pdf)) throw new Error("Expected a PDF file");

  // A PDF pdf.js can't read still parses, without URLs.
  const info: PdfInfo = await readPdfInfo(pdf).catch(() => ({ links: [], text: "", bold: [], page: "a4" as const }));
  const { output } = await generateText({
    model,
    temperature: 0,
    system: SYSTEM,
    output: Output.object({ schema: Extraction }), // the SDK validates the reply against the Zod schema
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: pdf, mediaType: "application/pdf" },
          { type: "text", text: `Extract this resume.\n\n${describeLinks(info.links)}${describeText(info.text)}` },
        ],
      },
    ],
  });
  const merged = mergeLeadIns({ ...output, page: info.page }, info.text);
  return withDerived(applyBold({ ...merged, layout: fixLayout(merged) }, info.bold));
}

function describeLinks(links: PdfLink[]): string {
  if (!links.length) return "The document has no links.";
  const rows = links.map((l) => `- "${l.text}" -> ${l.url}   (on the line: "${l.line}")`);
  return `Links in the document (visible text -> real URL):\n${rows.join("\n")}`;
}

function describeText(text: string): string {
  if (!text) return "";
  return `\n\nThe document's text layer, line by line. Copy wording and punctuation from it exactly (the page image\nshows the layout):\n${text}`;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const BULLET = /^[•·▪◦‣∙●*-]\s*/;

/**
 * "• KapHacks 6 — 2nd place: Built ..." is one bullet with a bold lead-in. If the model split the
 * lead-in off as the entry's heading, put it back: the text layer shows it starts a bullet line.
 */
export function mergeLeadIns<R extends Pick<Resume, "sections">>(r: R, text: string): R {
  const bulletLines = text
    .split("\n")
    .filter((l) => BULLET.test(l))
    .map((l) => squash(l.replace(BULLET, "")));
  return {
    ...r,
    sections: r.sections.map((s) => ({
      ...s,
      entries: s.entries.map((e) => {
        const lead = e.heading ? squash(e.heading) : "";
        const first = e.bullets[0] ? squash(e.bullets[0]) : "";
        if (!lead || !first || e.subheading || e.date || e.location) return e;
        // The PDF line: "<lead-in exactly as printed> <start of the bullet>".
        const line = bulletLines.find((l) => l.startsWith(lead.slice(0, Math.max(8, lead.length - 2))));
        const at = line?.indexOf(first.slice(0, 24)) ?? -1;
        if (!line || at <= 0) return e;
        return { ...e, heading: null, bullets: [squash(`${line.slice(0, at)} ${first}`), ...e.bullets.slice(1)] };
      }),
    })),
  };
}

/** Text compared without any whitespace: the text layer spaces words differently ("Supabase ."). */
const bare = (s: string) => s.replace(/\s+/g, "");

/**
 * Bold phrases, from the PDF's fonts when it has any. A run belongs to the entry whose bullets
 * contain the line it was printed on, so "RAG" bold in one bullet isn't bolded in another. The
 * model's list is used only when the PDF shows no bold text.
 */
export function applyBold<R extends Pick<Resume, "experience" | "projects" | "sections">>(r: R, runs: BoldRun[]): R {
  if (!runs.length) return r;
  const within = (bullets: string[]) => {
    const text = bare(bullets.join(""));
    const found = runs.filter((run) => {
      const line = bare(run.line.replace(BULLET, ""));
      return run.text.length > 1 && line.length > 0 && text.includes(line) && text.includes(bare(run.text));
    });
    return [...new Set(found.map((run) => run.text))];
  };
  return {
    ...r,
    experience: r.experience.map((e) => ({ ...e, bold: within(e.bullets) })),
    projects: r.projects.map((p) => ({ ...p, bold: within(p.bullets) })),
    sections: r.sections.map((s) => ({ ...s, entries: s.entries.map((e) => ({ ...e, bold: within(e.bullets) })) })),
  };
}

const KIND_BY_TITLE: [RegExp, Resume["layout"][number]["kind"]][] = [
  [/skill|technolog|tech stack|tools/i, "skills"],
  [/experience|employment|work history|career/i, "experience"],
  [/project/i, "projects"],
  [/education|academic|qualification/i, "education"],
  [/certif|licen[cs]e/i, "certifications"],
  [/summary|profile|objective|about/i, "summary"],
];

/**
 * Section kinds checked against the data: a heading marked "other" that no extra section has
 * (e.g. "Technical Skills") gets its kind from its words, so it renders where it was.
 */
export function fixLayout(r: Pick<Resume, "layout" | "sections">): Resume["layout"] {
  const extra = new Set(r.sections.map((s) => s.title));
  return r.layout.map((item) => {
    if (item.kind !== "other" || extra.has(item.title)) return item;
    const kind = KIND_BY_TITLE.find(([re]) => re.test(item.title))?.[1];
    return kind ? { ...item, kind } : item;
  });
}

/** Fill the fields that are derived from others: header link URLs, and the flat list of skills. */
export function withDerived(r: Omit<Resume, "links" | "skills">): Resume {
  return Resume.parse({
    ...r,
    // The schema's "current" is a null end date; resumes print "Present".
    experience: r.experience.map((e) => ({ ...e, end: isOngoing(e.end) ? null : e.end })),
    links: r.contactLinks.map((l) => l.url).filter((u) => !/^(mailto|tel):/i.test(u)),
    skills: [...new Set(r.skillGroups.flatMap((g) => g.items))],
  });
}
