/**
 * Fetches a Workday job posting and prints it.
 *
 *   npm run tool:fetch-job -- "<workday job url>"
 *   npm run tool:fetch-job -- "<workday job url>" --json
 */

import { parseArgs } from "node:util";

import { fetchJob, JobNotFound, NotWorkdayURL } from "../src/workday/posting.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { json: { type: "boolean", default: false } },
});
const [url] = positionals;
if (!url) throw new Error('usage: npm run tool:fetch-job -- "<workday job url>" [--json]');

try {
  const job = await fetchJob(url);
  if (values.json) {
    console.log(JSON.stringify(job, null, 2));
  } else {
    const others = job.otherLocations.length ? ` (+${job.otherLocations.join(", ")})` : "";
    console.log(`${job.title}  (${job.reqId})`);
    console.log(`${job.company} · ${job.location}${others}`);
    console.log(`${job.timeType ?? ""} · ${job.canApply ? "OPEN" : "CLOSED: cannot apply"}`);
    console.log(`${job.url}\n`);
    console.log(job.description);
  }
} catch (e) {
  if (e instanceof NotWorkdayURL || e instanceof JobNotFound) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
  throw e;
}
