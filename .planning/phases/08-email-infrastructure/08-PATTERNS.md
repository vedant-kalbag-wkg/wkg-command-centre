# Phase 8 — File Pattern Map

**Generated:** 2026-05-08
**Source:** `08-CONTEXT.md` (D-01..D-14), `08-RESEARCH.md` (Patterns 1–5, file inventory)
**Repo:** wkg-kiosk-tool (Next.js 15 App Router + Drizzle 0.45 + Better Auth 1.5.5 + Vercel)
**Files mapped:** 21 (CREATE 17, MODIFY 4) + 1 boundary file

---

## Conventions Summary

Five dominant patterns observed across the codebase that every new file in this phase must respect:

1. **Imports** — external first (alphabetised within group), blank line, then internal `@/...` aliases (alphabetised). Double-quoted strings throughout. See `src/components/auth/login-form.tsx:1-14`, `src/lib/auth.ts:1-6`.
2. **Forms** — `"use client"` + `react-hook-form` + `zod` + `@hookform/resolvers/zod` + `sonner` + shadcn primitives (`Button`/`Input`/`Label`) + `lucide-react` icons (`AlertCircle`, `Loader2`, optional `Eye`/`EyeOff`). The `mode: "onBlur", reValidateMode: "onChange"` resolver options are repeated verbatim in every form. See `src/components/auth/login-form.tsx`, `src/components/auth/reset-password-form.tsx`, `src/components/auth/set-password-form.tsx`.
3. **Server Actions** — `"use server"` directive at top, `import { z } from "zod/v4"` (note the `/v4` import path is the project convention, NOT plain `"zod"`), then `requireRole(...)` early in the function body. See `src/app/(app)/settings/users/actions.ts:1-22`.
4. **Drizzle schema** — single-file `src/db/schema.ts` (1,105 lines, do NOT split). Tables defined as `export const tableName = pgTable("snake_case_db_name", { camelCaseTsKey: type("snake_case_col") })`. uuid PKs use `.primaryKey().defaultRandom()`; timestamps use `timestamp("col", { withTimezone: true }).defaultNow().notNull()`. Composite/partial indexes go in the second arg `(t) => ({ ... })`. See `src/db/schema.ts:323-332` (locationMergeSnapshots — closest analog).
5. **SQL migrations** — hand-authored, idempotent (`IF NOT EXISTS`/`IF EXISTS`/`DO $$ ... EXCEPTION WHEN duplicate_object`), header doc-comment naming the phase + plan + deltas, and `── Delta N — short-name ──` separators. See `migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql`, `migrations/0040_phase_07_06_drop_locations_outlet_code.sql`.

---

## File Map

### CREATE: `src/emails/brand.ts`
- **Role:** Brand-token module (Azure / Graphite / font-stack / product name) consumed by every react-email template
- **Closest analog:** `~/.claude/weknow-brand-guidelines.md` (canonical hex values) + the inline-style hex literals already in `src/lib/email.ts:23-34` (color values to preserve verbatim) + the WK header repeated at `src/app/(auth)/login/page.tsx:13-15` (text-mark precedent)
- **Excerpt** — current hex literals to lift into tokens, from `src/lib/email.ts:23-30`:
  ```typescript
  // background gradient base
  // color: #121212 (Graphite)
  // color: #00A6D3 (Azure)
  // color: #fff (white)
  // font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
  ```
- **Conventions to preserve:** Export as `as const` object literal named `BRAND`. Hex casing matches CLAUDE.md global brand guidelines (`#00A6D3`, `#121212`, `#FFFFFF`). Do NOT introduce a CSS-in-JS layer; tokens are plain strings consumed by inline `style={{}}` attributes (Pitfall 4 in 08-RESEARCH).
- **Greenfield:** No prior `src/emails/` directory; defer skeleton to RESEARCH § Pattern 3.

---

### CREATE: `src/emails/_layout.tsx`
- **Role:** Shared base layout for all transactional templates (logo header + branded footer wrapper)
- **Closest analog:** Visual structure to reproduce comes from `src/lib/email.ts:23-34` (the soon-to-be-deleted `buildBrandedEmail` HTML); React-email primitive shapes from `@react-email/components` (no in-repo precedent). Login-page `WK` text-mark convention from `src/app/(auth)/login/page.tsx:13-15`.
- **Excerpt** — visual structure to mirror in JSX, from `src/lib/email.ts:23-34`:
  ```typescript
  return `
    <div style="font-family: ...; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
      <div style="margin-bottom: 32px;">
        <span style="font-size: 20px; font-weight: 700; color: #121212; letter-spacing: -0.01em;">WK</span>
      </div>
      <h1 style="font-size: 24px; font-weight: 600; color: #121212; ...">${heading}</h1>
      ...
    </div>
  `;
  ```
- **Conventions to preserve:** Preserve the 560px max-width container, 40px padding, WK text-mark header (matches login page parity). Inline `style={{}}` only (no `<style>` tags — Gmail strips them). Named export `EmailLayout({ children, preheader })`.
- **Greenfield:** No prior react-email layout; defer skeleton to RESEARCH § Pattern 3.

---

### CREATE: `src/emails/password-reset.tsx`
- **Role:** React-email template replacing the inline body in `sendPasswordResetEmail`
- **Closest analog:** Copy/heading/CTA shape from `src/lib/email.ts:37-56` (the function being replaced). Subject line `"Reset your password — WeKnow"` and body copy `"Click below to reset your password"` + footer `"This link expires in 1 hour..."` come straight from the existing helper.
- **Excerpt** — exact copy + CTA URL handling to preserve, from `src/lib/email.ts:44-55`:
  ```typescript
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@weknow.co",
    to,
    subject: "Reset your password — WeKnow",
    html: buildBrandedEmail({
      heading: "Reset your password",
      body: "<p>Click below to reset your password:</p>",
      ctaText: "Reset password",
      ctaUrl: resetUrl,
      footer: "This link expires in 1 hour. If you didn't request this, ignore this email.",
    }),
  });
  ```
- **Conventions to preserve:** Named export matching the import in research skeleton (`PasswordResetEmail`). Single prop `{ resetUrl }: { resetUrl: string }`. Preserves the existing copy verbatim — D-09 deletes the helper but does not change wording.

---

### CREATE: `src/emails/invite.tsx`
- **Role:** Internal-invite template (replaces `sendInviteEmail` body); separate from external invite per call-site distinction in `src/lib/auth.ts:17-23`
- **Closest analog:** `src/lib/email.ts:58-77` (current `sendInviteEmail`). RESEARCH § Recommended Project Structure splits internal vs external into TWO files (`invite.tsx` + `external-invite.tsx`); the planner should keep that split because `auth.ts:13-24` already branches on `isInvite && userType === "external"`.
- **Excerpt** — copy + subject to preserve, from `src/lib/email.ts:65-76`:
  ```typescript
  subject: "You're invited to WeKnow — Set your password",
  heading: "You're invited to WeKnow",
  body: "<p>You've been invited to the WeKnow Command Centre.</p><p>Click below to set your password and get started:</p>",
  ctaText: "Set your password",
  ctaUrl: resetUrl,
  footer: "This link expires in 1 hour.",
  ```
- **Conventions to preserve:** Named export `InviteEmail`. Prop `{ resetUrl }: { resetUrl: string }` — matches the existing function signature in `email.ts:58-64`.

---

### CREATE: `src/emails/external-invite.tsx`
- **Role:** External-portal invite template (replaces `sendExternalInviteEmail` body)
- **Closest analog:** `src/lib/email.ts:79-98` (current `sendExternalInviteEmail`). Different copy from internal invite — references "Analytics Portal" specifically.
- **Excerpt** — copy to preserve, from `src/lib/email.ts:86-95`:
  ```typescript
  subject: "Welcome to WeKnow Analytics — Set your password",
  heading: "Welcome to WeKnow Analytics",
  body: "<p>You've been invited to the WeKnow Analytics Portal, where you can view performance analytics for your locations.</p><p>Click below to set your password and access your dashboard:</p>",
  ctaText: "Set your password",
  ctaUrl: setPasswordUrl,
  footer: "Once you've set your password, you can sign in at any time to view your analytics.",
  ```
- **Conventions to preserve:** Named export `ExternalInviteEmail`. Prop `{ setPasswordUrl }: { setPasswordUrl: string }` — note the prop name differs from invite.tsx (`setPasswordUrl` vs `resetUrl`); locked by `email.ts:79-85`.

---

### CREATE: `src/emails/password-changed.tsx`
- **Role:** Confirmation email for EMAIL-02 (D-11: timestamp + "contact admin", no IP/UA)
- **Closest analog:** None in codebase (greenfield). Visual structure from `_layout.tsx`. Copy decisions locked in D-11. RESEARCH § Pattern 3 has the full skeleton at `08-RESEARCH.md:381-403`.
- **Excerpt** — D-11 locks the body shape (subject + content):
  ```
  Subject: "Your WeKnow password was changed"
  Body: "Your WeKnow Command Centre password was changed on <changedAt>."
        "If this wasn't you, please contact your administrator immediately."
  CTA: "Contact admin" → mailto: prod admin OR /admin deep-link
  ```
- **Conventions to preserve:** Named export `PasswordChangedEmail`. Props `{ changedAt: string; contactAdminUrl: string }` per RESEARCH § Pattern 3. NO `ip`, `userAgent`, or `browserFingerprint` props (D-11 + Pitfall 7 — privacy review trigger).

---

### CREATE: `src/inngest/client.ts`
- **Role:** Inngest client factory (event sender + function builder)
- **Closest analog:** None in codebase (greenfield). Closest existing "lib client factory" precedent is `src/lib/auth.ts:8-49` (single `export const auth = betterAuth({...})` from a third-party SDK config) — same shape: instantiate the SDK once, export the singleton.
- **Excerpt** — auth.ts singleton-export shape to mirror, from `src/lib/auth.ts:8`:
  ```typescript
  export const auth = betterAuth({
    database: drizzleAdapter(db, { provider: "pg" }),
    // ...
  });
  ```
- **Conventions to preserve:** Single named export `inngest`. Pass app id `"wkg-kiosk-tool"` per RESEARCH § Pattern 2. Reads `INNGEST_EVENT_KEY` from env automatically (Inngest SDK behaviour). No defensive try/catch — let env-var absence throw at startup, same as `auth.ts` does for `BETTER_AUTH_SECRET`.

---

### CREATE: `src/inngest/functions/send-email.ts`
- **Role:** The send-email Inngest function (`event: "email/send.requested"`); `step.run('render-html')` → `step.run('resend-send')` → `step.run('log')`; retries: 5
- **Closest analog:** None in codebase. The closest "wrap a side-effecting call + write an audit row" pattern is the auth-flow `sendResetPassword` hook at `src/lib/auth.ts:13-24` (call SDK → write log) and the ETL pipeline pattern in `src/app/api/etl/azure/run/route.ts:39` (`runAzureEtl(db)` → returns structured result with status). Step-isolation semantics are SDK-specific.
- **Excerpt** — full skeleton from RESEARCH § Pattern 2 lines `08-RESEARCH.md:267-317`. Key invariant: render-html / resend-send / log MUST each be in their own `step.run` so Inngest memoises them across retries (Pitfall 5).
- **Conventions to preserve:** Named export `sendEmailFn`. Imports follow project convention: `inngest` from `../client`, `Resend` from external (alphabetise external block first), `db` + `emailLog` from `@/db` and `@/db/schema`, template module from `@/emails/...`. The `onConflictDoNothing({ target: [emailLog.kind, emailLog.payloadHash] })` pattern is **new** (no existing usage); idempotency relies on the partial unique index added in migration 0041.

---

### CREATE: `src/inngest/functions/index.ts`
- **Role:** Barrel re-export of every Inngest function so `route.ts` imports a single `functions: [...]` array
- **Closest analog:** Project doesn't use barrel exports much; closest is `src/lib/sales/etl/index.ts` style (verify exists, otherwise just `export { sendEmailFn } from "./send-email"` is the simplest shape).
- **Excerpt** — N/A (one-liner barrel)
- **Conventions to preserve:** Single export per function file in this directory; `route.ts` imports the named exports directly OR via the barrel — planner picks. RESEARCH § Pattern 2 imports directly from `'@/inngest/functions/send-email'` so the barrel is optional.

---

### CREATE: `src/app/api/inngest/route.ts`
- **Role:** Next.js Route Handler exposing Inngest's `serve()` over `GET`/`POST`/`PUT`
- **Closest analog:** `src/app/api/auth/[...all]/route.ts` (3 lines: `export const { GET, POST } = toNextJsHandler(auth);`) — **exact same shape** but with the Inngest `serve` factory instead of `toNextJsHandler`. This is the closest stylistic match in the entire codebase.
- **Excerpt** — `src/app/api/auth/[...all]/route.ts:1-4`:
  ```typescript
  import { auth } from "@/lib/auth";
  import { toNextJsHandler } from "better-auth/next-js";

  export const { GET, POST } = toNextJsHandler(auth);
  ```
- **Conventions to preserve:** 4-line file. Single `export const { GET, POST, PUT }` from `serve({ client: inngest, functions: [...] })`. NO env-gating, NO try/catch, NO logger — `serve()` handles signing-key verification and error responses internally (Inngest SDK behaviour). Compare RESEARCH § Pattern 2 at `08-RESEARCH.md:320-331`.

---

### CREATE: `src/app/(app)/account/layout.tsx`
- **Role:** Minimal `(app)/account/*` shell. Session-gating already handled by parent `(app)/layout.tsx` — DO NOT re-implement. D-12 explicitly forbids tabs/sidebar nav.
- **Closest analog:** Parent `src/app/(app)/layout.tsx:1-26` — already does session-gate + `<AppShellV2>` wrap. Phase 8's `account/layout.tsx` is a thin sibling that just provides max-width container + vertical padding.
- **Excerpt** — parent session-gate (DO NOT duplicate), `src/app/(app)/layout.tsx:5-26`:
  ```typescript
  export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) redirect("/login");
    return (
      <AppShellV2 user={{ name: session.user.name, email: session.user.email, role: (session.user.role as string) || "member" }}>
        {children}
      </AppShellV2>
    );
  }
  ```
- **Conventions to preserve:** Server Component default (no `"use client"`). NO duplicate session check (parent handles it). NO `<AppShellV2>` (already wrapping from parent). Just a layout function returning a `<div className="max-w-2xl mx-auto py-8 px-4">{children}</div>` shell per RESEARCH § Pattern 4. Tabs/sidebar are explicitly out per D-12.

---

### CREATE: `src/app/(app)/account/security/page.tsx`
- **Role:** RSC page rendering `<ChangePasswordForm />`. No data-fetching needed (form state is purely client-side).
- **Closest analog:** `src/app/(auth)/login/page.tsx:1-27` is the closest "page imports a form component and renders" precedent in the project. Minor differences: `(app)` page uses h1 with `text-2xl` instead of `<CardHeader>` (matches RESEARCH § Pattern 4 `08-RESEARCH.md:427-434`); login page uses Card because it's a centred unauthenticated landing.
- **Excerpt** — login page render shape, `src/app/(auth)/login/page.tsx:4-26`:
  ```typescript
  export default function LoginPage() {
    return (
      <Card className="w-full max-w-[400px] ..." style={{ borderRadius: "8px", padding: "32px" }}>
        <CardHeader className="flex flex-col items-center gap-4 p-0 pb-6">
          <h1 className="text-xl font-bold tracking-[-0.01em] text-foreground">Sign in to WeKnow</h1>
        </CardHeader>
        <CardContent className="p-0">
          <LoginForm />
        </CardContent>
      </Card>
    );
  }
  ```
- **Conventions to preserve:** Default export, async only if data-fetching (here it's NOT, so plain `export default function`). Heading uses `text-2xl font-bold tracking-[-0.01em] text-foreground` per RESEARCH § Pattern 4 — same kerning convention as login. NO Card wrapper (this is an in-app page, not an auth landing). Form import from co-located `./change-password-form`.

---

### CREATE: `src/app/(app)/account/security/change-password-form.tsx`
- **Role:** Client form: current/new/confirm fields → `authClient.changePassword({ ..., revokeOtherSessions: true })` → POST `/api/account/password-changed` (chains the Inngest send) → toast.
- **Closest analog:** `src/components/auth/set-password-form.tsx` (closest match — same field set new/confirm + show/hide toggles) AND `src/components/auth/login-form.tsx:1-139` (canonical form scaffold, simpler). Use set-password-form for the password-field show/hide pattern; use login-form for the schema + onSubmit + submit-button skeleton.
- **Excerpt** — set-password-form schema + show/hide pattern, `src/components/auth/set-password-form.tsx:1-26`:
  ```typescript
  "use client";
  import { useEffect, useState } from "react";
  import { useRouter, useSearchParams } from "next/navigation";
  import { useForm } from "react-hook-form";
  import { z } from "zod";
  import { zodResolver } from "@hookform/resolvers/zod";
  import { Eye, EyeOff, AlertCircle, Loader2 } from "lucide-react";
  import { toast } from "sonner";

  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { authClient } from "@/lib/auth-client";

  const setPasswordSchema = z
    .object({
      password: z.string().min(8, "Password must be at least 8 characters"),
      confirmPassword: z.string().min(1, "Please confirm your password"),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: "Passwords do not match",
      path: ["confirmPassword"],
    });
  ```
- **Excerpt** — onSubmit + toast pattern from `src/components/auth/login-form.tsx:41-60`:
  ```typescript
  async function onSubmit(data: LoginFormValues) {
    setIsLoading(true);
    try {
      const result = await signIn.email({ ... });
      if (result.error) { toast.error("..."); return; }
      router.push("/kiosks");
    } catch {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }
  ```
- **Conventions to preserve:**
  - `"use client"` directive at top.
  - Imports: external alphabetical block (`react`, `next/*`, `react-hook-form`, `zod`, `@hookform/resolvers/zod`, `lucide-react`, `sonner`) → blank line → internal `@/*` alphabetical (`@/components/ui/*`, `@/lib/auth-client`).
  - Plain `import { z } from "zod"` (NOT `zod/v4`) — `zod/v4` is convention only inside `"use server"` actions per `src/app/(app)/settings/users/actions.ts:3`. Client forms use plain `"zod"` (verified across all three auth forms).
  - `useForm<Values>({ resolver: zodResolver(schema), mode: "onBlur", reValidateMode: "onChange" })` — verbatim across login/reset/set-password.
  - Field schema: three fields (`currentPassword`, `newPassword`, `confirm`) per RESEARCH § Pattern 4 lines 449-453. `.refine((d) => d.newPassword === d.confirm, { path: ['confirm'], message: 'Passwords do not match' })` mirrors set-password-form.tsx:22-25.
  - Submit chain: `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })` → if error: `toast.error(result.error.message ?? "Failed to change password")` and `return` → else `await fetch('/api/account/password-changed', { method: 'POST' })` → `toast.success(...)` → `reset()`.
  - Markup: `<div className="flex flex-col gap-2">` per field, `<Label>` with required asterisk span, `<Input>` with `aria-invalid` + `border-border focus:border-primary focus:ring-ring`, error `<p>` with `<AlertCircle className="size-3.5 shrink-0" />` + `role="alert"`, submit `<Button>` with `Loader2` spinner.
  - Show/hide eye toggles only on the new-password + confirm fields if matching set-password-form parity (planner discretion).

---

### CREATE: `src/app/api/account/password-changed/route.ts`
- **Role:** POST handler called by `change-password-form.tsx` after `authClient.changePassword` resolves. Re-fetches session, calls `inngest.send({ name: 'email/send.requested', data: { kind: 'password_changed', ... } })`.
- **Closest analog:** `src/app/api/etl/azure/run/route.ts` is the closest "POST handler with auth check + side-effect + JSON response" precedent. Different auth model (it uses cron-header / shared-secret); password-changed uses Better Auth session via `auth.api.getSession`.
- **Excerpt** — etl POST handler shape, `src/app/api/etl/azure/run/route.ts:25-47`:
  ```typescript
  export async function POST(req: Request) {
    const token = req.headers.get("x-etl-token");
    const isVercelCron = req.headers.get("x-vercel-cron") === "1";
    const authorized = isVercelCron || (!!token && token === process.env.ETL_SHARED_SECRET);
    if (!authorized) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    if (process.env.ETL_AZURE_ENABLED !== "true") {
      return NextResponse.json({ error: "..." }, { status: 503 });
    }
    const result = await runAzureEtl(db);
    return NextResponse.json(result, { status });
  }
  ```
- **Excerpt** — session-fetch shape (use Better Auth's helper), full skeleton at `08-RESEARCH.md:654-679`:
  ```typescript
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "unauthorised" }, { status: 401 });
  ```
- **Conventions to preserve:**
  - Imports: `import { NextResponse } from "next/server"` (matches etl route), `import { headers } from "next/headers"`, `import { auth } from "@/lib/auth"`, `import { inngest } from "@/inngest/client"`.
  - `export async function POST()` — no `req` arg needed (no body to parse).
  - Auth check: `auth.api.getSession({ headers: await headers() })` → 401 on null.
  - Side effect: `inngest.send({ name: "email/send.requested", data: { kind: "password_changed", to: session.user.email, subject: "Your WeKnow password was changed", template: "password-changed", templateProps: { changedAt: new Date().toLocaleString("en-GB", { timeZone: "Europe/London" }), contactAdminUrl: "mailto:vedant.kalbag@weknowgroup.com" } } })`.
  - Response: `return NextResponse.json({ ok: true })` on success.
  - Spelling: `"unauthorised"` (project uses British spelling per CLAUDE.md and existing codebase) — verify against existing routes.

---

### MODIFY: `src/lib/email.ts`
- **Role:** Public email API; **function signatures locked** — `src/lib/auth.ts:13-24` is the contract; bodies switch from nodemailer to Resend + react-email render.
- **Closest analog:** Itself. The three exported function signatures are the contract. RESEARCH § Pattern 1 (`08-RESEARCH.md:188-238`) has the new body skeleton.
- **Excerpt** — current locked signatures from `src/lib/email.ts:37-98` (must remain identical post-modify):
  ```typescript
  export async function sendPasswordResetEmail({ to, resetUrl }: { to: string; resetUrl: string }) { ... }
  export async function sendInviteEmail({ to, resetUrl }: { to: string; resetUrl: string }) { ... }
  export async function sendExternalInviteEmail({ to, setPasswordUrl }: { to: string; setPasswordUrl: string }) { ... }
  ```
- **Conventions to preserve:**
  - Three named function exports — same names, same param destructure shape, same prop names (`resetUrl` vs `setPasswordUrl` differs intentionally between invite and external-invite — see `email.ts:60-63` vs `email.ts:81-85`).
  - `async` returning `Promise<void>` (or `Promise<{...}>`; current functions don't return — keep the void shape so `auth.ts:13-24` stays untouched).
  - Imports: external (`Resend` from "resend") → blank line → internal (`@/db`, `@/db/schema`, `@/emails/*`).
  - DELETE the inline `buildBrandedEmail` helper (lines 9-35) per D-09.
  - DELETE the `nodemailer.createTransport` block (lines 1-7).
  - DELETE the `import nodemailer from "nodemailer"` line.
  - On Resend non-2xx: throw a typed error so Better Auth surfaces it to the form (D-04). Skeleton at `08-RESEARCH.md:228-235`.
  - Insert into `email_log` synchronously inside each function body before the throw — auth-flow audit row gets `inngestRunId: null`, `payloadHash: null` (D-06). Skeleton at `08-RESEARCH.md:215-223`.

---

### MODIFY: `src/db/schema.ts` — append `emailLog` table
- **Role:** Drizzle table definition appended to single-file schema (~50KB; do NOT split per CONTEXT brief)
- **Closest analog:** `src/db/schema.ts:316-332` — `locationMergeSnapshots` table (Phase 7 v1.1 addition; same shape: uuid PK, timestamps with timezone, jsonb-style payload). Also `src/db/schema.ts:298-314` — `auditLogs` (denormalised actor/recipient pattern that EMAIL-04's audit-table semantics mirror exactly).
- **Excerpt** — `locationMergeSnapshots` shape from `src/db/schema.ts:316-332`:
  ```typescript
  // Phase 7 Plan 07-03 — N→1 location-merge snapshot-before-commit (D-03 / DATA-02).
  // Each row captures the pre-merge FK state for a single forward-merge transaction.
  // ...
  export const locationMergeSnapshots = pgTable("location_merge_snapshots", {
    id: uuid("id").primaryKey().defaultRandom(),
    auditLogId: uuid("audit_log_id")
      .notNull()
      .references(() => auditLogs.id),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  });
  ```
- **Excerpt** — auditLogs denormalised shape (closer match to email_log semantics), `src/db/schema.ts:298-314`:
  ```typescript
  export const auditLogs = pgTable("audit_logs", {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    // ...
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  });
  ```
- **Conventions to preserve:**
  - Header doc-comment: `// Phase 8 Plan 08-XX — email_log audit table (EMAIL-04). One row per send, regardless of transport (sync Resend OR Inngest). Unique idx on (kind, payload_hash) WHERE payload_hash IS NOT NULL enforces digest idempotency at the DB; auth-flow sends pass NULL.`
  - Match `locationMergeSnapshots` table-positional convention: insert near other v1.1 audit/log tables.
  - **Critical schema detail (RESEARCH § Pattern 5 vs auditLogs):** `locationMergeSnapshots` uses `withTimezone: true`; the RESEARCH skeleton at `08-RESEARCH.md:511` writes `withTimezone: false`. **Use `withTimezone: true` to match the audit-log/snapshot precedent** — research is wrong on this single line. Confirm with planner.
  - Index definitions in second arg `(t) => ({ ... })`. The partial unique index syntax is already used in the project (Phase 7 migration 0039 partial idx); Drizzle supports `.where(sql\`...\`)` per A5 in research.
  - Column names: snake_case in DB (`resend_message_id`, `inngest_run_id`, `last_error`, `payload_hash`), camelCase in TS (`resendMessageId`, `inngestRunId`, `lastError`, `payloadHash`).
  - `import { sql } from "drizzle-orm"` and `index` from `drizzle-orm/pg-core` are already imported at top of `schema.ts:1-19` — reuse, don't re-add.

---

### CREATE: `migrations/0041_phase_08_email_log.sql`
- **Role:** Hand-authored idempotent SQL migration creating `email_log` table + partial unique index + recipient/created_at index
- **Closest analog:** `migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql` (the canonical hand-authored Phase 7 migration; uses every idempotency idiom we need: `IF NOT EXISTS`, `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`, `CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE ...`). Also `migrations/0040_phase_07_06_drop_locations_outlet_code.sql` for header-comment style.
- **Excerpt** — full header + idempotency idioms from `migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql:1-27`:
  ```sql
  -- Phase 7 schema deltas — consolidated migration (Plans 07-02, 07-03, 07-04).
  --
  -- This migration captures every schema change introduced by Phase 7 ...
  -- Each statement is `IF NOT EXISTS` / idempotent so re-running on the UAT
  -- branch (where the changes already exist) is a no-op.
  --
  -- Hand-authored rather than generated: drizzle-kit's snapshot history is
  -- incomplete ...
  --
  -- Deltas:
  --   1. Plan 07-02 (Plan B) — `locations.normalised_name` (text, nullable).
  --   ...
  ```
- **Excerpt** — table+constraint+partial-idx idiom, `migrations/0039_...sql:32-52`:
  ```sql
  -- ── Delta 2 — location_merge_snapshots table ──────────────────────────
  CREATE TABLE IF NOT EXISTS "location_merge_snapshots" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "audit_log_id" uuid NOT NULL,
    "payload" jsonb NOT NULL,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL
  );

  DO $$ BEGIN
    ALTER TABLE "location_merge_snapshots"
      ADD CONSTRAINT "location_merge_snapshots_audit_log_id_audit_logs_id_fk"
      FOREIGN KEY ("audit_log_id") REFERENCES "audit_logs"("id")
      ON DELETE no action ON UPDATE no action;
  EXCEPTION
    WHEN duplicate_object THEN null;
  END $$;

  -- ── Delta 3 — locations.normalised_name partial unique index ──────────
  CREATE UNIQUE INDEX IF NOT EXISTS "locations_normalised_name_unique_active"
    ON "locations" ("normalised_name")
    WHERE archived_at IS NULL;
  ```
- **Conventions to preserve:**
  - File-level doc-comment header naming Phase + plan + each delta. Use the same `-- ── Delta N — short-name ────────` separator style.
  - All DDL guarded by `IF NOT EXISTS` / `IF EXISTS`.
  - FK constraint adds wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;` (`email_log` has no FK in current design — skip this idiom unless wiring `recipient` → `user.email`).
  - Partial unique idx via `CREATE UNIQUE INDEX IF NOT EXISTS "name" ON "table" ("col1","col2") WHERE col2 IS NOT NULL;` (matches `0039_...:50-52`).
  - Column types: lowercase `text`, `uuid`, `jsonb`, `timestamp with time zone DEFAULT now() NOT NULL` — match `0039_...:33-37` exactly.
  - Default for uuid PK: `DEFAULT gen_random_uuid() NOT NULL` (matches `0039_...:34`).
  - DO NOT use `drizzle-kit generate` for this file — drizzle-kit's snapshot history is incomplete pre-0023 (per `0039`'s header comment); hand-author per the precedent.

---

### CREATE: `docs/email-fallback-brevo.md`
- **Role:** Operator runbook for the documented-only Brevo fallback (D-13 + Deferred § Brevo)
- **Closest analog:** `CLAUDE.md` § "Prod admin password rotation" (in-repo runbook style) — same shape: pre-flight checks, environment vars, command, aftercare.
- **Excerpt** — runbook structure from `CLAUDE.md` § "Prod admin password rotation":
  ```markdown
  ### Pre-flight checks
  - Confirm ...
  - Decide on ...

  ### Usage
  ```bash
  ENV_VAR='value' \
    command
  ```

  ### Aftercare
  - Do not commit ...
  ```
- **Conventions to preserve:** Markdown only, no code (it's an "if/when we ever flip" doc). Sections: trigger conditions (when do we flip), env-var switch (`EMAIL_PROVIDER=resend|brevo`), Brevo SDK shape, DNS records to swap, rollback path. Reference `tasks/v2-carryover-from-v1-phase-6.md` § V2-EMAIL-01 fix-path step 6 (the original spec). NO actual implementation (per D-13 Deferred § Brevo).

---

### CREATE: `tests/auth/change-password.spec.ts`
- **Role:** Playwright E2E for EMAIL-02 (happy path + 2 failure paths per RESEARCH § Validation Architecture)
- **Closest analog:** `tests/auth/password-reset.spec.ts:1-42` (closest topical match — exact same shape: `test.describe(...)` → 3 tests, navigation + visibility + form fill + assertion). Sign-in helper from `tests/helpers/auth.ts:46-53` (`signInAsAdmin`).
- **Excerpt** — happy-path test shape, `tests/auth/password-reset.spec.ts:1-29`:
  ```typescript
  import { test, expect } from "@playwright/test";

  test.describe("Password reset flow", () => {
    test("reset password form renders with email input", async ({ page }) => {
      await page.goto("/reset-password");
      await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
      await expect(page.getByLabel("Email address")).toBeVisible();
      await expect(page.getByRole("button", { name: "Send reset link" })).toBeVisible();
    });
    test("shows confirmation message after submitting email", async ({ page }) => {
      await page.goto("/reset-password");
      await page.getByLabel("Email address").fill("admin@weknow.co");
      await page.getByRole("button", { name: "Send reset link" }).click();
      await expect(page.getByText("Check your inbox")).toBeVisible({ timeout: 10000 });
    });
  });
  ```
- **Excerpt** — sign-in helper to call before navigating to `/account/security`, `tests/helpers/auth.ts:46-53`:
  ```typescript
  export async function signInAsAdmin(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email address").fill(TEST_ADMIN.email);
    await page.locator("input#password").fill(TEST_ADMIN.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/kiosks", { timeout: SIGN_IN_NAV_TIMEOUT_MS });
  }
  ```
- **Conventions to preserve:**
  - File location: `tests/auth/change-password.spec.ts` (mirrors `tests/auth/password-reset.spec.ts`).
  - Imports: `import { test, expect } from "@playwright/test"` + `import { signInAsAdmin, TEST_ADMIN } from "../helpers/auth"`.
  - `test.describe("Change password flow", () => { ... })` wrapper.
  - `test.beforeEach(async ({ page }) => { await signInAsAdmin(page); await page.goto("/account/security"); })` — signs in then navigates.
  - Selectors: `page.getByLabel("Current password")`, `page.locator("#newPassword")` (when label collides with confirm), `page.getByRole("button", { name: "Change password" })`. Mirror `tests/auth/login.spec.ts:11-18` precedent for label+id selector mix.
  - Assert toast via `await expect(page.getByText("Password changed. Other sessions signed out.")).toBeVisible({ timeout: 5000 });` (sonner mounts globally — `tests/auth/login.spec.ts:50-52` does this for "Invalid email or password").
  - Three tests minimum: (1) happy path → success toast + form reset, (2) wrong current password → inline error, (3) new password < 8 chars → zod inline error before Better Auth call.
  - **CLAUDE.md gate:** spec must run end-to-end against the Vercel preview alias before declaring done — `--list` passing is not sufficient (see CLAUDE.md § "Playwright specs against preview deploys").

---

### CREATE: `src/lib/__test_helpers__/mock-resend.ts`
- **Role:** Shared vitest mock helper for the `Resend` constructor + `resend.emails.send`. Returns programmable success/error responses.
- **Closest analog:** `src/lib/__tests__/monday-client.test.ts:43-64` — the project's canonical mock-client helper pattern (`mockFetchOnce` / `mockFetchSequence`). Same shape we want here for `mockResendOnce` / `mockResendSequence`.
- **Excerpt** — mock-helper shape, `src/lib/__tests__/monday-client.test.ts:43-64`:
  ```typescript
  function mockFetchOnce(body: unknown): Mock {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function mockFetchSequence(bodies: unknown[]): Mock {
    const fetchMock = vi.fn();
    for (const body of bodies) {
      fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => body });
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }
  ```
- **Conventions to preserve:**
  - Use `vi.mock("resend", ...)` to replace the `Resend` class export with a constructor returning a stubbed `emails: { send: vi.fn() }`. This is the standard SDK-mock pattern (RESEARCH § Wave 0 Gaps explicitly says `vi.mock('resend', ...)`).
  - Export named helpers: `mockResendSuccess({ id })`, `mockResendFailure({ message })`, `mockResendSequence([...])`.
  - Import shape: `import { vi, type Mock } from "vitest"` matching the project's existing import block at `src/lib/__tests__/monday-client.test.ts:1-9`.
  - File location: research suggested `src/lib/__test_helpers__/mock-resend.ts`. Project precedent uses `src/lib/__tests__/` (with `__tests__`, double underscore around `tests`); `__test_helpers__` is a NEW dir. Planner may prefer co-location at `src/lib/__tests__/helpers/mock-resend.ts` to match existing convention — flag for planner.

---

### CREATE: `src/emails/__test_helpers__/render-snapshot.ts`
- **Role:** Render JSX → HTML helper for template tests (snapshot-asserting visual output)
- **Closest analog:** None in repo (no existing react-email tests). Closest "render JSX to string for assertion" precedent is none — this is greenfield.
- **Excerpt:** N/A — wraps `await render(<Component {...props} />)` from `@react-email/render` and returns a normalised string (strip whitespace, lowercase tags) for stable snapshots.
- **Conventions to preserve:** Single named export `renderEmail(component: React.ReactElement): Promise<string>`. Same dir-naming caveat as mock-resend (planner picks `__test_helpers__` vs `__tests__/helpers/`).

---

### MODIFY: `package.json`
- **Role:** Add `resend@~6.12`, `inngest@~4.3`, `@react-email/components@~1.0`, `@react-email/render@~2.0`; add `react-email@~6.1` to devDependencies; remove `nodemailer` + `@types/nodemailer`. Add `email:dev` script per D-08.
- **Closest analog:** Itself. Versions locked in RESEARCH § Standard Stack.
- **Excerpt** — current scripts shape (verify by running `cat package.json | jq .scripts`); script ordering follows `dev`, `build`, `start`, `lint`, then `db:*`, then `test:*` per existing layout. Insert `email:dev` near `dev`.
- **Conventions to preserve:**
  - Use tilde `~` ranges for SDK pins per RESEARCH § Standard Stack (e.g. `"resend": "~6.12.3"`); existing project mixes `^` and `~`. Match the surrounding context — Better Auth uses `^1.5.5`, Drizzle uses `^0.45.1`. Planner picks based on local convention but tilde for new high-churn SDKs is reasonable.
  - Removals: `dependencies.nodemailer` + `devDependencies["@types/nodemailer"]`.
  - Script: `"email:dev": "react-email dev"` (per D-08, port defaults to 3000 — no collision with Next dev port 3003).
  - **Mandatory:** lockfile regen via the `linux/amd64` Docker recipe in `CLAUDE.md` § "npm ci lockfile must stay in sync" AFTER editing package.json. Do NOT run `npm install` on macOS between Docker regen and commit.

---

### MODIFY: `package-lock.json`
- **Role:** Lockfile regen via Docker recipe per `CLAUDE.md`
- **Closest analog:** Itself. Process is in `CLAUDE.md` § "npm ci lockfile must stay in sync".
- **Excerpt** — canonical command from `CLAUDE.md`:
  ```bash
  docker run --rm --platform linux/amd64 -v "$PWD":/src node:22-bookworm bash -lc '
    set -e
    mkdir -p /build && cp /src/package.json /build/package.json
    cd /build
    npm install --package-lock-only
    npm ci --dry-run
    cp /build/package-lock.json /src/package-lock.json
  '
  ```
- **Conventions to preserve:** Verify with `git diff --stat package-lock.json` — diffs confined to wasm32-wasi/`@emnapi`/`@napi-rs`/lightningcss/tailwind-oxide forest are expected; major-version drift in `next`/`react`/`drizzle`/`@neondatabase`/`typescript`/`vitest`/`playwright` is a red flag. Verify `grep '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` returns a result.

---

### MODIFY: `.env.example`
- **Role:** Replace SMTP_* with new email + Inngest env vars
- **Closest analog:** `.env.example` itself (lines 8-12 currently document `SMTP_HOST/PORT/USER/PASS/EMAIL_FROM`).
- **Excerpt** — current SMTP block from `.env.example:8-12`:
  ```env
  # Email (SMTP)
  SMTP_HOST=smtp.example.com
  SMTP_PORT=587
  SMTP_USER=
  SMTP_PASS=
  EMAIL_FROM=noreply@example.com
  ```
- **Conventions to preserve:**
  - Replace the entire `# Email (SMTP)` section with `# Email (Resend) + Async (Inngest)`.
  - Add: `RESEND_API_KEY=` (from Resend dashboard), `EMAIL_FROM=noreply@command.weknowgroup.com` (D-02 default), `EMAIL_REPLY_TO=` (optional), `INNGEST_EVENT_KEY=` (Inngest dashboard), `INNGEST_SIGNING_KEY=` (Inngest dashboard).
  - REMOVE: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
  - Comment block convention: `# Section Name (Provider)` header per existing layout.

---

### MODIFY: `.env.test` (template)
- **Role:** Same additions as `.env.example` but with test-mode placeholders
- **Closest analog:** `.env.example` (just edited)
- **Excerpt:** N/A — mirror the `.env.example` changes.
- **Conventions to preserve:** Match `.env.example` structure 1:1; planner verifies `.env.test` exists (memory entry "Prod admin account" references it for current prod admin password — don't overwrite that line).

---

### MODIFY: `playwright.config.ts` (likely no change)
- **Role:** Existing `PLAYWRIGHT_BASE_URL`-aware config; verify no auth.setup wiring needed
- **Closest analog:** Itself. Current config (full file, 27 lines) supports the preview-alias UAT flow already (`overrideBaseURL ?? "http://localhost:3003"`).
- **Excerpt** — current `playwright.config.ts:1-27` (already supports preview-alias mode, no change needed):
  ```typescript
  import { defineConfig } from "@playwright/test";
  const overrideBaseURL = process.env.PLAYWRIGHT_BASE_URL;
  export default defineConfig({
    testDir: "./tests",
    testMatch: "**/*.spec.ts",
    // ...
    webServer: overrideBaseURL ? undefined : { command: "npm run dev", ... },
  });
  ```
- **Conventions to preserve:** **No change needed** — existing config already handles `PLAYWRIGHT_BASE_URL` override (CLAUDE.md § "Playwright specs against preview deploys" requirement is already satisfied). Note in plan: leave this file alone unless `tests/auth/change-password.spec.ts` needs storage-state caching, in which case add an `auth.setup` project (precedent: none in project today).

---

### MODIFY/EXTEND: `tests/auth/forgot-password.spec.ts`
- **Role:** Existing/extending spec for EMAIL-03 forgot-password preview UAT
- **Closest analog:** `tests/auth/password-reset.spec.ts` (file already exists at this path). RESEARCH brief mentions "extend or create — RESEARCH.md unclear". Inspection: **the file exists** as `tests/auth/password-reset.spec.ts` (1.7K). Planner extends this rather than creating `forgot-password.spec.ts` to avoid spec duplication.
- **Excerpt:** See `tests/auth/password-reset.spec.ts:1-42` quoted under `change-password.spec.ts` analog above.
- **Conventions to preserve:**
  - Extend the existing 3-test `Password reset flow` describe block with one preview-shape happy-path test that asserts the email actually arrived (or, since D-14 makes inbox-side operator-driven, just asserts the form submit returns success against the preview alias).
  - The existing `admin@weknow.co` test in `password-reset.spec.ts:18-29` already covers the local-dev shape.
  - Add a new test that runs ONLY when `PLAYWRIGHT_BASE_URL` is set (skip locally) — guard via `test.skip(!process.env.PLAYWRIGHT_BASE_URL, ...)`.

---

## Boundary files (do NOT touch)

### `src/lib/auth.ts`
- **Why boundary:** It calls `sendPasswordResetEmail` / `sendInviteEmail` / `sendExternalInviteEmail` at lines 13-24. The signatures of those three exports in `src/lib/email.ts` ARE the contract this file relies on. Phase 8's whole "transport swap is structurally clean" claim depends on this file being untouched.
- **Verification:** After Phase 8's `email.ts` rewrite, `git diff src/lib/auth.ts` MUST be empty.
- **Excerpt** — the locked call shape, `src/lib/auth.ts:13-24`:
  ```typescript
  sendResetPassword: async ({ user, url }) => {
    const isInvite = url.includes("invite=1");
    const userType = (user as Record<string, unknown>).userType as string | undefined;
    if (isInvite && userType === "external") {
      await sendExternalInviteEmail({ to: user.email, setPasswordUrl: url });
    } else if (isInvite) {
      await sendInviteEmail({ to: user.email, resetUrl: url });
    } else {
      await sendPasswordResetEmail({ to: user.email, resetUrl: url });
    }
  },
  ```

---

## Greenfield surfaces (no existing analog in repo)

These directories have no prior code in the repo. The planner should defer to RESEARCH § Pattern N for the skeleton + the in-research [VERIFIED] / [CITED] SDK shapes — there is no in-repo idiom to copy yet.

| Surface | Defer to | Note |
|---------|----------|------|
| `src/emails/**` (react-email templates) | RESEARCH § Pattern 3 (`08-RESEARCH.md:336-413`) | First react-email use in project; brand tokens + layout are the canonical references for Phase 9 follow-up templates (digests, offline-alerts). Copy from `src/lib/email.ts:23-34` for visual structure only. |
| `src/inngest/**` (client + functions) | RESEARCH § Pattern 2 (`08-RESEARCH.md:243-318`) | First Inngest use. Step boundaries (Pitfall 5) and `onConflictDoNothing` idempotency (Pitfall 1) are SDK-specific — RESEARCH covers them. |
| `src/app/api/inngest/route.ts` | RESEARCH § Pattern 2 (`08-RESEARCH.md:320-331`) — though `src/app/api/auth/[...all]/route.ts` is the closest stylistic precedent (see file map above) | Use `serve()` from `inngest/next` exactly as documented; signing-key verification is built-in. |
| Integration tests for Inngest functions (`tests/email/send-email-fn.integration.test.ts`) | RESEARCH § Validation Architecture (`08-RESEARCH.md:759-797`) + use `tests/helpers/test-db.ts:1-50` for the Postgres fixture. Inngest's in-process test runner per RESEARCH Wave 0 Gaps. | First use of Inngest's test runner — defer entirely to Inngest docs; no in-repo idiom. |

---

## Cross-cutting "shared patterns" applied to multiple files

These patterns are not file-specific — they apply across most/all of the new files in this phase.

### Imports (every new TS/TSX file)
**Source:** `src/components/auth/login-form.tsx:1-14`, `src/lib/auth.ts:1-6`, `src/app/(app)/settings/users/actions.ts:1-6`
**Applies to:** Every new `.ts`/`.tsx` file
```typescript
import { externalA } from "external-a";
import { externalB } from "external-b";

import { internalA } from "@/internal/a";
import { internalB } from "@/internal/b";
```
- External imports first, alphabetised within group.
- Blank line separator.
- Internal `@/...` imports next, alphabetised within group.
- Double quotes throughout (project convention; verified across all sampled files).

### Form scaffold (every new client form)
**Source:** `src/components/auth/login-form.tsx`, `src/components/auth/reset-password-form.tsx`, `src/components/auth/set-password-form.tsx`
**Applies to:** `change-password-form.tsx` (the only new form in this phase)
- `"use client"` first line.
- `useForm<Values>({ resolver: zodResolver(schema), mode: "onBlur", reValidateMode: "onChange" })` — verbatim across all three existing auth forms.
- `setIsLoading(true)` before await; `finally { setIsLoading(false); }`.
- Errors rendered with `<AlertCircle className="size-3.5 shrink-0" />` + `role="alert"` + `text-xs text-destructive`.
- Submit button: `disabled={isLoading}`, `<Loader2 className="mr-2 size-4 animate-spin" />` when loading.
- toast.success / toast.error from `sonner` (NOT a custom toast lib).

### Server-action zod (NOT applicable to this phase)
**Source:** `src/app/(app)/settings/users/actions.ts:1-6` — `"use server"` actions use `import { z } from "zod/v4"`.
**Applies to:** None of Phase 8's files are server actions (only Route Handlers and client components). Plain `import { z } from "zod"` for client forms is correct — verified across login/reset/set-password forms.

### Drizzle schema (every new table or column)
**Source:** `src/db/schema.ts:298-332` (auditLogs + locationMergeSnapshots)
**Applies to:** `emailLog` append in `src/db/schema.ts`
- `pgTable("snake_case_db_name", { camelCaseTsKey: type("snake_case_col") })`.
- uuid PK: `id: uuid("id").primaryKey().defaultRandom()`.
- Timestamps: `timestamp("col", { withTimezone: true }).defaultNow().notNull()` (NOT `withTimezone: false` — confirmed against both `auditLogs` and `locationMergeSnapshots`; RESEARCH § Pattern 5 has a typo on this).
- Indexes in second arg `(t) => ({ ... })`.
- Header doc-comment naming Phase + plan + decision IDs (D-XX).

### SQL migration idioms (every new migration)
**Source:** `migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql`, `migrations/0040_phase_07_06_drop_locations_outlet_code.sql`
**Applies to:** `migrations/0041_phase_08_email_log.sql`
- Header doc-comment with phase + plan + delta list.
- `IF NOT EXISTS` on every DDL.
- Constraint adds wrapped in `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN null; END $$;`.
- `-- ── Delta N — short-name ────` separators between deltas.
- Lowercase types (`text`, `uuid`, `jsonb`, `timestamp with time zone`).
- `gen_random_uuid()` for uuid PK defaults.

### Playwright spec scaffold (every new spec)
**Source:** `tests/auth/login.spec.ts`, `tests/auth/password-reset.spec.ts`
**Applies to:** `tests/auth/change-password.spec.ts`, `tests/auth/forgot-password.spec.ts` (extension)
- `import { test, expect } from "@playwright/test"`.
- `test.describe("Flow name", () => { ... })`.
- For signed-in flows: `test.beforeEach(async ({ page }) => { await signInAsAdmin(page); ... })` from `tests/helpers/auth.ts:46-53`.
- Selectors: prefer `getByRole("button", { name: ... })` and `getByLabel("...")`. Use `locator("#id")` only when label collisions force it (precedent: `tests/auth/login.spec.ts:14`).
- Toasts: `await expect(page.getByText("...")).toBeVisible({ timeout: 5000 })`.
- **Preview-alias gate:** specs against `PLAYWRIGHT_BASE_URL=<git-branch-alias>` MUST run before claiming done — CLAUDE.md § "Playwright specs against preview deploys".

### Vitest unit-test scaffold (every new unit test)
**Source:** `src/lib/__tests__/monday-client.test.ts:1-90`
**Applies to:** `src/lib/email.test.ts`, `src/app/api/account/password-changed/route.test.ts`
- `import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest"`.
- `vi.mock("module-name", ...)` for SDK mocks.
- `beforeEach` for env-var setup, `afterEach` for `vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers()`.
- File location: co-located `*.test.ts` (NOT `__tests__/*.test.ts`) is the project convention — verify by `find src -name "*.test.ts"` showing both styles, with co-location dominating in newer code.

### Vitest integration-test scaffold (every new integration test)
**Source:** `tests/settings/audit-log.integration.test.ts:1-50`, `tests/helpers/test-db.ts:1-50`
**Applies to:** `tests/email/email-log.integration.test.ts`, `tests/email/send-email-fn.integration.test.ts`
- File suffix `.integration.test.ts` (vitest's `integration` project picks these up; `unit` excludes them).
- `import { setupTestDb, teardownTestDb, type TestDbContext } from "../helpers/test-db";`
- `let ctx: TestDbContext;`
- `beforeAll(async () => { ctx = await setupTestDb(); }, 180_000);` (Testcontainers warm-up needs the long timeout).
- `afterAll(async () => { if (ctx) await teardownTestDb(ctx); });`.
- `beforeEach(async () => { await ctx.db.delete(emailLog); });` to reset state between tests.

---

## Summary table

| File | Status | Closest analog | Match quality |
|------|--------|----------------|---------------|
| `src/emails/brand.ts` | CREATE | `src/lib/email.ts:23-34` (hex literals) + `~/.claude/weknow-brand-guidelines.md` | Greenfield (no react-email precedent) |
| `src/emails/_layout.tsx` | CREATE | `src/lib/email.ts:23-34` (visual structure) | Greenfield |
| `src/emails/password-reset.tsx` | CREATE | `src/lib/email.ts:37-56` (copy/CTA) | Greenfield (transport-swap derived) |
| `src/emails/invite.tsx` | CREATE | `src/lib/email.ts:58-77` | Greenfield (transport-swap derived) |
| `src/emails/external-invite.tsx` | CREATE | `src/lib/email.ts:79-98` | Greenfield (transport-swap derived) |
| `src/emails/password-changed.tsx` | CREATE | RESEARCH § Pattern 3 only | Greenfield (no existing copy) |
| `src/inngest/client.ts` | CREATE | `src/lib/auth.ts:8-49` (singleton-export) | Pattern-match (different SDK) |
| `src/inngest/functions/send-email.ts` | CREATE | RESEARCH § Pattern 2 + `src/lib/auth.ts:13-24` (call-and-log shape) | Greenfield |
| `src/inngest/functions/index.ts` | CREATE | none (one-line barrel) | N/A |
| `src/app/api/inngest/route.ts` | CREATE | `src/app/api/auth/[...all]/route.ts:1-4` | Exact stylistic match |
| `src/app/(app)/account/layout.tsx` | CREATE | `src/app/(app)/layout.tsx:5-26` (parent does session-gate) | Sibling layout, thin shell |
| `src/app/(app)/account/security/page.tsx` | CREATE | `src/app/(auth)/login/page.tsx:1-27` | Page-renders-form precedent |
| `src/app/(app)/account/security/change-password-form.tsx` | CREATE | `src/components/auth/set-password-form.tsx` + `src/components/auth/login-form.tsx` | Exact pattern match |
| `src/app/api/account/password-changed/route.ts` | CREATE | `src/app/api/etl/azure/run/route.ts:25-47` (POST + auth + side-effect) | Pattern-match |
| `migrations/0041_phase_08_email_log.sql` | CREATE | `migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql` | Exact idiom match |
| `docs/email-fallback-brevo.md` | CREATE | `CLAUDE.md` § "Prod admin password rotation" runbook | Stylistic match |
| `tests/auth/change-password.spec.ts` | CREATE | `tests/auth/password-reset.spec.ts` + `tests/auth/login.spec.ts` | Exact pattern match |
| `src/lib/__test_helpers__/mock-resend.ts` | CREATE | `src/lib/__tests__/monday-client.test.ts:43-64` (mockFetchOnce/Sequence) | Pattern-match (different SDK) |
| `src/emails/__test_helpers__/render-snapshot.ts` | CREATE | none | Greenfield |
| `src/lib/email.ts` | MODIFY | itself (signatures locked) | Self-pattern |
| `src/db/schema.ts` (append emailLog) | MODIFY | `src/db/schema.ts:316-332` (locationMergeSnapshots) + `:298-314` (auditLogs) | Exact in-file precedent |
| `package.json` | MODIFY | itself | Self-pattern |
| `package-lock.json` | MODIFY | CLAUDE.md Docker recipe | Process precedent |
| `.env.example` | MODIFY | itself | Self-pattern |
| `.env.test` | MODIFY | `.env.example` (mirror changes) | Self-pattern |
| `playwright.config.ts` | (no change) | itself | Already supports preview-alias mode |
| `tests/auth/forgot-password.spec.ts` | EXTEND existing `password-reset.spec.ts` | itself | Self-pattern |

---

## Notes for the planner

1. **`zod` import path:** Client forms use `import { z } from "zod"`; only `"use server"` actions use `import { z } from "zod/v4"`. Phase 8 has zero new server actions, so every new schema uses plain `"zod"`.
2. **Schema typo in RESEARCH § Pattern 5:** RESEARCH writes `withTimezone: false` for `email_log.created_at`. The dominant project convention (auditLogs + locationMergeSnapshots) is `withTimezone: true`. Use `true`.
3. **`__test_helpers__` vs `__tests__/helpers/`:** Project convention is `src/lib/__tests__/` (single `__tests__` dir per module). Research suggested `src/lib/__test_helpers__/` (new). Planner picks; recommend matching existing convention to keep `find src -name "__tests__"` working.
4. **`tests/auth/forgot-password.spec.ts` does not exist; `tests/auth/password-reset.spec.ts` does** — extend the existing file rather than create a duplicate.
5. **`playwright.config.ts` needs no changes** — preview-alias support is already wired (verified via the `overrideBaseURL` ternary at `playwright.config.ts:14-23`).
6. **Lockfile regen is the riskiest single task** — every dep addition must be followed by the Docker recipe in CLAUDE.md. Reserve a discrete plan task for it; do NOT bundle into a "and update package.json" subtask.

---

## PATTERN MAPPING COMPLETE

**Phase:** 08 - Email Infrastructure
**Files classified:** 27 (21 listed in CONTEXT brief + 6 implied helpers from RESEARCH § Wave 0 Gaps)
**Analogs found:** 23 / 27 with strong or exact matches; 4 greenfield (defer to RESEARCH)

### Coverage
- Files with exact analog: 9 (`route.ts` for inngest, schema append, migration, all forms, both Playwright specs, mock-resend)
- Files with role-match analog: 8 (account layout, security page, password-changed route, `email.ts` rewrite, env files, package.json edits, lockfile, forgot-password extension)
- Files with no analog (greenfield): 6 (4 react-email templates, Inngest function, render-snapshot helper) — defer to RESEARCH § Pattern 2 + 3
- Boundary files: 1 (`src/lib/auth.ts` — do not touch)

### Key Patterns Identified
- Every client form follows `login-form.tsx` / `set-password-form.tsx` exactly: `"use client"` + `react-hook-form` + plain `zod` (NOT `zod/v4`) + `zodResolver` + `mode: "onBlur"` + sonner toasts + lucide `Loader2`/`AlertCircle`/`Eye`/`EyeOff` + shadcn primitives.
- Every Drizzle table append follows `auditLogs` / `locationMergeSnapshots` shape: uuid PK with `gen_random_uuid()` default, `withTimezone: true` timestamps, snake_case DB / camelCase TS, indexes in second-arg `(t) => ({...})` block.
- Every SQL migration is hand-authored, idempotent, and follows the `0039`/`0040` header + `── Delta N ──` separator style — no `drizzle-kit generate` (project's snapshot history is incomplete pre-0023).
- Every API Route Handler is a tiny shell: ≤4 lines for SDK-handler exports (`api/auth/[...all]/route.ts`); auth check + side-effect + JSON response for custom routes (`api/etl/azure/run/route.ts`).
- Inngest, react-email, and Resend are all greenfield in this repo — the closest in-repo precedents are stylistic (singleton SDK exports, JSON Route Handlers, `email.ts` HTML literals). For SDK-specific shapes, defer to RESEARCH § Pattern 1-3 + 5.

### File Created
`/Users/vedant/Work/WeKnowGroup/wkg-kiosk-tool/.planning/phases/08-email-infrastructure/08-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference analog patterns + line ranges in PLAN.md `<read_first>` blocks.
