/**
 * The Temporal worker: runs application workflows and their "thinking" activities
 * (fetch, score, tailor, render) from the main task queue.
 *
 *   npm run worker        (needs Temporal: `npm run temporal` locally, or Temporal Cloud settings)
 */

import { NativeConnection } from "@temporalio/worker";

import { connectionOptions, temporalSettings } from "../workflows/connection.ts";
import { MAIN_QUEUE } from "../workflows/queues.ts";
import { connectStore, createMainWorker } from "../workflows/workers.ts";

const temporal = temporalSettings();
const connection = await NativeConnection.connect(connectionOptions(temporal));
const worker = await createMainWorker({ connection, temporal, store: await connectStore() });

console.log(`worker listening on task queue "${MAIN_QUEUE}" at ${temporal.description}`);
await worker.run();
