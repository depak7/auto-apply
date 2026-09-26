/** Comparing company names as people write them. */

// Words that say nothing about which company it is.
const LEGAL =
  /\b(private|pvt|limited|ltd|inc|incorporated|llc|llp|corp|corporation|co|company|gmbh|plc|india|solutions|technologies|technology|software|services|systems|group|global|international)\b/g;
const companyCore = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(LEGAL, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "KaptureCX" vs "Kapture CX Pvt Ltd" -> same; "LNW India Solutions Private Limited" vs "lnw" -> same. */
export function sameCompany(a: string, b: string): boolean {
  const x = companyCore(a);
  const y = companyCore(b);
  if (!x || !y) return false;
  const squash = (s: string) => s.replace(/\s+/g, "");
  return x === y || squash(x) === squash(y) || squash(x).startsWith(squash(y)) || squash(y).startsWith(squash(x));
}
