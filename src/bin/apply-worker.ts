/**
 * The browser worker: fills approved applications from the "apply" task queue, one at a time
 * (each needs its own browser). Separate from src/bin/worker.ts so it can run where browsers can.
 *
 *   npm run apply-worker        (needs Temporal: `npm run temporal` locally, or Temporal Cloud settings)
 */

import { NativeConnection } from "@temporalio/worker";

import { connectionOptions, temporalSettings } from "../workflows/connection.ts";
import { APPLY_QUEUE } from "../workflows/queues.ts";
import { connectStore, createApplyWorker } from "../workflows/workers.ts";

const temporal = temporalSettings();
const connection = await NativeConnection.connect(connectionOptions(temporal));
const worker = await createApplyWorker({ connection, temporal, store: await connectStore() });

console.log(`apply worker listening on task queue "${APPLY_QUEUE}" at ${temporal.description}`);
await worker.run();
