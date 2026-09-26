/**
 * Lever: one public application form, no sign-in. Postings come from Lever's public postings API.
 *
 *   https://jobs.lever.co/<company>/<posting id>[/apply]      (jobs.eu.lever.co for EU accounts)
 */

import { openRequiredFields } from "../apply/guards.ts";
import { HTTP_TIMEOUT_MS } from "../config.ts";
import { htmlToText } from "../lib/html.ts";
import { Job } from "../schemas/index.ts";
import { type JobBoard, JobNotFound, NotAJobURL } from "./types.ts";

const HOST = /^jobs\.(eu\.)?lever\.co$/i;
const POSTING_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LeverJobURL {
  company: string; // e.g. "brillio-2"
  postingId: string;
  jobUrl: string;
  applyUrl: string;
  apiUrl: string;
}

export function parseLeverUrl(input: string): LeverJobURL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new NotAJobURL(`Not a URL: ${input}`);
  }
  const host = HOST.exec(url.hostname);
  const [company, postingId] = url.pathname.split("/").filter(Boolean);
  if (!host || !company || !postingId || !POSTING_ID.test(postingId)) {
    throw new NotAJobURL(`Not a Lever job posting (expected jobs.lever.co/<company>/<posting id>): ${input}`);
  }
  const eu = host[1] ? "eu." : "";
  const jobUrl = `https://jobs.${eu}lever.co/${company}/${postingId}`;
  return {
    company,
    postingId,
    jobUrl,
    applyUrl: `${jobUrl}/apply`,
    apiUrl: `https://api.${eu}lever.co/v0/postings/${company}/${postingId}?mode=json`,
  };
}

// The parts of Lever's posting we use.
export interface LeverPosting {
  id: string;
  text: string;
  hostedUrl?: string;
  applyUrl?: string;
  categories?: { location?: string; allLocations?: string[]; commitment?: string; team?: string };
  descriptionPlain?: string;
  lists?: { text: string; content: string }[];
  additionalPlain?: string;
}

export async function fetchLeverJob(input: string): Promise<Job> {
  const url = parseLeverUrl(input);
  const response = await fetch(url.apiUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (response.status === 404) throw new JobNotFound(`No Lever posting at ${url.jobUrl}`);
  if (!response.ok) throw new Error(`Lever returned ${response.status} for ${url.apiUrl}`);
  return jobFromLever(url, (await response.json()) as LeverPosting);
}

/** Map Lever's JSON to our Job. Kept separate from fetchLeverJob so it can be tested offline. */
export function jobFromLever(url: LeverJobURL, p: LeverPosting): Job {
  const location = p.categories?.location ?? "";
  const description = [
    p.descriptionPlain?.trim(),
    ...(p.lists ?? []).map((l) => `${l.text}\n${htmlToText(l.content)}`),
    p.additionalPlain?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n");
  return Job.parse({
    board: "lever",
    url: p.hostedUrl ?? url.jobUrl,
    applyUrl: p.applyUrl ?? url.applyUrl,
    tenant: url.company,
    reqId: p.id,
    title: p.text,
    company: companyName(url.company),
    location,
    otherLocations: (p.categories?.allLocations ?? []).filter((l) => l !== location),
    timeType: p.categories?.commitment ?? null,
    canApply: true,
    description,
  });
}

/** "brillio-2" -> "Brillio", "acme-corp" -> "Acme Corp": the posting API has no display name. */
export const companyName = (slug: string) =>
  slug
    .replace(/-\d+$/, "")
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

const isSubmit = (label: string) => /^submit( application)?$/i.test(label.trim());

export const lever: JobBoard = {
  id: "lever",
  name: "Lever",
  owns: (url) => HOST.test(url.hostname),
  fetchJob: fetchLeverJob,
  startUrl: (job) => job.applyUrl ?? `${job.url}/apply`,
  needsLogin: false,
  goal: `This is Lever: one application form on a single page, with no sign-in.
- Never use "Apply with LinkedIn" or any other "apply with" button.
- Current location: type the candidate's city and country, then pick the matching suggestion if a list appears.
- Optional survey questions (age range, gender, ethnicity, veteran or disability status): answer only if the
  candidate facts contain the answer; otherwise leave them empty.
- When every required field is filled and the resume is attached, choose AT_REVIEW. Only the candidate presses
  "Submit application".`,
  // Complete: the Submit button is there, every required field is filled, and the page shows no errors.
  formComplete: (page) =>
    page.fields.some((f) => f.kind === "button" && isSubmit(f.label)) &&
    openRequiredFields(page).length === 0 &&
    page.errors.length === 0,
  submitButtons: (page) => page.fields.filter((f) => f.kind === "button" && !f.disabled && isSubmit(f.label)),
  submitted: (url) => /\/thanks\/?(\?|$)/.test(new URL(url).pathname + new URL(url).search),
};
