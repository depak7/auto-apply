/**
 * Candidate details that application forms ask for and resumes don't contain.
 * A null field is asked of the user rather than guessed.
 */

import { z } from "zod";

export const Profile = z.object({
  firstName: z.string().nullable(), // defaults to the first word of the resume name
  lastName: z.string().nullable(), // defaults to the rest of the resume name
  phone: z.string().nullable(), // e.g. "9000000000"
  phoneCountryCode: z.string().nullable(), // e.g. "+91"
  address: z.object({
    line1: z.string().nullable(),
    city: z.string().nullable(),
    state: z.string().nullable(),
    postalCode: z.string().nullable(),
    country: z.string().nullable(), // e.g. "India"
  }),
  // Answers to questions forms ask often, in the user's own words. Examples of keys:
  // "authorized to work", "needs sponsorship", "notice period", "current salary",
  // "desired salary", "how did you hear about us", "worked here before", "relatives working here".
  answers: z.record(z.string(), z.string()),
});
export type Profile = z.infer<typeof Profile>;

export const EMPTY_PROFILE: Profile = {
  firstName: null,
  lastName: null,
  phone: null,
  phoneCountryCode: null,
  address: { line1: null, city: null, state: null, postalCode: null, country: null },
  answers: {},
};
