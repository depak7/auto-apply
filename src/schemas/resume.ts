/**
 * A parsed resume. Field descriptions are sent to the model as extraction instructions, and
 * text is kept verbatim so later rewrites start from what the candidate actually wrote.
 */

import { z } from "zod";

const Experience = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  start: z.string().describe('Start date as written, e.g. "Jan 2022" or "2022"'),
  end: z.string().nullable().describe('End date as written; null if current ("Present")'),
  bullets: z.array(z.string()).describe("Each bullet point, copied word for word"),
});

const Education = z.object({
  school: z.string(),
  degree: z.string().nullable().describe('e.g. "B.Tech", "MS"'),
  field: z.string().nullable().describe('e.g. "Computer Science"'),
  start: z.string().nullable(),
  end: z.string().nullable(),
  details: z.array(z.string()).describe("GPA, honours, coursework lines, as written"),
});

const Project = z.object({
  name: z.string(),
  url: z.string().nullable(),
  bullets: z.array(z.string()),
});

export const Resume = z.object({
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(z.string()).describe("LinkedIn, GitHub, portfolio URLs"),
  summary: z.string().nullable().describe("Summary/objective paragraph, if any"),
  experience: z.array(Experience).describe("Most recent first, as in the resume"),
  education: z.array(Education),
  projects: z.array(Project),
  skills: z.array(z.string()).describe("One skill per item, e.g. ['Python', 'Kubernetes']"),
  certifications: z.array(z.string()),
});
export type Resume = z.infer<typeof Resume>;
