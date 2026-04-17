/**
 * Region → coordinate mapping for weather lookups.
 * Coordinates represent a central/representative point in each region.
 * Used by the weather overlay to fetch OpenMeteo data for the user's
 * selected region (or a default location when none selected).
 */

export type Coordinate = {
  lat: number;
  lon: number;
  label: string;
};

/**
 * Map of region/location identifiers to coordinates.
 * Keys are lowercase region names or location group names.
 * Falls back to London (UK) when no match is found.
 */
const REGION_COORDINATES: Record<string, Coordinate> = {
  // UK regions
  uk: { lat: 51.5074, lon: -0.1278, label: "London, UK" },
  london: { lat: 51.5074, lon: -0.1278, label: "London" },
  "south east": { lat: 51.2, lon: 0.5, label: "South East England" },
  "south west": { lat: 50.7, lon: -3.5, label: "South West England" },
  midlands: { lat: 52.4862, lon: -1.8904, label: "Midlands" },
  "north west": { lat: 53.4808, lon: -2.2426, label: "North West England" },
  "north east": { lat: 54.9783, lon: -1.6178, label: "North East England" },
  scotland: { lat: 55.9533, lon: -3.1883, label: "Edinburgh, Scotland" },
  wales: { lat: 51.4816, lon: -3.1791, label: "Cardiff, Wales" },
  ireland: { lat: 53.3498, lon: -6.2603, label: "Dublin, Ireland" },

  // European regions
  europe: { lat: 48.8566, lon: 2.3522, label: "Paris, Europe" },
  france: { lat: 48.8566, lon: 2.3522, label: "Paris, France" },
  spain: { lat: 40.4168, lon: -3.7038, label: "Madrid, Spain" },
  portugal: { lat: 38.7223, lon: -9.1393, label: "Lisbon, Portugal" },
  italy: { lat: 41.9028, lon: 12.4964, label: "Rome, Italy" },
  germany: { lat: 52.52, lon: 13.405, label: "Berlin, Germany" },
  greece: { lat: 37.9838, lon: 23.7275, label: "Athens, Greece" },
  turkey: { lat: 41.0082, lon: 28.9784, label: "Istanbul, Turkey" },

  // Middle East
  dubai: { lat: 25.2048, lon: 55.2708, label: "Dubai, UAE" },
  uae: { lat: 25.2048, lon: 55.2708, label: "Dubai, UAE" },

  // Americas
  "north america": { lat: 40.7128, lon: -74.006, label: "New York, USA" },
  caribbean: { lat: 18.1096, lon: -77.2975, label: "Kingston, Jamaica" },
};

const DEFAULT_COORDINATE: Coordinate = {
  lat: 51.5074,
  lon: -0.1278,
  label: "London, UK (default)",
};

/**
 * Resolve a region/location name to weather coordinates.
 * Tries exact match first, then fuzzy substring match.
 * Falls back to London, UK.
 */
export function resolveWeatherLocation(regionName?: string): Coordinate {
  if (!regionName) return DEFAULT_COORDINATE;

  const key = regionName.toLowerCase().trim();

  // Exact match
  if (REGION_COORDINATES[key]) {
    return REGION_COORDINATES[key];
  }

  // Substring match (e.g. "UK - London" contains "london")
  for (const [name, coord] of Object.entries(REGION_COORDINATES)) {
    if (key.includes(name) || name.includes(key)) {
      return coord;
    }
  }

  return DEFAULT_COORDINATE;
}
