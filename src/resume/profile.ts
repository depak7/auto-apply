/**
 * Resume -> profile: copy the contact details a resume has into the profile's empty fields.
 * Fields the user already filled in are never overwritten.
 */

import { nameCase, splitPhone } from "../lib/person.ts";
import type { Profile, Resume } from "../schemas/index.ts";

export function fillProfileFromResume(profile: Profile, resume: Resume): Profile {
  const [first, ...rest] = resume.name.trim().split(/\s+/).map(nameCase);
  const phone = splitPhone(resume.phone, null);
  const place = parseLocation(resume.location);
  const address = profile.address;
  return {
    ...profile,
    firstName: profile.firstName ?? (first || null),
    lastName: profile.lastName ?? (rest.join(" ") || null),
    email: profile.email ?? resume.email,
    phone: profile.phone ?? phone.number,
    phoneCountryCode: profile.phoneCountryCode ?? phone.code,
    address: {
      ...address,
      city: address.city ?? place.city,
      state: address.state ?? place.state,
      country: address.country ?? place.country,
    },
    links: profile.links.length ? profile.links : resume.links,
  };
}

/**
 * "Bengaluru, Karnataka, India" -> city, state, country. "Pune, India" -> city, country.
 * "Austin, TX" -> city, state (a two-letter second part is a state code, not a country).
 */
export function parseLocation(location: string | null): {
  city: string | null;
  state: string | null;
  country: string | null;
} {
  const parts = (location ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 3) return { city: parts[0]!, state: parts[1]!, country: parts.at(-1)! };
  if (parts.length === 2) {
    const second = parts[1]!;
    return /^[A-Z]{2}$/.test(second)
      ? { city: parts[0]!, state: second, country: null }
      : { city: parts[0]!, state: null, country: second };
  }
  return { city: parts[0] ?? null, state: null, country: null };
}
