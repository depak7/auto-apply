/**
 * Bundles the workflow code once, at image build time, so workers load a ready bundle instead of
 * running webpack at every start (which costs memory a small machine doesn't have).
 *
 *   node src/bin/bundle-workflows.ts        (the Dockerfile runs it)
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { bundleWorkflowCode } from "@temporalio/worker";

import { WORKFLOW_BUNDLE, WORKFLOWS_PATH } from "../workflows/workers.ts";

const { code } = await bundleWorkflowCode({ workflowsPath: WORKFLOWS_PATH });
await mkdir(dirname(WORKFLOW_BUNDLE), { recursive: true });
await writeFile(WORKFLOW_BUNDLE, code);
console.log(`workflow bundle written to ${WORKFLOW_BUNDLE} (${(code.length / 1024).toFixed(0)} KiB)`);
