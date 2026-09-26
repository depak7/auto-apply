/**
 * The app's records in Postgres: resumes, applications, and the profile. Nested values (job,
 * score, tailoring result) are `jsonb` columns, validated with their Zod schemas when read.
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
  "READY_TO_SUBMIT", // filled up to Workday's Review page; waiting for the user to say "submit"
  "SUBMITTING", // browser worker is re-opening the draft to click Submit (once)
  "SUBMITTED", // Workday confirmed the application
  "SUBMIT_UNCONFIRMED", // Submit was clicked but Workday's confirmation never showed: check in Workday, never retried
  "ALREADY_APPLIED", // Workday says this account applied to the job before (not by us): nothing to do
  "FAILED",
] as const;
export type Status = (typeof STATUSES)[number];

export interface ResumeRecord {
  id: string;
  name: string;
  pdfKey: string | null;
  resume: Resume;
  createdAt: string;
}

export interface ApplicationRecord {
  id: string;
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
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationPatch = Partial<
  Pick<
    ApplicationRecord,
    "status" | "job" | "score" | "tailor" | "pdfKey" | "questions" | "screenshotKey" | "submitAttemptedAt" | "error"
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
  error: { column: "error" },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonb = (value: unknown) => (value == null ? null : JSON.stringify(value));
const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : value == null ? null : String(value));

type Row = Record<string, unknown>;

export class Store {
  constructor(private readonly db: Db) {}

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

  // Profile

  async getProfile(): Promise<Profile> {
    const { rows } = await this.db.query<Row>("SELECT profile FROM profile WHERE id = 1");
    return rows[0] ? Profile.parse(rows[0].profile) : EMPTY_PROFILE;
  }

  async saveProfile(profile: Profile): Promise<Profile> {
    const valid = Profile.parse(profile);
    await this.db.query(
      `INSERT INTO profile (id, profile) VALUES (1, $1::jsonb)
       ON CONFLICT (id) DO UPDATE SET profile = excluded.profile, updated_at = now()`,
      [jsonb(valid)],
    );
    return valid;
  }

  /** Add answers (question -> answer) to the profile, so the same question is never asked twice. */
  async addAnswers(answers: Record<string, string>): Promise<Profile> {
    const profile = await this.getProfile();
    return this.saveProfile({ ...profile, answers: { ...profile.answers, ...answers } });
  }

  // Resumes

  async addResume(resume: Resume, pdfKey: string | null = null): Promise<ResumeRecord> {
    const { rows } = await this.db.query<Row>(
      "INSERT INTO resumes (id, name, pdf_key, resume) VALUES ($1, $2, $3, $4::jsonb) RETURNING *",
      [randomUUID(), resume.name, pdfKey, jsonb(resume)],
    );
    return toResume(rows[0]!);
  }

  async getResume(id: string): Promise<ResumeRecord | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.db.query<Row>("SELECT * FROM resumes WHERE id = $1", [id]);
    return rows[0] ? toResume(rows[0]) : null;
  }

  /** Newest first. */
  async listResumes(): Promise<{ id: string; name: string; createdAt: string }[]> {
    const { rows } = await this.db.query<Row>("SELECT id, name, created_at FROM resumes ORDER BY created_at DESC");
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), createdAt: iso(r.created_at)! }));
  }

  // Applications

  async createApplication(url: string, resumeId: string): Promise<ApplicationRecord> {
    const { rows } = await this.db.query<Row>(
      "INSERT INTO applications (id, url, resume_id, status) VALUES ($1, $2, $3, 'CREATED') RETURNING *",
      [randomUUID(), url, resumeId],
    );
    return toApplication(rows[0]!);
  }

  async getApplication(id: string): Promise<ApplicationRecord | null> {
    if (!UUID.test(id)) return null;
    const { rows } = await this.db.query<Row>("SELECT * FROM applications WHERE id = $1", [id]);
    return rows[0] ? toApplication(rows[0]) : null;
  }

  /** Newest first. */
  async listApplications(): Promise<ApplicationRecord[]> {
    const { rows } = await this.db.query<Row>("SELECT * FROM applications ORDER BY created_at DESC");
    return rows.map(toApplication);
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

function toResume(row: Row): ResumeRecord {
  return {
    id: String(row.id),
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
    error: (row.error as string | null) ?? null,
    createdAt: iso(row.created_at)!,
    updatedAt: iso(row.updated_at)!,
  };
}
