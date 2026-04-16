'use strict';

/**
 * RuleTester spec for `wkg/no-raw-sales-query`.
 *
 * Run standalone:
 *   node eslint-rules/no-raw-sales-query.test.js
 *
 * Note: RuleTester does NOT process `eslint-disable-next-line` comments —
 * those are handled by ESLint core at a higher level. The escape hatch is
 * documented in the rule's `messages.rawSalesQuery` text; it's exercised
 * end-to-end via `npm run lint` rather than here.
 */

const { RuleTester } = require('eslint');
const tsParser = require('@typescript-eslint/parser');
const rule = require('./no-raw-sales-query');

// Use @typescript-eslint/parser so `import type` and other TS syntax parse
// cleanly — the rule applies to real `.ts` files in this codebase.
const tester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
});

tester.run('no-raw-sales-query', rule, {
  valid: [
    // Scoped via scopedSalesCondition in the same function
    {
      code: `
        import { salesRecords } from '@/db/schema';
        import { scopedSalesCondition } from '@/lib/scoping/scoped-query';
        async function fetchSales(db, user) {
          const cond = await scopedSalesCondition(db, user);
          return db.select().from(salesRecords).where(cond);
        }
      `,
    },
    // Scoped via scopedSalesCondition inside an arrow function
    {
      code: `
        import { salesRecords } from '@/db/schema';
        import { scopedSalesCondition } from '@/lib/scoping/scoped-query';
        const fetchSales = async (db, user) => {
          const cond = await scopedSalesCondition(db, user);
          return db.delete(salesRecords).where(cond);
        };
      `,
    },
    // Type-only import — no runtime access to salesRecords
    {
      code: `
        import type { salesRecords } from '@/db/schema';
        export type Sale = typeof salesRecords.$inferSelect;
      `,
    },
    // Non-sales table query — rule doesn't care
    {
      code: `
        import { locations } from '@/db/schema';
        function run(db) {
          return db.select().from(locations);
        }
      `,
    },
    // Method we don't care about (e.g. .with(salesRecords))
    {
      code: `
        import { salesRecords } from '@/db/schema';
        function describe() {
          return salesRecords;
        }
      `,
    },
  ],
  invalid: [
    // Raw select without scoped condition
    {
      code: `
        import { salesRecords } from '@/db/schema';
        function fetch(db) {
          return db.select().from(salesRecords);
        }
      `,
      errors: [{ messageId: 'rawSalesQuery' }],
    },
    // Raw delete
    {
      code: `
        import { salesRecords } from '@/db/schema';
        function purge(db) {
          return db.delete(salesRecords);
        }
      `,
      errors: [{ messageId: 'rawSalesQuery' }],
    },
    // Raw update
    {
      code: `
        import { salesRecords } from '@/db/schema';
        function bump(db) {
          return db.update(salesRecords).set({ grossAmount: '1' });
        }
      `,
      errors: [{ messageId: 'rawSalesQuery' }],
    },
    // Raw insert (importer is allow-listed at config level, not here)
    {
      code: `
        import { salesRecords } from '@/db/schema';
        function load(db) {
          return db.insert(salesRecords).values({});
        }
      `,
      errors: [{ messageId: 'rawSalesQuery' }],
    },
    // Top-level raw query — no enclosing function; still flagged.
    {
      code: `
        import { salesRecords } from '@/db/schema';
        db.select().from(salesRecords);
      `,
      errors: [{ messageId: 'rawSalesQuery' }],
    },
    // scopedSalesCondition lives in a DIFFERENT function — doesn't count.
    {
      code: `
        import { salesRecords } from '@/db/schema';
        import { scopedSalesCondition } from '@/lib/scoping/scoped-query';
        async function cond(db, user) {
          return scopedSalesCondition(db, user);
        }
        function fetch(db) {
          return db.select().from(salesRecords);
        }
      `,
      errors: [{ messageId: 'rawSalesQuery' }],
    },
  ],
});

console.log('no-raw-sales-query rule tests passed');
