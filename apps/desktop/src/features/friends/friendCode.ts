/** "luft", "lf-luft " or "LF-LUFT" all mean LF-LUFT; the server only takes the full form. */
export function normalizeFriendCode(input: string): string {
  const code = input.replace(/\s+/g, "").toUpperCase();
  return !code || code.startsWith("LF-") ? code : `LF-${code}`;
}
