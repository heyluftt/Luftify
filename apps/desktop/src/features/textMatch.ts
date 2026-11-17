/** Case-, accent- and spacing-insensitive form for comparing names. */
export function matchKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether every word of `query` occurs in one of `fields`. */
export function matchesEveryWord(query: string, ...fields: (string | undefined)[]): boolean {
  const words = matchKey(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = fields.filter(Boolean).map((field) => matchKey(field!)).join(" ");
  return words.every((word) => haystack.includes(word));
}
