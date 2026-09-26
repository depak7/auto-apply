// Home: start an application from a Workday link, and see every application at a glance.

import { type FormEvent, useState } from "react";
import { Link, useLocation } from "wouter";

import { ApiError, type ApplicationSummary, api } from "../api.ts";
import { Button, Card, Notice, StatusPill, timeAgo } from "../components/ui.tsx";
import { prettyLocation, prettyTitle } from "../format.ts";
import { useData } from "../hooks.ts";
import { needsYou, STATUS } from "../status.ts";

export function ApplicationsPage() {
  const apps = useData(api.applications, "once", (list) => list.some((a) => STATUS[a.status].working));
  const resumes = useData(api.resumes, "once");
  const list = apps.data ?? [];

  const groups = [
    { title: "Needs you", items: list.filter((a) => needsYou(a.status)) },
    { title: "In progress", items: list.filter((a) => STATUS[a.status].working) },
    { title: "Done", items: list.filter((a) => !needsYou(a.status) && !STATUS[a.status].working) },
  ];

  return (
    <div className="space-y-10">
      <NewApplication resumeId={resumes.data?.[0]?.id ?? null} loadingResumes={!resumes.data} />

      {apps.error && <Notice>Couldn't load your applications: {apps.error.message}</Notice>}
      {apps.data && list.length === 0 && (
        <p className="text-center text-sm text-zinc-500">Your applications will appear here.</p>
      )}

      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.title}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-500">
                {g.title}
                <span className="rounded-full bg-zinc-200/70 px-2 text-xs text-zinc-600">{g.items.length}</span>
              </h2>
              <div className="grid gap-3">
                {g.items.map((a) => (
                  <ApplicationRow key={a.id} app={a} />
                ))}
              </div>
            </section>
          ),
      )}
    </div>
  );
}

function NewApplication({ resumeId, loadingResumes }: { resumeId: string | null; loadingResumes: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!resumeId) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.create(url.trim(), resumeId);
      navigate(`/applications/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  }

  return (
    <Card className="p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Apply to a job</h1>
      <p className="mt-1.5 text-[15px] text-zinc-500">
        Paste a Workday job link. We'll tailor your resume to it, show you every change, and fill in the application
        once you approve.
      </p>

      {!loadingResumes && !resumeId ? (
        <div className="mt-6">
          <Notice tone="info">
            First, add your resume.{" "}
            <Link href="/profile" className="font-semibold underline underline-offset-2">
              Go to Profile
            </Link>
          </Notice>
        </div>
      ) : (
        <form onSubmit={start} className="mt-6 flex flex-col gap-3 sm:flex-row">
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://company.wd5.myworkdayjobs.com/…/job/…"
            className="min-w-0 flex-1 rounded-lg border-0 bg-zinc-50 px-4 py-3 text-[15px] ring-1 ring-zinc-200 placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-brand-600 focus:outline-none"
          />
          <Button type="submit" busy={busy} disabled={!resumeId || !url.trim()} className="sm:px-6">
            Tailor & review
          </Button>
        </form>
      )}
      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
    </Card>
  );
}

function ApplicationRow({ app }: { app: ApplicationSummary }) {
  const fit = app.scores?.fit;
  return (
    <Link href={`/applications/${app.id}`}>
      <Card className="group flex items-center gap-4 p-4 transition hover:ring-zinc-300 sm:p-5">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-base font-semibold text-brand-700">
          {(app.company ?? "?").charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-zinc-900 group-hover:text-brand-700">
            {prettyTitle(app.title) ?? "Reading the job…"}
          </div>
          <div className="mt-0.5 truncate text-sm text-zinc-500">
            {[app.company, prettyLocation(app.location)].filter(Boolean).join(" · ") || new URL(app.url).hostname}
          </div>
        </div>
        {fit && (
          <div className="hidden text-right sm:block">
            <div className="text-lg font-semibold tabular-nums">{fit.after}</div>
            <div className="text-xs text-zinc-500">fit</div>
          </div>
        )}
        <div className="flex flex-col items-end gap-1.5">
          <StatusPill status={app.status} />
          <span className="text-xs text-zinc-400">{timeAgo(app.updatedAt)}</span>
        </div>
      </Card>
    </Link>
  );
}
