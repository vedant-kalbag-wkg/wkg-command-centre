# M8 — Invite Flow & Email Polish Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend the invite dialog to capture userType (internal/external) and scopes for external users at invite time, send branded email templates, and show a scope preview on the set-password page.

**Architecture:** The invite dialog gains a userType toggle. When "external" is selected, an inline scope builder appears (reuses the dimension type + ID pattern from ManageScopesDialog). The `inviteUser()` action creates the user, sets userType, inserts scopes, and triggers a password-reset email. The `sendResetPassword` hook in auth.ts detects invite vs. reset via URL params and dispatches the correct branded template. The set-password page fetches user context from the token and shows a scope preview for external users.

**Tech Stack:** Next.js 15, React Hook Form, Zod, better-auth, Drizzle ORM, Nodemailer, Playwright

---

## Task 1: Extend invite dialog with userType + scope selection

**Files:**
- Modify: `src/components/admin/invite-user-dialog.tsx`

**What to change:**

1. Add `userType` to the Zod schema and form:

```typescript
const inviteSchema = z.object({
  email: z.email("Please enter a valid email address"),
  role: z.enum(["admin", "member", "viewer"], { error: "Please select a role" }),
  userType: z.enum(["internal", "external"]),
});
```

Default: `userType: "internal"`.

2. Add a **User type** toggle after the Role select. Use two radio-style buttons or a Select:

```tsx
<div className="grid gap-2">
  <Label>User type</Label>
  <Select value={watchedUserType} onValueChange={(val) => setValue("userType", val, { shouldValidate: true })}>
    <SelectTrigger><SelectValue /></SelectTrigger>
    <SelectContent>
      <SelectItem value="internal">Internal (team member)</SelectItem>
      <SelectItem value="external">External (partner/venue)</SelectItem>
    </SelectContent>
  </Select>
</div>
```

3. When `userType === "external"`, show an **inline scope builder** below:

- Local state: `scopes: { dimensionType: DimensionType; dimensionId: string }[]`
- "Add scope" row: dimension type Select + dimension ID Input + Add button (same pattern as ManageScopesDialog)
- Added scopes shown as removable chips/pills or a mini table
- Validation: if external, require `scopes.length >= 1` before submit. Show error "External users require at least one scope" if violated.

4. On submit, call `inviteUser(data.email, data.role, data.userType, scopes)`.

5. Widen dialog: change `sm:max-w-[480px]` to `sm:max-w-[560px]` to accommodate the scope section.

**Reusable constants from ManageScopesDialog:**
```typescript
const DIMENSION_OPTIONS: { value: DimensionType; label: string }[] = [
  { value: "hotel_group", label: "Hotel group" },
  { value: "location", label: "Location" },
  { value: "region", label: "Region" },
  { value: "product", label: "Product" },
  { value: "provider", label: "Provider" },
  { value: "location_group", label: "Location group" },
];
```
Extract these to a shared constant file `src/lib/scoping/dimension-options.ts` so both components can import them.

**Step 1:** Extract `DIMENSION_OPTIONS` to `src/lib/scoping/dimension-options.ts`. Update ManageScopesDialog to import from there.

**Step 2:** Add userType + scope builder to InviteUserDialog.

**Step 3:** Verify typecheck: `npx tsc --noEmit`

**Step 4:** Commit: `feat(admin): add userType and scope selection to invite dialog`

---

## Task 2: Update inviteUser action for userType + scopes

**Files:**
- Modify: `src/app/(app)/settings/users/actions.ts`

**What to change:**

Update the `inviteUser` function signature:

```typescript
export async function inviteUser(
  email: string,
  role: Role,
  userType: "internal" | "external" = "internal",
  scopes: { dimensionType: string; dimensionId: string }[] = [],
)
```

After creating the user and setting the role, add:

1. **Set userType** on the user record:
```typescript
const { db } = await import("@/db");
const { user: userTable, userScopes } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");

await db.update(userTable)
  .set({ userType })
  .where(eq(userTable.id, userId));
```

2. **Insert scopes** (for external users):
```typescript
if (userType === "external" && scopes.length > 0) {
  await db.insert(userScopes).values(
    scopes.map((s) => ({
      userId,
      dimensionType: s.dimensionType,
      dimensionId: s.dimensionId,
      createdBy: session.user.id,
    })),
  );
}
```

3. **Validate** external users have >= 1 scope:
```typescript
if (userType === "external" && scopes.length === 0) {
  return { error: "External users require at least one scope" };
}
```

4. **Pass invite flag** in the redirectTo so the email hook can distinguish invite from reset:
```typescript
await auth.api.requestPasswordReset({
  body: {
    email: validatedEmail,
    redirectTo: "/set-password?invite=1",
  },
});
```

**Step 1:** Update the action with new params + logic.

**Step 2:** Verify typecheck: `npx tsc --noEmit`

**Step 3:** Run existing tests: `npx vitest run`

**Step 4:** Commit: `feat(admin): support userType and scopes in inviteUser action`

---

## Task 3: Branded email templates

**Files:**
- Modify: `src/lib/email.ts`
- Modify: `src/lib/auth.ts` (sendResetPassword hook)

**What to change in `email.ts`:**

1. **Create `sendExternalInviteEmail()`** — branded HTML email for external partners:

```typescript
export async function sendExternalInviteEmail({
  to,
  setPasswordUrl,
}: {
  to: string;
  setPasswordUrl: string;
}) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@weknow.co",
    to,
    subject: "Welcome to WeKnow Analytics — Set your password",
    html: buildBrandedEmail({
      heading: "Welcome to WeKnow Analytics",
      body: `
        <p>You've been invited to the WeKnow Analytics Portal, where you can view performance analytics for your locations.</p>
        <p>Click below to set your password and access your dashboard:</p>
      `,
      ctaText: "Set your password",
      ctaUrl: setPasswordUrl,
      footer: "Once you've set your password, you can sign in at any time to view your analytics.",
    }),
  });
}
```

2. **Update `sendInviteEmail()`** — branded HTML for internal team invites:

```typescript
export async function sendInviteEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@weknow.co",
    to,
    subject: "You're invited to WeKnow — Set your password",
    html: buildBrandedEmail({
      heading: "You're invited to WeKnow",
      body: `
        <p>You've been invited to the WeKnow Command Centre.</p>
        <p>Click below to set your password and get started:</p>
      `,
      ctaText: "Set your password",
      ctaUrl: resetUrl,
      footer: "This link expires in 1 hour.",
    }),
  });
}
```

3. **Update `sendPasswordResetEmail()`** — branded HTML:

```typescript
export async function sendPasswordResetEmail({
  to,
  resetUrl,
}: {
  to: string;
  resetUrl: string;
}) {
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || "noreply@weknow.co",
    to,
    subject: "Reset your password — WeKnow",
    html: buildBrandedEmail({
      heading: "Reset your password",
      body: `<p>Click below to reset your password:</p>`,
      ctaText: "Reset password",
      ctaUrl: resetUrl,
      footer: "This link expires in 1 hour. If you didn't request this, ignore this email.",
    }),
  });
}
```

4. **Add `buildBrandedEmail()` helper** — inline HTML with WeKnow brand:

```typescript
function buildBrandedEmail({
  heading,
  body,
  ctaText,
  ctaUrl,
  footer,
}: {
  heading: string;
  body: string;
  ctaText: string;
  ctaUrl: string;
  footer: string;
}): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 20px;">
      <div style="margin-bottom: 32px;">
        <span style="font-size: 20px; font-weight: 700; color: #121212; letter-spacing: -0.01em;">WK</span>
      </div>
      <h1 style="font-size: 24px; font-weight: 600; color: #121212; margin: 0 0 16px;">${heading}</h1>
      <div style="font-size: 15px; line-height: 1.6; color: #333;">${body}</div>
      <div style="margin: 24px 0;">
        <a href="${ctaUrl}" style="display: inline-block; padding: 12px 24px; background: #00A6D3; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 15px;">${ctaText}</a>
      </div>
      <p style="font-size: 13px; color: #666; margin-top: 32px;">${footer}</p>
    </div>
  `;
}
```

**What to change in `auth.ts`:**

Update the `sendResetPassword` hook to detect invite vs. reset:

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

Import `sendExternalInviteEmail` and `sendInviteEmail` at top of auth.ts.

**Step 1:** Add `buildBrandedEmail` helper and update all 3 email functions.

**Step 2:** Update auth.ts hook to dispatch correct template.

**Step 3:** Verify typecheck.

**Step 4:** Commit: `feat(email): branded email templates for invites and resets`

---

## Task 4: Set-password scope preview for external users

**Files:**
- Create: `src/app/(auth)/set-password/actions.ts`
- Modify: `src/components/auth/set-password-form.tsx`

**What to create — `actions.ts`:**

A server action that looks up user context from a reset token. The better-auth `verification` table stores `identifier` (= user email). From email, look up user → check userType → if external, fetch scopes.

```typescript
"use server";

import { db } from "@/db";
import { verification, user, userScopes } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function getInviteContext(token: string): Promise<{
  userType: "internal" | "external" | null;
  scopes: { dimensionType: string; dimensionId: string }[];
} | null> {
  // better-auth stores the hashed token as 'value', and the email as 'identifier'
  // We can't look up by raw token — but we CAN look up by identifier (email)
  // from the URL. Actually, better-auth hashes the token, so we need a different approach.
  //
  // Alternative: look up by the `identifier` field if the URL includes the email.
  // OR: Accept that we can't reverse the token easily, and instead use a simpler approach:
  // pass the email as a URL param alongside the token.
  return null; // Placeholder — see implementation notes
}
```

**Simpler approach:** Instead of token lookup, pass the email as a URL param in the invite link. Modify `inviteUser()` to set:
```typescript
redirectTo: `/set-password?invite=1&email=${encodeURIComponent(validatedEmail)}`
```

Then the set-password page reads `email` from URL params and calls:
```typescript
export async function getInviteContext(email: string): Promise<{
  userType: "internal" | "external";
  scopes: { dimensionType: string; dimensionName: string }[];
} | null> {
  const [found] = await db
    .select({ id: user.id, userType: user.userType })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);

  if (!found || found.userType !== "external") return null;

  const scopeRows = await db
    .select({ dimensionType: userScopes.dimensionType, dimensionId: userScopes.dimensionId })
    .from(userScopes)
    .where(eq(userScopes.userId, found.id));

  // Resolve scope IDs to display names
  // For hotel_group: look up hotelGroups.name, etc.
  const resolvedScopes = await resolveScopeNames(scopeRows);
  return { userType: "external", scopes: resolvedScopes };
}
```

**What to change — `set-password-form.tsx`:**

1. On mount, if `searchParams.has("invite")`, fetch `getInviteContext(email)`.
2. If external user with scopes, show a preview panel above the password form:

```tsx
{inviteCtx && (
  <div className="rounded-lg border border-wk-azure/20 bg-wk-azure/5 p-4 mb-2">
    <p className="text-sm font-medium text-wk-graphite mb-2">
      You'll have access to:
    </p>
    <ul className="text-sm text-wk-night-grey space-y-1">
      {inviteCtx.scopes.map((s, i) => (
        <li key={i}>• {s.dimensionName} ({s.dimensionType})</li>
      ))}
    </ul>
  </div>
)}
```

3. After password set, redirect external users to `/portal/analytics/portfolio` instead of `/login`:

```typescript
if (inviteCtx?.userType === "external") {
  router.push("/login"); // External users log in, middleware redirects to portal
} else {
  router.push("/login");
}
```

Actually, both redirect to `/login` — the middleware handles the rest. Keep it simple.

**Step 1:** Create the server action `getInviteContext`.

**Step 2:** Update set-password form to show scope preview.

**Step 3:** Update `inviteUser()` to include email in redirectTo URL.

**Step 4:** Verify typecheck.

**Step 5:** Commit: `feat(auth): show scope preview on set-password page for external users`

---

## Task 5: E2E tests for invite flow

**Files:**
- Modify: `tests/admin/invite-user.spec.ts`

**What to add:**

1. **"admin can invite an external user with scopes"**
   - Open invite dialog
   - Fill email
   - Select role (viewer)
   - Change user type to "External"
   - Scope builder appears
   - Add a scope: dimension type "Hotel group", dimension ID = a known hotel group ID
   - Click "Send invite"
   - Verify success toast
   - Verify user appears in table

2. **"external invite requires at least one scope"**
   - Open invite dialog
   - Fill email, select External
   - Try to submit without adding scopes
   - Verify validation error "External users require at least one scope"

3. **"internal invite does not show scope builder"**
   - Open invite dialog
   - Verify scope builder is NOT visible when Internal is selected

**Step 1:** Write the test cases.

**Step 2:** Run: `npx playwright test tests/admin/invite-user.spec.ts`

**Step 3:** Commit: `test(admin): add E2E tests for external user invite with scopes`

---

## Task 6: Full verification

**Step 1:** Typecheck: `npx tsc --noEmit`

**Step 2:** Unit tests: `npx vitest run`

**Step 3:** E2E tests: `npx playwright test`

**Step 4:** Manual smoke test:
- Sign in as admin → Settings → Users → Invite user
- Select External → add hotel_group scope → submit
- Verify email sent (check MailHog at localhost:8025 if configured)
- New user appears in user table with correct userType

**Step 5:** Summary commit:
```
feat(admin): complete M8 — invite flow with scope capture + branded emails

Invite dialog captures userType (internal/external) with inline scope builder.
External users require ≥1 scope at invite time. Three branded email templates
(internal invite, external invite, password reset) with WeKnow brand styling.
Set-password page shows scope preview for external users.
```
