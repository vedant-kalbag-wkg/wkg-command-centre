// Phase 8 Plan 08-01 — Brand tokens consumed by every react-email template.
// Hex values verbatim from ~/.claude/weknow-brand-guidelines.md (CLAUDE.md
// pins these as global rules for any We Know Group project). Inline-style
// only — Gmail strips <style> blocks (Pitfall 4 in 08-RESEARCH.md).
//
// The wordmark used in email headers is "WeKnow" in Bold (Brand-Bold rule
// of -10 kerning translated to -0.04em letter-spacing) paired with an
// Azure period accent — the same lockup pattern the brand uses in print
// when the wink brandmark image asset isn't available.
export const BRAND = {
  azure: "#00A6D3",
  graphite: "#121212",
  white: "#FFFFFF",
  // Azure tints — brand guidelines: 20% increments only.
  azure80: "#33B8DC",
  azure60: "#66CAE5",
  azure40: "#99DBED",
  azure20: "#CCEDF6",
  // Utility neutrals — body copy / dividers / muted footer text.
  textPrimary: "#121212",
  textSecondary: "#3F3F3F",
  textMuted: "#6B7280",
  divider: "#E5E7EB",
  surfaceMuted: "#F7F9FA",
  fontStack:
    'Circular, "CircularXX", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  productName: "WeKnow Command Centre",
  // Footer link for every transactional template. Always points at the prod
  // alias — preview-sent emails carry the production-branded footer by
  // design (recipients see one canonical surface, regardless of which
  // deploy issued the email). Switch to a per-environment value here only
  // if a future template starts deep-linking to environment-specific URLs.
  prodUrl: "https://wkg-command-centre.vercel.app",
  legalLine: "© WeKnow Group · Confidential, internal use only",
} as const;
