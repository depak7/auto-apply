/**
 * The two Temporal workers. Each process type runs one of them (src/bin/worker.ts,
 * src/bin/apply-worker.ts), or both in one process (src/bin/workers.ts) on a single small machine.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type NativeConnection, Worker } from "@temporalio/worker";

import { createApplyActivities } from "../apply/activities.ts";
import { credentialsKey, DATA_DIR, DATABASE_CA_CERT, DATABASE_SCHEMA, DATABASE_URL, ROOT } from "../config.ts";
import { openFileStore } from "../files/store.ts";
import { SecretBox } from "../lib/secrets.ts";
import { Store } from "../store/store.ts";
import { createActivities } from "./activities.ts";
import type { TemporalSettings } from "./connection.ts";
import { APPLY_QUEUE, MAIN_QUEUE } from "./queues.ts";

export interface WorkerDeps {
  connection: NativeConnection;
  temporal: TemporalSettings;
  store: Store;
  /** Both workers share one small machine: take one main-queue activity at a time. */
  shared?: boolean;
}

export const WORKFLOWS_PATH = fileURLToPath(new URL("./application.ts", import.meta.url));
/** Written by src/bin/bundle-workflows.ts at image build time; without it, workers bundle at start. */
export const WORKFLOW_BUNDLE = join(ROOT, "dist", "workflow-bundle.js");

export async function connectStore(): Promise<Store> {
  return Store.connect(DATABASE_URL, { ca: DATABASE_CA_CERT, schema: DATABASE_SCHEMA });
}

/** Workflows, plus the fetch, score, tailor, and render activities. */
export function createMainWorker({ connection, temporal, store, shared = false }: WorkerDeps): Promise<Worker> {
  return Worker.create({
    connection,
    namespace: temporal.namespace,
    taskQueue: MAIN_QUEUE,
    ...(existsSync(WORKFLOW_BUNDLE)
      ? { workflowBundle: { codePath: WORKFLOW_BUNDLE } }
      : { workflowsPath: WORKFLOWS_PATH }),
    activities: createActivities({ store, files: openFileStore(process.env, DATA_DIR) }),
    // Sharing a machine with the browser: no PDF render (a second Chromium) while a form is being filled.
    ...(shared ? { maxConcurrentActivityTaskExecutions: 1, maxCachedWorkflows: 50 } : {}),
  });
}

/** The browser activities: fill and submit, one at a time (each needs its own browser). */
export function createApplyWorker({ connection, temporal, store }: WorkerDeps): Promise<Worker> {
  return Worker.create({
    connection,
    namespace: temporal.namespace,
    taskQueue: APPLY_QUEUE,
    activities: createApplyActivities({
      store,
      files: openFileStore(process.env, DATA_DIR),
      secrets: new SecretBox(credentialsKey()),
      headless: process.env.HEADED !== "1",
    }),
    maxConcurrentActivityTaskExecutions: 1,
  });
}
