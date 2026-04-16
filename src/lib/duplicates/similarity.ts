export interface ScorablePair {
  id: string;
  name: string;
  customerCode: string | null;
  hotelGroup: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface PairScore {
  score: number;
  reasons: Array<"name" | "code" | "geo" | "group">;
  nameSimilarity: number;
  distanceMeters: number | null;
}

const PUNCT_RE = /[^\p{L}\p{N}\s]/gu;
const CODE_SUFFIX_RE = /\s*\[[^\]]+\]\s*$/;
const WHITESPACE_RE = /\s+/g;

export function normalizeForMatch(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(CODE_SUFFIX_RE, "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(PUNCT_RE, " ")
    .replace(WHITESPACE_RE, " ")
    .trim();
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 2) {
    if (s.length === 1) out.add(s);
    return out;
  }
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

export function bigramJaccard(a: string, b: string): number {
  if (!a && !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  if (A.size === 0 || B.size === 0) return a === b ? 1 : 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const CODE_BOOST = 0.15;
const GEO_BOOST = 0.1;
const GROUP_BOOST = 0.05;
const GEO_RADIUS_M = 200;
const MIN_NAME_SIM_FOR_BOOST = 0.3;

export function scorePair(a: ScorablePair, b: ScorablePair): PairScore {
  const nameSim = bigramJaccard(
    normalizeForMatch(a.name),
    normalizeForMatch(b.name)
  );

  const reasons: PairScore["reasons"] = [];
  let score = nameSim;
  if (nameSim >= 0.5) reasons.push("name");

  if (nameSim >= MIN_NAME_SIM_FOR_BOOST) {
    if (
      a.customerCode &&
      b.customerCode &&
      a.customerCode.trim().toLowerCase() === b.customerCode.trim().toLowerCase()
    ) {
      score += CODE_BOOST;
      reasons.push("code");
    }
  }

  let distanceMeters: number | null = null;
  if (
    a.latitude != null &&
    a.longitude != null &&
    b.latitude != null &&
    b.longitude != null
  ) {
    distanceMeters = haversineMeters(
      a.latitude,
      a.longitude,
      b.latitude,
      b.longitude
    );
    if (
      nameSim >= MIN_NAME_SIM_FOR_BOOST &&
      distanceMeters <= GEO_RADIUS_M
    ) {
      score += GEO_BOOST;
      reasons.push("geo");
    }
  }

  if (nameSim >= MIN_NAME_SIM_FOR_BOOST) {
    if (
      a.hotelGroup &&
      b.hotelGroup &&
      a.hotelGroup.trim().toLowerCase() === b.hotelGroup.trim().toLowerCase()
    ) {
      score += GROUP_BOOST;
      reasons.push("group");
    }
  }

  return { score: Math.min(1, score), reasons, nameSimilarity: nameSim, distanceMeters };
}
