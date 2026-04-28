"use server";

/**
 * Server actions for /settings/geocoding (Phase 6 plan 06-06).
 *
 * Three verbs match the pipeline: dryRunGeocoding, applyGeocoding,
 * cancelGeocoding. Every action gates on `requireRole("admin")` so the page
 * (which also redirects on RBAC failure) is doubly-defended even if a
 * client-only navigation bypasses the page guard.
 *
 * The Google Maps API key is read from `process.env.GOOGLE_MAPS_API_KEY`
 * here, NOT in the pipeline — keeps the pipeline pure-DI and lets the UI
 * surface a clear "configuration error" path when the key is unset on the
 * deployment.
 */

import { db } from "@/db";
import { requireRole } from "@/lib/rbac";
import { makeGoogleGeocoder } from "@/lib/geocoding/google";
import {
  _stageGeocodeForActor,
  _commitGeocodeForActor,
  _cancelGeocodeForActor,
  countGeocodeCandidates,
  type GeocodeStageSummary,
  type GeocodeStagedRow,
  type GeocodeCommitResult,
} from "@/lib/geocoding/pipeline";

export type DryRunResult =
  | { success: true; summary: GeocodeStageSummary }
  | { error: string };

export type ApplyResult =
  | { success: true; result: GeocodeCommitResult }
  | { error: string };

export async function getCandidateCount(
  forceRerun: boolean,
): Promise<{ count: number } | { error: string }> {
  try {
    await requireRole("admin");
    const count = await countGeocodeCandidates(db, forceRerun);
    return { count };
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Failed to count candidates",
    };
  }
}

export async function dryRunGeocoding(opts: {
  forceRerun: boolean;
}): Promise<DryRunResult> {
  let session: Awaited<ReturnType<typeof requireRole>>;
  try {
    session = await requireRole("admin");
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Unauthorized",
    };
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!apiKey) {
    return {
      error:
        "GOOGLE_MAPS_API_KEY is not set on this deployment. Add it under Vercel → Settings → Environment Variables and redeploy before running geocoding.",
    };
  }

  try {
    const geocoder = makeGoogleGeocoder(apiKey);
    const summary = await _stageGeocodeForActor(
      { id: session.user.id, name: session.user.name },
      db,
      geocoder,
      opts,
    );
    return { success: true, summary };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Dry-run failed",
    };
  }
}

export async function applyGeocoding(
  stagingId: string,
  rows: GeocodeStagedRow[],
): Promise<ApplyResult> {
  let session: Awaited<ReturnType<typeof requireRole>>;
  try {
    session = await requireRole("admin");
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Unauthorized",
    };
  }

  try {
    const result = await _commitGeocodeForActor(
      { id: session.user.id, name: session.user.name },
      db,
      stagingId,
      rows,
    );
    return { success: true, result };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Apply failed",
    };
  }
}

export async function cancelGeocoding(
  stagingId: string,
): Promise<{ success: true } | { error: string }> {
  try {
    await requireRole("admin");
    await _cancelGeocodeForActor(stagingId);
    return { success: true };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "Cancel failed",
    };
  }
}
