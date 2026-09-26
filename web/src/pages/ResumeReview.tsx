// The resume review: the exact page we will upload, with every change marked, next to a list of
// what changed and why. Approving happens here, with everything in view.

import { useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";

import { pageOf, type ReviewMode, resumeHtml } from "../../../src/resume/template.ts";
import { ApiError, type ApplicationDetail, api, files } from "../api.ts";
import { cleanReason, pathLabel, WordDiff } from "../components/Diff.tsx";
import { ResumePage, type ResumePageHandle } from "../components/ResumePage.tsx";
import { Button, Card, cx, Notice, Spinner } from "../components/ui.tsx";
import { RESUME_FONTS } from "../fonts.ts";
import { prettyTitle } from "../format.ts";
import { useData } from "../hooks.ts";

type View = "changes" | "compare" | "final";

export function ResumeReviewPage({ id }: { id: string }) {
  const { data: app, error } = useData(() => api.application(id), id);
  if (error) return <Notice>Couldn't load this resume: {error.message}</Notice>;
  if (!app)
    return (
      <div className="flex justify-center py-24 text-zinc-400">
        <Spinner />
      </div>
    );
  if (!app.resume)
    return <Notice tone="info">The tailored resume isn't ready yet. It appears here once tailoring finishes.</Notice>;
  return <Review app={app} resume={app.resume} />;
}

function Review({ app, resume }: { app: ApplicationDetail; resume: NonNullable<ApplicationDetail["resume"]> }) {
  const [view, setViewState] = useState<View>("changes");
  const setView = (next: View) => {
    pages.current = []; // pages of the previous view are gone
    setViewState(next);
  };
  const [active, setActive] = useState<number | null>(null);
  const pages = useRef<(ResumePageHandle | null)[]>([]);
  const changed = useMemo(() => app.changes.map((c) => c.path), [app.changes]);
  const pageRef = (i: number) => (page: ResumePageHandle | null) => {
    pages.current[i] = page;
  };

  const html = useMemo(() => {
    const page = (mode: ReviewMode, marks = true) =>
      resumeHtml(resume.tailored, { mode, original: resume.original, changed: marks ? changed : [] }, RESUME_FONTS);
    return {
      changes: page("changes"),
      original: page("original"),
      tailored: page("tailored"),
      final: page("tailored", false),
    };
  }, [resume, changed]);

  const paper = pageOf(resume.tailored);

  const show = (n: number) => {
    setActive(n);
    if (view === "final") setView("changes");
    requestAnimationFrame(() => {
      for (const page of pages.current) page?.show(n);
    });
  };

  return (
    <div className="space-y-6">
      <TopBar app={app} view={view} setView={setView} />

      <div className="grid gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="order-2 space-y-4 lg:order-1 lg:sticky lg:top-40 lg:max-h-[calc(100dvh-11rem)] lg:overflow-y-auto lg:pr-1">
          <Summary app={app} />
          <ol className="space-y-2">
            {app.changes.map((c, i) => (
              <li key={c.path}>
                <button
                  type="button"
                  onClick={() => show(i + 1)}
                  className={cx(
                    "w-full rounded-xl bg-white p-4 text-left ring-1 transition hover:ring-brand-300",
                    active === i + 1 ? "ring-2 ring-brand-500" : "ring-zinc-200/80",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                      {pathLabel(c.path)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-zinc-700">
                    {c.path === "skills"
                      ? "Same skills, reordered: the ones this job asks for come first."
                      : cleanReason(c.reason ?? "Reworded for this job.")}
                  </p>
                  {c.path !== "skills" && (
                    <div className="mt-2 line-clamp-4 text-[13px] leading-6">
                      <WordDiff before={c.before} after={c.after} inline />
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ol>
          <NotClaimed app={app} />
        </aside>

        <main className="order-1 min-w-0 lg:order-2">
          {view === "changes" && <ResumePage ref={pageRef(0)} html={html.changes} page={paper} maxScale={1} />}
          {view === "compare" && (
            <div className="grid gap-6 xl:grid-cols-2">
              <ResumePage ref={pageRef(0)} html={html.original} page={paper} label="Original" />
              <ResumePage ref={pageRef(1)} html={html.tailored} page={paper} label="Tailored" />
            </div>
          )}
          {view === "final" && (
            <ResumePage ref={pageRef(0)} html={html.final} page={paper} maxScale={1} label="Exactly what we upload" />
          )}
        </main>
      </div>
    </div>
  );
}

function TopBar({ app, view, setView }: { app: ApplicationDetail; view: View; setView: (v: View) => void }) {
  const [, navigate] = useLocation();
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deciding = app.status === "AWAITING_APPROVAL";

  const decide = (what: "approve" | "reject") => async () => {
    setBusy(what);
    setError(null);
    try {
      await (what === "approve" ? api.approve(app.id) : api.reject(app.id));
      navigate(`/applications/${app.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(null);
    }
  };

  return (
    <div className="sticky top-16 z-10 -mx-4 border-b border-zinc-200/70 bg-zinc-50/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link href={`/applications/${app.id}`} className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
            ← Back to application
          </Link>
          <h1 className="truncate text-lg font-semibold tracking-tight">
            Resume for {prettyTitle(app.title)} <span className="font-normal text-zinc-400">· {app.company}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="tablist" className="inline-flex rounded-lg bg-zinc-200/60 p-1">
            {(
              [
                ["changes", "Changes"],
                ["compare", "Side by side"],
                ["final", "Final PDF"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                role="tab"
                aria-selected={view === value}
                onClick={() => setView(value)}
                className={cx(
                  "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition",
                  view === value ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600 hover:text-zinc-900",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {deciding ? (
            <>
              <Button variant="ghost" onClick={decide("reject")} busy={busy === "reject"} disabled={!!busy}>
                Don't apply
              </Button>
              <Button onClick={decide("approve")} busy={busy === "approve"} disabled={!!busy}>
                Approve & apply
              </Button>
            </>
          ) : (
            app.hasPdf && (
              <a href={files.resumePdf(app.id)} target="_blank" rel="noreferrer">
                <Button variant="secondary">Download PDF</Button>
              </a>
            )
          )}
        </div>
      </div>
      {error && (
        <div className="mt-2">
          <Notice>{error}</Notice>
        </div>
      )}
    </div>
  );
}

function Summary({ app }: { app: ApplicationDetail }) {
  const s = app.scores;
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-zinc-900">
        {app.changes.length
          ? `${app.changes.length} change${app.changes.length > 1 ? "s" : ""} for this job`
          : "No changes needed"}
      </p>
      <p className="mt-1 text-sm text-zinc-500">
        Reworded and reordered from what you wrote. Every number, tool and role is kept; nothing is invented.
      </p>
      {s && (
        <dl className="mt-4 grid grid-cols-2 gap-3">
          <Stat label="Fit" before={s.fit.before} after={s.fit.after} />
          <Stat label="Keywords" before={s.keywords.before} after={s.keywords.after} suffix="%" />
        </dl>
      )}
    </Card>
  );
}

function Stat({
  label,
  before,
  after,
  suffix = "",
}: {
  label: string;
  before: number;
  after: number;
  suffix?: string;
}) {
  const delta = after - before;
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2.5 ring-1 ring-zinc-200/70">
      <dt className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-xl font-semibold tabular-nums">
          {after}
          {suffix}
        </span>
        <span className={cx("text-xs font-semibold", delta > 0 ? "text-emerald-600" : "text-zinc-400")}>
          {delta > 0 ? `+${delta}` : "same"}
        </span>
      </dd>
    </div>
  );
}

function NotClaimed({ app }: { app: ApplicationDetail }) {
  const gaps = app.requirements.filter((r) => r.status === "gap");
  if (!gaps.length) return null;
  return (
    <Card className="p-5">
      <p className="text-sm font-semibold text-zinc-900">Not claimed</p>
      <p className="mt-1 text-sm text-zinc-500">
        The job asks for these; your resume doesn't show them, so we didn't add them.
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5">
        {gaps.map((g) => (
          <li key={g.id} className="rounded-full bg-zinc-50 px-2.5 py-1 text-xs text-zinc-600 ring-1 ring-zinc-200">
            {g.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}
