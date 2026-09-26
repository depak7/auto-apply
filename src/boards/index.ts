/** The supported job boards, and picking the right one for a URL or a job. */

import type { Job } from "../schemas/index.ts";
import { lever } from "./lever.ts";
import { type JobBoard, NotAJobURL } from "./types.ts";
import { workday } from "./workday.ts";

export type { BoardId, JobBoard } from "./types.ts";
export { JobNotFound, NotAJobURL } from "./types.ts";

export const BOARDS: JobBoard[] = [workday, lever];

export const SUPPORTED = "a Workday (*.myworkdayjobs.com) or Lever (jobs.lever.co) job link";

/** The board a posting URL belongs to. Throws NotAJobURL for anything else. */
export function boardFor(input: string): JobBoard {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new NotAJobURL(`Not a URL. Paste ${SUPPORTED}.`);
  }
  const board = BOARDS.find((b) => b.owns(url));
  if (!board) throw new NotAJobURL(`Not a supported job link. Paste ${SUPPORTED}.`);
  return board;
}

/** The board a fetched job came from. */
export const boardOf = (job: Pick<Job, "board">): JobBoard => BOARDS.find((b) => b.id === job.board) ?? workday;

/** Validate a posting URL and read the job from its board. */
export const fetchJob = (input: string): Promise<Job> => boardFor(input).fetchJob(input);
