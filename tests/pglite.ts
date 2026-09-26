/** A real Postgres in memory (PGlite), behind the app's `Db` interface, for tests. */

import { PGlite } from "@electric-sql/pglite";

import type { Db, Queryable } from "../src/store/db.ts";
import { migrate } from "../src/store/migrations.ts";
import { Store } from "../src/store/store.ts";

type PGliteQueryable = Pick<PGlite, "query" | "exec">;

const wrap = (pg: PGliteQueryable): Queryable => ({
  query: async <T>(sql: string, params?: unknown[]) => ({ rows: (await pg.query<T>(sql, params)).rows }),
  exec: async (sql) => {
    await pg.exec(sql);
  },
});

export function pgliteDb(): Db {
  const pg = new PGlite();
  return {
    ...wrap(pg),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
}

/** A fresh, fully migrated store. */
export async function testStore(): Promise<Store> {
  const db = pgliteDb();
  await migrate(db);
  return new Store(db);
}

/** Sign a test user in and return their id. */
export async function testUser(store: Store, name = "asha"): Promise<string> {
  return (await store.signIn({ sub: `g-${name}`, email: `${name}@example.com`, name, picture: null })).id;
}
