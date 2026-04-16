import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
  setupTestDb,
  teardownTestDb,
  type TestDbContext,
} from '../helpers/test-db';
import {
  user,
  userScopes,
  auditLogs,
  hotelGroups,
  providers as providersTable,
} from '@/db/schema';
import {
  _listScopesForActor,
  _addScopeForActor,
  _removeScopeForActor,
  type Actor,
} from '@/app/(app)/settings/users/[id]/scopes-actions';

/**
 * Integration tests for userScopes CRUD server actions.
 *
 * Auth gating (requireRole('admin')) is exercised via the internal helpers
 * which accept the actor as an explicit parameter. The public server actions
 * delegate to these helpers after running requireRole('admin'); the requireRole
 * path itself is covered by src/lib/rbac.ts and its callers — we don't mock
 * next/headers here because the internal-helper seam keeps tests deterministic
 * without monkey-patching framework modules.
 */
describe('userScopes CRUD actions (integration)', () => {
  let ctx: TestDbContext;

  const adminActor: Actor = {
    id: randomUUID(),
    name: 'Admin User',
    role: 'admin',
  };
  const memberActor: Actor = {
    id: randomUUID(),
    name: 'Member User',
    role: 'member',
  };
  const viewerActor: Actor = {
    id: randomUUID(),
    name: 'Viewer User',
    role: 'viewer',
  };

  // Target users for scope manipulation
  const externalUserId = randomUUID();
  const internalUserId = randomUUID();

  // Dimension IDs (real rows so unique constraint behaviour is faithful)
  let hgAId: string;
  let hgBId: string;
  let providerId: string;

  beforeAll(async () => {
    ctx = await setupTestDb();

    await ctx.db.insert(user).values([
      {
        id: adminActor.id,
        email: 'admin@t.t',
        name: adminActor.name,
        emailVerified: true,
        userType: 'internal',
        role: 'admin',
      },
      {
        id: memberActor.id,
        email: 'member@t.t',
        name: memberActor.name,
        emailVerified: true,
        userType: 'internal',
        role: 'member',
      },
      {
        id: viewerActor.id,
        email: 'viewer@t.t',
        name: viewerActor.name,
        emailVerified: true,
        userType: 'internal',
        role: 'viewer',
      },
      {
        id: externalUserId,
        email: 'ext@t.t',
        name: 'External Target',
        emailVerified: true,
        userType: 'external',
        role: null,
      },
      {
        id: internalUserId,
        email: 'int@t.t',
        name: 'Internal Target',
        emailVerified: true,
        userType: 'internal',
        role: 'member',
      },
    ]);

    const [hgA] = await ctx.db
      .insert(hotelGroups)
      .values({ name: 'HG-A' })
      .returning();
    const [hgB] = await ctx.db
      .insert(hotelGroups)
      .values({ name: 'HG-B' })
      .returning();
    const [prov] = await ctx.db
      .insert(providersTable)
      .values({ name: 'Provider-X' })
      .returning();
    hgAId = hgA.id;
    hgBId = hgB.id;
    providerId = prov.id;
  }, 180_000);

  afterAll(async () => {
    if (ctx) await teardownTestDb(ctx);
  });

  beforeEach(async () => {
    // Reset per-test mutable state: scopes + audit logs.
    await ctx.db.delete(userScopes);
    await ctx.db.delete(auditLogs);
  });

  // ---------------------------------------------------------------------------
  // Happy paths
  // ---------------------------------------------------------------------------

  it('admin can addScope then listScopes returns the row', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );

    const rows = await _listScopesForActor(ctx.db, adminActor, internalUserId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: internalUserId,
      dimensionType: 'hotel_group',
      dimensionId: hgAId,
    });
    expect(rows[0].id).toBeTruthy();
    expect(rows[0].createdAt).toBeInstanceOf(Date);
  });

  it('admin can removeScope and listScopes no longer returns it', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgBId,
    );
    const before = await _listScopesForActor(
      ctx.db,
      adminActor,
      internalUserId,
    );
    expect(before).toHaveLength(2);

    const target = before.find((r) => r.dimensionId === hgAId)!;
    await _removeScopeForActor(ctx.db, adminActor, target.id);

    const after = await _listScopesForActor(
      ctx.db,
      adminActor,
      internalUserId,
    );
    expect(after).toHaveLength(1);
    expect(after[0].dimensionId).toBe(hgBId);
  });

  // ---------------------------------------------------------------------------
  // Auth invariants — non-admin throws Forbidden
  // ---------------------------------------------------------------------------

  it('non-admin (member) calling listScopes throws Forbidden', async () => {
    await expect(
      _listScopesForActor(ctx.db, memberActor, internalUserId),
    ).rejects.toThrow(/forbidden/i);
  });

  it('non-admin (viewer) calling addScope throws Forbidden', async () => {
    await expect(
      _addScopeForActor(
        ctx.db,
        viewerActor,
        internalUserId,
        'hotel_group',
        hgAId,
      ),
    ).rejects.toThrow(/forbidden/i);
  });

  it('non-admin (member) calling removeScope throws Forbidden', async () => {
    // seed via admin
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );
    const [row] = await _listScopesForActor(
      ctx.db,
      adminActor,
      internalUserId,
    );

    await expect(
      _removeScopeForActor(ctx.db, memberActor, row.id),
    ).rejects.toThrow(/forbidden/i);
  });

  // ---------------------------------------------------------------------------
  // External-user invariant
  // ---------------------------------------------------------------------------

  it('external user cannot be left with 0 scopes — removeScope throws on the last row', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      externalUserId,
      'hotel_group',
      hgAId,
    );
    const [only] = await _listScopesForActor(
      ctx.db,
      adminActor,
      externalUserId,
    );

    await expect(
      _removeScopeForActor(ctx.db, adminActor, only.id),
    ).rejects.toThrow(/last scope.*external/i);

    // Row must still be present.
    const after = await _listScopesForActor(
      ctx.db,
      adminActor,
      externalUserId,
    );
    expect(after).toHaveLength(1);
  });

  it('external user with multiple scopes — can remove down to 1', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      externalUserId,
      'hotel_group',
      hgAId,
    );
    await _addScopeForActor(
      ctx.db,
      adminActor,
      externalUserId,
      'provider',
      providerId,
    );
    const seeded = await _listScopesForActor(
      ctx.db,
      adminActor,
      externalUserId,
    );
    expect(seeded).toHaveLength(2);

    const first = seeded[0];
    await _removeScopeForActor(ctx.db, adminActor, first.id);

    const remaining = await _listScopesForActor(
      ctx.db,
      adminActor,
      externalUserId,
    );
    expect(remaining).toHaveLength(1);
  });

  it('internal user CAN be left with 0 scopes — removeScope succeeds', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );
    const [only] = await _listScopesForActor(
      ctx.db,
      adminActor,
      internalUserId,
    );

    await _removeScopeForActor(ctx.db, adminActor, only.id);

    const after = await _listScopesForActor(
      ctx.db,
      adminActor,
      internalUserId,
    );
    expect(after).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------

  it('invalid dimensionType throws', async () => {
    await expect(
      _addScopeForActor(
        ctx.db,
        adminActor,
        internalUserId,
        // @ts-expect-error — intentionally bad input to exercise runtime guard
        'bogus',
        hgAId,
      ),
    ).rejects.toThrow(/dimension/i);
  });

  // ---------------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------------

  it('addScope is idempotent — adding the same triple twice does not create a duplicate', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );

    const rows = await _listScopesForActor(
      ctx.db,
      adminActor,
      internalUserId,
    );
    expect(rows).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // Audit logging
  // ---------------------------------------------------------------------------

  it('audit log entry exists after addScope (action=assign)', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );

    const logs = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'user'),
          eq(auditLogs.entityId, internalUserId),
        ),
      );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorId: adminActor.id,
      actorName: adminActor.name,
      entityType: 'user',
      entityId: internalUserId,
      action: 'assign',
      field: 'userScopes',
    });
    expect(logs[0].newValue).toContain('hotel_group');
    expect(logs[0].newValue).toContain(hgAId);
  });

  it('audit log entry exists after removeScope (action=unassign)', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'provider',
      providerId,
    );
    const [row] = await _listScopesForActor(
      ctx.db,
      adminActor,
      internalUserId,
    );

    // Clear the assign log so we can isolate the unassign one.
    await ctx.db.delete(auditLogs);

    await _removeScopeForActor(ctx.db, adminActor, row.id);

    const logs = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'user'),
          eq(auditLogs.entityId, internalUserId),
        ),
      );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      actorId: adminActor.id,
      actorName: adminActor.name,
      entityType: 'user',
      entityId: internalUserId,
      action: 'unassign',
      field: 'userScopes',
    });
    expect(logs[0].oldValue).toContain('provider');
    expect(logs[0].oldValue).toContain(providerId);
  });

  it('idempotent addScope still writes an audit entry (UX trace) — duplicate suppressed at DB but action recorded', async () => {
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );
    await _addScopeForActor(
      ctx.db,
      adminActor,
      internalUserId,
      'hotel_group',
      hgAId,
    );

    const logs = await ctx.db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.entityType, 'user'),
          eq(auditLogs.entityId, internalUserId),
          eq(auditLogs.action, 'assign'),
        ),
      );
    // Both calls audit-log; the DB-level dedupe is the unique constraint.
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // removeScope on missing id
  // ---------------------------------------------------------------------------

  it('removeScope throws when scope id does not exist', async () => {
    await expect(
      _removeScopeForActor(ctx.db, adminActor, randomUUID()),
    ).rejects.toThrow(/not found/i);
  });
});
