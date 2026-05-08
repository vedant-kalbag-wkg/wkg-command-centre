// Canonical name normalisation used to detect same-name location collisions
// across regions. Identity rule: Phase 7 collapses N hotels with the same
// normalised name into a single canonical location, so the function must be
// stable, deterministic, and applied identically wherever names are compared.
//
// Rules (must match scripts/probe-monday-vs-db-addresses.ts T1 regex):
//   1. trim leading/trailing whitespace
//   2. lowercase (Unicode-aware)
//   3. strip every character that is not a Unicode letter, Unicode digit, or
//      whitespace — punctuation, symbols, dashes, ampersands, etc. all go
//   4. collapse runs of whitespace into a single space
export function normaliseName(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ");
}
