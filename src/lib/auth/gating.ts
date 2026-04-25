/**
 * Returns true if an authenticated user with the given userType
 * should be gated (redirected) on the given pathname.
 *
 * Rule: external users may ONLY access /portal/**, auth routes (/login,
 * /reset-password, /set-password, /api/auth/*), and root (/ — which the
 * auth redirect handles separately).
 *
 * Anything else is gated; middleware should redirect to
 * /portal/coming-soon while the portal is feature-paused
 * (archive/portal-lockdown-2026-04-25). When the portal is revived, this
 * destination flips back to /portal/analytics/portfolio.
 *
 * Internal users are never gated by this helper.
 */
export function shouldGateExternalUser(
  userType: "internal" | "external" | undefined,
  pathname: string,
): boolean {
  if (userType !== "external") return false;

  const allowedPrefixes = [
    "/portal/",
    "/login",
    "/reset-password",
    "/set-password",
    "/api/auth/",
  ];

  if (pathname === "/") return false;
  if (pathname === "/portal") return false; // /portal exact match redirects elsewhere, not gated here

  const isAllowed = allowedPrefixes.some((prefix) =>
    prefix.endsWith("/")
      ? pathname.startsWith(prefix)
      : pathname === prefix || pathname.startsWith(prefix + "/"),
  );

  return !isAllowed;
}
