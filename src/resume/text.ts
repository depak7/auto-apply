import type { Resume } from "../schemas/index.ts";

/**
 * The resume as compact plain text, for models that judge it (Jev) or rewrite it.
 * Contact details are left out: they say nothing about fit, and Jev works best on
 * small state without irrelevant detail.
 */
export function resumeToText(r: Resume): string {
  const lines: string[] = [];
  if (r.summary) lines.push("SUMMARY", r.summary, "");
  lines.push("EXPERIENCE");
  for (const e of r.experience) {
    lines.push(`${e.title} at ${e.company} (${e.start} to ${e.end ?? "present"})${e.tech ? ` [${e.tech}]` : ""}`);
    lines.push(...e.bullets.map((b) => `- ${b}`));
  }
  if (r.projects.length) {
    lines.push("", "PROJECTS");
    for (const p of r.projects) lines.push(p.name, ...p.bullets.map((b) => `- ${b}`));
  }
  for (const section of r.sections) {
    lines.push("", section.title.toUpperCase());
    for (const e of section.entries) {
      const head = [e.heading, e.subheading, e.date].filter(Boolean).join(", ");
      if (head) lines.push(head);
      lines.push(...e.bullets.map((b) => `- ${b}`));
    }
  }
  lines.push("", "EDUCATION");
  for (const ed of r.education) {
    lines.push([ed.degree, ed.field, ed.school, ed.end].filter(Boolean).join(", "), ...ed.details.map((d) => `- ${d}`));
  }
  lines.push("", "SKILLS");
  if (r.skillGroups.length) {
    for (const g of r.skillGroups) lines.push(`${g.label ? `${g.label}: ` : ""}${g.items.join(", ")}`);
  } else lines.push(r.skills.join(", "));
  if (r.certifications.length) lines.push("", "CERTIFICATIONS", ...r.certifications);
  return lines.join("\n");
}
