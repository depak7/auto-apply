/** Normalizing personal details the way application forms expect them. */

/** "DEEPAK" -> "Deepak" (forms warn about all-caps names). Leaves "S", "McDonald", "O'Brien" alone. */
export function nameCase(word: string): string {
  if (word.length < 2 || word !== word.toUpperCase()) return word;
  return word.charAt(0) + word.slice(1).toLowerCase();
}

/**
 * "+91-9876543210" -> { code: "+91", number: "9876543210" }. Uses the profile's code when given;
 * otherwise reads it from a "+CC" prefix. The number is digits only.
 */
export function splitPhone(
  raw: string | null,
  profileCode: string | null,
): { code: string | null; number: string | null } {
  if (!raw) return { code: profileCode, number: null };
  const text = raw.trim();
  const code =
    profileCode ??
    /^\+(\d{1,3})[\s.-]/
      .exec(text)?.[0]
      .trim()
      .replace(/[\s.-]$/, "") ??
    null;
  let digits = text.replace(/\D/g, "");
  const codeDigits = code?.replace(/\D/g, "");
  if (codeDigits && digits.startsWith(codeDigits) && text.trim().startsWith("+"))
    digits = digits.slice(codeDigits.length);
  return { code, number: digits || null };
}
