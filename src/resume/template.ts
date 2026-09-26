/**
 * The resume page as HTML: one template for both the PDF we upload and the on-screen review,
 * so what the user reviews is exactly what gets sent. No Node or browser dependencies, so the
 * UI can import it too.
 *
 * The layout follows the uploaded resume: its section titles and order, skill groups, links,
 * bold phrases and paper size, in a classic single-column serif style (Computer Modern).
 *
 * With `review`, changed lines are marked for the screen only (never in the PDF):
 *   mode "changes":  removed words struck through, added words highlighted, numbered badge
 *   mode "original": the original text, changed lines tinted red
 *   mode "tailored": the new text, changed lines tinted green
 */

import { diffWords } from "diff";

import type { Link, Resume } from "../schemas/index.ts";

export type ReviewMode = "changes" | "original" | "tailored";

export interface Review {
  mode: ReviewMode;
  original: Resume;
  changed: string[]; // changed paths in reading order; position + 1 is the badge number
}

/** URLs of the four Computer Modern Serif faces (data: URIs for the PDF, file URLs in the UI). */
export interface Fonts {
  regular: string;
  italic: string;
  bold: string;
  boldItalic: string;
}

export interface Page {
  format: "A4" | "Letter";
  widthPx: number; // at 96 dpi
  heightPx: number;
  margin: string;
}

const PAGES: Record<Resume["page"], Page> = {
  a4: { format: "A4", widthPx: 794, heightPx: 1123, margin: "11mm" },
  letter: { format: "Letter", widthPx: 816, heightPx: 1056, margin: "11mm" },
};

/** The paper the resume is printed on: the same size as the uploaded PDF. */
export const pageOf = (r: Pick<Resume, "page">): Page => PAGES[r.page] ?? PAGES.a4;

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Escaped text with each bold phrase in <b>, wherever it still appears (whole words only). */
function emphasize(text: string, bold: string[]): string {
  const phrases = [...new Set(bold.map((b) => b.trim()).filter((b) => b.length > 1))].sort(
    (a, b) => b.length - a.length,
  );
  if (!phrases.length) return esc(text);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${phrases.map(escRe).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  let html = "";
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    html += `${esc(text.slice(last, m.index))}<b>${esc(m[0])}</b>`;
    last = m.index + m[0].length;
  }
  return html + esc(text.slice(last));
}

/** "DEEPAK S" -> "Deepak S", so small caps show a capital first letter, as LaTeX's \\scshape does. */
const displayName = (name: string) =>
  name === name.toUpperCase()
    ? name.replace(/\p{L}+/gu, (w) => (w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w))
    : name;

const link = (l: Link) =>
  /^https?:|^mailto:/i.test(l.url) ? `<a href="${esc(l.url)}">${esc(l.label)}</a>` : esc(l.label);

/** Two cells on one line: what on the left, where or when on the right. */
const row = (left: string, right: string, cls = "") =>
  `<div class="row ${cls}"><span>${left}</span>${right ? `<span>${right}</span>` : ""}</div>`;

export function resumeHtml(tailored: Resume, review?: Review, fonts?: Fonts): string {
  const shown = review?.mode === "original" ? review.original : tailored;
  const original = review?.original ?? tailored;

  /** One editable line, bold phrases kept, and marked for review when it changed. */
  const line = (path: string, before: string, after: string, bold: string[]): string => {
    const n = review ? review.changed.indexOf(path) + 1 : 0;
    const text = review?.mode === "original" ? before : after;
    if (!review || n === 0) return emphasize(text, bold);
    const badge = `<span class="badge" id="c${n}">${n}</span>`;
    if (review.mode === "changes") {
      const diff = diffWords(before, after)
        .map((p) => (p.added ? `<ins>${esc(p.value)}</ins>` : p.removed ? `<del>${esc(p.value)}</del>` : esc(p.value)))
        .join("");
      return `<span class="changed">${badge}${diff}</span>`;
    }
    return `<span class="changed ${review.mode}">${badge}${emphasize(text, bold)}</span>`;
  };

  /** Bullets of one entry: `get` picks the entry from a resume, `path` names bullet j. */
  const bullets = <E extends { bullets: string[]; bold: string[] }>(
    get: (r: Resume) => E | undefined,
    path: (j: number) => string,
  ) => {
    const now = get(review?.mode === "original" ? original : tailored);
    const before = get(original);
    const items = now?.bullets ?? [];
    const bold = [...(now?.bold ?? []), ...(before?.bold ?? [])];
    return items.length
      ? `<ul>${items.map((b, j) => `<li>${line(path(j), before?.bullets[j] ?? "", b, bold)}</li>`).join("")}</ul>`
      : "";
  };

  const heading = (title: string) => `<h2>${esc(title)}</h2>`;

  const renderers: Record<string, (title: string) => string> = {
    summary: (title) =>
      shown.summary
        ? heading(title) +
          `<p class="summary">${line("summary", original.summary ?? "", tailored.summary ?? "", [])}</p>`
        : "",

    skills: (title) => {
      if (!shown.skills.length) return "";
      if (!shown.skillGroups.length) {
        return heading(title) + `<p class="skills">${skillsLine("skills", original.skills, tailored.skills)}</p>`;
      }
      const groups = shown.skillGroups
        .map((g, i) => {
          const items = skillsLine(
            `skills.${i}`,
            original.skillGroups[i]?.items ?? g.items,
            tailored.skillGroups[i]?.items ?? g.items,
          );
          return `<div>${g.label ? `<b>${esc(g.label)}:</b> ` : ""}${items}</div>`;
        })
        .join("");
      return heading(title) + `<div class="skills">${groups}</div>`;
    },

    experience: (title) =>
      shown.experience.length
        ? heading(title) +
          shown.experience
            .map(
              (e, i) =>
                `<div class="entry">${row(
                  `<b>${esc(e.company)}</b> | <b><i>${esc(e.title)}</i></b>`,
                  e.tech ? `<b>(${esc(e.tech)})</b>` : "",
                )}${row(`<i>${esc(e.start)} - ${esc(e.end ?? "Present")}</i>`, e.location ? `<i>${esc(e.location)}</i>` : "", "sub")}${bullets(
                  (r) => r.experience[i],
                  (j) => `experience.${i}.bullets.${j}`,
                )}</div>`,
            )
            .join("")
        : "",

    projects: (title) =>
      shown.projects.length
        ? heading(title) +
          shown.projects
            .map((p, i) => {
              const links = p.links.length ? p.links : p.url ? [{ label: p.url, url: p.url }] : [];
              return `<div class="entry">${row([`<b>${esc(p.name)}</b>`, ...links.map(link)].join(" | "), "")}${bullets(
                (r) => r.projects[i],
                (j) => `projects.${i}.bullets.${j}`,
              )}</div>`;
            })
            .join("")
        : "",

    education: (title) =>
      shown.education.length
        ? heading(title) +
          shown.education
            .map((ed) => {
              const degree = [ed.degree, ed.field].filter(Boolean).join(" in ");
              const when = [ed.start, ed.end].filter(Boolean).join(" - ");
              const details = ed.details.length
                ? `<ul>${ed.details.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>`
                : "";
              return `<div class="entry">${row(`<b>${esc(degree || ed.school)}</b>`, when ? `<b>${esc(when)}</b>` : "")}${
                degree ? row(`<i>${esc(ed.school)}</i>`, ed.location ? `<i>${esc(ed.location)}</i>` : "", "sub") : ""
              }${details}</div>`;
            })
            .join("")
        : "",

    certifications: (title) =>
      shown.certifications.length
        ? heading(title) + `<ul>${shown.certifications.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`
        : "",
  };

  /** Another section (achievements, publications...): entries with an optional heading, and bullets. */
  const other = (s: number) => {
    const section = shown.sections[s];
    if (!section) return "";
    const entries = section.entries
      .map((e, k) => {
        const top = e.heading ? row(`<b>${esc(e.heading)}</b>`, e.date ? `<b>${esc(e.date)}</b>` : "") : "";
        const sub =
          e.subheading || e.location
            ? row(`<i>${esc(e.subheading ?? "")}</i>`, e.location ? `<i>${esc(e.location)}</i>` : "", "sub")
            : "";
        return `<div class="entry">${top}${sub}${bullets(
          (r) => r.sections[s]?.entries[k],
          (j) => `sections.${s}.entries.${k}.bullets.${j}`,
        )}</div>`;
      })
      .join("");
    return entries ? heading(section.title) + entries : "";
  };

  /** Skills in their (possibly reordered) order; skills that moved up are highlighted in review. */
  function skillsLine(path: string, before: string[], after: string[]): string {
    const n = review ? review.changed.indexOf(path) + 1 : 0;
    if (!review || n === 0 || review.mode === "original") {
      return (review?.mode === "original" ? before : after).map(esc).join(", ");
    }
    const moved = new Set(after.filter((s, i) => before.indexOf(s) > i));
    const list = after.map((s) => (moved.has(s) ? `<ins>${esc(s)}</ins>` : esc(s))).join(", ");
    return `<span class="changed tailored"><span class="badge" id="c${n}">${n}</span>${list}</span>`;
  }

  // Sections in the resume's own order and wording; anything the layout doesn't mention follows.
  const DEFAULT_TITLES: Record<string, string> = {
    summary: "Summary",
    experience: "Experience",
    projects: "Projects",
    education: "Education",
    skills: "Skills",
    certifications: "Certifications",
  };
  const body: string[] = [];
  const done = new Set<string>();
  for (const item of shown.layout) {
    if (item.kind === "other") {
      const s = shown.sections.findIndex((x, i) => x.title === item.title && !done.has(`other.${i}`));
      if (s >= 0) {
        done.add(`other.${s}`);
        body.push(other(s));
      }
    } else if (!done.has(item.kind)) {
      done.add(item.kind);
      body.push(renderers[item.kind]!(item.title));
    }
  }
  for (const kind of Object.keys(DEFAULT_TITLES))
    if (!done.has(kind)) body.push(renderers[kind]!(DEFAULT_TITLES[kind]!));
  shown.sections.forEach((_, s) => {
    if (!done.has(`other.${s}`)) body.push(other(s));
  });

  const contactLinks: Link[] = shown.contactLinks.length
    ? shown.contactLinks
    : shown.links.map((url) => ({ label: url.replace(/^https?:\/\/(www\.)?/, ""), url }));
  const contact = [
    shown.phone ? esc(shown.phone) : "",
    shown.email ? link({ label: shown.email, url: `mailto:${shown.email}` }) : "",
    shown.location ? esc(shown.location) : "",
    ...contactLinks.filter((l) => !/^mailto:/i.test(l.url)).map(link),
  ]
    .filter(Boolean)
    .join(" | ");

  const page = pageOf(tailored);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    ${fonts ? fontFaces(fonts) : ""}
    body { font: 10pt/1.16 "CMU Serif", "Latin Modern Roman", "Computer Modern Serif", Georgia, "Times New Roman", serif;
           color: #000; margin: 0; -webkit-font-smoothing: antialiased; }
    a { color: inherit; text-decoration: none; }
    header { text-align: center; }
    h1 { font-size: 25pt; font-weight: 400; font-variant: small-caps; letter-spacing: 0.02em; margin: 0; line-height: 1.05; }
    .headline, .contact { font-size: 9.5pt; margin-top: 2px; }
    h2 { font-size: 12pt; font-weight: 700; margin: 5px 0 2px; padding-bottom: 1px; border-bottom: 0.7px solid #000; }
    .entry { margin-top: 2px; }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .row > span:first-child { min-width: 0; }
    .row > span:last-child { flex-shrink: 0; white-space: nowrap; text-align: right; }
    .row.sub { font-size: 9pt; }
    .skills { padding-left: 10px; font-size: 9.6pt; }
    .summary { margin: 2px 0; }
    ul { margin: 0 0 2px 22px; padding: 0; font-size: 9.6pt; }
    li { margin: 0; }
    li::marker { font-size: 0.8em; }
    ${review ? reviewCss(page) : ""}
  </style></head><body>${review ? `<div class="page">` : ""}
    <header>
      <h1>${esc(displayName(shown.name))}</h1>
      ${shown.headline ? `<div class="headline">${esc(shown.headline)}</div>` : ""}
      ${contact ? `<div class="contact">${contact}</div>` : ""}
    </header>
    ${body.join("\n")}
  ${review ? "</div>" : ""}</body></html>`;
}

const fontFaces = (f: Fonts) =>
  [
    [f.regular, 400, "normal"],
    [f.italic, 400, "italic"],
    [f.bold, 700, "normal"],
    [f.boldItalic, 700, "italic"],
  ]
    .map(
      ([src, weight, style]) =>
        `@font-face { font-family: "CMU Serif"; src: url("${src}") format("woff2"); font-weight: ${weight}; font-style: ${style}; }`,
    )
    .join("\n");

// Screen only: the page itself (paper size, PDF margins), page-break guides, and the change marks.
const reviewCss = (page: Page) => `
  html { background: #fff; }
  .page { box-sizing: border-box; width: ${page.widthPx}px; min-height: ${page.heightPx}px; padding: ${page.margin};
          background-image: repeating-linear-gradient(to bottom, transparent 0, transparent ${page.heightPx - 1}px, #d4d4d8 ${page.heightPx - 1}px, #d4d4d8 ${page.heightPx}px); }
  a { pointer-events: none; }
  .changed { position: relative; border-radius: 3px; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
  .changed.tailored { background: #ecfdf5; }
  .changed.original { background: #fef2f2; }
  .badge { position: absolute; left: -30px; top: 0; width: 17px; height: 17px; border-radius: 9px; background: #4f46e5; color: #fff;
           font: bold 9.5px/17px Arial, sans-serif; text-align: center; scroll-margin-top: 80px; }
  li .badge { left: -48px; }
  ins { background: #bbf7d0; color: #14532d; text-decoration: none; border-radius: 2px; }
  del { background: #fee2e2; color: #991b1b; text-decoration: line-through; border-radius: 2px; }
  .flash { animation: flash 1.2s ease-out; }
  @keyframes flash { 0% { box-shadow: 0 0 0 4px #a5b4fc; } 100% { box-shadow: 0 0 0 0 transparent; } }
`;
