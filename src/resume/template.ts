/**
 * The resume page as HTML: one template for both the PDF we upload and the on-screen review,
 * so what the user reviews is exactly what gets sent. No Node or browser dependencies, so the
 * UI can import it too.
 *
 * With `review`, changed lines are marked for the screen only (never in the PDF):
 *   mode "changes":  removed words struck through, added words highlighted, numbered badge
 *   mode "original": the original text, changed lines tinted red
 *   mode "tailored": the new text, changed lines tinted green
 */

import { diffWords } from "diff";

import type { Resume } from "../schemas/index.ts";

export type ReviewMode = "changes" | "original" | "tailored";

export interface Review {
  mode: ReviewMode;
  original: Resume;
  changed: string[]; // changed paths in reading order; position + 1 is the badge number
}

/** A4 at 96 dpi, and the page margin used for the PDF. */
export const PAGE = { widthPx: 794, heightPx: 1123, margin: "14mm" };

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function resumeHtml(tailored: Resume, review?: Review): string {
  const shown = review?.mode === "original" ? review.original : tailored;
  const original = review?.original ?? tailored;

  /** One editable line, marked for review when it changed. */
  const line = (path: string, before: string, after: string): string => {
    const n = review ? review.changed.indexOf(path) + 1 : 0;
    const plain = esc(review?.mode === "original" ? before : after);
    if (!review || n === 0) return plain;
    const badge = `<span class="badge" id="c${n}">${n}</span>`;
    if (review.mode === "changes") {
      const diff = diffWords(before, after)
        .map((p) => (p.added ? `<ins>${esc(p.value)}</ins>` : p.removed ? `<del>${esc(p.value)}</del>` : esc(p.value)))
        .join("");
      return `<span class="changed">${badge}${diff}</span>`;
    }
    return `<span class="changed ${review.mode}">${badge}${plain}</span>`;
  };

  const bullets = (items: string[], path: (j: number) => string, before: (j: number) => string) =>
    items.length ? `<ul>${items.map((b, j) => `<li>${line(path(j), before(j), b)}</li>`).join("")}</ul>` : "";
  const plainBullets = (items: string[]) =>
    items.length ? `<ul>${items.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "";
  const section = (title: string, body: string) => (body ? `<h2>${title}</h2>${body}` : "");

  const contact = [shown.email, shown.phone, shown.location, ...shown.links]
    .filter(Boolean)
    .map((c) => esc(c!))
    .join(" · ");

  const experience = shown.experience
    .map(
      (e, i) =>
        `<div class="row"><span><b>${esc(e.title)}</b>, ${esc(e.company)}${e.location ? `, ${esc(e.location)}` : ""}</span>` +
        `<span>${esc(e.start)} – ${esc(e.end ?? "Present")}</span></div>` +
        bullets(
          review?.mode === "original" ? original.experience[i]!.bullets : (tailored.experience[i]?.bullets ?? []),
          (j) => `experience.${i}.bullets.${j}`,
          (j) => original.experience[i]?.bullets[j] ?? "",
        ),
    )
    .join("");
  const projects = shown.projects
    .map(
      (p, i) =>
        `<div class="row"><b>${esc(p.name)}</b>${p.url ? `<span>${esc(p.url)}</span>` : ""}</div>` +
        bullets(
          review?.mode === "original" ? original.projects[i]!.bullets : (tailored.projects[i]?.bullets ?? []),
          (j) => `projects.${i}.bullets.${j}`,
          (j) => original.projects[i]?.bullets[j] ?? "",
        ),
    )
    .join("");
  const education = shown.education
    .map(
      (ed) =>
        `<div class="row"><span><b>${esc([ed.degree, ed.field].filter(Boolean).join(", "))}</b>, ${esc(ed.school)}</span>` +
        `<span>${esc(ed.end ?? "")}</span></div>${plainBullets(ed.details)}`,
    )
    .join("");

  const skillsHtml = (() => {
    if (!shown.skills.length) return "";
    const n = review ? review.changed.indexOf("skills") + 1 : 0;
    if (!review || n === 0 || review.mode === "original") return `<p>${shown.skills.map(esc).join(", ")}</p>`;
    const moved = new Set(tailored.skills.filter((s, i) => original.skills.indexOf(s) > i));
    const list = tailored.skills.map((s) => (moved.has(s) ? `<ins>${esc(s)}</ins>` : esc(s))).join(", ");
    return `<p><span class="changed tailored"><span class="badge" id="c${n}">${n}</span>${list}</span></p>`;
  })();

  const summary = shown.summary ? `<p>${line("summary", original.summary ?? "", tailored.summary ?? "")}</p>` : "";

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font: 10.5pt/1.35 Arial, Helvetica, sans-serif; color: #111; margin: 0; }
    h1 { font-size: 18pt; margin: 0 0 2px; }
    h2 { font-size: 11pt; text-transform: uppercase; border-bottom: 1px solid #999; margin: 12px 0 4px; }
    .contact { color: #333; }
    .row { display: flex; justify-content: space-between; gap: 12px; margin-top: 6px; } /* left: what, right: when */
    ul { margin: 2px 0 0 18px; padding: 0; }
    li { margin: 1px 0; }
    ${review ? REVIEW_CSS : ""}
  </style></head><body>${review ? `<div class="page">` : ""}
    <h1>${esc(shown.name)}</h1><div class="contact">${contact}</div>
    ${section("Summary", summary)}
    ${section("Experience", experience)}
    ${section("Projects", projects)}
    ${section("Education", education)}
    ${section("Skills", skillsHtml)}
    ${section("Certifications", plainBullets(shown.certifications))}
  ${review ? "</div>" : ""}</body></html>`;
}

// Screen only: the page itself (A4, PDF margins), page-break guides, and the change marks.
const REVIEW_CSS = `
  html { background: #fff; }
  .page { box-sizing: border-box; width: ${PAGE.widthPx}px; min-height: ${PAGE.heightPx}px; padding: ${PAGE.margin};
          background-image: repeating-linear-gradient(to bottom, transparent 0, transparent ${PAGE.heightPx - 1}px, #d4d4d8 ${PAGE.heightPx - 1}px, #d4d4d8 ${PAGE.heightPx}px); }
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
