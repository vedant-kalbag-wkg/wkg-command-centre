# Phase 8: Email Infrastructure - Research

**Researched:** 2026-05-08
**Domain:** Transactional email substrate (Resend SDK + Inngest async + react-email templates) on Next.js 15 App Router + Better Auth 1.5.5 + Drizzle 0.45.x + Vercel
**Confidence:** HIGH (locked decisions in CONTEXT.md narrow the design space; SDK shapes verified against npm registry + official docs via WebSearch)

## Summary

Phase 8 swaps the silent-fail nodemailer SMTP transport at `src/lib/email.ts` for the Resend SDK while preserving the three exported function signatures (`sendPasswordResetEmail`, `sendInviteEmail`, `sendExternalInviteEmail`) so call sites at `src/lib/auth.ts:13-24` are untouched. The HTML body switches from the inline `buildBrandedEmail` helper (deleted) to react-email components rendered via `@react-email/render`, with brand tokens centralised in `src/emails/brand.ts`. A new self-serve `/account/security` page wraps `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })` and chains a confirmation email. An Inngest client (`src/inngest/client.ts`) + send-email function + `/api/inngest/route.ts` mount the async substrate Phase 9 will consume; a new thin `email_log` table (Drizzle migration `0041`) audits every send with a `(kind, payload_hash)` unique index for digest idempotency. EMAIL-03 prod deliverability is operator-driven (D-14): Claude verifies request side, operator verifies inbox side.

**Primary recommendation:** Build in this order — (1) `email_log` migration + Resend transport drop-in keeping signatures stable, (2) react-email templates + brand module, (3) Inngest substrate + `/api/inngest` route + send-email function (smoke-tested via dev server), (4) `/account/security` UI + confirmation email (route through Inngest to exercise the substrate, per CONTEXT.md Claude's-discretion item), (5) Brevo fallback doc + DNS runbook + operator UAT checklist. Lockfile regen via `linux/amd64` Docker recipe (mandatory) lands in plan 08-01 alongside the dep additions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Render branded email HTML | Backend (server-only `react-email`) | — | `@react-email/render` runs in Node; the React JSX never ships to the browser. Templates live under `src/emails/` and are imported only in server-side code (`email.ts` + Inngest functions). |
| Send transactional email (auth flows) | Backend / API request handler | — | D-03: sync Resend in handler. No queue. UI surfaces failure (D-04). |
| Send async email (digests / confirmation / Phase 9) | Backend / Inngest function | — | D-05: digests + notifications + reports + the EMAIL-02 confirmation ride Inngest. `step.run('resend', ...)` provides retry. |
| Receive Inngest webhooks | Backend / Next.js Route Handler | — | `src/app/api/inngest/route.ts` exports `serve({ client, functions })` over GET/POST/PUT. Signing-key verifies origin. |
| Audit log of every send | Database / `email_log` table | Backend (writer) | D-06: write `email_log` regardless of transport. Unique idx `(kind, payload_hash)` enforces digest idempotency at the DB. |
| Self-serve change-password form | Frontend / Browser | Backend (Better Auth API) | Form is a `"use client"` component using `react-hook-form` + Better Auth client SDK; server fields never see plaintext password except inside Better Auth's hasher. |
| `/account/security` route shell | Frontend Server (RSC) | — | New `(app)/account/security/page.tsx` is an RSC that renders the client form. Layout requires session like all other `(app)/*` routes. |
| DNS records for `command.weknowgroup.com` | External / Operator | — | Operator-driven manual DNS work at the registrar. Phase 8 ships a runbook, not automation. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `resend` | `6.12.3` (locked target `6.12.2` from carryover doc — bump to current minor patch) | Transactional email send (HTTP API client) | Locked v1.0-close 2026-04-29; best Next.js DX, EU region, native React-template support. [VERIFIED: `npm view resend version` → 6.12.3] |
| `inngest` | `4.3.0` (locked target `4.2.6` — minor bump, no breaking change) | Async / queue / cron substrate; retries; signing-key webhook verification | Locked v1.1 scoping 2026-05-03; replaces the bespoke `email_jobs` table idea wholesale. [VERIFIED: `npm view inngest version` → 4.3.0] |
| `react-email` | `6.1.1` | Dev server (`react-email dev`) for previewing templates locally | Adds an `npm run email:dev` script per D-08; preview port defaults to 3000 (collides with Next dev port 3003 — non-issue). [VERIFIED: `npm view react-email version` → 6.1.1] |
| `@react-email/components` | `1.0.12` | JSX building-blocks: `<Html>`, `<Head>`, `<Body>`, `<Container>`, `<Section>`, `<Heading>`, `<Text>`, `<Button>`, `<Hr>`, `<Img>`, `<Link>`, optional `<Tailwind>` | Locked D-07 substrate. [VERIFIED: `npm view @react-email/components version` → 1.0.12] |
| `@react-email/render` | `2.0.8` | `render(<Component />, options)` → HTML string for Resend's `html:` field | Required when sending via Inngest steps (where the JSX must become a serialisable string before the step boundary). [VERIFIED: `npm view @react-email/render version` → 2.0.8] |

### Supporting (already in tree — reuse, don't re-add)
| Library | Existing version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-auth` | `^1.5.5` | `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })` for EMAIL-02 | Confirmed via `src/lib/auth-client.ts`. [VERIFIED: codebase + WebSearch — Better Auth 1.5.x exposes `changePassword` with `revokeOtherSessions: boolean` flag] |
| `react-hook-form` | `^7.71.2` | `/account/security` form binding | Same pattern as `login-form.tsx` / `reset-password-form.tsx`. |
| `@hookform/resolvers` | `^5.2.2` | Zod resolver for the form | Already used in every auth form. |
| `zod` | `^4.3.6` (uses `zod/v4` import path in places) | Validation schema for current/new/confirm fields | The `(app)/settings/users/actions.ts` server action already imports `zod/v4` — match that style. |
| `sonner` | `^2.0.7` | Toast on success/failure | Established pattern in `login-form.tsx`, `reset-password-form.tsx`. |
| `drizzle-orm` | `^0.45.1` | `email_log` table definition + insert | Migration target is `migrations/0041_phase_08_email_log.sql`. |
| `drizzle-kit` | `^0.31.10` | Generate the SQL migration | Project uses **numbered SQL migrations**, NOT `drizzle-kit push` (verified: `migrations/0001_*.sql` … `migrations/0040_*.sql` exist; `drizzle.config.ts` sets `out: "./migrations"`). |

### Removed deps
| Library | Action | Why |
|---------|--------|-----|
| `nodemailer@^8.0.3` | Remove from `dependencies` | Transport replaced wholesale. |
| `@types/nodemailer@^7.0.11` | Remove from `devDependencies` | No remaining import. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Resend | Brevo SDK | Locked as documented fallback only (D-13 in CONTEXT.md, V2-EMAIL-01 in carryover doc). `docs/email-fallback-brevo.md` ships in Phase 8 but no implementation. |
| Inngest | Trigger.dev / BullMQ + Upstash Redis / Vercel Cron + DB queue | Locked at v1.1 scoping. Inngest is the smallest total surface area; DB queue would mean ~200 LOC of polling/locking/backoff we own forever. |
| `@react-email/render` (pre-render to HTML) | Pass JSX directly to `resend.emails.send({ react: <C /> })` | Fine for sync sends from `email.ts`. NOT fine for Inngest sends — `step.run` results must be serialisable, so JSX must be rendered to HTML before the step boundary. Use `react:` field for sync-Resend path; use `render()` + `html:` field for Inngest path. |

**Installation:**
```bash
npm install resend@6.12.3 inngest@4.3.0 @react-email/components@1.0.12 @react-email/render@2.0.8
npm install --save-dev react-email@6.1.1
npm uninstall nodemailer @types/nodemailer
```

**Then regenerate the lockfile via the linux/amd64 Docker recipe in `CLAUDE.md`** — multiple new packages with platform-native bindings (none in this set should pull wasm32-wasi today, but the `react-email` dev tooling chain has historically pulled `@rolldown/binding-*` via `tsdown`). Do NOT regen on macOS. Do NOT run `npm install` between the Docker regen and the commit.

**Version verification (run before plan 08-01 lands):**
```bash
npm view resend version
npm view inngest version
npm view @react-email/components version
npm view @react-email/render version
npm view react-email version
```
Ran 2026-05-08; all five versions above are current. Re-verify if plan 08-01 lands more than ~2 weeks after this date.

[VERIFIED: npm registry, 2026-05-08]

## Architecture Patterns

### System Architecture Diagram

```
                    ┌──────────────────────────────────┐
                    │   Browser  (signed-in user)      │
                    │   /account/security  (form)      │
                    └───────────────┬──────────────────┘
                                    │ authClient.changePassword(...)
                                    ▼
        ┌─────────────────────────────────────────────────────┐
        │   Better Auth /api/auth/[...all]/route.ts            │
        │   (verifies current pw, hashes + writes account.pw)  │
        └───────────────┬─────────────────────────────────────┘
                        │ on success
                        ▼
        ┌──────────────────────────────────────────┐         ┌─────────────────────────┐
        │   Server action OR client-side chain     │────────▶│   inngest.send({         │
        │   triggers email send                    │  event  │     name: 'email/send.   │
        └──────────────────────────────────────────┘         │       requested',        │
                                                             │     data: { kind, ... }  │
                                                             │   })                     │
                                                             └────────────┬────────────┘
                                                                          │
            ┌─────────────────────────────────────────────────────────────┘
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  Inngest cloud  ── (HTTPS POST + signing-key)──▶  /api/inngest/route.ts      │
│                                                                               │
│   sendEmailFn                                                                 │
│     step.run('render-html')   → @react-email/render(<Template />)             │
│     step.run('resend')        → resend.emails.send({ html, ... })             │
│     step.run('log')           → db.insert(emailLog).values({ status:'sent' }) │
│   retries: 5, exponential backoff                                             │
└──────────────────────────────────────────────────────────────────────────────┘

Sync path (auth flows: forgot-pw / invite / external-invite) — does NOT touch Inngest:

   /api/auth/[...all]   ──▶   sendResetPassword hook   ──▶   src/lib/email.ts
                                                                    │
                                       ┌────────────────────────────┤
                                       ▼                            ▼
                              resend.emails.send({         db.insert(emailLog)
                                react: <Tmpl />, ...        .values({ status:'sent'|
                              })                            'failed', ... })
                                       │
                                       └─▶ surface non-2xx to UI as toast/inline error
```

Two send paths, one audit table:
- **Sync Resend** (auth handler) — zero queue latency, surfaces failure to UI (D-04). `email_log.inngest_run_id = NULL`.
- **Inngest async** (digests, confirmation, Phase 9) — retry + idempotency + signing-key verified webhook. `email_log.inngest_run_id = <run-id>`.

### Recommended Project Structure
```
src/
├── lib/
│   └── email.ts                      # MODIFY: Resend transport (signatures locked)
├── emails/                           # NEW: react-email templates
│   ├── brand.ts                      # Azure / Graphite / font-stack tokens
│   ├── _layout.tsx                   # Shared header (WK logo) + footer wrapper
│   ├── password-reset.tsx
│   ├── invite.tsx                    # internal invite (was sendInviteEmail body)
│   ├── external-invite.tsx           # external/analytics-portal invite
│   └── password-changed.tsx          # NEW for EMAIL-02
├── inngest/                          # NEW
│   ├── client.ts                     # new Inngest({ id: 'wkg-kiosk-tool' })
│   ├── events.ts                     # event-name + payload typing
│   └── functions/
│       └── send-email.ts             # send-email function (retries: 5)
├── db/
│   └── schema.ts                     # APPEND: emailLog pgTable + unique index
├── app/
│   ├── api/
│   │   └── inngest/
│   │       └── route.ts              # NEW: serve({ client, functions })
│   ├── (app)/
│   │   └── account/                  # NEW route group leaf
│   │       ├── layout.tsx            # minimal scaffold (no tabs yet)
│   │       └── security/
│   │           ├── page.tsx          # RSC; session-gated by (app)/layout.tsx
│   │           └── change-password-form.tsx  # 'use client'
│   └── (auth)/                       # UNTOUCHED — login/reset-password/set-password
└── ...
migrations/
└── 0041_phase_08_email_log.sql       # NEW
docs/
└── email-fallback-brevo.md           # NEW: documented-only fallback (D-13)
tests/
├── auth/
│   └── change-password.spec.ts       # NEW Playwright spec (EMAIL-02 happy path)
├── email/                            # NEW
│   ├── email-log.integration.test.ts # idempotency: insert twice → 1 row
│   └── send-email-fn.integration.test.ts  # Inngest function asserts log row written
└── ...
```

### Pattern 1: Resend transport drop-in (sync, signatures locked)

**What:** Replace nodemailer transport in `src/lib/email.ts` with Resend client; preserve the three exported function signatures so callers (`src/lib/auth.ts:18-22`) need zero changes.

**When to use:** Any auth-flow email (D-03 sync rule).

**Skeleton:**
```typescript
// src/lib/email.ts
import { Resend } from 'resend';
import { db } from '@/db';
import { emailLog } from '@/db/schema';
import { PasswordResetEmail } from '@/emails/password-reset';
import { InviteEmail } from '@/emails/invite';
import { ExternalInviteEmail } from '@/emails/external-invite';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? 'noreply@command.weknowgroup.com';

async function send({
  to,
  subject,
  react,
  kind,
}: {
  to: string;
  subject: string;
  react: React.ReactElement;
  kind: 'password_reset' | 'invite' | 'external_invite';
}): Promise<{ id: string | null; error: string | null }> {
  const result = await resend.emails.send({ from: FROM, to, subject, react });
  // resend-node v6 returns { data: { id } | null, error: ... | null }
  const messageId = result.data?.id ?? null;
  const errorMsg = result.error ? String(result.error.message ?? result.error) : null;

  await db.insert(emailLog).values({
    kind,
    recipient: to,
    resendMessageId: messageId,
    inngestRunId: null,
    status: errorMsg ? 'failed' : 'sent',
    lastError: errorMsg,
    payloadHash: null, // auth-flow sends are intentionally not deduped
  });

  return { id: messageId, error: errorMsg };
}

export async function sendPasswordResetEmail({ to, resetUrl }: { to: string; resetUrl: string }) {
  const r = await send({
    to,
    subject: 'Reset your password — WeKnow',
    react: PasswordResetEmail({ resetUrl }),
    kind: 'password_reset',
  });
  if (r.error) throw new Error(`Email send failed: ${r.error}`); // surfaces via Better Auth → form (D-04)
}
// sendInviteEmail / sendExternalInviteEmail follow the same shape; bodies switch templates only.
```

**Source for Resend response shape:** [Resend Node SDK](https://www.npmjs.com/package/resend), [Send email using Resend - React Email](https://react.email/docs/integrations/resend). `result.data.id` is the canonical `resendMessageId`; `result.error` is `{ message, name }` on failure. [VERIFIED: WebSearch + carryover doc + npm registry]

### Pattern 2: Inngest send-email function

**What:** A single Inngest function (`email/send.requested`) renders a template and calls Resend with retry + idempotency + audit-log write — the substrate Phase 9 + EMAIL-02 confirmation ride.

**When to use:** Anything not auth-flow (D-05): digests, confirmation, notifications, reports.

**Skeleton:**
```typescript
// src/inngest/client.ts
import { Inngest } from 'inngest';
export const inngest = new Inngest({ id: 'wkg-kiosk-tool' });

// src/inngest/events.ts
export type EmailSendRequested = {
  name: 'email/send.requested';
  data: {
    kind: 'password_changed' | 'digest_daily' | 'kiosk_offline' | string;
    to: string;
    subject: string;
    template: 'password-changed' | string;        // dispatch key
    templateProps: Record<string, unknown>;       // serialisable JSON
    payloadHash?: string;                         // optional; for digest dedupe
  };
};

// src/inngest/functions/send-email.ts
import { inngest } from '../client';
import { Resend } from 'resend';
import { render } from '@react-email/render';
import { db } from '@/db';
import { emailLog } from '@/db/schema';
import { PasswordChangedEmail } from '@/emails/password-changed';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM ?? 'noreply@command.weknowgroup.com';

const TEMPLATES = {
  'password-changed': PasswordChangedEmail,
  // ...future Phase 9 templates
};

export const sendEmailFn = inngest.createFunction(
  { id: 'send-email', retries: 5 },                       // exponential backoff built in
  { event: 'email/send.requested' },
  async ({ event, step, runId }) => {
    const { kind, to, subject, template, templateProps, payloadHash } = event.data;

    const html = await step.run('render-html', async () => {
      const Component = TEMPLATES[template as keyof typeof TEMPLATES];
      return await render(Component(templateProps as never)); // Promise<string> in render v2+
    });

    const sendResult = await step.run('resend-send', async () => {
      return await resend.emails.send({ from: FROM, to, subject, html });
    });

    await step.run('log', async () => {
      await db
        .insert(emailLog)
        .values({
          kind,
          recipient: to,
          resendMessageId: sendResult.data?.id ?? null,
          inngestRunId: runId,
          status: sendResult.error ? 'failed' : 'sent',
          lastError: sendResult.error ? String(sendResult.error.message ?? sendResult.error) : null,
          payloadHash: payloadHash ?? null,
        })
        .onConflictDoNothing({ target: [emailLog.kind, emailLog.payloadHash] });
        // The unique index on (kind, payload_hash) makes duplicate sends a no-op INSERT.
    });

    if (sendResult.error) throw new Error(String(sendResult.error.message ?? sendResult.error));
    // Throwing → Inngest retries with exponential backoff up to retries=5.
  },
);
```

```typescript
// src/app/api/inngest/route.ts
import { serve } from 'inngest/next';
import { inngest } from '@/inngest/client';
import { sendEmailFn } from '@/inngest/functions/send-email';

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [sendEmailFn],
  // signingKey defaults to process.env.INNGEST_SIGNING_KEY
});
```

**Source:** [Next.js Quick Start - Inngest Documentation](https://www.inngest.com/docs/getting-started/nextjs-quick-start), [Inngest npm](https://www.npmjs.com/package/inngest). Inngest auto-reads `INNGEST_EVENT_KEY` (sender) + `INNGEST_SIGNING_KEY` (webhook auth) from env. [CITED: inngest docs]

### Pattern 3: react-email base layout + branded template

**Skeleton:**
```typescript
// src/emails/brand.ts
export const BRAND = {
  azure: '#00A6D3',
  graphite: '#121212',
  white: '#FFFFFF',
  // Circular Pro is paid; email clients won't fetch web fonts reliably anyway.
  // Fall back to system stack matching the logged-in app (login-form.tsx uses --font-sans).
  fontStack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  productName: 'WeKnow Command Centre',
  prodUrl: 'https://wkg-command-centre.vercel.app',
};
```

```typescript
// src/emails/_layout.tsx
import { Html, Head, Body, Container, Section, Text, Hr, Img } from '@react-email/components';
import { BRAND } from './brand';

export function EmailLayout({ children, preheader }: { children: React.ReactNode; preheader?: string }) {
  return (
    <Html>
      <Head />
      {preheader && <div style={{ display: 'none', maxHeight: 0, overflow: 'hidden' }}>{preheader}</div>}
      <Body style={{ backgroundColor: '#f5f5f5', fontFamily: BRAND.fontStack, margin: 0, padding: 0 }}>
        <Container style={{ maxWidth: 560, margin: '40px auto', padding: '32px', backgroundColor: BRAND.white, borderRadius: 8 }}>
          <Section style={{ marginBottom: 32 }}>
            {/* TODO: replace WK text-mark with hosted PNG logo once asset lands; do not link to weknowgroup.com from email image (cookie-tracking concerns). */}
            <Text style={{ fontSize: 20, fontWeight: 700, color: BRAND.graphite, margin: 0, letterSpacing: '-0.01em' }}>WK</Text>
          </Section>
          {children}
          <Hr style={{ borderColor: '#e5e5e5', margin: '32px 0 16px' }} />
          <Text style={{ fontSize: 12, color: '#888', margin: 0 }}>
            {BRAND.productName} · <a href={BRAND.prodUrl} style={{ color: BRAND.azure, textDecoration: 'none' }}>{BRAND.prodUrl}</a>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
```

```typescript
// src/emails/password-changed.tsx
import { Heading, Text, Button } from '@react-email/components';
import { EmailLayout } from './_layout';
import { BRAND } from './brand';

export function PasswordChangedEmail({ changedAt, contactAdminUrl }: { changedAt: string; contactAdminUrl: string }) {
  return (
    <EmailLayout preheader={`Your password was changed on ${changedAt}`}>
      <Heading style={{ fontSize: 24, fontWeight: 600, color: BRAND.graphite, margin: '0 0 16px' }}>
        Your password was changed
      </Heading>
      <Text style={{ fontSize: 15, lineHeight: 1.6, color: '#333', margin: '0 0 16px' }}>
        Your WeKnow Command Centre password was changed on <strong>{changedAt}</strong>.
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 1.6, color: '#333', margin: '0 0 24px' }}>
        If this wasn&rsquo;t you, please contact your administrator immediately.
      </Text>
      <Button href={contactAdminUrl} style={{ display: 'inline-block', padding: '12px 24px', backgroundColor: BRAND.azure, color: BRAND.white, textDecoration: 'none', borderRadius: 6, fontWeight: 500, fontSize: 15 }}>
        Contact admin
      </Button>
    </EmailLayout>
  );
}
```

**Render shape:**
```typescript
import { render } from '@react-email/render';
const html = await render(<PasswordChangedEmail changedAt="2026-05-09 11:42 BST" contactAdminUrl="mailto:vedant.kalbag@weknowgroup.com" />);
// render() is async in v2+; returns string.
```

**Source:** [Render - React Email](https://react.email/docs/utilities/render), [@react-email/render npm](https://www.npmjs.com/package/@react-email/render). Inline styles are mandatory — Gmail/Outlook strip `<style>` tags. The optional `<Tailwind>` component compiles utility classes to inline styles at render time, but introduces another moving part; recommend skipping for v1.1 and using inline styles directly. [CITED: react.email docs]

### Pattern 4: `/account/security` page + change-password form

**Skeleton:**
```typescript
// src/app/(app)/account/layout.tsx — minimal, no tabs yet (D-12)
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <div className="max-w-2xl mx-auto py-8 px-4">{children}</div>;
}

// src/app/(app)/account/security/page.tsx — RSC, session-gated by (app)/layout.tsx
import { ChangePasswordForm } from './change-password-form';

export default function SecurityPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-[-0.01em] text-foreground">Security</h1>
      <ChangePasswordForm />
    </div>
  );
}

// src/app/(app)/account/security/change-password-form.tsx — 'use client'
'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

const schema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
  confirm: z.string(),
}).refine((d) => d.newPassword === d.confirm, { path: ['confirm'], message: 'Passwords do not match' });

type Values = z.infer<typeof schema>;

export function ChangePasswordForm() {
  const [isLoading, setIsLoading] = useState(false);
  const { register, handleSubmit, formState: { errors }, reset } = useForm<Values>({ resolver: zodResolver(schema), mode: 'onBlur' });

  async function onSubmit(data: Values) {
    setIsLoading(true);
    try {
      const result = await authClient.changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        revokeOtherSessions: true,                         // D-10: surface in UI copy
      });
      if ('error' in result && result.error) {
        toast.error(result.error.message ?? 'Failed to change password');
        return;
      }
      // Trigger confirmation email — server action chain or direct fetch to a small POST route.
      await fetch('/api/account/password-changed', { method: 'POST' });  // calls inngest.send(...)
      toast.success('Password changed. Other sessions signed out.');
      reset();
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  // ... markup follows reset-password-form.tsx + login-form.tsx pattern (Label/Input/Button/AlertCircle)
}
```

**Better Auth API confirmed:** `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })` — `revokeOtherSessions: true` invalidates all other active sessions (the current one survives). On failure returns `{ error: { message } }`. [CITED: Better Auth Email & Password docs via WebSearch] [VERIFIED: codebase already uses `auth.$context.password.hash()` in `scripts/reset-admin-password.ts` confirming Better Auth's hasher pipeline]

**Confirmation-email triggering decision (Claude's discretion per CONTEXT.md):** Route via Inngest. Justification: it's the lowest-cost moment to exercise the substrate before Phase 9 depends on it; failure of the confirmation email never blocks the user (they already got the toast); retry semantics matter more for confirmation than for forgot-password (where a missing email is recoverable by re-requesting). The `/api/account/password-changed` POST endpoint is a thin server-side wrapper that:
1. Re-fetches the session via `auth.api.getSession`,
2. Calls `inngest.send({ name: 'email/send.requested', data: { kind: 'password_changed', to: session.user.email, subject: 'Your WeKnow password was changed', template: 'password-changed', templateProps: { changedAt: new Date().toISOString(), contactAdminUrl: 'mailto:vedant.kalbag@weknowgroup.com' } } })`.

### Pattern 5: `email_log` Drizzle schema + migration

**Drizzle schema (append to `src/db/schema.ts`):**
```typescript
import { pgTable, uuid, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),                           // 'password_reset' | 'invite' | 'external_invite' | 'password_changed' | 'digest_*' | 'kiosk_offline'
    recipient: text('recipient').notNull(),
    resendMessageId: text('resend_message_id'),
    inngestRunId: text('inngest_run_id'),
    status: text('status').notNull(),                       // 'sent' | 'failed' | 'bounced'
    lastError: text('last_error'),                          // text not jsonb — keep one-row format simple; future-jsonb is non-breaking column-type change
    payloadHash: text('payload_hash'),                      // sha256(kind + recipient + period_start) for digests; NULL for auth-flow sends
    createdAt: timestamp('created_at', { withTimezone: false }).defaultNow().notNull(),
  },
  (t) => ({
    // Partial unique idx — only enforce uniqueness when payload_hash is set (digest sends).
    // Auth-flow sends with NULL payload_hash never collide.
    kindPayloadHashUq: uniqueIndex('email_log_kind_payload_hash_uq')
      .on(t.kind, t.payloadHash)
      .where(sql`payload_hash IS NOT NULL`),
    recipientCreatedAtIdx: index('email_log_recipient_created_at_idx').on(t.recipient, t.createdAt.desc()),
  }),
);
```

**Migration file:** `migrations/0041_phase_08_email_log.sql` — generated via `npx drizzle-kit generate` (then hand-review SQL output for the partial-unique-index clause; drizzle-kit historically emits these correctly but verify).

**Why partial unique idx (not plain unique on `(kind, payload_hash)`):** Postgres treats NULL as distinct in unique constraints — a plain unique idx on `(kind, payload_hash)` would technically allow infinite NULL/NULL rows but each non-NULL pair would still dedupe correctly. Partial idx is cleaner and clearer about intent. Check the Phase 7 migrations for partial-unique-idx prior art: `migrations/0033_..._and_admin_settings.sql` and `migrations/0039_phase_07_normalised_name_and_merge_snapshots.sql` both use partial-unique-idx (`WHERE archived_at IS NULL`).

### Anti-Patterns to Avoid
- **Pre-rendering JSX inside the inngest payload** — `inngest.send({ data: { html: render(<X/>) } })` is fine technically but inflates payload size 10-50x and ties payload format to template version. Pass `template` + `templateProps` and render inside the function (Pattern 2). Source: same rationale as the carryover doc's "Inngest holds the queue, we render inside the worker."
- **Sending JSX through Inngest steps** — JSX is a non-serialisable object. `step.run('render', () => <Tmpl />)` will silently misbehave. Always render to HTML string inside `step.run`.
- **Using `Resend` constructor with no API key** — when `RESEND_API_KEY` is unset (local dev without MailHog shim), the SDK throws on first send. Gate the constructor behind the env presence; fall back to a console-log shim for local dev (Claude's-discretion item per CONTEXT.md — recommend MailHog `localhost:1025` only when explicitly set, otherwise console.log so onboarding works zero-config).
- **Inline-styling outside react-email primitives** — using a top-level `<style>` block. Gmail strips `<style>` in the desktop client. Apply `style={{...}}` on every component.
- **Using `email_log.payloadHash` for auth-flow sends** — defeats the "every reset is intentional" UX. Leave NULL (D-06).
- **Calling `authClient.changePassword` from a Server Action** — `authClient` is the browser SDK; from server use `auth.api.changePassword({ body, headers })`. The form is a `'use client'` component for a reason — the password leaves the browser only inside Better Auth's standard request shape.
- **Not chaining the confirmation email after success** — leaving it to the user means it never ships. Post-success `await fetch('/api/account/password-changed', { method: 'POST' })` before the success toast (or fire-and-forget after; either is fine — the email is non-blocking).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Email retry/backoff | Custom `setTimeout` retry loop in `email.ts` | Inngest `retries: 5` (exponential backoff built in) | Locked v1.1 scoping. We tried writing this in v1.0 (`email_jobs` table sketch in V2-EMAIL-04); it was 200+ LOC of polling/locking we'd own forever. |
| Email queue table | A new `email_jobs` Drizzle table with status enum + cron worker | Inngest holds queue state | Locked. `email_log` is audit-only (D-06). |
| Email idempotency | `if (already_sent_today) return;` checks in code | DB-level unique idx on `(kind, payload_hash)` | Atomic. Won't race. Survives process restarts. |
| Webhook signature verification | Manually verifying X-Inngest-Signature headers | `inngest/next`'s `serve()` handles signing-key verification | Built in. Set `INNGEST_SIGNING_KEY` and forget. |
| HTML email layout from template strings | `buildBrandedEmail({heading, body, ...})` pattern (current `email.ts`) | react-email `<Container>/<Section>/<Heading>/<Button>/<Hr>/<Img>` primitives | Existing helper handles 4 emails badly; Phase 9 needs 5+ richer ones. Inline strings are a dead-end (D-07). |
| Password complexity rules | Custom regex + zod predicates ("requires uppercase, number, symbol") | Better Auth's built-in min-length + project's `z.string().min(8)` | EMAIL-02 ships a basic form; D-12 / Out-of-Scope explicitly defers password-strength meter + breach-check to v1.2. |
| Cron schedule for daily digest | `vercel.json` `crons:` entry | Inngest function with `{ cron: 'TZ=Europe/London 0 7 * * *' }` trigger | Locked at v1.1 scoping. Phase 8 doesn't ship the digest; Phase 9 does, but we set the rail by *not* adding `vercel.json` cron entries here. |

**Key insight:** Every hand-rolled solution above costs maintenance forever; every "use the library" choice resolves an entire class of bugs at the SDK boundary. The locked decisions in CONTEXT.md already reflect this. Do not re-litigate.

## Common Pitfalls

### Pitfall 1: Lockfile drift on dep additions
**What goes wrong:** CI fails on `npm ci` with `Missing: @emnapi/core@... from lock file` or runtime fails with `Cannot find module '@*/binding-linux-x64-gnu'`.
**Why it happens:** `react-email` pulls dev-only build tooling that may include wasm32-wasi bindings; lockfile generated on macOS-arm64 lacks the linux-x64 entries CI needs. See `CLAUDE.md` § "npm ci lockfile must stay in sync".
**How to avoid:** Mandatory linux/amd64 Docker regen recipe from `CLAUDE.md`. Do NOT regen on macOS. Verify with `grep '"node_modules/@rolldown/binding-linux-x64-gnu"' package-lock.json` returning a result.
**Warning signs:** `npm ci` succeeds locally but fails CI; `npm ci --dry-run` on macOS shows green but vitest/next break under `npm ci` on Linux.

### Pitfall 2: `BETTER_AUTH_URL` pinned to per-deploy URL → all `/api/auth/*` calls 403
**What goes wrong:** Vercel mints a new deployment hash per redeploy; stale `BETTER_AUTH_URL` no longer matches request origin → 403 Invalid Origin.
**Why it happens:** `trustedOrigins` defaults to `BETTER_AUTH_URL` only in Better Auth.
**How to avoid:** Use the git-branch alias `wkg-command-centre-git-<sanitized-branch>-vedant-kalbag-wkgs-projects.vercel.app` (auto-generated, repoints on each push to that branch). See `CLAUDE.md` § "Vercel preview env vars". **Same rule applies to `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`** for Phase 8 preview UAT.
**Warning signs:** Forgot-password / change-password forms show generic error on preview but work on prod (or vice versa).

### Pitfall 3: Playwright `--list` green ≠ spec actually runs
**What goes wrong:** CI greenlights a phase because Playwright spec parses; the actual test never executes against preview; regression escapes to prod.
**Why it happens:** Listed at https://CLAUDE.md § "Playwright specs against preview deploys (not just `--list`)". Phase 6 plan 06-05 shipped exactly this regression.
**How to avoid:** Run with `PLAYWRIGHT_BASE_URL=<git-branch-alias>` against the live preview before declaring done. EMAIL-02's `tests/auth/change-password.spec.ts` MUST run end-to-end against the preview.
**Warning signs:** Playwright reports "0 tests run" or "1 test passed" suspiciously fast on a spec the operator believes does navigation work.

### Pitfall 4: `react:` field swallows JSX serialisation errors silently
**What goes wrong:** Passing a malformed JSX tree to `resend.emails.send({ react: ... })` returns a 422 with an error message that sometimes doesn't surface clearly in `result.error`.
**Why it happens:** Resend renders JSX server-side via its own internal call to `@react-email/render`; render-time errors don't always become typed errors.
**How to avoid:** Always wrap the call in try/catch and inspect `result.error` even on a 2xx. For Inngest path, use explicit `await render(<Tmpl/>)` first then `html:` field — error happens at our boundary, easier to debug. (This is Pattern 2.)

### Pitfall 5: `email_log` writes inside `step.run` but Resend already sent
**What goes wrong:** Inngest retries the *step* — if `step.run('log')` fails (DB blip), Resend has already sent. Idempotent-retry semantics: the next retry of the failed step succeeds, but the next retry of the whole function would resend.
**Why it happens:** Misunderstanding step boundaries. Inngest only retries the failed step; previous steps (like `step.run('resend')`) are memoised and not re-executed on retry.
**How to avoid:** Trust Inngest's step memoisation — Pattern 2 is correct. The `step.run('resend')` returns the same value on retry without resending. (Verify in Inngest dev server: trigger a `step.run('log')` failure manually and confirm Resend's dashboard shows 1 send, not 2.) [CITED: inngest docs on step idempotency]
**Warning signs:** Resend dashboard shows duplicate sends for a single Inngest run. If this happens, `step.run('resend')` is being called outside `step.run` (i.e. in plain JS); pull it back inside.

### Pitfall 6: `emailLog.lastError` storing JSON-stringified error → unindexable + breaks queries
**What goes wrong:** Storing `JSON.stringify(error)` in a `text` column produces opaque, unsortable error blobs.
**How to avoid:** Store `error.message` as plain text (Pattern 2). Future-proof: if we ever want structured errors, migrate `text → jsonb` is a non-breaking column-type change.

### Pitfall 7: Confirmation email leaks user's IP/UA via well-meaning "security" copy
**What goes wrong:** Copying the typical "Your password was changed from IP 1.2.3.4 (Chrome on macOS)" pattern from consumer apps adds PII to `email_log` (which we'd need a retention policy for) and creates a privacy-review surface.
**How to avoid:** D-11 explicitly locks this out. Timestamp + "contact admin" only. The plan's templates and copy must not silently grow IP/UA fields.

### Pitfall 8: DKIM CNAME records on parent zone vs subdomain zone
**What goes wrong:** Operator adds Resend's DKIM records to `weknowgroup.com` zone instead of the `command.weknowgroup.com` zone (or vice versa), domain shows partially_verified status, mail bounces.
**How to avoid:** When adding subdomain `command.weknowgroup.com` to Resend, the records (e.g. `resend._domainkey.command`, `_dmarc.command`, SPF TXT on `command`) live in the parent `weknowgroup.com` zone but with `command.` prefix on the record name. Most DNS UIs (GoDaddy, Cloudflare) handle this transparently — operator copies the host name Resend shows, with no zone-ambiguity.

## Runtime State Inventory

> Phase 8 is primarily greenfield (new templates, new substrate, new route, new audit table) but does swap the email transport in place. Inventory below tracks the swap surface.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no existing email-related table; `email_log` is brand-new in this phase. | None. |
| Live service config | **Resend dashboard** holds domain-verification state, API keys, send logs. **Inngest dashboard** holds function registrations + run history. Both are operator-managed via web UI; not in git. | Document in plan SUMMARY: API key rotation procedure + which Resend Domain object pairs with which Vercel env. |
| OS-registered state | None — Vercel-hosted; no pm2 / launchd / Task Scheduler involvement. | None. |
| Secrets/env vars | **NEW on Vercel preview + prod:** `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` (optional), `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`. **TO REMOVE if set:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (probably never set in prod, but check). `.env.example` updated to reflect the new shape. | Plan task: `vercel env add` for each new var on preview alias + prod. Update `.env.example` + `.env.test` template. Update `scripts/preflight-env.ts` (referenced in `package.json`'s build script) if it asserts on these. |
| Build artifacts / installed packages | `nodemailer` removal triggers `npm ci` to delete `node_modules/nodemailer`; lockfile regen needed (Pitfall 1). `react-email` CLI is dev-only — installed in `devDependencies`, doesn't ship to Vercel runtime. | Lockfile regen via Docker recipe; verify no remaining `import "nodemailer"` (grep the codebase post-merge). |

**The canonical question (rename/refactor angle):** After every file is updated, what runtime systems still have nodemailer state? Answer: nothing — nodemailer was a no-op in prod (it was sending to `localhost:1025` which doesn't exist), so there's no in-flight state to drain. The swap is structurally clean. The only operator-facing handoff is the Vercel env-var update + DNS records.

## Code Examples

### Better Auth client-side change-password
```typescript
// src/lib/auth-client.ts already exists; just call:
import { authClient } from '@/lib/auth-client';

const result = await authClient.changePassword({
  currentPassword: 'old',
  newPassword: 'new123!@#',
  revokeOtherSessions: true,            // signs out other devices/browsers
});

// result.error?.message is the failure reason ('Invalid password' | 'Password too short' | ...)
```
[CITED: better-auth.com/docs/authentication/email-password]

### Resend with React JSX directly (sync path — auth flows)
```typescript
import { Resend } from 'resend';
import { PasswordResetEmail } from '@/emails/password-reset';

const resend = new Resend(process.env.RESEND_API_KEY);
const { data, error } = await resend.emails.send({
  from: 'noreply@command.weknowgroup.com',
  to: 'user@example.com',
  subject: 'Reset your password — WeKnow',
  react: PasswordResetEmail({ resetUrl: '...' }),
});
// data?.id is the resend_message_id; error is null on 2xx.
```
[CITED: react.email/docs/integrations/resend, github.com/resend/resend-node]

### Resend with pre-rendered HTML (Inngest path)
```typescript
import { render } from '@react-email/render';
const html = await render(<PasswordChangedEmail changedAt="..." contactAdminUrl="..." />);
const { data, error } = await resend.emails.send({
  from: 'noreply@command.weknowgroup.com', to: 'user@example.com',
  subject: 'Your WeKnow password was changed',
  html,
});
```
[CITED: react.email/docs/utilities/render — render() returns Promise<string> in v2+]

### Inngest event send (from server action)
```typescript
// src/app/api/account/password-changed/route.ts
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { inngest } from '@/inngest/client';
import { NextResponse } from 'next/server';

export async function POST() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: 'unauthorised' }, { status: 401 });
  await inngest.send({
    name: 'email/send.requested',
    data: {
      kind: 'password_changed',
      to: session.user.email,
      subject: 'Your WeKnow password was changed',
      template: 'password-changed',
      templateProps: {
        changedAt: new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }),
        contactAdminUrl: 'mailto:vedant.kalbag@weknowgroup.com',
      },
    },
  });
  return NextResponse.json({ ok: true });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| nodemailer SMTP | Resend HTTP API | v1.1 (this phase) | Email actually delivers in prod; signatures preserved so call sites unchanged. |
| Inline HTML strings via `buildBrandedEmail` | react-email JSX components | v1.1 (this phase) | Diff-friendly templates; previewable via `react-email dev`; foundation for richer Phase 9 bodies. |
| `email_jobs` Drizzle queue table + Vercel cron | Inngest manages queue + schedule | locked v1.1 scoping | Skip ~200 LOC; built-in retries + dashboard. |
| `vercel.json` `crons:` entries | Inngest function with `{ cron: ... }` trigger | locked v1.1 scoping | Single substrate; portable cron string if v2 ever wants Vercel-only fallback. |
| Custom token-store for password reset | Better Auth's built-in reset token (`auth.emailAndPassword.sendResetPassword`) | already in place since Phase 1 | Phase 8 doesn't change; just swaps the transport at the bottom of the chain. |

**Deprecated/outdated:**
- nodemailer transport in `src/lib/email.ts` — DELETE on Phase 8 merge.
- `buildBrandedEmail` helper in `src/lib/email.ts` — DELETE on Phase 8 merge (D-09).
- `SMTP_*` env vars in `.env.example` — REPLACE with `RESEND_API_KEY` + `EMAIL_FROM` + `EMAIL_REPLY_TO` + Inngest keys.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Inngest 4.3.0 (current latest) is API-compatible with locked target 4.2.6 — patch/minor bump | Standard Stack | Low. Inngest follows semver and 4.x has been stable; if a breaking change exists, pin to `inngest@4.2.6` exactly. |
| A2 | The Inngest dev workflow is `npx inngest-cli dev` (not bundled CLI) | Pattern 2 | Low. Verify with `npx inngest-cli@latest --help` during plan 08-03; if the CLI moved, update the plan's dev runbook. |
| A3 | `@react-email/render`'s `render()` returns `Promise<string>` in v2+ (was synchronous in v0/v1) | Pattern 2 | Medium — if it's still synchronous, the `await` is harmless; if it's async and we forget `await`, we'd `step.run` returning a `Promise` object instead of the HTML. Verify against actual SDK on first integration test. |
| A4 | `resend.emails.send` returns `{ data: { id }, error }` on resend-node v6 (consistent with v3 docs) | Pattern 1 | Medium — quick fix if shape differs; first integration test catches it. |
| A5 | Drizzle 0.45.1 supports partial unique indexes via the `.where(sql\`...\`)` builder | Pattern 5 | Low — Phase 7 migrations 0033 + 0039 already use this pattern in the project. [VERIFIED: codebase] |
| A6 | Resend's domain-verification flow auto-polls DNS within ~10 minutes of records being added (operator does not need to click verify) | Section 7 below | Medium — if it requires a click, the runbook needs an explicit step. Documented as either-way in the runbook below. |
| A7 | The `command.weknowgroup.com` subdomain is operator-controlled (DNS access exists at the registrar) | Section 7 | High if wrong — blocks EMAIL-03 entirely. Operator-confirm before plan 08-03 starts. **Open question** flagged below. |
| A8 | Better Auth's `changePassword` on the client triggers no server-side `onPasswordChanged` hook (it just hashes + writes to `account.password`) | Pattern 4 | Medium — if a hook exists we could simplify by sending the email there. The fetch-after-await chain is correct regardless. |
| A9 | The existing `signIn.email(...)` / `forgetPassword(...)` client API survives the migration unchanged | n/a | Low — Phase 8 doesn't touch login or forgot-password client code; only the email transport beneath them. |
| A10 | `nodemailer` is not imported anywhere outside `src/lib/email.ts` | Runtime State Inventory | Low — verified by `grep -rln "nodemailer" src` yielding only `src/lib/email.ts` (in initial probe). |

## Open Questions

1. **Does the operator have DNS-edit access to the `weknowgroup.com` zone (where the `command.` subdomain records will live)?**
   - What we know: `weknow.co` and `weknowgroup.com` are both We Know Group-owned; the legacy `noreply@weknow.co` default in `email.ts` suggests historical access to at least `weknow.co`. Migration 0040 sets `command.weknowgroup.com` as the new sending domain.
   - What's unclear: who at WKG holds `weknowgroup.com` DNS access (likely IT/operations), and whether DNS changes route through a ticket process that adds days of latency.
   - Recommendation: Plan 08-03 (or earlier) opens a parallel DNS work-track. The plan's first task: operator confirms DNS access. If access is gated, plan timeline must accommodate. **The DNS work blocks EMAIL-03 entirely** — flag in the plan as a critical-path risk.

2. **Should plan 08-01 ship a MailHog `localhost:1025` shim for local-dev or a Resend test-mode key?**
   - What we know: CONTEXT.md flags this as Claude's discretion; default to MailHog if undecided.
   - What's unclear: how much friction MailHog adds to onboarding (need to install + run a separate process) vs Resend test-mode keys (free, but every dev needs their own).
   - Recommendation: Console-log shim by default (zero-config, see all email content in dev server output), MailHog supported via `EMAIL_DEV_TRANSPORT=mailhog` env var if a dev wants visual inspection. Resend test-mode key for any dev who wants prod-shape testing.

3. **DMARC starting policy: `p=none` for ramp-up or `p=quarantine` immediate?**
   - What we know: CONTEXT.md flags as discretion; CONTEXT.md D-02 references `p=quarantine` as the eventual target.
   - Recommendation: Start `p=none` for the first ~2 weeks of sending (collect aggregate reports via a `rua=mailto:` address — operator picks), then move to `p=quarantine`. Reasoning: a `p=quarantine` policy on day 1 with a misconfigured DKIM record routes legitimate forgot-password emails to spam during the very deliverability period we're trying to validate.

4. **Does the EMAIL-03 throwaway-user UAT need cleanup tooling, or does the operator just deactivate via the admin UI when done?**
   - What we know: The admin UI (`src/app/(app)/settings/users/`) supports deactivate + delete. Throwaway emails are operator-owned (`vedant.kalbag+test1@…` style aliasing).
   - Recommendation: Plan 08-03 SUMMARY checklist includes a "delete throwaway user" step explicitly, citing `deactivateUser` / `deleteUser` server actions.

5. **Should the WK text-mark in `_layout.tsx` be replaced with a hosted PNG logo immediately, or shipped as text-mark for v1.1?**
   - What we know: Login page (`src/app/(auth)/login/page.tsx`) uses the same WK text-mark. CONTEXT.md doesn't specify.
   - Recommendation: Ship text-mark for parity with the login page; flag a follow-up item to upgrade to a hosted PNG (with `Img` from `@react-email/components`) in Phase 11 polish if asset is available.

6. **Resend rate-limits: does the free tier (3k/mo) accommodate the EMAIL-03 UAT volume + Phase 9 daily-digest + ad-hoc reset emails?**
   - What we know: Carryover doc (V2-EMAIL-01) states "free tier covers expected volume (3k/mo)". Internal audience ~30 users.
   - Recommendation: At 30 users * 30 days * 1 email/day worst case = 900/mo, well under 3k. No action needed; flag for Phase 11 if usage grows.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Resend account | Send transactional email | Operator-managed | n/a | Brevo (documented per D-13, not implemented) |
| Inngest cloud account | Async substrate + dev server | Operator-managed | n/a | None — required. No fallback queue path. |
| `command.weknowgroup.com` subdomain | Sending FROM address | Pending operator DNS work | n/a | Could fall back to `command.weknow.co` if `weknowgroup.com` DNS access blocks. |
| `inngest-cli` (npx-runnable) | Local dev (`inngest-cli dev`) | Available via npx | latest | Install dev-dep if frequently used. |
| `react-email` CLI (npx-runnable) | Template preview | Will be in devDependencies | 6.1.1 | None — recommend via `npm run email:dev`. |
| node 22 (Vercel runtime) | All of the above | Yes (per existing build) | 22.x | n/a |

**Missing dependencies with no fallback:**
- Inngest cloud account (operator action) — sign up via inngest.com, generate event-key + signing-key, add to Vercel env. **Plan 08-03 critical-path item.**
- `command.weknowgroup.com` DNS access (operator action) — see Open Question 1.

**Missing dependencies with fallback:**
- Resend domain verification — fallback path is to use the Resend-provided `*.resend.dev` test domain for the EMAIL-03 UAT, but that breaks the deliverability bar (test domains have separate reputation). Strong recommendation: do not fall back; resolve DNS first.

## Validation Architecture

> `workflow.nyquist_validation` defaults to enabled (no explicit `false` in config). Section is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 (unit + integration projects) + Playwright 1.58.2 (browser specs) |
| Config files | `vitest.config.ts` (two projects: `unit` excludes `**/*.integration.test.ts`; `integration` includes them with Testcontainers Postgres); `playwright.config.ts` reads `PLAYWRIGHT_BASE_URL` env override |
| Quick run command (unit) | `npx vitest run --project unit tests/email/` |
| Integration suite | `npx vitest run --project integration tests/email/` |
| Playwright targeted | `npx playwright test tests/auth/change-password.spec.ts` |
| Playwright vs preview | `PLAYWRIGHT_BASE_URL=https://wkg-command-centre-git-gsd-phase-08-email-infrastructure-vedant-kalbag-wkgs-projects.vercel.app TEST_ADMIN_EMAIL=... TEST_ADMIN_PASSWORD=... npx playwright test tests/auth/change-password.spec.ts` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EMAIL-01 | `sendPasswordResetEmail` calls Resend with `from`, `to`, `subject`, `react` and inserts `email_log` row with `status='sent'` and a populated `resendMessageId` | unit (mock Resend client) | `npx vitest run --project unit src/lib/email.test.ts` | ❌ Wave 0 |
| EMAIL-01 | `sendInviteEmail` and `sendExternalInviteEmail` correctly route to internal vs external templates per the invite/userType branching in `auth.ts:13-24` | unit (mock Resend) | `npx vitest run --project unit src/lib/email.test.ts` | ❌ Wave 0 |
| EMAIL-01 | Resend non-2xx response → `email_log.status='failed'` + `lastError` populated + the function throws (so Better Auth surfaces failure to UI) | unit (mock Resend with rejected response) | `npx vitest run --project unit src/lib/email.test.ts` | ❌ Wave 0 |
| EMAIL-02 | Signed-in user submits valid current+new password → `authClient.changePassword` returns success → toast displayed → form reset | Playwright (against local dev OR preview) | `npx playwright test tests/auth/change-password.spec.ts` | ❌ Wave 0 |
| EMAIL-02 | Wrong current password → inline error from Better Auth surfaced in form | Playwright | same spec, separate test() | ❌ Wave 0 |
| EMAIL-02 | New password < 8 chars → zod inline error before Better Auth call | Playwright | same spec, separate test() | ❌ Wave 0 |
| EMAIL-02 | After successful change with `revokeOtherSessions: true`, an `inngest.send({ name: 'email/send.requested', data: { kind: 'password_changed', ... } })` event was emitted | unit (mock inngest client) | `npx vitest run --project unit src/app/api/account/password-changed/route.test.ts` | ❌ Wave 0 |
| EMAIL-03 | Forgot-password against the preview alias delivers an email to the operator inbox; clicking the link lands on `/set-password` and a chosen new password authenticates | manual operator UAT (D-14 Claude verifies request side, operator verifies inbox side) | per `08-03-SUMMARY.md` checklist | n/a (manual) |
| EMAIL-03 | Throwaway-user invite flow delivers an email; click → `/set-password?invite=1` → new pw → `/login` → success | manual operator UAT (chained with above) | per `08-03-SUMMARY.md` checklist | n/a (manual) |
| EMAIL-04 | Inngest send-email function inserts an `email_log` row with `status='sent'`, populated `resendMessageId`, populated `inngestRunId` for a triggered event | integration (Testcontainers Postgres + Inngest in-process test runner) | `npx vitest run --project integration tests/email/send-email-fn.integration.test.ts` | ❌ Wave 0 |
| EMAIL-04 | Two events with the same `(kind, payloadHash)` → only one `email_log` row exists post-send (DB unique idx no-ops the duplicate) | integration | `npx vitest run --project integration tests/email/email-log.integration.test.ts` | ❌ Wave 0 |
| EMAIL-04 | Inngest function with simulated Resend 5xx → step retries (asserted via Inngest test runner's run-history); after retries exhausted, `email_log.status='failed'` | integration | `npx vitest run --project integration tests/email/send-email-fn.integration.test.ts` (separate test) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --project unit tests/email/ src/lib/email.test.ts src/app/api/account/`
- **Per wave merge:** Full unit + integration suites: `npx vitest run`
- **Phase gate (before `/gsd-verify-work`):** Full unit + integration green + `tests/auth/change-password.spec.ts` Playwright run against local dev + (operator-driven) the same spec against the git-branch alias preview deploy + the EMAIL-03 manual checklist

### Wave 0 Gaps
- [ ] `tests/email/` directory + `tests/email/email-log.integration.test.ts` — covers EMAIL-04 idempotency
- [ ] `tests/email/send-email-fn.integration.test.ts` — covers EMAIL-04 substrate (uses Inngest's in-process test runner per their docs)
- [ ] `src/lib/email.test.ts` — covers EMAIL-01 transport behaviour with a mocked Resend client (use `vi.mock('resend', ...)`)
- [ ] `src/app/api/account/password-changed/route.test.ts` — covers EMAIL-02 confirmation-email-trigger contract (mock `inngest.send`)
- [ ] `tests/auth/change-password.spec.ts` — Playwright spec for EMAIL-02 happy path + 2 failure paths
- [ ] `tests/email/conftest`-equivalent — shared fixtures (a Postgres test container with the email_log migration applied; consider extending `tests/helpers/test-db.ts`)
- [ ] No new framework install — vitest + Playwright already configured.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Better Auth's existing email-and-password module + reset-token store; `disableSignUp: true` invite-only flow preserved. Phase 8 only changes the *transport* layer below this; auth logic unchanged. |
| V3 Session Management | yes | Better Auth handles session lifecycle. EMAIL-02's `revokeOtherSessions: true` invalidates other devices on password change. UI MUST surface that other sessions were signed out (toast copy: "Password changed. Other sessions signed out."). |
| V4 Access Control | yes | `/account/security` is gated by `(app)/layout.tsx` session redirect; `/api/account/password-changed` re-checks session via `auth.api.getSession`. Inngest webhook validates source via `INNGEST_SIGNING_KEY`. |
| V5 Input Validation | yes | zod schemas on form (`schema.refine` for password match); Better Auth validates server-side; `email_log.recipient` writes are from authenticated session-user.email only (never from request body). |
| V6 Cryptography | yes | Better Auth handles password hashing (used as-is via `auth.$context.password.hash` precedent); we do not hand-roll. Resend uses HTTPS only. Inngest webhook signature verification via signing key. |
| V8 Data Protection | yes | `email_log.recipient` stores email PII. Retention policy: see Open Question 4 above; recommend a Phase 11 follow-up to purge `email_log` rows older than 1 year. No IP / UA stored (D-11). |
| V9 Communications | yes | All Resend + Inngest traffic is HTTPS. SPF/DKIM/DMARC scoped to `command.weknowgroup.com` (not parent zone) per D-01/D-02. |
| V13 API and Web Service | yes | `/api/inngest` validates signature; `/api/account/password-changed` requires session. Both are Next.js Route Handlers with implicit CSRF protection via the same-origin policy + signed Better Auth session cookies. |

### Known Threat Patterns for the Phase 8 stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Email spoofing (someone forges a "from: noreply@command.weknowgroup.com" message) | Spoofing | SPF + DKIM + DMARC `p=quarantine` scoped to subdomain. Unverified mail from outside Resend's infrastructure gets quarantined by recipient mail servers. |
| Password-reset token leak via email-server logs | Information Disclosure | Tokens are Better Auth's existing high-entropy single-use tokens with 1-hour TTL. Resend logs only `messageId` not body. `email_log.recipient` doesn't store token either. Existing mitigations preserved. |
| Account takeover via change-password CSRF | Tampering | `/account/security` form posts via Better Auth's client which uses signed session cookies (Better Auth's `nextCookies()` plugin handles cross-origin protection). `revokeOtherSessions: true` ensures stolen sessions are killed immediately on password change. |
| Inngest webhook forgery (attacker hits `/api/inngest` with a fake event) | Spoofing / Tampering | `INNGEST_SIGNING_KEY` mandatory; `serve()` rejects unsigned/wrong-signed POSTs with 401. |
| `email_log` PII leak via SQL injection or admin-UI exposure | Information Disclosure | All writes are parameterised via Drizzle; no admin UI for `email_log` ships in Phase 8 (deferred to Phase 11 per CONTEXT.md). Read access requires DATABASE_URL. |
| Password change confirmation email enumerates valid users | Information Disclosure | Confirmation only sends to authenticated user (we already know who they are). Forgot-password endpoint returns same response for valid/invalid emails (Better Auth standard); `email_log.recipient` reflects whoever the operator typed but is not user-facing. |
| Brevo fallback creates parallel-channel that could leak through misconfig | Information Disclosure | Fallback is documented-only (D-13). No code path can route mail through Brevo without a deliberate code change + new env var + deploy. |
| Open redirect via Better Auth `redirectTo` parameter on reset link | Tampering | Better Auth allow-lists redirect targets via `BETTER_AUTH_URL`; existing setting (`/set-password?invite=1&...`) is internal-only. Phase 8 doesn't change this. |
| Rate-limit absence on `/account/security` enables online password-guess | Tampering | Better Auth has built-in attempt limiting on `changePassword` (rejects on wrong currentPassword); for v1.1 internal audience this is sufficient. Phase 11 may add IP-level throttling if user-base broadens. |
| `RESEND_API_KEY` leak via env exposure | Information Disclosure | Vercel env vars not exposed to client (no `NEXT_PUBLIC_` prefix); only used server-side. Rotate via Resend dashboard if leaked; update Vercel env. |

## Project Constraints (from CLAUDE.md)

The planner MUST honor these:

1. **npm-ci lockfile platform skew** — adding `resend` + `inngest` + `react-email` + `@react-email/components` + `@react-email/render` triggers macOS-vs-Linux drift. Use the linux/amd64 Docker recipe in `CLAUDE.md` § "npm ci lockfile must stay in sync". Do NOT regen on macOS. Do NOT run `npm install` between Docker regen and commit.
2. **Vercel preview env vars must use the git-branch alias** — `BETTER_AUTH_URL`, `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO` all set against `wkg-command-centre-git-gsd-phase-08-email-infrastructure-vedant-kalbag-wkgs-projects.vercel.app` (verify exact alias via `vercel alias ls | grep gsd-phase-08` once the branch is pushed).
3. **Playwright specs must run against the preview, not just `--list`** — EMAIL-02's `change-password.spec.ts` runs end-to-end against the preview alias before the phase claims done. `--list` passing is not sufficient evidence (Phase 6 plan 06-05 regression precedent).
4. **Test admin pre-existing**: `vedant.kalbag@weknowgroup.com` for prod (per memory `prod-admin-account.md`); `admin@weknow.co` / `Admin123!` for local Playwright (per `tests/auth/setup.ts`). Per-environment switching belongs in `.env.test`.
5. **No manual SQL for ops cleanup** (memory `no_manual_sql_for_ops.md`) — `email_log` retention purge, when implemented (Phase 11 polish), MUST be an admin UI feature, not a script.
6. **Phase branching strategy** — per global preference (`branching_strategy: "phase"`), Phase 8 work commits to `gsd/phase-08-email-infrastructure`. Plan-level summary commits + a phase-completion commit before merge.
7. **Brand guidelines (`~/.claude/weknow-brand-guidelines.md`)** — Azure `#00A6D3`, Graphite `#121212`, White `#FFFFFF` are the only primary colors. Circular Pro typography (with Bold using -10 kerning) — but email clients don't reliably load web fonts, so fall back to system stack. Hero color is Azure for CTAs (already encoded in `BRAND.azure` per Pattern 3).

## Sources

### Primary (HIGH confidence)
- Codebase: `src/lib/email.ts`, `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/app/(app)/settings/users/actions.ts`, `src/components/auth/{login,reset-password,set-password}-form.tsx`, `tests/auth/setup.ts`, `package.json`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `migrations/0040_*.sql`, `scripts/reset-admin-password.ts` — read 2026-05-08
- npm registry: `npm view {resend,inngest,react-email,@react-email/components,@react-email/render} version` — 2026-05-08
- `.planning/phases/08-email-infrastructure/08-CONTEXT.md` § Decisions D-01 through D-14 (locked)
- `.planning/STATE.md` § Phase 8 decisions captured 2026-05-08
- `.planning/research/v1.1-email-queue.md` — Inngest rationale + email_log sketch + wire-up file layout
- `tasks/v2-carryover-from-v1-phase-6.md` § V2-EMAIL-01..04 — Original carryover rationale on Resend vs Brevo vs SES
- `CLAUDE.md` (project) — npm-ci lockfile drift, Vercel preview env-var rule, Playwright preview-deploy rule, prod admin password rotation
- `~/.claude/weknow-brand-guidelines.md` (referenced — colour + typography rules)

### Secondary (MEDIUM confidence — WebSearch verified against listed domains)
- [Better Auth — Email & Password](https://better-auth.com/docs/authentication/email-password) — `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })` confirmed
- [Better Auth — Session Management](https://better-auth.com/docs/concepts/session-management) — revokeOtherSessions semantics
- [Resend Node SDK (npm)](https://www.npmjs.com/package/resend) — emails.send shape and `data.id` response field
- [React Email — Resend integration](https://react.email/docs/integrations/resend) — `react:` field usage with JSX components
- [React Email — Render](https://react.email/docs/utilities/render) — `render(<C/>)` returning HTML string
- [Inngest — Next.js Quick Start](https://www.inngest.com/docs/getting-started/nextjs-quick-start) — App Router `serve` handler at `/api/inngest/route.ts`, GET/POST/PUT export
- [Inngest — Setting up your app](https://www.inngest.com/docs/learn/serving-inngest-functions) — function definition + retries config
- [Inngest npm](https://www.npmjs.com/package/inngest) — current version (4.3.0)
- [Resend — Managing Domains](https://resend.com/docs/dashboard/domains/introduction) — DNS record requirements (SPF + DKIM + optional DMARC)
- [DmarcDkim — Resend setup](https://dmarcdkim.com/setup/how-to-setup-resend-spf-dkim-and-dmarc-records) — subdomain DNS layout reference

### Tertiary (LOW confidence — unverified, flag for validation during plan 08-01)
- A2: `inngest-cli dev` is the dev-server invocation (training data; verify with `npx inngest-cli@latest --help` on first run)
- A3: `@react-email/render` v2 returns Promise — check actual signature on first integration test
- A4: resend-node v6 returns exactly `{ data: { id }, error }` (was true in v3 docs; v6 should be same per WebSearch but a quick `console.log(result)` on first send is the cheapest verification)
- A6: Resend's domain verification auto-polls (vs requires click) — operator confirms via dashboard

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified via `npm view`, all locked in CONTEXT.md or v1.1 scoping
- Architecture: HIGH — file paths verified against codebase; SDK shapes verified against official docs (WebSearch)
- Pitfalls: HIGH — drawn from existing CLAUDE.md (lockfile, preview-env, Playwright) which encode hard-won project lessons
- Validation: HIGH — vitest + Playwright already configured; spec list is concrete and per-requirement

**Research date:** 2026-05-08
**Valid until:** 2026-06-07 (30 days; SDK versions stable, decisions locked, low-velocity surface area). Re-verify Inngest 4.x and Resend 6.x versions if plan 08-01 lands beyond this window.

## RESEARCH COMPLETE
