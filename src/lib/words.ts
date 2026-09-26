/** Lowercased words of a text, keeping characters that belong to tech names (C++, C#, Node.js, e-mail). */
export const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}+#.-]+/gu) ?? [];

/** An end date that means "still here": "Present", "Current", "Now", "Till date", "Ongoing". */
export const isOngoing = (end: string | null | undefined) =>
  !end || /^(present|current(ly)?|now|ongoing|till date|to date|today)$/i.test(end.trim());
