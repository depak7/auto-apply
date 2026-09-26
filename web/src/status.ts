// How each status reads to a person, and where it sits in the journey.

import type { ApplicationSummary } from "./api.ts";

export type Status = ApplicationSummary["status"];
export type Tone = "progress" | "action" | "success" | "warning" | "danger" | "muted";

export const STAGES = ["Match", "Your review", "Filling", "Submit", "Done"] as const;

interface StatusInfo {
  label: string; // short, for pills
  detail: string; // one sentence, for the application page
  tone: Tone;
  stage: number; // index in STAGES
  working: boolean; // the system is busy: poll for updates
}

export const STATUS: Record<Status, StatusInfo> = {
  CREATED: { label: "Starting", detail: "Getting ready.", tone: "progress", stage: 0, working: true },
  FETCHING: {
    label: "Reading the job",
    detail: "Reading the job description from Workday.",
    tone: "progress",
    stage: 0,
    working: true,
  },
  SCORING: {
    label: "Scoring your fit",
    detail: "Checking your resume against each requirement.",
    tone: "progress",
    stage: 0,
    working: true,
  },
  TAILORING: {
    label: "Tailoring",
    detail: "Rewording your resume to show your fit more clearly. Nothing new is added.",
    tone: "progress",
    stage: 0,
    working: true,
  },
  AWAITING_APPROVAL: {
    label: "Review changes",
    detail: "Your tailored resume is ready. Review the changes before we apply.",
    tone: "action",
    stage: 1,
    working: false,
  },
  REJECTED: { label: "Not applied", detail: "You chose not to apply.", tone: "muted", stage: 1, working: false },
  EXPIRED: {
    label: "Expired",
    detail: "This waited too long for a decision and was closed.",
    tone: "muted",
    stage: 1,
    working: false,
  },
  RENDERING: {
    label: "Preparing",
    detail: "Creating your tailored resume PDF.",
    tone: "progress",
    stage: 2,
    working: true,
  },
  QUEUED: {
    label: "Queued",
    detail: "Waiting for a browser to fill in the application.",
    tone: "progress",
    stage: 2,
    working: true,
  },
  APPLYING: {
    label: "Filling in",
    detail: "Filling in the application on Workday. This takes a few minutes.",
    tone: "progress",
    stage: 2,
    working: true,
  },
  NEEDS_INPUT: {
    label: "Needs your answers",
    detail: "The form asked something we don't know yet. Answer once and we'll remember it.",
    tone: "action",
    stage: 2,
    working: false,
  },
  READY_TO_SUBMIT: {
    label: "Ready to submit",
    detail: "Everything is filled in. Check the review page, then submit.",
    tone: "action",
    stage: 3,
    working: false,
  },
  SUBMITTING: {
    label: "Submitting",
    detail: "Submitting your application.",
    tone: "progress",
    stage: 3,
    working: true,
  },
  SUBMITTED: {
    label: "Submitted",
    detail: "Your application was submitted and Workday confirmed it.",
    tone: "success",
    stage: 4,
    working: false,
  },
  SUBMIT_UNCONFIRMED: {
    label: "Check Workday",
    detail: "Submit was clicked, but Workday didn't confirm. Check your Workday candidate home before trying again.",
    tone: "warning",
    stage: 3,
    working: false,
  },
  ALREADY_APPLIED: {
    label: "Already applied",
    detail: "Workday says you've already applied to this job with this account, so there is nothing to fill in.",
    tone: "muted",
    stage: 4,
    working: false,
  },
  FAILED: { label: "Needs attention", detail: "Something went wrong.", tone: "danger", stage: 0, working: false },
};

export const needsYou = (s: Status) => STATUS[s].tone === "action";
