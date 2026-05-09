import { ChangePasswordForm } from "./change-password-form";

// Phase 8 Plan 08-02 — Self-serve change-password page (EMAIL-02 SC2).
// Server Component, no data-fetching needed (form state is purely client-side).
// Heading kerning matches the project's existing convention (`tracking-[-0.01em]`)
// per PATTERNS § Pattern 4.
export default function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-[-0.01em] text-foreground">
        Security
      </h1>
      <ChangePasswordForm />
    </div>
  );
}
