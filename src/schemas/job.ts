/** A job posting, as fetched from its board's public API (Workday, Lever). */

import { z } from "zod";

export const Job = z.object({
  board: z.enum(["workday", "lever"]).default("workday"), // where it's posted; jobs saved before Lever are Workday
  url: z.string(), // canonical job page URL
  applyUrl: z.string().nullable().default(null), // the application form, when it has its own URL (Lever)
  tenant: z.string(), // the company's id on the board, e.g. Workday "nvidia", Lever "brillio-2"
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
