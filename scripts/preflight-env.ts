const REQUIRED = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "DATABASE_URL"] as const;

const env = process.env.VERCEL_ENV;
const missing = REQUIRED.filter((k) => !process.env[k]);

if (missing.length === 0) {
  process.exit(0);
}

if (env === "production") {
  console.error(
    `\nPreflight failed: missing required environment variable(s) on Vercel Production:\n` +
      missing.map((k) => `  - ${k}`).join("\n") +
      `\n\nFix: set them in Vercel Project -> Settings -> Environment Variables -> Production, then redeploy.\n`,
  );
  process.exit(1);
}

if (env === "preview") {
  for (const k of missing) {
    console.warn(`Preflight WARN: ${k} is not set on Vercel Preview`);
  }
}
