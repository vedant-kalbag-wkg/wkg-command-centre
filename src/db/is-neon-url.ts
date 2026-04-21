export function isNeonUrl(connectionString: string): boolean {
  if (!connectionString) return false;
  try {
    const url = new URL(connectionString);
    return url.hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}
