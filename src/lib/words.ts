/** Lowercased words of a text, keeping characters that belong to tech names (C++, C#, Node.js, e-mail). */
export const words = (text: string): string[] => text.toLowerCase().match(/[\p{L}\p{N}+#.-]+/gu) ?? [];
