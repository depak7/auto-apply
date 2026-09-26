/**
 * Versioned schema migrations. Pending migrations run in order, in one transaction, and are
 * recorded in `schema_migrations`. A transaction-scoped advisory lock makes concurrent starts
 * (API and workers booting together) safe: one process migrates, the others wait and then find
 * nothing left to do.
 *
 * Never edit a released migration; add a new one.
 */

import type { Db } from "./db.ts";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial schema",
    sql: `
      CREATE TABLE resumes (
        id          uuid PRIMARY KEY,
        name        text NOT NULL,
        pdf_path    text,
        resume      jsonb NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE applications (
        id                  uuid PRIMARY KEY,
        url                 text NOT NULL,
        resume_id           uuid NOT NULL REFERENCES resumes (id) ON DELETE CASCADE,
        status              text NOT NULL,
        job                 jsonb,
        score               jsonb,
        tailor              jsonb,
        questions           jsonb,
        pdf_path            text,
        screenshot_path     text,
        submit_attempted_at timestamptz,
        error               text,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX applications_created_at_idx ON applications (created_at DESC);
      CREATE INDEX applications_resume_id_idx ON applications (resume_id);

      -- Single-user for now: exactly one profile row.
      CREATE TABLE profile (
        id          smallint PRIMARY KEY CHECK (id = 1),
        profile     jsonb NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      );
    `,
  },
  {
    version: 2,
    name: "files are stored by key, not local path",
    sql: `
      ALTER TABLE resumes RENAME COLUMN pdf_path TO pdf_key;
      ALTER TABLE applications RENAME COLUMN pdf_path TO pdf_key;
      ALTER TABLE applications RENAME COLUMN screenshot_path TO screenshot_key;
    `,
  },
];

// Arbitrary constant identifying this app's migration lock.
const LOCK_KEY = 7_265_110_231;

/** Apply pending migrations; returns the versions it ran. */
export async function migrate(db: Db): Promise<number[]> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]); // held until this transaction ends
    await tx.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     integer PRIMARY KEY,
        name        text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await tx.query<{ version: number }>("SELECT version FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.version));
    const pending = MIGRATIONS.filter((m) => !applied.has(m.version));
    for (const m of pending) {
      await tx.exec(m.sql);
      await tx.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [m.version, m.name]);
    }
    return pending.map((m) => m.version);
  });
}
