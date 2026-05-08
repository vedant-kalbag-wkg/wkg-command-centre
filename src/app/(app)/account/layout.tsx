// Phase 8 Plan 08-02 — Thin (app)/account/* shell (D-12).
//
// Intentionally minimal: no tabs, no sidebar nav, no session-gate. The parent
// `(app)/layout.tsx` already redirects unauthenticated requests to /login and
// wraps children in <AppShellV2>. Duplicating either here would either
// double-render the shell or introduce a redundant auth round-trip.
//
// Future tabs (e.g. /account/notifications in Phase 9) land here; do NOT add
// them speculatively before the route exists.
export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="max-w-2xl mx-auto py-8 px-4">{children}</div>;
}
