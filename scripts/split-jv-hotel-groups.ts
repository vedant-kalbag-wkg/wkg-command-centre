/**
 * Idempotent split of comma-encoded JV hotel_groups per audit Resolved
 * Decision D5 (tasks/todo.md, PR-6 Part C).
 *
 * Background: the Monday import created hotel_group rows whose `name` is a
 * comma-separated list of constituent groups (e.g.
 * "Marriott Group, Splendid Hospitality Group") to encode joint-venture (JV)
 * ownership. The right model is N:N memberships against the standalone
 * constituent groups; the JV row is redundant once memberships are split.
 *
 * What this script does — for every active (archived_at IS NULL)
 * comma-encoded hotel_group:
 *   1. Split the name on `,` into trimmed parts.
 *   2. For each part, ensure a standalone hotel_group exists (auto-create if
 *      missing — mirrors enrich-locations-from-monday.ts auto-insert pattern).
 *   3. For every location membered to the JV: add memberships to each
 *      constituent standalone (ON CONFLICT DO NOTHING), then delete the
 *      membership to the JV. Memberships of archived locations are migrated
 *      too — we preserve historical audit trails.
 *   4. Once all locations migrated, set archived_at = NOW() on the JV row.
 *
 * D5 keeps hotel_groups N:N (legitimate JV cases exist) — we are NOT layering
 * a UNIQUE(location_id) here. The schema change is just adding the
 * `archived_at` column (migration 0031).
 *
 * Idempotent: the WHERE archived_at IS NULL filter excludes JVs that have
 * already been split, so re-running on a clean DB is a no-op.
 *
 * Run:
 *   Dry-run (default):
 *     npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *       scripts/split-jv-hotel-groups.ts
 *   Apply:
 *     npx tsx --env-file=.env.neon-dev --tsconfig tsconfig.json \
 *       scripts/split-jv-hotel-groups.ts --apply
 */
import { Pool, type PoolClient } from "pg";

const APPLY = process.argv.includes("--apply");
const ETL_SYSTEM_USER_ID = "00000000-0000-0000-0000-000000000001";

type JvRow = { id: string; name: string };

type Plan = {
  jv_id: string;
  jv_name: string;
  parts: string[];
  // standalone group ids resolved or created for each part (same order as parts)
  part_ids: string[];
  // parts that did not exist as standalone before this run (for reporting)
  created_parts: string[];
  // location_ids currently membered to the JV
  member_location_ids: string[];
};

async function ensureStandalone(
  client: PoolClient,
  name: string,
): Promise<{ id: string; created: boolean }> {
  // Try to find an existing standalone (active) group with this exact name.
  // Active rather than any: an archived JV row could in principle have the
  // same name shape as a part (it can't here — parts have no comma), but
  // filtering on archived_at IS NULL is the right invariant.
  const found = await client.query<{ id: string }>(
    `SELECT id FROM hotel_groups WHERE name = $1 AND archived_at IS NULL`,
    [name],
  );
  if (found.rowCount && found.rowCount > 0) {
    return { id: found.rows[0].id, created: false };
  }
  if (!APPLY) {
    // In dry-run we don't insert; return a sentinel so the planner can still
    // report which parts WOULD be created. Caller filters this out before
    // any membership writes (which dry-run skips entirely anyway).
    return { id: "00000000-0000-0000-0000-000000000000", created: true };
  }
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO hotel_groups (name) VALUES ($1)
       ON CONFLICT (name) DO NOTHING
       RETURNING id`,
    [name],
  );
  if (inserted.rowCount && inserted.rowCount > 0) {
    return { id: inserted.rows[0].id, created: true };
  }
  // Race / archived row with same name — re-select.
  const refound = await client.query<{ id: string }>(
    `SELECT id FROM hotel_groups WHERE name = $1`,
    [name],
  );
  if (refound.rowCount !== 1) {
    throw new Error(`Failed to ensure standalone hotel_group "${name}"`);
  }
  return { id: refound.rows[0].id, created: false };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");
  console.log("Target:", url.replace(/:[^:@]+@/, ":***@"));
  console.log("Mode:  ", APPLY ? "APPLY (writes + audit log)" : "DRY RUN (no writes)");

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const jvs = await client.query<JvRow>(
      `SELECT id, name FROM hotel_groups
       WHERE name ~ '.+,.+' AND archived_at IS NULL
       ORDER BY name`,
    );

    if (jvs.rowCount === 0) {
      console.log("\nNo comma-encoded hotel_groups — nothing to do (idempotent re-run).");
      await client.query("ROLLBACK");
      return;
    }

    console.log(`\n--- ${jvs.rowCount} JV-encoded hotel_groups found ---`);

    const plans: Plan[] = [];
    for (const jv of jvs.rows) {
      const parts = jv.name
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (parts.length < 2) {
        // Defensive: regex .+,.+ guarantees >=2 parts, but trim could nuke one.
        console.warn(`  SKIP: "${jv.name}" produced <2 non-empty parts`);
        continue;
      }
      const partIds: string[] = [];
      const createdParts: string[] = [];
      for (const part of parts) {
        const { id, created } = await ensureStandalone(client, part);
        partIds.push(id);
        if (created) createdParts.push(part);
      }

      const members = await client.query<{ location_id: string }>(
        `SELECT location_id FROM location_hotel_group_memberships
         WHERE hotel_group_id = $1`,
        [jv.id],
      );

      plans.push({
        jv_id: jv.id,
        jv_name: jv.name,
        parts,
        part_ids: partIds,
        created_parts: createdParts,
        member_location_ids: members.rows.map((r) => r.location_id),
      });
    }

    let totalMembersMigrated = 0;
    const allCreatedParts = new Set<string>();
    for (const p of plans) {
      console.log(
        `  "${p.jv_name}" → ${p.parts.join(" + ")}  (members: ${p.member_location_ids.length}` +
          (p.created_parts.length
            ? `, NEW standalones: ${p.created_parts.join(", ")}`
            : "") +
          ")",
      );
      totalMembersMigrated += p.member_location_ids.length;
      for (const c of p.created_parts) allCreatedParts.add(c);
    }
    console.log(
      `\n  Total: ${plans.length} JVs, ${totalMembersMigrated} location memberships to migrate, ${allCreatedParts.size} standalones to auto-create.`,
    );

    if (!APPLY) {
      console.log("\n--- DRY RUN — would split JVs and archive originals ---");
      console.log("  Re-run with --apply to execute.");
      await client.query("ROLLBACK");
      return;
    }

    let totalAddedMemberships = 0;
    let totalDeletedMemberships = 0;
    let auditCount = 0;

    for (const p of plans) {
      // For each location, link to every part standalone and unlink from JV.
      for (const locId of p.member_location_ids) {
        // Insert N rows in one statement via unnest.
        const ins = await client.query(
          `INSERT INTO location_hotel_group_memberships (location_id, hotel_group_id)
           SELECT $1::uuid, hg_id
           FROM unnest($2::uuid[]) AS hg_id
           ON CONFLICT (location_id, hotel_group_id) DO NOTHING`,
          [locId, p.part_ids],
        );
        totalAddedMemberships += ins.rowCount ?? 0;

        const del = await client.query(
          `DELETE FROM location_hotel_group_memberships
           WHERE location_id = $1::uuid AND hotel_group_id = $2::uuid`,
          [locId, p.jv_id],
        );
        totalDeletedMemberships += del.rowCount ?? 0;

        // Lookup location name for the audit log entry.
        const lname = await client.query<{ name: string }>(
          `SELECT name FROM locations WHERE id = $1`,
          [locId],
        );
        const locationName = lname.rows[0]?.name ?? "(unknown)";

        await client.query(
          `INSERT INTO audit_logs
            (actor_id, actor_name, entity_type, entity_id, entity_name,
             action, field, old_value, new_value, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())`,
          [
            ETL_SYSTEM_USER_ID,
            "ETL System (split-jv-hotel-groups)",
            "location",
            locId,
            locationName,
            "update",
            "hotel_group_membership",
            p.jv_name,
            p.parts.join(" + "),
            JSON.stringify({
              reason:
                "D5 PR-6 Part C — split comma-encoded JV hotel_group into per-constituent N:N memberships",
              jv_hotel_group_id: p.jv_id,
              jv_hotel_group_name: p.jv_name,
              constituent_hotel_group_ids: p.part_ids,
              constituent_hotel_group_names: p.parts,
              script: "scripts/split-jv-hotel-groups.ts",
            }),
          ],
        );
        auditCount += 1;
      }

      // Archive the JV row itself.
      await client.query(
        `UPDATE hotel_groups SET archived_at = NOW() WHERE id = $1`,
        [p.jv_id],
      );
      await client.query(
        `INSERT INTO audit_logs
          (actor_id, actor_name, entity_type, entity_id, entity_name,
           action, field, old_value, new_value, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())`,
        [
          ETL_SYSTEM_USER_ID,
          "ETL System (split-jv-hotel-groups)",
          "hotel_group",
          p.jv_id,
          p.jv_name,
          "archive",
          "archived_at",
          null,
          "now()",
          JSON.stringify({
            reason:
              "D5 PR-6 Part C — JV row archived after splitting into per-constituent memberships",
            constituent_hotel_group_ids: p.part_ids,
            constituent_hotel_group_names: p.parts,
            members_migrated: p.member_location_ids.length,
            script: "scripts/split-jv-hotel-groups.ts",
          }),
        ],
      );
      auditCount += 1;
    }

    console.log(
      `\n  Added ${totalAddedMemberships} new constituent memberships.\n` +
        `  Deleted ${totalDeletedMemberships} JV memberships.\n` +
        `  Archived ${plans.length} JV hotel_groups.\n` +
        `  Wrote ${auditCount} audit_logs rows.`,
    );

    if (allCreatedParts.size > 0) {
      console.log(`\n  Auto-created standalone hotel_groups (${allCreatedParts.size}):`);
      for (const name of [...allCreatedParts].sort()) console.log(`    + ${name}`);
    }

    // Idempotency self-check — should report 0 of each.
    const post = await client.query<{ unarchived_jvs: number; jv_memberships: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM hotel_groups WHERE name ~ '.+,.+' AND archived_at IS NULL) AS unarchived_jvs,
         (SELECT COUNT(*)::int FROM location_hotel_group_memberships lhgm
          JOIN hotel_groups hg ON hg.id = lhgm.hotel_group_id
          WHERE hg.name ~ '.+,.+') AS jv_memberships`,
    );
    console.log(
      `\n  Post-apply: unarchived JVs=${post.rows[0].unarchived_jvs}, residual JV memberships=${post.rows[0].jv_memberships} (idempotent: re-run would do nothing).`,
    );

    await client.query("COMMIT");
    console.log("\nCommitted.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("\nRolled back:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
