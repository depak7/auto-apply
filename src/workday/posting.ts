/**
 * Workday job URLs: recognise them, pull out their parts, and fetch the posting.
 *
 * A Workday job URL looks like:
 *   https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-HPC-Storage-Engineer_JR2014997
 *           └tenant┘└dc┘                 └locale┘└──────── site ────────┘    └──────────────── jobPath ────────────────┘
 *
 * The locale segment is optional. Everything after /job/ identifies the posting.
 */

import { HTTP_TIMEOUT_MS } from "../config.ts";
import { htmlToText } from "../lib/html.ts";
import { Job } from "../schemas/index.ts";

const HOST_RE = /^(?<tenant>[a-z0-9-]+)\.(?<dc>wd\d+)\.myworkdayjobs\.com$/i;
const LOCALE_RE = /^[a-z]{2}-[A-Z]{2}$/;

/** The URL is not a Workday job posting. */
export class NotWorkdayURL extends Error {}

/** Workday has no posting at this URL (removed, or a typo). */
export class JobNotFound extends Error {}

export interface WorkdayJobURL {
  tenant: string; // company id, e.g. "nvidia"
  host: string; // e.g. "nvidia.wd5.myworkdayjobs.com"
  site: string; // career site, e.g. "NVIDIAExternalCareerSite"
  jobPath: string; // e.g. "US-CA-Santa-Clara/Senior-HPC-Storage-Engineer_JR2014997"
  jobUrl: string; // public job page (no locale, so Workday picks the default)
  applyUrl: string; // application form, same as clicking Apply
  apiUrl: string; // public JSON endpoint with title, description, location
}

export function parseWorkdayUrl(input: string): WorkdayJobURL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new NotWorkdayURL(`Not a URL: ${input}`);
  }
  const host = url.hostname.toLowerCase();
  const hostMatch = HOST_RE.exec(host);
  if (!["http:", "https:"].includes(url.protocol) || !hostMatch?.groups) {
    throw new NotWorkdayURL(`Not a Workday URL (expected *.wdN.myworkdayjobs.com): ${input}`);
  }

  let parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] && LOCALE_RE.test(parts[0])) parts = parts.slice(1);

  // Expect: <site>/job/<at least one segment>. Drop a trailing /apply... if present.
  const [site, jobKeyword, ...rest] = parts;
  if (!site || jobKeyword !== "job") {
    throw new NotWorkdayURL(`Not a Workday job posting (expected /<site>/job/...): ${input}`);
  }
  const applyAt = rest.indexOf("apply");
  const jobParts = applyAt === -1 ? rest : rest.slice(0, applyAt);
  if (jobParts.length === 0) throw new NotWorkdayURL(`Workday URL has no job id: ${input}`);

  const tenant = hostMatch.groups.tenant!.toLowerCase();
  const jobPath = jobParts.join("/");
  const jobUrl = `https://${host}/${site}/job/${jobPath}`;
  return {
    tenant,
    host,
    site,
    jobPath,
    jobUrl,
    applyUrl: `${jobUrl}/apply`,
    apiUrl: `https://${host}/wday/cxs/${tenant}/${site}/job/${jobPath}`,
  };
}

/** Validate a Workday URL and fetch the posting from Workday's public JSON endpoint. */
export async function fetchJob(input: string): Promise<Job> {
  const jobUrl = parseWorkdayUrl(input);
  const response = await fetch(jobUrl.apiUrl, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (response.status === 404) throw new JobNotFound(`No Workday posting at ${jobUrl.jobUrl}`);
  if (!response.ok) throw new Error(`Workday returned ${response.status} for ${jobUrl.apiUrl}`);
  return jobFromResponse(jobUrl, await response.json());
}

// The parts of Workday's response we use.
interface WorkdayJobResponse {
  jobPostingInfo: {
    title: string;
    jobDescription?: string;
    location?: string;
    additionalLocations?: string[];
    timeType?: string;
    jobReqId?: string;
    canApply?: boolean;
    externalUrl?: string;
  };
  hiringOrganization?: { name?: string };
}

/** Map Workday's JSON to our Job. Kept separate from fetchJob so it can be tested offline. */
export function jobFromResponse(jobUrl: WorkdayJobURL, data: WorkdayJobResponse): Job {
  const info = data.jobPostingInfo;
  return Job.parse({
    url: info.externalUrl || jobUrl.jobUrl,
    tenant: jobUrl.tenant,
    reqId: info.jobReqId ?? "",
    title: info.title,
    company: companyName(data, jobUrl.tenant),
    location: info.location ?? "",
    otherLocations: info.additionalLocations ?? [],
    timeType: info.timeType ?? null,
    canApply: info.canApply ?? false,
    description: htmlToText(info.jobDescription ?? ""),
  });
}

function companyName(data: WorkdayJobResponse, tenant: string): string {
  // Workday gives the legal entity, often with an internal code in front: "2100 NVIDIA USA".
  const name = (data.hiringOrganization?.name ?? "").replace(/^\d+\s+/, "").trim();
  return name || tenant.charAt(0).toUpperCase() + tenant.slice(1);
}
