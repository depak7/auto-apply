import pg from "pg";
import { describe, expect, it } from "vitest";
import { EMPTY_PROFILE } from "../src/schemas/index.ts";
import { postgresOptions } from "../src/store/db.ts";
import { MIGRATIONS, migrate } from "../src/store/migrations.ts";
import { Store } from "../src/store/store.ts";
import { SAMPLE_RESUME } from "./mocks.ts";
import { pgliteDb, testStore, testUser } from "./pglite.ts";

describe("migrations", () => {
  it("apply once, in order, and are recorded", async () => {
    const db = pgliteDb();
    expect(await migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(await migrate(db)).toEqual([]); // already applied: nothing to do
    const { rows } = await db.query<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version");
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });
});

describe("Store", () => {
  it("round-trips resumes and applications through jsonb, validated on read", async () => {
    const store = await testStore();
    const me = await testUser(store);
    const resume = await store.addResume(me, SAMPLE_RESUME, "/files/r.pdf");
    expect((await store.getResume(resume.id))?.resume).toEqual(SAMPLE_RESUME);

    const app = await store.createApplication(me, "https://x.wd1.myworkdayjobs.com/s/job/j", resume.id);
    expect(app).toMatchObject({ status: "CREATED", job: null, score: null, resumeId: resume.id, userId: me });

    const score = {
      overall: 40,
      keywords: { percent: 50, found: ["Ceph"], missing: ["CUDA"] },
      requirements: [{ id: "r1", text: "Ceph", kind: "must" as const, keywords: ["Ceph"] }],
      items: [{ requirementId: "r1", score: 0.8, confidence: 0.9, status: "related" as const }],
    };
    const updated = await store.updateApplication(app.id, { status: "SCORING", score, questions: ["Q?"] });
    expect(updated).toMatchObject({ status: "SCORING", score, questions: ["Q?"] });
    expect(updated.updatedAt >= app.updatedAt).toBe(true);
    expect(updated.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO strings, not Date objects

    const cleared = await store.updateApplication(app.id, { questions: null, error: null });
    expect(cleared.questions).toBeNull();
    expect((await store.listApplications(me)).map((a) => a.id)).toEqual([app.id]);
  });

  it("stores timestamps as timestamps", async () => {
    const store = await testStore();
    const me = await testUser(store);
    const app = await store.createApplication(me, "u", (await store.addResume(me, SAMPLE_RESUME)).id);
    const at = "2026-09-25T10:00:00.000Z";
    expect((await store.updateApplication(app.id, { submitAttemptedAt: at })).submitAttemptedAt).toBe(at);
  });

  it("treats malformed ids as not found instead of failing the query", async () => {
    const store = await testStore();
    expect(await store.getApplication("nope")).toBeNull();
    expect(await store.getResume("123")).toBeNull();
  });

  it("rejects an application for a resume that doesn't exist", async () => {
    const store = await testStore();
    await expect(store.createApplication(await testUser(store), "u", crypto.randomUUID())).rejects.toThrow();
  });

  it("profile: empty by default, one per user, answers merged", async () => {
    const store = await testStore();
    const [asha, ben] = [await testUser(store, "asha"), await testUser(store, "ben")];
    expect((await store.getProfile(asha)).answers).toEqual({});
    await store.addAnswers(asha, { "notice period": "30 days" });
    await store.addAnswers(asha, { "desired salary": "negotiable" });
    expect((await store.getProfile(asha)).answers).toEqual({
      "notice period": "30 days",
      "desired salary": "negotiable",
    });
    expect((await store.getProfile(ben)).answers).toEqual({});
  });

  it("the first user to sign in claims rows from before sign-in existed; later users don't", async () => {
    const db = pgliteDb();
    await migrate(db);
    // A resume, application, and profile saved before users existed (no owner).
    const resumeId = crypto.randomUUID();
    await db.query("INSERT INTO resumes (id, name, resume) VALUES ($1, 'Asha', $2::jsonb)", [
      resumeId,
      JSON.stringify(SAMPLE_RESUME),
    ]);
    await db.query("INSERT INTO applications (id, url, resume_id, status) VALUES ($1, 'u', $2, 'CREATED')", [
      crypto.randomUUID(),
      resumeId,
    ]);
    await db.query("INSERT INTO profile (id, profile) VALUES (1, $1::jsonb)", [
      JSON.stringify({ ...EMPTY_PROFILE, answers: { "notice period": "30 days" } }),
    ]);
    const store = new Store(db);

    const first = await testUser(store, "asha");
    const second = await testUser(store, "ben");
    expect(await store.listResumes(first)).toHaveLength(1);
    expect(await store.listApplications(first)).toHaveLength(1);
    expect((await store.getProfile(first)).answers).toEqual({ "notice period": "30 days" });
    expect(await store.listResumes(second)).toEqual([]);
  });

  it("scopes lookups to the owner when asked", async () => {
    const store = await testStore();
    const [asha, ben] = [await testUser(store, "asha"), await testUser(store, "ben")];
    const resume = await store.addResume(asha, SAMPLE_RESUME);
    const app = await store.createApplication(asha, "u", resume.id);
    expect(await store.getResume(resume.id, ben)).toBeNull();
    expect(await store.getApplication(app.id, ben)).toBeNull();
    expect((await store.getApplication(app.id, asha))?.id).toBe(app.id);
    expect((await store.getApplication(app.id))?.id).toBe(app.id); // workers: by id alone
  });
});

describe("postgresOptions", () => {
  const AIVEN = "postgres://avnadmin:pw@pg-x.aivencloud.com:12345/defaultdb?sslmode=require";
  const CA = "-----BEGIN CERTIFICATE-----\\nMIIE\\n-----END CERTIFICATE-----";
  // What pg itself ends up using, after merging the URL with the options.
  const sslOf = (options: pg.PoolConfig) =>
    (new pg.Client(options) as unknown as { connectionParameters: { ssl: unknown } }).connectionParameters.ssl;

  it("verifies the server against the given CA, whatever sslmode the URL has", () => {
    const options = postgresOptions(AIVEN, { ca: CA });
    expect(options.connectionString).not.toContain("sslmode");
    expect(sslOf(options)).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nMIIE\n-----END CERTIFICATE-----",
      rejectUnauthorized: true,
    });
  });

  it("sets the search_path to the app's schema, and rejects unsafe schema names", () => {
    expect(postgresOptions("postgres://u:p@h/db", { schema: "autoapply" }).options).toBe("-c search_path=autoapply");
    expect(() => postgresOptions("postgres://u:p@h/db", { schema: "x; DROP TABLE users" })).toThrow("Invalid schema");
  });

  it("keeps the URL as it is without a CA", () => {
    expect(postgresOptions("postgres://u:p@localhost:5433/db")).toMatchObject({
      connectionString: "postgres://u:p@localhost:5433/db",
    });
    expect(sslOf(postgresOptions("postgres://u:p@localhost:5433/db"))).toBe(false);
  });
});
