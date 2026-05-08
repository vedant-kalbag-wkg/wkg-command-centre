// Phase 8 Plan 08-01 — Brand tokens consumed by every react-email template.
// Hex values verbatim from ~/.claude/weknow-brand-guidelines.md (CLAUDE.md
// pins these as global rules for any We Know Group project). Inline-style
// only — Gmail strips <style> blocks (Pitfall 4 in 08-RESEARCH.md).
export const BRAND = {
  azure: "#00A6D3",
  graphite: "#121212",
  white: "#FFFFFF",
  fontStack:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  productName: "WeKnow Command Centre",
  prodUrl: "https://wkg-command-centre.vercel.app",
} as const;
