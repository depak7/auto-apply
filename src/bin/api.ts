/**
 * Starts the web process: the API under /api, and the UI (web/dist, built by `npm run web:build`)
 * for everything else. One process serves both, so there is one thing to deploy.
 *
 *   npm run api           (needs `npm run temporal` running; the workers to make progress)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { basicAuth } from "hono/basic-auth";
import { API_PORT, DATA_DIR, DATABASE_CA_CERT, DATABASE_SCHEMA, DATABASE_URL, ROOT } from "../config.ts";
import { openFileStore } from "../files/store.ts";
import { createApi } from "../server/api.ts";
import { Store } from "../store/store.ts";
import { connectWorkflows } from "../workflows/client.ts";

const app = new Hono();

// Anyone who can open this app can submit applications with your Workday account, so outside
// your own machine it must be protected. Set APP_PASSWORD (any username works).
const password = process.env.APP_PASSWORD;
if (password) app.use("*", basicAuth({ verifyUser: (_user, pass) => pass === password, realm: "AutoApply" }));
else
  console.warn("APP_PASSWORD is not set: the app is open to anyone who can reach it. Fine only on your own machine.");

app.route(
  "/api",
  createApi({
    store: await Store.connect(DATABASE_URL, { ca: DATABASE_CA_CERT, schema: DATABASE_SCHEMA }),
    workflows: await connectWorkflows(),
    files: openFileStore(process.env, DATA_DIR),
  }),
);

const dist = join(ROOT, "web", "dist");
if (existsSync(dist)) {
  app.use("/*", serveStatic({ root: "web/dist" }));
  // Single-page app: page paths (e.g. /applications/123) get index.html and the UI routes them.
  // Paths with a file extension are real files: if missing, a plain 404, not the page.
  // index.html is read per request so a rebuilt UI is served without restarting.
  app.get("*", (c) =>
    /\.[a-z0-9]+$/i.test(c.req.path) ? c.notFound() : c.html(readFileSync(join(dist, "index.html"), "utf8")),
  );
} else {
  app.get("/", (c) => c.text("API is at /api. Build the UI with `npm run web:build`."));
}

serve({ fetch: app.fetch, port: API_PORT }, () => console.log(`AutoApply on http://localhost:${API_PORT}`));
