/**
 * Google Maps Geocoding wrapper — Phase 6 plan 06-06.
 *
 * Thin DI-friendly boundary around `@googlemaps/google-maps-services-js`. The
 * pipeline (`./pipeline.ts`) depends on the `Geocoder` interface, NOT the SDK
 * directly. Tests inject a stub `Geocoder` so unit/integration runs never hit
 * the real network.
 *
 * Env-var convention (per RESEARCH.md): no centralised `src/lib/env.ts`. The
 * action layer reads the API key from process.env and passes it to
 * `makeGoogleGeocoder()`. This file MUST NOT reference `process.env` — keeps
 * the boundary pure DI and makes the env-var failure mode easy to surface in
 * the UI ("API key not set on this deployment").
 */

import { Client, Status } from "@googlemaps/google-maps-services-js";

export type GeocodeResult =
  | {
      status: "ok";
      latitude: number;
      longitude: number;
      formattedAddress: string;
      // Google's confidence proxy: location_type ∈
      //   ROOFTOP | RANGE_INTERPOLATED | GEOMETRIC_CENTER | APPROXIMATE
      locationType: string;
      placeId: string;
    }
  | {
      status: "no_results";
      address: string;
    }
  | {
      status: "error";
      address: string;
      errorMessage: string;
    };

export type Geocoder = {
  geocode: (address: string) => Promise<GeocodeResult>;
};

/**
 * Construct a Geocoder backed by the Google Maps Geocoding API. Throws
 * synchronously if `apiKey` is empty so the action layer surfaces a clear
 * configuration error rather than letting the SDK swallow the missing key.
 */
export function makeGoogleGeocoder(apiKey: string): Geocoder {
  if (!apiKey) {
    throw new Error(
      "An API key is required to construct the Google Maps geocoder",
    );
  }
  const client = new Client({});

  return {
    geocode: async (address: string): Promise<GeocodeResult> => {
      try {
        const res = await client.geocode({ params: { address, key: apiKey } });
        if (res.data.status === Status.ZERO_RESULTS) {
          return { status: "no_results", address };
        }
        if (res.data.status !== Status.OK) {
          return {
            status: "error",
            address,
            errorMessage:
              res.data.error_message ??
              `Google Maps status: ${res.data.status}`,
          };
        }
        const top = res.data.results[0];
        if (!top) return { status: "no_results", address };
        return {
          status: "ok",
          latitude: top.geometry.location.lat,
          longitude: top.geometry.location.lng,
          formattedAddress: top.formatted_address,
          locationType: top.geometry.location_type ?? "UNKNOWN",
          placeId: top.place_id,
        };
      } catch (err) {
        return {
          status: "error",
          address,
          errorMessage:
            err instanceof Error ? err.message : "Unknown geocoder error",
        };
      }
    },
  };
}
