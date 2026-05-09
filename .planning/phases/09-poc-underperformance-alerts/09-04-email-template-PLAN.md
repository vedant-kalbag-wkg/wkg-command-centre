---
phase: 09-poc-underperformance-alerts
plan: 04
type: execute
wave: 2
depends_on: [01]
files_modified:
  - src/emails/poc-underperformance.tsx
  - src/emails/text-versions.ts
  - src/inngest/events.ts
  - src/inngest/functions/send-email.ts
  - src/emails/__tests__/poc-underperformance.test.ts
autonomous: true
requirements: [POC-ALERT-01]
must_haves:
  truths:
    - "PocUnderperformanceEmail React component renders to non-empty HTML containing every kiosk row"
    - "pocUnderperformanceText() returns a plain-text body containing every kiosk row's location + revenue + percentile"
    - "TEMPLATES dispatch in src/inngest/functions/send-email.ts maps 'poc-underperformance' -> PocUnderperformanceEmail"
    - "Plain-text branch in send-email.ts handles 'poc-underperformance' -> pocUnderperformanceText"
    - "src/inngest/events.ts EmailKind union includes 'underperforming_poc' AND EmailTemplate union includes 'poc-underperformance' (this plan owns the union extension to unblock the send-email.ts narrowing in task 3 — see BLOCKER-3 fix)"
    - "Template uses BRAND.azure for CTA, BRAND.graphite for headings, BRAND.azure20 for tinted panels — WeKnow brand voice"
    - "Each kiosk row has a deep link to ${BRAND.prodUrl}/kiosks/<id> and the email footer CTA points at ${BRAND.prodUrl}/analytics/portfolio"
    - "POC email subject is dynamically composed as `Performance update — N kiosk${N === 1 ? '' : 's'} need attention` where N = batched-kiosk count for that POC (subject string is emitted by the cron in plan 09-03; this plan locks the canonical wording for downstream tests + brand-voice review)"
  artifacts:
    - path: "src/emails/poc-underperformance.tsx"
      provides: "react-email template component for the underperforming-POC alert"
      exports: ["PocUnderperformanceEmail", "KioskRow"]
    - path: "src/emails/text-versions.ts"
      provides: "pocUnderperformanceText() pure plain-text renderer"
      contains: "pocUnderperformanceText"
    - path: "src/inngest/events.ts"
      provides: "Extended EmailKind ('underperforming_poc') + EmailTemplate ('poc-underperformance') unions — owned by THIS plan (09-04) so the narrowing in send-email.ts task 3 type-checks; plan 09-03 consumes these literals when emitting events and depends_on includes 09-04 as a result"
      contains: "underperforming_poc"
    - path: "src/inngest/functions/send-email.ts"
      provides: "Extended TEMPLATES dispatch + plain-text branch"
      contains: "poc-underperformance"
  key_links:
    - from: "sendEmailFn TEMPLATES"
      to: "PocUnderperformanceEmail"
      via: "kind='underperforming_poc' dispatch"
    - from: "sendEmailFn plain-text branch"
      to: "pocUnderperformanceText"
      via: "explicit if branch (parallel to passwordChangedText)"
    - from: "src/inngest/events.ts EmailKind / EmailTemplate unions"
      to: "src/inngest/functions/weekly-poc-alerts.ts (plan 09-03) inngest.send({ data: { kind, template, ... } }) call site"
      via: "TypeScript union narrowing — 09-03 imports these unions transitively via the inngest.send signature"
---

<objective>
Author the react-email template + plain-text companion for the
underperforming-POC alert and wire them into the existing Phase 8
sendEmailFn dispatch table. The template clones
`src/emails/password-changed.tsx` end-to-end (PATTERNS marks it an
"exact" analog), substitutes the props for kiosk-row props, renders
each kiosk as a tinted Azure-20% Section panel with location, region,
revenue, percentile, and a per-kiosk deep link, and ends with a CTA
to /analytics/portfolio.

This plan also OWNS the `EmailKind` / `EmailTemplate` union extension
in `src/inngest/events.ts` (per BLOCKER-3 fix from plan-checker
iteration 1). Originally this edit was in plan 09-03, but the
narrowing in this plan's task 3 (`else if (template === "poc-underperformance")`)
requires the union to already include `"poc-underperformance"` at the
point send-email.ts is type-checked — so 09-04 must own it. As a
consequence, plan 09-03 now `depends_on: [01, 02, 04]` (Wave 3) and
this plan stays Wave 2 with `depends_on: [01]`.

Brand compliance is REQUIRED — read `~/.claude/weknow-brand-guidelines.md`
mirrored verbatim in `src/emails/brand.ts`. Use Azure (#00A6D3) for
the CTA + accent borders, Graphite (#121212) for headings, Azure-20%
(#CCEDF6) for tinted panels, Circular Pro fallback chain via brand.ts.

Purpose: Without this template, every email/send.requested event
emitted by the cron with `kind='underperforming_poc'` fails at the
TEMPLATES lookup with `Unknown email template: poc-underperformance`.
The cron's emit step would still succeed, but sendEmailFn would
fail-and-retry until the function is killed.

Output:
- `src/emails/poc-underperformance.tsx` (new react-email template)
- `src/emails/text-versions.ts` extended (pocUnderperformanceText)
- `src/inngest/events.ts` extended (EmailKind + EmailTemplate union additions — moved here from 09-03 per BLOCKER-3)
- `src/inngest/functions/send-email.ts` extended (TEMPLATES + text branch)
- `src/emails/__tests__/poc-underperformance.test.ts` (snapshot + content assertions)
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md
@.planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md
@.planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md
@.planning/phases/09-poc-underperformance-alerts/09-VALIDATION.md
@.planning/phases/09-poc-underperformance-alerts/09-01-SUMMARY.md

@src/emails/brand.ts
@src/emails/_layout.tsx
@src/emails/_cta.tsx
@src/emails/password-changed.tsx
@src/emails/text-versions.ts
@src/inngest/events.ts
@src/inngest/functions/send-email.ts
@src/emails/__tests__/helpers/render-snapshot.ts

<interfaces>
Brand tokens (src/emails/brand.ts — verified shape):
```typescript
export const BRAND = {
  azure: "#00A6D3",
  graphite: "#121212",
  azure20: "#CCEDF6",     // 20% tint of Azure
  textSecondary: "#3F3F3F",
  productName: "WeKnow Command Centre",
  prodUrl: "https://wkg-command-centre.vercel.app",
  // ... fontFamily fallback chain
} as const;
```

Layout component (src/emails/_layout.tsx):
```typescript
export function EmailLayout({ preheader, children }: { preheader: string; children: React.ReactNode }): JSX.Element;
```

CTA component (src/emails/_cta.tsx):
```typescript
export function CTA({ href, label }: { href: string; label: string }): JSX.Element;
```

Render helper (src/emails/__tests__/helpers/render-snapshot.ts) — existing test util for email render assertions.

Cron emits with these templateProps (per plan 09-03):
```typescript
{
  pocName: string;
  kiosks: Array<{
    kioskId: string;        // human-facing (this is kiosks.outletCode)
    locationName: string;
    region: string;
    revenue: number;
    percentile: number;
    detailUrl: string;      // pre-built: ${BRAND.prodUrl}/kiosks/${k.kioskId}
  }>;
  moreCount: number;        // kiosks beyond the 25 cap
  windowDays: number;
  runIsoWeek: string;       // e.g. "2026-W19"
}
```
</interfaces>
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| sendEmailFn -> Resend HTTP API | Existing; Phase 8 handles. |
| Cron-supplied templateProps -> rendered HTML | All values come from internal classification + DB lookups. No user-input fields except `user.name` (the POC's name from Better Auth) — escaped automatically by react-email's React render. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-09-04-01 | Tampering | Open redirect via detailUrl | mitigate | The template does NOT accept arbitrary URL strings — it accepts the pre-built `detailUrl` from the cron, which always uses `${BRAND.prodUrl}/kiosks/${id}`. BRAND.prodUrl is a build-time constant. Defense-in-depth: the template renders the URL via `<Link href={k.detailUrl}>` (react-email primitive) — no string concat at render time. |
| T-09-04-02 | Cross-Site Scripting | location name / region rendered in HTML | mitigate | React/JSX auto-escapes children. We never use `dangerouslySetInnerHTML`. The plain-text version is also safe (no shell, no eval). |
| T-09-04-03 | Information Disclosure | email body data | accept | Documented in plan 09-03 threat model — email contains only the POC's own kiosks. Same data the POC already sees in /analytics/portfolio (which they have access to). |
| T-09-04-04 | Spoofing | EMAIL_FROM | accept | Phase 8 already pins `noreply@command.weknowgroup.com` + DMARC `p=quarantine`. Template doesn't control the From header. |

ASVS controls applied:
- V5.3.4 (Output Encoding): React's auto-escape applies to all template props; no raw HTML inserted.
- V11.1.4 (No insecure URL schemes): All hrefs in the template are `https://` URLs built from BRAND.prodUrl.
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Author src/emails/poc-underperformance.tsx + render test</name>
  <files>src/emails/poc-underperformance.tsx, src/emails/__tests__/poc-underperformance.test.ts</files>
  <read_first>
    - src/emails/password-changed.tsx (full file — your end-to-end clone target).
    - src/emails/_layout.tsx (full file — confirms EmailLayout signature + preheader prop).
    - src/emails/_cta.tsx (full file — confirms CTA signature).
    - src/emails/brand.ts (full file — token names + values).
    - src/emails/__tests__/helpers/render-snapshot.ts (full file — the snapshot helper API).
    - src/emails/__tests__/password-changed.test.ts (if exists) — analog test file for the snapshot pattern.
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/emails/poc-underperformance.tsx".
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Code Examples lines 562-617 (template scaffold reference).
    - .planning/phases/09-poc-underperformance-alerts/09-CONTEXT.md § D-14 + D-15 + D-16 (content + brand voice rules).
    - ~/.claude/weknow-brand-guidelines.md if accessible (the tokens are already mirrored in brand.ts).
  </read_first>
  <behavior>
    Tests (write FIRST):
    - Test 1: render with 1 kiosk -> output HTML contains the location name, region, revenue (formatted as £XXX), percentile, and the detailUrl.
    - Test 2: render with 3 kiosks -> output contains all 3 kiosk locationNames in document order.
    - Test 3: render with `moreCount=12` -> output contains "12 more" or similar copy referencing the truncation.
    - Test 4: render with `moreCount=0` -> output does NOT contain "more".
    - Test 5: render -> output contains a CTA href pointing at `${BRAND.prodUrl}/analytics/portfolio`.
    - Test 6: render -> output contains the recipient name from `pocName`.
    - Test 7: render -> output contains the brand color `#00A6D3` (Azure CTA) somewhere.
    - Test 8: render -> output contains the brand color `#121212` (Graphite heading) somewhere.
    - Test 9: render -> output contains the windowDays as a number/string in body copy.
    - Test 10: snapshot — `expect(html).toMatchInlineSnapshot()` for one canonical 2-kiosk render (use the existing `render-snapshot.ts` helper if it provides one; otherwise use vitest's `toMatchSnapshot` against an external snapshot file).

    For test rendering, use `@react-email/render`'s `render` (sync HTML render via `render(<Component />)`).

    Component behavior:
    - Cap kiosks at the array passed in (the cron caps at 25; the template trusts the array length).
    - Hides the "+ N more" line when `moreCount === 0`.
    - Each kiosk row is a tinted `Section` panel (`backgroundColor: BRAND.azure20`, `borderLeft: 3px solid BRAND.azure`, `borderRadius: 6px`, `padding: 14px 16px`, `margin: 0 0 12px`) — clone of the password-changed info panel pattern.
    - Single CTA at the foot: `<CTA href={portfolioUrl} label="Open portfolio analytics" />`.
    - Subject is set in the cron, NOT in the template (templates don't control subject in this codebase).
    - Pre-header copy: e.g. "${kiosks.length} kiosks in your portfolio need attention".
  </behavior>
  <action>
    1. Create the test file FIRST at src/emails/__tests__/poc-underperformance.test.ts. Pattern (clone password-changed test analog if it exists; otherwise write fresh):

       ```typescript
       import { render } from "@react-email/render";
       import { describe, it, expect } from "vitest";
       import { PocUnderperformanceEmail } from "../poc-underperformance";
       import { BRAND } from "../brand";

       const ONE_KIOSK_PROPS = {
         pocName: "Alex",
         kiosks: [{
           kioskId: "K001",
           locationName: "Hilton Mayfair",
           region: "London",
           revenue: 123.45,
           percentile: 8,
           detailUrl: `${BRAND.prodUrl}/kiosks/abc-123`,
         }],
         moreCount: 0,
         windowDays: 30,
         runIsoWeek: "2026-W19",
       };

       describe("PocUnderperformanceEmail", () => {
         it("renders kiosk row with location, region, revenue, percentile, detailUrl", async () => {
           const html = await render(<PocUnderperformanceEmail {...ONE_KIOSK_PROPS} />);
           expect(html).toContain("Hilton Mayfair");
           expect(html).toContain("London");
           expect(html).toContain("123.45");
           expect(html).toContain("8");
           expect(html).toContain(`${BRAND.prodUrl}/kiosks/abc-123`);
         });

         // ... tests 2-10 per behavior block above ...
       });
       ```

    2. Run `npx vitest run --project unit src/emails/__tests__/poc-underperformance.test.ts` — confirm it fails (component does not exist).

    3. Create src/emails/poc-underperformance.tsx — clone src/emails/password-changed.tsx end-to-end and adapt:

       ```typescript
       import { Heading, Section, Text, Link } from "@react-email/components";
       import { BRAND } from "./brand";
       import { CTA } from "./_cta";
       import { EmailLayout } from "./_layout";

       export type KioskRow = {
         kioskId: string;        // human-facing (the kiosks.outletCode)
         locationName: string;
         region: string;
         revenue: number;
         percentile: number;
         detailUrl: string;
       };

       export function PocUnderperformanceEmail({
         pocName,
         kiosks,
         moreCount,
         windowDays,
         runIsoWeek,
       }: {
         pocName: string;
         kiosks: KioskRow[];
         moreCount: number;
         windowDays: number;
         runIsoWeek: string;
       }) {
         const portfolioUrl = `${BRAND.prodUrl}/analytics/portfolio`;
         const preheader = `${kiosks.length} kiosk${kiosks.length === 1 ? "" : "s"} in your portfolio need attention`;
         return (
           <EmailLayout preheader={preheader}>
             <Heading
               as="h1"
               style={{
                 fontSize: "24px",
                 fontWeight: 700,
                 letterSpacing: "-0.01em",
                 color: BRAND.graphite,
                 margin: "0 0 14px",
                 lineHeight: 1.2,
               }}
             >
               Performance update
             </Heading>
             <Text style={{
               fontSize: "15px",
               lineHeight: 1.6,
               color: BRAND.textSecondary,
               margin: "0 0 18px",
             }}>
               Hi {pocName}, the following kiosk{kiosks.length === 1 ? " has" : "s have"} fallen
               into the bottom outlet tier over the last {windowDays} days. Tap any kiosk to
               review its detail page and the latest figures.
             </Text>

             {kiosks.map((k) => (
               <Section
                 key={k.kioskId}
                 style={{
                   backgroundColor: BRAND.azure20,
                   borderLeft: `3px solid ${BRAND.azure}`,
                   borderRadius: "6px",
                   padding: "14px 16px",
                   margin: "0 0 12px",
                 }}
               >
                 <Text style={{
                   fontSize: "15px",
                   fontWeight: 600,
                   color: BRAND.graphite,
                   margin: "0 0 4px",
                 }}>
                   <Link href={k.detailUrl} style={{ color: BRAND.azure, textDecoration: "none" }}>
                     {k.kioskId}
                   </Link>
                   {" — "}{k.locationName}
                 </Text>
                 <Text style={{
                   fontSize: "13px",
                   color: BRAND.textSecondary,
                   margin: 0,
                 }}>
                   {k.region} · £{k.revenue.toFixed(2)} over {windowDays}d · bottom {k.percentile.toFixed(0)}%
                 </Text>
               </Section>
             ))}

             {moreCount > 0 && (
               <Text style={{
                 fontSize: "13px",
                 color: BRAND.textSecondary,
                 margin: "8px 0 18px",
                 fontStyle: "italic",
               }}>
                 + {moreCount} more kiosk{moreCount === 1 ? "" : "s"} below cutoff —
                 view the full list at portfolio analytics.
               </Text>
             )}

             <CTA href={portfolioUrl} label="Open portfolio analytics" />

             <Text style={{
               fontSize: "11px",
               color: BRAND.textSecondary,
               margin: "24px 0 0",
             }}>
               Run reference: {runIsoWeek}
             </Text>
           </EmailLayout>
         );
       }
       ```

    4. Re-run the tests; all 10 must pass. If a test misses by a punctuation difference (e.g. `£123.45` vs `£123`), adjust the test's expectation to match the rendered output (use `.toFixed(2)` formatting in the component → match in the test).
  </action>
  <verify>
    <automated>npx vitest run --project unit src/emails/__tests__/poc-underperformance.test.ts</automated>
  </verify>
  <done>
    - PocUnderperformanceEmail component renders without throwing.
    - All 10 tests pass — `npx vitest run --project unit src/emails/__tests__/poc-underperformance.test.ts` exits 0.
    - `grep -c "BRAND.azure" src/emails/poc-underperformance.tsx` returns at least 1 AND `grep -c "BRAND.graphite" src/emails/poc-underperformance.tsx` returns at least 1 AND `grep -c "BRAND.azure20" src/emails/poc-underperformance.tsx` returns at least 1 (proves brand tokens consumed at module level — independent of the snapshot test; concrete grep-target replaces "brand tokens used in the rendered output" subjective phrasing per W7).
    - `grep -c "dangerouslySetInnerHTML" src/emails/poc-underperformance.tsx` returns 0.
    - `grep -c "k.detailUrl" src/emails/poc-underperformance.tsx` returns at least 1 (deep-link href is sourced from the typed prop, not constructed at render time).
    - `grep -c "/analytics/portfolio" src/emails/poc-underperformance.tsx` returns at least 1 (single CTA endpoint).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Extend src/emails/text-versions.ts with pocUnderperformanceText</name>
  <files>src/emails/text-versions.ts</files>
  <read_first>
    - src/emails/text-versions.ts (full file — read passwordChangedText lines 62-80 as the analog).
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/emails/text-versions.ts (modify)".
  </read_first>
  <behavior>
    - When called with the same templateProps the cron produces, returns a plain-text body that mirrors the HTML structure: heading, intro paragraph, one line per kiosk (locationName / region / revenue / percentile / detailUrl), optional "+ N more" line, CTA URL, run-iso-week reference, FOOTER.
    - Uses the existing FOOTER constant from text-versions.ts.
    - All values are escaped naturally by `String.prototype.concat` — no shell, no template-string injection risk.
    - If `kiosks.length === 0`, returns a one-line body indicating no kiosks (defensive — should never happen, but the cron guards too).
  </behavior>
  <action>
    Append to src/emails/text-versions.ts (after the existing `passwordChangedText` function — keep the FOOTER export shared):

    ```typescript
    export function pocUnderperformanceText({
      pocName,
      kiosks,
      moreCount,
      windowDays,
      runIsoWeek,
      portfolioUrl,
    }: {
      pocName: string;
      kiosks: Array<{
        kioskId: string;
        locationName: string;
        region: string;
        revenue: number;
        percentile: number;
        detailUrl: string;
      }>;
      moreCount: number;
      windowDays: number;
      runIsoWeek: string;
      portfolioUrl: string;
    }): string {
      const lines: string[] = [
        "Performance update",
        "",
        `Hi ${pocName}, the following kiosk${kiosks.length === 1 ? " has" : "s have"} fallen ` +
          `into the bottom outlet tier over the last ${windowDays} days.`,
        "",
      ];
      for (const k of kiosks) {
        lines.push(`${k.kioskId} — ${k.locationName}`);
        lines.push(`  ${k.region} · £${k.revenue.toFixed(2)} over ${windowDays}d · bottom ${k.percentile.toFixed(0)}%`);
        lines.push(`  ${k.detailUrl}`);
        lines.push("");
      }
      if (moreCount > 0) {
        lines.push(`+ ${moreCount} more kiosk${moreCount === 1 ? "" : "s"} below cutoff — view the full list at portfolio analytics.`);
        lines.push("");
      }
      lines.push(`Open portfolio analytics: ${portfolioUrl}`);
      lines.push("");
      lines.push(`Run reference: ${runIsoWeek}`);
      lines.push("");
      lines.push(FOOTER);
      return lines.join("\n");
    }
    ```

    The `portfolioUrl` is a parameter (not derived from BRAND inside the function) so the call site in send-email.ts can pass `${BRAND.prodUrl}/analytics/portfolio` — keeps text-versions.ts free of brand imports if that's the existing convention. Verify against `passwordChangedText` first; if it imports BRAND directly, follow that convention instead.
  </action>
  <verify>
    <automated>grep -q "pocUnderperformanceText" src/emails/text-versions.ts &amp;&amp; npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "text-versions" || echo OK</automated>
  </verify>
  <done>
    - `grep -c "export function pocUnderperformanceText" src/emails/text-versions.ts` returns 1.
    - `npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -c "text-versions"` returns 0 (no TS errors in this file).
  </done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Extend src/inngest/events.ts unions AND wire template into TEMPLATES + plain-text branch in src/inngest/functions/send-email.ts</name>
  <files>src/inngest/events.ts, src/inngest/functions/send-email.ts</files>
  <read_first>
    - src/inngest/events.ts (full file) — read the current `EmailKind` and `EmailTemplate` unions end-to-end. You will append `"underperforming_poc"` to `EmailKind` and `"poc-underperformance"` to `EmailTemplate`. Maintain alphabetical ordering within each union if existing entries follow that ordering; otherwise append. Per BLOCKER-3 fix: the union extension is OWNED by THIS plan (09-04), not by 09-03. 09-03's cron consumes these literals when emitting events; that's why 09-03 declares `depends_on: [01, 02, 04]` (Wave 3).
    - src/inngest/functions/send-email.ts (full file). Specifically:
      - lines 34-38 (TEMPLATES dispatch) — extend with one entry.
      - lines 82-93 (plain-text branch in `step.run("render-html", ...)`) — extend with an `else if (template === "poc-underperformance")` branch.
    - .planning/phases/09-poc-underperformance-alerts/09-PATTERNS.md § "src/inngest/events.ts (modify)" + "src/inngest/functions/send-email.ts (modify)".
    - .planning/phases/09-poc-underperformance-alerts/09-RESEARCH.md § Pattern 5 (templateProps wire-shape).
  </read_first>
  <behavior>
    - `src/inngest/events.ts`: `EmailKind` accepts `"underperforming_poc"` as a valid value. `EmailTemplate` accepts `"poc-underperformance"` as a valid value.
    - `src/inngest/functions/send-email.ts`: `sendEmailFn` now accepts events with `template: "poc-underperformance"` and renders them via `PocUnderperformanceEmail`. The plain-text branch produces a non-empty plain-text body for the same templateProps. No regression on the existing `password-changed` template behavior (the existing Phase 8 integration suite remains green).
  </behavior>
  <action>
    1. **First step — extend the unions in `src/inngest/events.ts`** (this MUST happen before the send-email.ts edit so the `else if (template === "poc-underperformance")` narrowing in step 3 type-checks):
       - Add `"underperforming_poc"` to the `EmailKind` union.
       - Add `"poc-underperformance"` to the `EmailTemplate` union.
       - If there is a discriminated-union `Events` type that the Inngest client uses, no change is required here for these literals (they ride the existing `email/send.requested` event shape). Plan 09-03 separately appends a NEW event type `PerformanceAlertsRunRequested` with `name: "performance-alerts/run.requested"` — that addition is in 09-03, not here.
       - Run `npx tsc --noEmit -p tsconfig.json` to verify no callers broke.

    2. Add the import for PocUnderperformanceEmail at the top of `src/inngest/functions/send-email.ts`:
       ```typescript
       import { PocUnderperformanceEmail } from "@/emails/poc-underperformance";
       import { pocUnderperformanceText } from "@/emails/text-versions";
       import { BRAND } from "@/emails/brand";   // if not already imported
       ```

    3. Extend the TEMPLATES dispatch (lines ~34-38):
       ```typescript
       const TEMPLATES = {
         "password-changed": PasswordChangedEmail,
         "poc-underperformance": PocUnderperformanceEmail,
       } as const;
       ```

    4. Extend the plain-text branch (lines ~82-93). The existing branch is:
       ```typescript
       if (template === "password-changed") {
         const props = templateProps as { changedAt: string; contactAdminUrl: string };
         text = passwordChangedText({
           changedAt: props.changedAt,
           contactAdminEmail: props.contactAdminUrl.replace(/^mailto:/, ""),
         });
       } else {
         text = await render(element, { plainText: true });
       }
       ```

       Add an `else if`:
       ```typescript
       if (template === "password-changed") {
         // ...existing...
       } else if (template === "poc-underperformance") {
         const props = templateProps as {
           pocName: string;
           kiosks: Array<{
             kioskId: string;
             locationName: string;
             region: string;
             revenue: number;
             percentile: number;
             detailUrl: string;
           }>;
           moreCount: number;
           windowDays: number;
           runIsoWeek: string;
         };
         text = pocUnderperformanceText({
           ...props,
           portfolioUrl: `${BRAND.prodUrl}/analytics/portfolio`,
         });
       } else {
         text = await render(element, { plainText: true });
       }
       ```

    5. Run the existing Phase 8 send-email integration tests to confirm no regression:
       `npx vitest run --project integration tests/email/send-email-fn.integration.test.ts`
       (This is the canonical "no regression on Phase 8 behaviour" check — the suite must exit 0.)
  </action>
  <verify>
    <automated>grep -q "underperforming_poc" src/inngest/events.ts &amp;&amp; grep -q "poc-underperformance" src/inngest/events.ts &amp;&amp; grep -q '"poc-underperformance": PocUnderperformanceEmail' src/inngest/functions/send-email.ts &amp;&amp; grep -q 'pocUnderperformanceText' src/inngest/functions/send-email.ts &amp;&amp; npx vitest run --project integration tests/email/send-email-fn.integration.test.ts</automated>
  </verify>
  <done>
    - `grep -c "underperforming_poc" src/inngest/events.ts` returns at least 1 (EmailKind union extension landed BEFORE the send-email.ts narrowing — BLOCKER-3 ownership).
    - `grep -c "poc-underperformance" src/inngest/events.ts` returns at least 1 (EmailTemplate union extension landed).
    - `grep -c '"poc-underperformance": PocUnderperformanceEmail' src/inngest/functions/send-email.ts` returns 1 (TEMPLATES dispatch entry).
    - `grep -c "pocUnderperformanceText" src/inngest/functions/send-email.ts` returns at least 1 (plain-text branch wired).
    - `npx vitest run --project integration tests/email/send-email-fn.integration.test.ts` exits 0 (specifically running the Phase 8 suite to prove no regression on existing password-changed behaviour — concrete superset of W7 "no regression on Phase 8 behaviour").
    - `npx tsc --noEmit -p tsconfig.json` exits 0.
  </done>
</task>

</tasks>

<verification>
- `npx vitest run --project unit src/emails/__tests__/poc-underperformance.test.ts` exits 0
- `npx vitest run --project integration tests/email/send-email-fn.integration.test.ts` exits 0 (Phase 8 password-changed suite specifically — concrete grep-target per W7 fix replacing "no regression on Phase 8 behaviour" subjective phrasing)
- `grep -q "PocUnderperformanceEmail" src/inngest/functions/send-email.ts`
- `grep -q "pocUnderperformanceText" src/emails/text-versions.ts`
- `grep -q "underperforming_poc" src/inngest/events.ts` AND `grep -q "poc-underperformance" src/inngest/events.ts` (BLOCKER-3 — union extension owned by THIS plan)
- `npx tsc --noEmit -p tsconfig.json` exits 0
</verification>

<success_criteria>
1. PocUnderperformanceEmail renders to non-empty HTML containing every kiosk row's location, region, revenue, percentile, and a deep link.
2. Plain-text branch produces a parallel structured plain-text body.
3. The cron-emitted events with `template: "poc-underperformance"` now route through sendEmailFn correctly — the integration test for plan 09-03 (idempotency.integration.test.ts), if it stubs sendEmailFn rendering, will pass; if it actually invokes the rendering path, this template is in place.
4. WeKnow brand voice + tokens applied (Azure / Graphite / Circular Pro fallback).
5. `EmailKind` + `EmailTemplate` unions extended in src/inngest/events.ts (BLOCKER-3 — union ownership moved here from 09-03 to unblock the type-narrowing in task 3).
</success_criteria>

<output>
After completion, create `.planning/phases/09-poc-underperformance-alerts/09-04-SUMMARY.md` with:
- Files created (template, test, text-version)
- Files modified (events.ts, send-email.ts)
- Snapshot of the rendered HTML for the canonical 2-kiosk fixture (or just confirmation the snapshot test pinned)
- Brand-token usage confirmed (azure / graphite / azure20 in the rendered output)
- Confirmation that `EmailKind` + `EmailTemplate` unions were extended in src/inngest/events.ts (per BLOCKER-3 — original plan placed this in 09-03; moved here to resolve the Wave-2 race)
</output>
