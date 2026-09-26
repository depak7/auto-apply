/**
 * Temporal task queue names. Kept apart from config.ts because workflow code runs in
 * Temporal's sandbox and may only import plain, side-effect-free modules like this one.
 */

/** Fetch, score, tailor, render: the "thinking" work. Served by src/bin/worker.ts. */
export const MAIN_QUEUE = "autoapply";

/** Filling and submitting the application in a browser. Served by src/bin/apply-worker.ts. */
export const APPLY_QUEUE = "apply";

export const workflowId = (applicationId: string) => `application-${applicationId}`;
