/**
 * The candidate facts the agent may use, as one small object: the only source of truth for
 * what gets typed into a form. Nothing outside this object may be claimed.
 */

import { sameCompany } from "../lib/company.ts";
import { nameCase, splitPhone } from "../lib/person.ts";
import { isOngoing } from "../lib/words.ts";
import type { Profile, Resume } from "../schemas/index.ts";

export type Facts = ReturnType<typeof buildFacts>;

/** The company being applied to: its display name and its Workday tenant (e.g. "LNW India Solutions…", "lnw"). */
export interface ApplyingTo {
  company: string;
  tenant?: string;
}

export function buildFacts(
  resume: Resume | null,
  profile: Profile,
  email: string,
  applyingTo: ApplyingTo | null = null,
) {
  const employers = [...new Set(resume?.experience.map((e) => e.company) ?? [])];
  const workedThere = applyingTo
    ? employers.some(
        (e) => sameCompany(e, applyingTo.company) || (!!applyingTo.tenant && sameCompany(e, applyingTo.tenant)),
      )
    : null;
  const [first, ...rest] = (resume?.name ?? "").trim().split(/\s+/).map(nameCase);
  const latest = resume?.experience[0];
  const phone = splitPhone(profile.phone ?? resume?.phone ?? null, profile.phoneCountryCode);
  // Keys use the words forms use ("given name", "family name"): Jev matches labels literally.
  return {
    given_name_first_name: profile.firstName ?? (first || null),
    family_name_last_name_surname: profile.lastName ?? (rest.join(" ") || null),
    email,
    // Jev must know a password exists, but never sees it: code types it (see values.ts).
    password: "(available: typed by the system into password fields)",
    // Codes Workday emails during sign-in: the system asks the candidate and types it.
    verification_code: "(available: the system asks the candidate and types it into verification code fields)",
    phone_number: phone.number, // national number, digits only: forms ask for the code separately
    phone_country_code: phone.code, // e.g. "+91"
    address: profile.address,
    links: profile.links.length ? profile.links : (resume?.links ?? []),
    current_title: latest?.title ?? null,
    current_company: latest && isOngoing(latest.end) ? latest.company : null,
    skills: resume?.skills ?? [],
    education: resume?.education.map((e) => [e.degree, e.field, e.school, e.end].filter(Boolean).join(", ")) ?? [],
    // "Have you worked for us / our affiliates before?": answered from the resume's employers.
    past_employers: employers,
    applying_to: applyingTo?.company ?? null,
    has_worked_at_applying_company: workedThere === null ? null : workedThere ? "Yes" : "No",
    answers: profile.answers,
  };
}
