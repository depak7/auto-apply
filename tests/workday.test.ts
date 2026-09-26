import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { jobFromResponse, NotWorkdayURL, parseWorkdayUrl } from "../src/workday/posting.ts";

const JOB = "US-CA-Santa-Clara/Senior-HPC-Storage-Engineer_JR2014997";
const BASE = "https://nvidia.wd5.myworkdayjobs.com";

describe("parseWorkdayUrl", () => {
  it.each([
    `${BASE}/NVIDIAExternalCareerSite/job/${JOB}`,
    `${BASE}/en-US/NVIDIAExternalCareerSite/job/${JOB}`,
    `${BASE}/en-US/NVIDIAExternalCareerSite/job/${JOB}/apply/applyManually`,
    `${BASE}/NVIDIAExternalCareerSite/job/${JOB}?source=linkedin`,
    `  ${BASE}/NVIDIAExternalCareerSite/job/${JOB}  `,
  ])("parses %s", (url) => {
    const job = parseWorkdayUrl(url);
    expect(job.tenant).toBe("nvidia");
    expect(job.site).toBe("NVIDIAExternalCareerSite");
    expect(job.jobPath).toBe(JOB);
    expect(job.jobUrl).toBe(`${BASE}/NVIDIAExternalCareerSite/job/${JOB}`);
    expect(job.apiUrl).toBe(`${BASE}/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/${JOB}`);
  });

  it.each([
    "https://boards.greenhouse.io/acme/jobs/123",
    `${BASE}/NVIDIAExternalCareerSite`, // site, no job
    `${BASE}/NVIDIAExternalCareerSite/job/`,
    "https://evil.com/nvidia.wd5.myworkdayjobs.com/x/job/y",
    "ftp://nvidia.wd5.myworkdayjobs.com/x/job/y",
    "not a url",
  ])("rejects %s", (url) => {
    expect(() => parseWorkdayUrl(url)).toThrow(NotWorkdayURL);
  });
});

describe("jobFromResponse", () => {
  it("maps a real Workday response", () => {
    const data = JSON.parse(readFileSync(new URL("./fixtures/workday_job_nvidia.json", import.meta.url), "utf8"));
    const job = jobFromResponse(parseWorkdayUrl(`${BASE}/NVIDIAExternalCareerSite/job/${JOB}`), data);

    expect(job.title).toBe("Senior HPC Storage Engineer");
    expect(job.reqId).toBe("JR2014997");
    expect(job.company).toBe("NVIDIA USA"); // "2100 " prefix stripped
    expect(job.location).toBe("US, CA, Santa Clara");
    expect(job.otherLocations).toEqual(["US, TX, Austin"]);
    expect(job.canApply).toBe(true);
    expect(job.description).not.toContain("<"); // HTML removed
    expect(job.description).toContain("\n- Research and analyze"); // bullet text stays on its "- " line
  });
});
