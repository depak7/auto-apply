/**
 * The two things the API needs from Temporal: start an application's workflow, and signal it.
 * Behind a tiny interface so API tests can use a fake instead of a running Temporal server.
 */

import { Client, Connection } from "@temporalio/client";

import { answersSignal, type applicationWorkflow, approveSignal, rejectSignal, submitSignal } from "./application.ts";
import { connectionOptions, type TemporalSettings, temporalSettings } from "./connection.ts";
import { MAIN_QUEUE, workflowId } from "./queues.ts";

export interface Workflows {
  start(applicationId: string): Promise<void>;
  signal(applicationId: string, signal: "approve" | "reject" | "answers" | "submit"): Promise<void>;
}

export async function connectWorkflows(settings: TemporalSettings = temporalSettings()): Promise<Workflows> {
  const connection = await Connection.connect(connectionOptions(settings));
  const client = new Client({ connection, namespace: settings.namespace });
  return {
    async start(applicationId) {
      await client.workflow.start<typeof applicationWorkflow>("applicationWorkflow", {
        taskQueue: MAIN_QUEUE,
        workflowId: workflowId(applicationId), // one workflow per application; starting twice fails
        args: [applicationId],
      });
    },
    async signal(applicationId, signal) {
      const def = { approve: approveSignal, reject: rejectSignal, answers: answersSignal, submit: submitSignal }[
        signal
      ];
      await client.workflow.getHandle(workflowId(applicationId)).signal(def);
    },
  };
}
