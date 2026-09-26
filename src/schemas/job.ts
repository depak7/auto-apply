/** A Workday job posting, as fetched from the public jobs API. */

import { z } from "zod";

export const Job = z.object({
  url: z.string(), // canonical job page URL
  tenant: z.string(), // Workday tenant, e.g. "nvidia"
  reqId: z.string(), // e.g. "JR2014997"
  title: z.string(),
  company: z.string(),
  location: z.string(), // primary location, e.g. "US, CA, Santa Clara"
  otherLocations: z.array(z.string()),
  timeType: z.string().nullable(), // e.g. "Full time"
  canApply: z.boolean(), // false when the posting is closed
  description: z.string(), // plain text, bullets kept as "- "
});
export type Job = z.infer<typeof Job>;
