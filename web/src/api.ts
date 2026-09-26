// Talks to the AutoApply API. Response types come straight from the server code, so the UI and
// the API can't drift apart.

import type { Profile } from "../../src/schemas/index.ts";
import type { ApplicationDetail, ApplicationSummary, ResumeSummary } from "../../src/server/api.ts";

export type { ApplicationDetail, ApplicationSummary, Profile, ResumeSummary };

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

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const api = {
  applications: () => call<ApplicationSummary[]>("/applications"),
  application: (id: string) => call<ApplicationDetail>(`/applications/${id}`),
  create: (url: string, resumeId: string) => post<{ id: string }>("/applications", { url, resumeId }),
  approve: (id: string) => post(`/applications/${id}/approve`),
  reject: (id: string) => post(`/applications/${id}/reject`),
  answer: (id: string, answers: Record<string, string>) => post(`/applications/${id}/answers`, { answers }),
  submit: (id: string) => post(`/applications/${id}/submit`),

  resumes: () => call<ResumeSummary[]>("/resumes"),
  uploadResume: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<{ id: string; name: string }>("/resumes", { method: "POST", body: form });
  },

  profile: () => call<Profile>("/profile"),
  saveProfile: (profile: Profile) =>
    call<Profile>("/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    }),
};

export const files = {
  resumePdf: (id: string) => `/api/applications/${id}/resume.pdf`,
  screenshot: (id: string, version: string) =>
    `/api/applications/${id}/screenshot.png?v=${encodeURIComponent(version)}`,
};
