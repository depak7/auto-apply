/**
 * Settings in one place. Values come from the environment, or from .env in the project root.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const envFile = join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile); // built into Node, no dotenv needed

export const HTTP_TIMEOUT_MS = 20_000;

/** Get a setting that must be present, with a clear error if it isn't. */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Add it to ${envFile}`);
  return value;
}

/** Resume-vs-job scoring. Jev scores each requirement 0..2 (not shown / related / clearly shown). */
export const SCORING = {
  mustWeight: 2, // must-have requirements count double in the overall score
  niceWeight: 1,
  gapBelow: 0.5, // below this: a gap. Shown to the user, never written into the resume
  clearFrom: 1.5, // from this up: clearly shown. Between the two: "related", what tailoring improves
};

/** Resume tailoring. */
export const TAILORING = {
  maxRounds: 2, // rewrite -> check -> re-score, at most this many times
  maxEditsPerRound: 8,
  truthMin: 0.75, // Jev's P("describes only the original line's work") needed to keep a rewrite (after the code checks)
  keepsMin: 0.6, // Jev's P("keeps everything the original states"); a bit lower: pure reorders score ~0.7
  unsureBelow: 0.6, // requirement scores with Jev confidence under this are marked "unsure" in the output
};

/** Postgres connection. The default matches `npm run db` (the compose `postgres` service). */
export const DATABASE_URL = process.env.DATABASE_URL || "postgres://autoapply:autoapply@localhost:5433/autoapply";
/** CA certificate (PEM) for a Postgres server signed by its own CA, such as Aiven. */
export const DATABASE_CA_CERT = process.env.DATABASE_CA_CERT || undefined;
/** Postgres schema for AutoApply's tables (default: public). Use one when the database is shared. */
export const DATABASE_SCHEMA = process.env.DATABASE_SCHEMA || undefined;

/** Where the app keeps files: uploaded resumes, rendered PDFs, screenshots. */
export const DATA_DIR = process.env.DATA_DIR || join(ROOT, "data");
export const API_PORT = Number(process.env.PORT || 3000);

const PRODUCTION = process.env.NODE_ENV === "production";

/** A secret from the environment. Development falls back to `devValue`; production refuses to start without it. */
function secretEnv(name: string, devValue: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (PRODUCTION) throw new Error(`${name} is not set`);
  return devValue;
}

/**
 * Sign-in settings. GOOGLE_CLIENT_ID is required in production: without it the app has a single
 * local user that anyone could sign in as.
 */
export function authConfig() {
  const googleClientId = process.env.GOOGLE_CLIENT_ID?.trim() || undefined;
  if (PRODUCTION && !googleClientId) throw new Error("GOOGLE_CLIENT_ID is not set");
  return {
    googleClientId,
    sessionSecret: secretEnv("SESSION_SECRET", "development-only-session-secret"),
    secureCookies: PRODUCTION,
  };
}

/** Key that encrypts users' Workday passwords: 32 bytes, base64 (`openssl rand -base64 32`). */
export const credentialsKey = () => secretEnv("CREDENTIALS_KEY", Buffer.alloc(32, 1).toString("base64"));

/** A Workday account from the environment, for the developer tools (the app uses each user's own login). */
export function workdayCredentials() {
  return { email: requireEnv("WORKDAY_EMAIL"), password: requireEnv("WORKDAY_PASSWORD") };
}
