/**
 * The minimal database interface the store needs, and its Postgres implementation.
 * Tests use the same interface over PGlite (Postgres in WebAssembly), so the SQL is identical.
 */

import pg from "pg";

export interface Queryable {
  /** One statement, with `$1`-style parameters. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Several statements, no parameters. */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  /** Run `fn` in one transaction on one connection; committed if it resolves, rolled back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const wrap = (client: pg.Pool | pg.PoolClient): Queryable => ({
  query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await client.query(sql, params)).rows as T[] }),
  exec: async (sql) => {
    await client.query(sql);
  },
});

const URL_SSL_PARAMS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface PostgresOptions {
  /** PEM certificate of the server's CA (e.g. Aiven's): TLS is required and verified against it. */
  ca?: string;
  /** Schema for the app's tables, so they can share a database with other apps. Default: public. */
  schema?: string;
}

/**
 * Pool options for `url`. pg lets SSL settings in the URL override the `ssl` option, so with a
 * `ca` those are removed from the URL first. A `schema` becomes every connection's search_path.
 */
export function postgresOptions(url: string, { ca, schema }: PostgresOptions = {}): pg.PoolConfig {
  const options: pg.PoolConfig = { connectionString: url, max: 10 };
  if (ca) {
    const parsed = new URL(url);
    for (const name of URL_SSL_PARAMS) parsed.searchParams.delete(name);
    options.connectionString = parsed.toString();
    options.ssl = { ca: ca.replace(/\\n/g, "\n"), rejectUnauthorized: true }; // env vars often carry "\n" escapes
  }
  if (schema) options.options = `-c search_path=${checkSchema(schema)}`;
  return options;
}

export function checkSchema(schema: string): string {
  if (!IDENTIFIER.test(schema)) throw new Error(`Invalid schema name: ${schema}`);
  return schema;
}

/** A connection pool for `url`, e.g. postgres://user:pass@host:5432/db. */
export function connectPostgres(url: string, options: PostgresOptions = {}): Db {
  const pool = new pg.Pool(postgresOptions(url, options));
  return {
    ...wrap(pool),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
