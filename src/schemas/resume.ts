/**
 * A parsed resume. Field descriptions are sent to the model as extraction instructions, and
 * text is kept verbatim so later rewrites start from what the candidate actually wrote.
 *
 * The structure mirrors the document (section titles and order, skill groups, links with their
 * real URLs, bold phrases), so the tailored resume is rendered the way the candidate laid it out.
 * Fields added over time have defaults, so resumes stored before them still load.
 */

import { z } from "zod";

export const Link = z.object({
  label: z.string().describe('The visible text, e.g. "LinkedIn", "GitHub", "Live", "janedoe.dev"'),
  url: z.string().describe("The real address, from the PDF's list of links (not the visible text)"),
});
export type Link = z.infer<typeof Link>;

/** Phrases printed in bold inside an entry's bullets. Bullet text itself stays plain. */
const Bold = z
  .array(z.string())
  .default([])
  .describe("Every phrase printed in bold inside these bullets, copied exactly (a word or a few words)");

const Experience = z.object({
  company: z.string(),
  title: z.string(),
  tech: z
    .string()
    .nullable()
    .default(null)
    .describe('Technologies listed beside the title, e.g. "Java, Spring Boot, Kafka" (without brackets)'),
  location: z.string().nullable(),
  start: z.string().describe('Start date as written, e.g. "Jan 2022" or "2022"'),
  end: z.string().nullable().describe('End date as written; null if current ("Present")'),
  bullets: z.array(z.string()).describe("Each bullet point, copied word for word"),
  bold: Bold,
});

const Education = z.object({
  school: z.string(),
  degree: z.string().nullable().describe('e.g. "B.Tech", "Bachelor of Engineering"'),
  field: z.string().nullable().describe('e.g. "Computer Science"'),
  location: z.string().nullable().default(null),
  start: z.string().nullable(),
  end: z.string().nullable(),
  details: z.array(z.string()).describe("GPA, honours, coursework lines, as written"),
});

const Project = z.object({
  name: z.string().describe('The project line before its links, e.g. "Actbrow – Production AI Agent Platform"'),
  links: z.array(Link).default([]).describe('Links shown with the project, e.g. "Live", "GitHub"'),
  url: z.string().nullable().default(null).describe("Leave null: use links"), // from before `links`
  bullets: z.array(z.string()),
  bold: Bold,
});

const SkillGroup = z.object({
  label: z.string().nullable().describe('The group\'s label as written, e.g. "Languages"; null for a plain list'),
  items: z.array(z.string()).describe("One skill per item, as written"),
});

/** An entry of any other section (achievements, publications, volunteering...). */
const Entry = z.object({
  heading: z.string().nullable().describe("The entry's first line, if it has one (e.g. an award or role)"),
  subheading: z.string().nullable(),
  date: z.string().nullable(),
  location: z.string().nullable(),
  bullets: z.array(z.string()).describe("Each bullet point, copied word for word"),
  bold: Bold,
});

const Section = z.object({
  title: z.string().describe('The heading exactly as written, e.g. "Achievements & Open Source"'),
  entries: z.array(Entry),
});

export const SECTION_KINDS = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
  "certifications",
  "other",
] as const;

const LayoutItem = z.object({
  kind: z.enum(SECTION_KINDS),
  title: z.string().describe('The heading exactly as written, e.g. "Technical Skills"'),
});

export const Resume = z.object({
  name: z.string(),
  headline: z
    .string()
    .nullable()
    .default(null)
    .describe('The line under the name, e.g. "Software Engineer — Distributed Systems"'),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  contactLinks: z.array(Link).default([]).describe("Links in the header (LinkedIn, GitHub, portfolio); not the email"),
  links: z.array(z.string()).describe("Header link URLs (derived from contactLinks)"),
  summary: z.string().nullable().describe("Summary/objective paragraph, if any"),
  skillGroups: z.array(SkillGroup).default([]).describe("The skills section, group by group, as laid out"),
  skills: z.array(z.string()).describe("Every skill, one per item (derived from skillGroups)"),
  experience: z.array(Experience).describe("Most recent first, as in the resume"),
  education: z.array(Education),
  projects: z.array(Project).describe("Only entries under a Projects heading"),
  certifications: z.array(z.string()),
  sections: z
    .array(Section)
    .default([])
    .describe(
      "Sections other than summary, skills, experience, projects, education and certifications " +
        '(e.g. "Achievements & Open Source", "Publications"), each with its own title. Never merge them into projects.',
    ),
  page: z.enum(["a4", "letter"]).default("a4").describe("Paper size of the uploaded PDF (read by code)"),
  layout: z
    .array(LayoutItem)
    .default([])
    .describe('Every section heading in the order it appears; kind "other" for a section in `sections`'),
});
export type Resume = z.infer<typeof Resume>;
