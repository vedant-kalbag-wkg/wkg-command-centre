# wkg-kiosk-tool

Unified kiosk operations + analytics platform for WeKnow Group.

This repository is the merged successor to the two previous apps (`data-dashboard` for analytics and `kiosk-management` for ops). It consolidates both surfaces into a single Next.js application.

## Status

Phase 1 / M0 — foundation bootstrap in progress. Most features are not yet wired up.

## Plans

- Design: [`docs/plans/2026-04-16-kiosk-platform-merge-design.md`](docs/plans/2026-04-16-kiosk-platform-merge-design.md)
- Implementation (Phase 1): [`docs/plans/2026-04-16-phase-1-foundation.md`](docs/plans/2026-04-16-phase-1-foundation.md)

A top-level `docs/ARCHITECTURE.md` is pending and will land in a later task.

## Tech stack

- Next.js 16
- React 19
- TypeScript
- Drizzle ORM
- Postgres
- Better Auth
- Vitest
- Playwright

## Getting started

```bash
npm install
npm run dev
```

The dev server runs on port 3003 (see `package.json`).

Full dev-environment setup (database, env vars, seed data) will be documented in `docs/DEVELOPMENT.md` once Task 0.4 lands.
