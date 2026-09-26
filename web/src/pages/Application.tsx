// One application: where it is, and the one thing to do next.

import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { Link } from "wouter";

import { ApiError, type ApplicationDetail, api, files } from "../api.ts";
import { cleanReason, pathLabel } from "../components/Diff.tsx";
import { Button, Card, Check, cx, Notice, ScoreTile, Spinner, StatusPill, Stepper } from "../components/ui.tsx";
import { prettyLocation, prettyTitle } from "../format.ts";
import { useData } from "../hooks.ts";
import { STATUS } from "../status.ts";

export function ApplicationPage({ id }: { id: string }) {
  const {
    data: app,
    error,
    refresh,
  } = useData(
    () => api.application(id),
    id,
    (a) => STATUS[a.status].working,
  );

  if (error) return <Notice>Couldn't load this application: {error.message}</Notice>;
  if (!app)
    return (
      <div className="flex justify-center py-24 text-zinc-400">
        <Spinner />
      </div>
    );

  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
        ← All applications
      </Link>

      <header className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {prettyTitle(app.title) ?? "Reading the job…"}
          </h1>
          <p className="mt-1 text-[15px] text-zinc-500">
            {[app.company, prettyLocation(app.location)].filter(Boolean).join(" · ")}
            {" · "}
            <a
              href={app.jobUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-brand-700 hover:underline"
            >
              View job ↗
            </a>
          </p>
        </div>
        <StatusPill status={app.status} />
      </header>

      <Card className="px-5 py-4">
        <Stepper status={app.status} />
      </Card>

      {app.status === "AWAITING_APPROVAL" ? (
        // Reviewing: the resume gets the full width; how it matches follows below.
        <div className="space-y-6">
          <Stage app={app} onChange={refresh} />
          {app.requirements.length > 0 && <MatchPanel app={app} />}
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <Stage app={app} onChange={refresh} />
            <ResumeLinkCard app={app} />
          </div>
          {app.requirements.length > 0 && <MatchPanel app={app} />}
        </div>
      )}
    </div>
  );
}

function Stage({ app, onChange }: { app: ApplicationDetail; onChange: () => void }) {
  const info = STATUS[app.status];
  switch (app.status) {
    case "AWAITING_APPROVAL":
      return <ReviewChanges app={app} onChange={onChange} />;
    case "NEEDS_INPUT":
      return <AnswerQuestions app={app} onChange={onChange} />;
    case "NEEDS_CODE":
      return <EnterCode app={app} onChange={onChange} />;
    case "READY_TO_SUBMIT":
      return <ReadyToSubmit app={app} onChange={onChange} />;
    case "SUBMITTED":
      return (
        <Panel title="Application submitted" icon={<SuccessIcon />}>
          <p className="text-[15px] text-zinc-600">{info.detail} Good luck!</p>
          {app.hasScreenshot && <Screenshot app={app} />}
        </Panel>
      );
    case "SUBMIT_UNCONFIRMED":
      return (
        <Panel title="Please check the job board">
          <Notice tone="warning">{info.detail}</Notice>
          {app.hasScreenshot && <Screenshot app={app} />}
        </Panel>
      );
    case "FAILED":
      return (
        <Panel title="This application needs attention">
          <Notice>{app.error ?? info.detail}</Notice>
          <p className="text-sm text-zinc-500">Nothing was submitted. You can start again from the job link.</p>
        </Panel>
      );
    case "REJECTED":
    case "EXPIRED":
      return (
        <Panel title={info.label}>
          <p className="text-[15px] text-zinc-600">{info.detail}</p>
        </Panel>
      );
    case "ALREADY_APPLIED":
      return (
        <Panel title="You've already applied to this job">
          <p className="text-[15px] text-zinc-600">{info.detail} Nothing was changed or sent.</p>
          {app.hasScreenshot && <Screenshot app={app} />}
        </Panel>
      );
    default:
      return (
        <Panel>
          <div className="flex items-center gap-4 py-2">
            <div className="flex size-11 items-center justify-center rounded-full bg-sky-50 text-sky-600">
              <Spinner />
            </div>
            <div>
              <p className="font-medium text-zinc-900">{info.label}…</p>
              <p className="text-sm text-zinc-500">{info.detail} You can leave this page; it keeps going.</p>
            </div>
          </div>
        </Panel>
      );
  }
}

// Stage: review the tailored resume, on the resume itself.

function ReviewChanges({ app, onChange }: { app: ApplicationDetail; onChange: () => void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = (what: "approve" | "reject") => async () => {
    setBusy(what);
    setError(null);
    try {
      await (what === "approve" ? api.approve(app.id) : api.reject(app.id));
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(null);
    }
  };
  const gaps = app.requirements.filter((r) => r.status === "gap");

  return (
    <>
      {app.scores && (
        <div className="grid gap-3 sm:grid-cols-2">
          <ScoreTile label="Fit" {...app.scores.fit} hint="How clearly your resume shows what the job asks for." />
          <ScoreTile
            label="Keywords"
            {...app.scores.keywords}
            suffix="%"
            hint="The job's own terms found in your resume, as filters look for them."
          />
        </div>
      )}

      <ResumeLinkCard app={app} primary />

      {gaps.length > 0 && (
        <Card className="p-5">
          <p className="text-sm font-medium text-zinc-800">Not claimed</p>
          <p className="mt-0.5 text-sm text-zinc-500">Your resume doesn't show these, so we didn't add them.</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {gaps.map((g) => (
              <li key={g.id} className="rounded-full bg-zinc-50 px-3 py-1 text-xs text-zinc-600 ring-1 ring-zinc-200">
                {g.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="sticky bottom-3 z-10">
        <Card className="flex flex-col gap-3 px-5 py-4 shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-zinc-500">
            Approve to fill in the application with this resume. Nothing is sent to {app.company ?? "the employer"}{" "}
            until you press Submit at the end.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" onClick={act("reject")} busy={busy === "reject"} disabled={!!busy}>
              Don't apply
            </Button>
            <Button onClick={act("approve")} busy={busy === "approve"} disabled={!!busy}>
              Approve & apply
            </Button>
          </div>
        </Card>
        {error && (
          <div className="mt-2">
            <Notice>{error}</Notice>
          </div>
        )}
      </div>
    </>
  );
}

/** A summary of the resume changes, opening the full-page review. */
function ResumeLinkCard({ app, primary = false }: { app: ApplicationDetail; primary?: boolean }) {
  if (!app.resume) return null;
  const count = app.changes.length;
  return (
    <Card className={cx("p-6", primary && "ring-2 ring-brand-600/20")}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Your tailored resume</h2>
          <p className="mt-1 text-sm text-zinc-500">
            {count
              ? `${count} change${count > 1 ? "s" : ""}, reworded and reordered from what you wrote. Nothing invented.`
              : "Your resume already fits this job; no changes were needed."}
          </p>
          {count > 0 && (
            <ol className="mt-4 space-y-2">
              {app.changes.slice(0, 3).map((c, i) => (
                <li key={c.path} className="flex gap-2.5 text-sm">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-700">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium text-zinc-800">{pathLabel(c.path)}</span>
                    <span className="text-zinc-500">
                      {" "}
                      ·{" "}
                      {c.path === "skills"
                        ? "reordered for this job"
                        : cleanReason(c.reason ?? "reworded for this job")}
                    </span>
                  </span>
                </li>
              ))}
              {count > 3 && <li className="pl-7.5 text-sm text-zinc-400">and {count - 3} more</li>}
            </ol>
          )}
        </div>
        <Link href={`/applications/${app.id}/resume`} className="shrink-0">
          <Button variant={primary ? "primary" : "secondary"}>
            {primary ? "Review changes on your resume" : "Open resume"} →
          </Button>
        </Link>
      </div>
    </Card>
  );
}

// Stage: the form asked something we don't know.

function AnswerQuestions({ app, onChange }: { app: ApplicationDetail; onChange: () => void }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const complete = app.questions.every((q) => answers[q]?.trim());

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.answer(app.id, Object.fromEntries(app.questions.map((q) => [q, answers[q]!.trim()])));
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Panel title={`${app.company ?? "The form"} is asking`}>
      <p className="-mt-1 text-sm text-zinc-500">
        We never guess these. Answer once and we'll remember it for every future application.
      </p>
      <form onSubmit={save} className="space-y-4">
        {app.questions.map((q) => (
          <label key={q} className="block">
            <span className="text-[15px] font-medium text-zinc-800">{q.replace(/\*$/, "")}</span>
            <input
              value={answers[q] ?? ""}
              onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
              className="mt-1.5 w-full rounded-lg border-0 px-3.5 py-2.5 text-[15px] ring-1 ring-zinc-200 focus:ring-2 focus:ring-brand-600 focus:outline-none"
            />
          </label>
        ))}
        {error && <Notice>{error}</Notice>}
        <div className="flex justify-end">
          <Button type="submit" busy={busy} disabled={!complete}>
            Save & continue
          </Button>
        </div>
      </form>
    </Panel>
  );
}

// Stage: Workday emailed a verification code; the browser waits on that page for it.

function EnterCode({ app, onChange }: { app: ApplicationDetail; onChange: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const question = app.questions[0]?.replace(/\*$/, "") ?? "Verification code";

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.enterCode(app.id, code.trim());
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Panel title="Enter the code Workday sent you">
      <p className="-mt-1 text-[15px] text-zinc-600">
        {app.company ?? "Workday"} sent a verification code to your Workday email. The application is open and waiting
        on that page for about 10 minutes.
      </p>
      <form onSubmit={send} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1">
          <span className="text-sm font-medium text-zinc-700">{question}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="one-time-code"
            spellCheck={false}
            className="mt-1.5 w-full rounded-lg border-0 px-3.5 py-2.5 font-mono text-lg tracking-[0.3em] ring-1 ring-zinc-200 focus:ring-2 focus:ring-brand-600 focus:outline-none"
          />
        </label>
        <Button type="submit" busy={busy} disabled={!code.trim()} className="sm:px-6">
          Continue
        </Button>
      </form>
      {error && <Notice>{error}</Notice>}
    </Panel>
  );
}

// Stage: filled in, waiting for the user's final word.

function ReadyToSubmit({ app, onChange }: { app: ApplicationDetail; onChange: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.submit(app.id);
      dialog.current?.close();
      onChange();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <Panel title="Ready to submit">
      <p className="-mt-1 text-[15px] text-zinc-600">
        Everything is filled in. Check the page below. When you submit, we press Submit once and wait for the job board
        to confirm.
      </p>
      {app.hasScreenshot && <Screenshot app={app} />}
      <div className="flex flex-col-reverse gap-3 border-t border-zinc-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
        {app.hasPdf ? (
          <a
            href={files.resumePdf(app.id)}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            Open the resume we uploaded ↗
          </a>
        ) : (
          <span />
        )}
        <Button onClick={() => dialog.current?.showModal()}>Submit application</Button>
      </div>

      <dialog
        ref={dialog}
        className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-2xl p-0 shadow-xl backdrop:bg-zinc-900/40 backdrop:backdrop-blur-sm"
      >
        <div className="space-y-3 p-6">
          <h2 className="text-lg font-semibold">Submit to {app.company ?? "this employer"}?</h2>
          <p className="text-[15px] text-zinc-600">
            This sends your application for <strong>{prettyTitle(app.title)}</strong>. It can't be undone.
          </p>
          {error && <Notice>{error}</Notice>}
        </div>
        <div className="flex justify-end gap-2 rounded-b-2xl bg-zinc-50 px-6 py-4">
          <Button variant="ghost" onClick={() => dialog.current?.close()} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} busy={busy}>
            Yes, submit
          </Button>
        </div>
      </dialog>
    </Panel>
  );
}

// Side panel: how the resume matches each requirement.

function MatchPanel({ app }: { app: ApplicationDetail }) {
  const icon = { clear: "bg-emerald-500", related: "bg-amber-400", gap: "bg-zinc-300" } as const;
  return (
    <Card className="h-fit p-5 lg:sticky lg:top-24">
      <h2 className="text-sm font-semibold text-zinc-900">How you match</h2>
      <p className="mt-0.5 text-xs text-zinc-500">
        <Legend color="bg-emerald-500">clearly shown</Legend> <Legend color="bg-amber-400">related</Legend>{" "}
        <Legend color="bg-zinc-300">not shown</Legend>
      </p>
      <ul className="mt-4 space-y-3">
        {app.requirements.map((r) => (
          <li key={r.id} className="flex gap-2.5">
            <span className={cx("mt-1.5 size-2 shrink-0 rounded-full", icon[r.status])} />
            <div className="min-w-0 text-sm">
              <span className="text-zinc-700">{r.text}</span>
              {r.kind === "nice" && <span className="ml-1.5 text-xs text-zinc-400">nice to have</span>}
              {r.after > r.before + 0.05 && (
                <span className="ml-1.5 text-xs font-medium text-emerald-600">clearer now</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Legend({ color, children }: { color: string; children: string }) {
  return (
    <span className="mr-2 inline-flex items-center gap-1">
      <span className={cx("size-1.5 rounded-full", color)} />
      {children}
    </span>
  );
}

function Panel({ title, icon, children }: { title?: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <Card className="space-y-4 p-6">
      {title && (
        <h2 className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          {icon}
          {title}
        </h2>
      )}
      {children}
    </Card>
  );
}

function Screenshot({ app }: { app: ApplicationDetail }) {
  const src = files.screenshot(app.id, app.updatedAt);
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-xl ring-1 ring-zinc-200">
      <img
        src={src}
        alt="The application page as we left it"
        className="max-h-[520px] w-full object-cover object-top"
      />
    </a>
  );
}

function SuccessIcon() {
  return (
    <span className="flex size-7 items-center justify-center rounded-full bg-emerald-500 text-white">
      <Check className="size-4" />
    </span>
  );
}
