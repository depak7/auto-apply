// Workday data reads like a database. Make it read like a person wrote it.

/** "Senior Java Developer (Kafka)_6-10 Yrs_Pune" -> "Senior Java Developer (Kafka) · 6-10 Yrs · Pune" */
export const prettyTitle = (title: string | null) => (title ? title.replace(/\s*_\s*/g, " · ").trim() : null);

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])\p{L}/gu, (m) => m.toUpperCase());

/** "PUNE, , INDIA" -> "Pune, India"; leaves "US, CA, Santa Clara" alone except empty parts. */
export function prettyLocation(location: string | null): string | null {
  if (!location) return null;
  const parts = location
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => (p === p.toUpperCase() && p.length > 3 ? titleCase(p) : p)).join(", ");
}

/** "DEEPAK S" -> "Deepak S" (all-caps names only). */
export const prettyName = (name: string) => (name === name.toUpperCase() ? titleCase(name) : name);
