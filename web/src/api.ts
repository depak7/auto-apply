// Talks to the AutoApply API. Response types come straight from the server code, so the UI and
// the API can't drift apart.

import type { Profile, Resume } from "../../src/schemas/index.ts";
import type { ApplicationDetail, ApplicationSummary, ResumeSummary } from "../../src/server/api.ts";
import type { ResumeRecord, User } from "../../src/store/store.ts";

export type { ApplicationDetail, ApplicationSummary, Profile, Resume, ResumeRecord, ResumeSummary, User };

/** The signed-in user, and the Workday login they apply with (the password is never sent back). */
export interface Me {
  user: User;
  workday: { email: string; updatedAt: string } | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status, body);
  return body as T;
}

const send =
  (method: "POST" | "PUT") =>
  <T>(path: string, body?: unknown) =>
    call<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
const post = send("POST");
const put = send("PUT");

export const api = {
  authConfig: () => call<{ googleClientId: string | null }>("/auth/config"),
  signInWithGoogle: (credential: string) => post<User>("/auth/google", { credential }),
  signInLocally: () => post<User>("/auth/local"),
  signOut: () => post("/auth/logout"),
  me: () => call<Me>("/me"),

  applications: () => call<ApplicationSummary[]>("/applications"),
  application: (id: string) => call<ApplicationDetail>(`/applications/${id}`),
  create: (url: string, resumeId: string) => post<{ id: string }>("/applications", { url, resumeId }),
  approve: (id: string) => post(`/applications/${id}/approve`),
  reject: (id: string) => post(`/applications/${id}/reject`),
  answer: (id: string, answers: Record<string, string>) => post(`/applications/${id}/answers`, { answers }),
  submit: (id: string) => post(`/applications/${id}/submit`),
  enterCode: (id: string, code: string) => post(`/applications/${id}/code`, { code }),

  resumes: () => call<ResumeSummary[]>("/resumes"),
  resume: (id: string) => call<ResumeRecord>(`/resumes/${id}`),
  uploadResume: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ id: string; name: string }>("/resumes", { method: "POST", body: form });
  },

  profile: () => call<Profile>("/profile"),
  saveProfile: (profile: Profile) => put<Profile>("/profile", profile),
  saveWorkdayLogin: (email: string, password?: string) =>
    put<{ email: string }>("/workday-account", { email, ...(password ? { password } : {}) }),
};

export const files = {
  resumePdf: (id: string) => `/api/applications/${id}/resume.pdf`,
  screenshot: (id: string, version: string) =>
    `/api/applications/${id}/screenshot.png?v=${encodeURIComponent(version)}`,
};
