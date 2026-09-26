/**
 * The app's records in Postgres: users, and each user's resumes, applications, profile, and
 * Workday login. Nested values (job, score, tailoring result) are `jsonb` columns, validated with
 * their Zod schemas when read.
 *
 * Methods the API calls take the signed-in user's id and only ever touch that user's rows.
 * Workers load an application by id alone (`getApplication(id)`): they act on what the workflow gives them.
 */

import { randomUUID } from "node:crypto";

import { EMPTY_PROFILE, Job, Profile, Resume, ScoreResult, TailorResult } from "../schemas/index.ts";
import { checkSchema, connectPostgres, type Db, type PostgresOptions } from "./db.ts";
import { migrate } from "./migrations.ts";

/** Where an application is. The workflow moves it forward; the UI shows it. */
export const STATUSES = [
  "CREATED",
  "FETCHING", // reading the job from Workday
  "SCORING", // requirements + Jev fit + keywords
  "TAILORING", // rewrite, truth check, re-score
  "AWAITING_APPROVAL", // waiting for the user to approve or reject the diff
  "REJECTED", // user said no
  "EXPIRED", // no decision within the approval window
  "RENDERING", // making the tailored resume PDF
  "QUEUED", // waiting in Temporal's apply queue for a browser worker
  "APPLYING", // browser worker is filling the form
  "NEEDS_INPUT", // paused: the form asked something the facts don't answer; see `questions`
  "NEEDS_CODE", // the browser is waiting on Workday's verification code page for the user to type the code
  "READY_TO_SUBMIT", // filled up to Workday's Review page; waiting for the user to say "submit"
  "SUBMITTING", // browser worker is re-opening the draft to click Submit (once)
  "SUBMITTED", // Workday confirmed the application
  "SUBMIT_UNCONFIRMED", // Submit was clicked but Workday's confirmation never showed: check in Workday, never retried
  "ALREADY_APPLIED", // Workday says this account applied to the job before (not by us): nothing to do
  "FAILED",
] as const;
export type Status = (typeof STATUSES)[number];

export interface User {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  createdAt: string;
}

/** Who signed in, as Google (or local development) describes them. */
export interface Identity {
  sub: string;
  email: string;
  name: string | null;
  picture: string | null;
}

export interface WorkdayAccount {
  email: string;
  passwordSealed: string; // encrypted by SecretBox; the store never sees the password
  updatedAt: string;
}

export interface ResumeRecord {
  id: string;
  userId: string | null;
  name: string;
  pdfKey: string | null;
  resume: Resume;
  createdAt: string;
}

export interface ApplicationRecord {
  id: string;
  userId: string | null;
  url: string;
  resumeId: string;
  status: Status;
  job: Job | null;
  score: ScoreResult | null;
  tailor: TailorResult | null;
  pdfKey: string | null; // file key of the tailored resume PDF, uploaded with the application
  questions: string[] | null; // what the form asked that we could not answer (NEEDS_INPUT)
  screenshotKey: string | null; // file key of the last page the browser worker saw
  submitAttemptedAt: string | null; // set BEFORE clicking Submit: if present, Submit is never clicked again
  code: string | null; // verification code the user typed while NEEDS_CODE; cleared once read
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationPatch = Partial<
  Pick<
    ApplicationRecord,
    | "status"
    | "job"
    | "score"
    | "tailor"
    | "pdfKey"
    | "questions"
    | "screenshotKey"
    | "submitAttemptedAt"
    | "code"
    | "error"
  >
>;

/** Patchable fields and their columns. JSON fields are sent as text and cast to jsonb. */
const COLUMNS: Record<keyof ApplicationPatch, { column: string; json?: true }> = {
  status: { column: "status" },
  job: { column: "job", json: true },
  score: { column: "score", json: true },
  tailor: { column: "tailor", json: true },
  questions: { column: "questions", json: true },
  pdfKey: { column: "pdf_key" },
  screenshotKey: { column: "screenshot_key" },
  submitAttemptedAt: { column: "submit_attempted_at" },
  code: { column: "code" },
  error: { column: "error" },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonb = (value: unknown) => (value == null ? null : JSON.stringify(value));
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value == null ? null : String(value));

type Row = Record<string, unknown>;

export class Store {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /** Connect to `url`, create the schema if one is given, apply pending migrations, and return a ready store. */
  static async connect(url: string, options: PostgresOptions = {}): Promise<Store> {
    const db = connectPostgres(url, options);
    if (options.schema) await db.exec(`CREATE SCHEMA IF NOT EXISTS ${checkSchema(options.schema)}`);
    await migrate(db);
    return new Store(db);
  }

  close(): Promise<void> {
    return this.db.close();
  }

  // Users

  /** Create or update the user who just signed in. The very first user also claims rows from before sign-in existed. */
  async signIn(who: Identity): Promise<User> {
    return this.db.transaction(async (tx) => {
      const { rows: count } = await tx.query<{ n: string }>("SELECT count(*) AS n FROM users");
      const { rows } = await tx.query<Row>(
        `INSERT INTO users (id, google_sub, email, name, picture) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (google_sub) DO UPDATE
           SET email = excluded.email, name = excluded.name, picture = excluded.picture, last_login_at = now()
         RETURNING *`,
        [randomUUID(), who.sub, who.email, who.name, who.picture],
      );
      const user = toUser(rows[0]!);
      if (Number(count[0]!.n) === 0) {
        await tx.query("UPDATE resumes SET user_id = $1 WHERE user_id IS NULL", [user.id]);
        await tx.query("UPDATE applications SET user_id = $1 WHERE user_id IS NULL", [user.id]);
        await tx.query(
          "INSERT INTO profiles (user_id, profile) SELECT $1, profile FROM profile WHERE id = 1 ON CONFLICT DO NOTHING",
          [user.id],
        );
      }
      return user;
    });
  }

  async getUser(id: string): Promise<User | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.db.query<Row>("SELECT * FROM users WHERE id = $1", [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  // Profile

  async getProfile(userId: string): Promise<Profile> {
    const { rows } = await this.db.query<Row>("SELECT profile FROM profiles WHERE user_id = $1", [userId]);
    return rows[0] ? Profile.parse(rows[0].profile) : EMPTY_PROFILE;
  }

  async saveProfile(userId: string, profile: Profile): Promise<Profile> {
    const valid = Profile.parse(profile);
    await this.db.query(
      `INSERT INTO profiles (user_id, profile) VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET profile = excluded.profile, updated_at = now()`,
      [userId, jsonb(valid)],
    );
    return valid;
  }

  /** Add answers (question -> answer) to the profile, so the same question is never asked twice. */
  async addAnswers(userId: string, answers: Record<string, string>): Promise<Profile> {
    const profile = await this.getProfile(userId);
    return this.saveProfile(userId, { ...profile, answers: { ...profile.answers, ...answers } });
  }

  // Workday login

  async getWorkdayAccount(userId: string): Promise<WorkdayAccount | null> {
    const { rows } = await this.db.query<Row>("SELECT * FROM workday_accounts WHERE user_id = $1", [userId]);
    const r = rows[0];
    return r
      ? { email: String(r.email), passwordSealed: String(r.password_sealed), updatedAt: iso(r.updated_at)! }
      : null;
  }

  async saveWorkdayAccount(userId: string, email: string, passwordSealed: string): Promise<void> {
    await this.db.query(
      `INSERT INTO workday_accounts (user_id, email, password_sealed) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET email = excluded.email, password_sealed = excluded.password_sealed, updated_at = now()`,
      [userId, email, passwordSealed],
    );
  }

  // Resumes

  async addResume(userId: string, resume: Resume, pdfKey: string | null = null): Promise<ResumeRecord> {
    const { rows } = await this.db.query<Row>(
      "INSERT INTO resumes (id, user_id, name, pdf_key, resume) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *",
      [randomUUID(), userId, resume.name, pdfKey, jsonb(resume)],
    );
    return toResume(rows[0]!);
  }

  /** A resume by id; with `userId`, only if that user owns it. */
  async getResume(id: string, userId?: string): Promise<ResumeRecord | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.db.query<Row>(
      userId ? "SELECT * FROM resumes WHERE id = $1 AND user_id = $2" : "SELECT * FROM resumes WHERE id = $1",
      userId ? [id, userId] : [id],
    );
    return rows[0] ? toResume(rows[0]) : null;
  }

  /** The user's resumes, newest first. */
  async listResumes(userId: string): Promise<{ id: string; name: string; createdAt: string }[]> {
    const { rows } = await this.db.query<Row>(
      "SELECT id, name, created_at FROM resumes WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), createdAt: iso(r.created_at)! }));
  }

  // Applications

  async createApplication(userId: string, url: string, resumeId: string): Promise<ApplicationRecord> {
    const { rows } = await this.db.query<Row>(
      "INSERT INTO applications (id, user_id, url, resume_id, status) VALUES ($1, $2, $3, $4, 'CREATED') RETURNING *",
      [randomUUID(), userId, url, resumeId],
    );
    return toApplication(rows[0]!);
  }

  /** An application by id; with `userId`, only if that user owns it. */
  async getApplication(id: string, userId?: string): Promise<ApplicationRecord | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.db.query<Row>(
      userId ? "SELECT * FROM applications WHERE id = $1 AND user_id = $2" : "SELECT * FROM applications WHERE id = $1",
      userId ? [id, userId] : [id],
    );
    return rows[0] ? toApplication(rows[0]) : null;
  }

  /** The user's applications, newest first. */
  async listApplications(userId: string): Promise<ApplicationRecord[]> {
    const { rows } = await this.db.query<Row>(
      "SELECT * FROM applications WHERE user_id = $1 ORDER BY created_at DESC",
      [userId],
    );
    return rows.map(toApplication);
  }

  /** Read the verification code the user typed, and clear it, so it is used once. */
  async takeCode(id: string): Promise<string | null> {
    const { rows } = await this.db.query<{ code: string }>(
      `UPDATE applications a SET code = NULL
       FROM (SELECT id, code FROM applications WHERE id = $1 FOR UPDATE) old
       WHERE a.id = old.id AND old.code IS NOT NULL
       RETURNING old.code`,
      [id],
    );
    return rows[0]?.code ?? null;
  }

  async updateApplication(id: string, patch: ApplicationPatch): Promise<ApplicationRecord> {
    const entries = Object.entries(patch) as [keyof ApplicationPatch, unknown][];
    const sets = entries.map(([key], i) => {
      const { column, json } = COLUMNS[key];
      return `${column} = $${i + 2}${json ? "::jsonb" : ""}`;
    });
    const values = entries.map(([key, value]) => (COLUMNS[key].json ? jsonb(value) : (value ?? null)));
    const { rows } = await this.db.query<Row>(
      `UPDATE applications SET ${[...sets, "updated_at = now()"].join(", ")} WHERE id = $1 RETURNING *`,
      [id, ...values],
    );
    if (!rows[0]) throw new Error(`No application ${id}`);
    return toApplication(rows[0]);
  }
}

function toUser(row: Row): User {
  return {
    id: String(row.id),
    email: String(row.email),
    name: (row.name as string | null) ?? null,
    picture: (row.picture as string | null) ?? null,
    createdAt: iso(row.created_at)!,
  };
}

const owner = (row: Row) => (row.user_id == null ? null : String(row.user_id));

function toResume(row: Row): ResumeRecord {
  return {
    id: String(row.id),
    userId: owner(row),
    name: String(row.name),
    pdfKey: (row.pdf_key as string | null) ?? null,
    resume: Resume.parse(row.resume),
    createdAt: iso(row.created_at)!,
  };
}

function toApplication(row: Row): ApplicationRecord {
  const parse = <T>(schema: { parse(v: unknown): T }, value: unknown) => (value == null ? null : schema.parse(value));
  return {
    id: String(row.id),
    userId: owner(row),
    url: String(row.url),
    resumeId: String(row.resume_id),
    status: row.status as Status,
    job: parse(Job, row.job),
    score: parse(ScoreResult, row.score),
    tailor: parse(TailorResult, row.tailor),
    pdfKey: (row.pdf_key as string | null) ?? null,
    questions: (row.questions as string[] | null) ?? null,
    screenshotKey: (row.screenshot_key as string | null) ?? null,
    submitAttemptedAt: iso(row.submit_attempted_at),
    code: (row.code as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}
