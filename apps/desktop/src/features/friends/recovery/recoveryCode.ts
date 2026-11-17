/** The recovery code as people type it: 20 characters, groups of four. */
const ALPHABET = /^[A-HJ-NP-Z2-9]{20}$/;

export function normalizeRecoveryCode(input: string): string | null {
  const plain = input.replace(/[\s-]/g, "").toUpperCase();
  return ALPHABET.test(plain) ? plain.match(/.{4}/g)!.join("-") : null;
}
