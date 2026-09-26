/**
 * The real workflow code, run on Temporal's time-skipping test server with fake activities.
 * "Time-skipping" means the 7-day approval timeout passes instantly when nothing else is running.
 */

import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Status } from "../src/store/store.ts";
import type { Activities, ApplyActivities } from "../src/workflows/activities.ts";
import {
  answersSignal,
  applicationWorkflow,
  approveSignal,
  rejectSignal,
  submitSignal,
} from "../src/workflows/application.ts";
import { APPLY_QUEUE, MAIN_QUEUE } from "../src/workflows/queues.ts";

let env: TestWorkflowEnvironment;
beforeAll(async () => {
  env = await TestWorkflowEnvironment.createTimeSkipping();
}, 120_000);
afterAll(async () => void (await env?.teardown()));

/** Fake activities that just record what happened. */
function fakes(
  opts: {
    failScoring?: boolean;
    applyOutcomes?: ("at_review" | "needs_input" | "already_applied")[];
    submitOutcomes?: ("submitted" | "unconfirmed" | "needs_input")[];
  } = {},
) {
  const log: string[] = [];
  const statuses: Status[] = [];
  const main: Activities = {
    setStatus: async (_id, s) => void statuses.push(s),
    markFailed: async (_id, message) => void log.push(`failed: ${message}`),
    fetchJobForApplication: async () => void log.push("fetch"),
    scoreApplication: async () => {
      log.push("score");
      if (opts.failScoring) {
        const { ApplicationFailure } = await import("@temporalio/common");
        throw ApplicationFailure.nonRetryable("Jev is down");
      }
    },
    tailorApplication: async () => void log.push("tailor"),
    renderApplicationPdf: async () => void log.push("render"),
  };
  const outcomes = [...(opts.applyOutcomes ?? ["at_review"])];
  const submits = [...(opts.submitOutcomes ?? ["submitted"])];
  const apply: ApplyActivities = {
    applyToJob: async () => {
      log.push("apply");
      const outcome = outcomes.shift() ?? "at_review";
      statuses.push(
        outcome === "needs_input"
          ? "NEEDS_INPUT"
          : outcome === "already_applied"
            ? "ALREADY_APPLIED"
            : "READY_TO_SUBMIT",
      );
      return outcome;
    },
    submitApplication: async () => {
      log.push("submit");
      return submits.shift() ?? "submitted";
    },
  };
  return { main, apply, log, statuses };
}

async function run(
  f: ReturnType<typeof fakes>,
  drive: (handle: Awaited<ReturnType<typeof env.client.workflow.start>>) => Promise<void>,
) {
  const workflowsPath = fileURLToPath(new URL("../src/workflows/application.ts", import.meta.url));
  const main = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: MAIN_QUEUE,
    workflowsPath,
    activities: f.main,
  });
  const apply = await Worker.create({ connection: env.nativeConnection, taskQueue: APPLY_QUEUE, activities: f.apply });

  return main.runUntil(
    apply.runUntil(async () => {
      const handle = await env.client.workflow.start(applicationWorkflow, {
        taskQueue: MAIN_QUEUE,
        workflowId: `test-${Math.random()}`,
        args: ["app-1"],
      });
      await drive(handle);
      return handle.result();
    }),
  );
}

/** Wait until the workflow has reached a status (the n-th time it does). */
async function until(f: ReturnType<typeof fakes>, status: Status, n = 1) {
  while (f.statuses.filter((s) => s === status).length < n) await new Promise((r) => setTimeout(r, 20));
}
const untilAwaiting = (f: ReturnType<typeof fakes>) => until(f, "AWAITING_APPROVAL");

describe("applicationWorkflow", () => {
  it("approve -> fill -> waits at READY_TO_SUBMIT -> submit only when told", async () => {
    const f = fakes();
    const result = await run(f, async (handle) => {
      await untilAwaiting(f);
      expect(f.log).toEqual(["fetch", "score", "tailor"]); // nothing rendered before approval
      await handle.signal(approveSignal);
      await until(f, "READY_TO_SUBMIT");
      await new Promise((r) => setTimeout(r, 200));
      expect(f.log).not.toContain("submit"); // filled, but nothing sent without the user's word
      await handle.signal(submitSignal);
    });

    expect(result).toBe("SUBMITTED");
    expect(f.log).toEqual(["fetch", "score", "tailor", "render", "apply", "submit"]);
  });

  it("ready but never told to submit: expires without submitting", async () => {
    const f = fakes();
    const result = await run(f, async (handle) => {
      await untilAwaiting(f);
      await handle.signal(approveSignal);
    });

    expect(result).toBe("EXPIRED");
    expect(f.log).not.toContain("submit");
  });

  it("submit clicked but not confirmed: stops, never tries again", async () => {
    const f = fakes({ submitOutcomes: ["unconfirmed"] });
    const result = await run(f, async (handle) => {
      await untilAwaiting(f);
      await handle.signal(approveSignal);
      await until(f, "READY_TO_SUBMIT");
      await handle.signal(submitSignal);
    });

    expect(result).toBe("SUBMIT_UNCONFIRMED");
    expect(f.log.filter((l) => l === "submit")).toHaveLength(1);
  });

  it("form changed at submit time: ask, fill again, and wait for a fresh 'submit'", async () => {
    const f = fakes({ submitOutcomes: ["needs_input", "submitted"] });
    const result = await run(f, async (handle) => {
      await untilAwaiting(f);
      await handle.signal(approveSignal);
      await until(f, "READY_TO_SUBMIT");
      await handle.signal(submitSignal);
      while (f.log.filter((l) => l === "submit").length < 1) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 200));
      await handle.signal(answersSignal);
      await until(f, "READY_TO_SUBMIT", 2);
      await new Promise((r) => setTimeout(r, 200));
      expect(f.log.filter((l) => l === "submit")).toHaveLength(1); // the old "submit" does not carry over
      await handle.signal(submitSignal);
    });

    expect(result).toBe("SUBMITTED");
    expect(f.log).toEqual(["fetch", "score", "tailor", "render", "apply", "submit", "apply", "submit"]);
  });

  it("needs input: waits for the answers, then fills again", async () => {
    const f = fakes({ applyOutcomes: ["needs_input", "at_review"] });
    const result = await run(f, async (handle) => {
      await untilAwaiting(f);
      await handle.signal(approveSignal);
      await until(f, "NEEDS_INPUT");
      expect(f.log.filter((l) => l === "apply")).toHaveLength(1); // waiting, not retrying
      await handle.signal(answersSignal);
      await until(f, "READY_TO_SUBMIT");
      await handle.signal(submitSignal);
    });

    expect(result).toBe("SUBMITTED");
    expect(f.log).toEqual(["fetch", "score", "tailor", "render", "apply", "apply", "submit"]);
    expect(f.statuses).toEqual(["AWAITING_APPROVAL", "QUEUED", "NEEDS_INPUT", "QUEUED", "READY_TO_SUBMIT"]);
  });

  it("needs input, never answered: expires after the window", async () => {
    const f = fakes({ applyOutcomes: ["needs_input"] });
    const result = await run(f, async (handle) => {
      await untilAwaiting(f);
      await handle.signal(approveSignal);
    });

    expect(result).toBe("EXPIRED");
    expect(f.statuses.at(-1)).toBe("EXPIRED");
  });

  it("already applied on Workday: stops, never asks to submit", async () => {
    const f = fakes({ applyOutcomes: ["already_applied"] });
    const result = await run(f, async (handle) => {
      await untilAwaiting(f);
      await handle.signal(approveSignal);
    });
    expect(result).toBe("ALREADY_APPLIED");
    expect(f.log).not.toContain("submit");
  });

  it("reject: stops without rendering or applying", async () => {
    const f = fakes();
    const result = await run(f, async (handle) => {
      await untilAwaiting(f);
      await handle.signal(rejectSignal);
    });

    expect(result).toBe("REJECTED");
    expect(f.log).toEqual(["fetch", "score", "tailor"]);
    expect(f.statuses).toEqual(["AWAITING_APPROVAL", "REJECTED"]);
  });

  it("no decision within 7 days: expires (time skips ahead)", async () => {
    const f = fakes();
    const result = await run(f, async () => {});

    expect(result).toBe("EXPIRED");
    expect(f.statuses).toEqual(["AWAITING_APPROVAL", "EXPIRED"]);
  });

  it("a failing step marks the application FAILED with the real reason", async () => {
    const f = fakes({ failScoring: true });
    await expect(run(f, async () => {})).rejects.toThrow();
    expect(f.log).toEqual(["fetch", "score", "failed: Jev is down"]);
  });
});
