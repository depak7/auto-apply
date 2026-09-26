/**
 * Both workers in one process: for a single small machine, such as one Heroku Eco dyno.
 *
 *   npm run workers
 */

import { NativeConnection } from "@temporalio/worker";

import { connectionOptions, temporalSettings } from "../workflows/connection.ts";
import { APPLY_QUEUE, MAIN_QUEUE } from "../workflows/queues.ts";
import { connectStore, createApplyWorker, createMainWorker } from "../workflows/workers.ts";

const temporal = temporalSettings();
const deps = {
  temporal,
  connection: await NativeConnection.connect(connectionOptions(temporal)),
  store: await connectStore(),
  shared: true,
};
const workers = [await createMainWorker(deps), await createApplyWorker(deps)];

console.log(`workers listening on task queues "${MAIN_QUEUE}" and "${APPLY_QUEUE}" at ${temporal.description}`);
await Promise.all(workers.map((w) => w.run()));
