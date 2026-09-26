// Profile: who you are, the Workday login we apply with, your resume, and the details and
// answers forms ask for.

import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";

import { ApiError, api, type Profile, type Resume } from "../api.ts";
import { Avatar, Button, Card, Notice, Spinner, timeAgo } from "../components/ui.tsx";
import { prettyName } from "../format.ts";
import { useData } from "../hooks.ts";
import { useSession } from "../session.tsx";

export function ProfilePage() {
  // A new resume fills empty profile fields on the server: reload the form when one is uploaded.
  const [version, setVersion] = useState(0);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-[15px] text-zinc-500">
          What we use to fill in applications. We only ever use what's here, never guesses.
        </p>
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6 lg:sticky lg:top-24">
          <AccountCard />
          <WorkdayLoginCard />
        </div>
        <div className="min-w-0 space-y-8">
          <ResumeCard onUploaded={() => setVersion((v) => v + 1)} />
          <ProfileForm key={version} />
        </div>
      </div>
    </div>
  );
}

function AccountCard() {
  const { me, signOut } = useSession();
  const name = me.user.name ?? me.user.email;
  return (
    <Card className="p-6">
      <div className="flex items-center gap-4">
        <Avatar name={name} picture={me.user.picture} className="size-14 text-lg" />
        <div className="min-w-0">
          <div className="truncate text-lg font-semibold tracking-tight">{name}</div>
          <div className="truncate text-sm text-zinc-500">{me.user.email}</div>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-zinc-100 pt-4 text-sm">
        <span className="text-zinc-500">Member since {new Date(me.user.createdAt).toLocaleDateString()}</span>
        <Button variant="ghost" className="-mr-2 px-2.5" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </Card>
  );
}

function WorkdayLoginCard() {
  const { me, refresh } = useSession();
  const saved = me.workday;
  const [email, setEmail] = useState(saved?.email ?? me.user.email);
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    try {
      await api.saveWorkdayLogin(email.trim(), password || undefined);
      setPassword("");
      await refresh();
      setState("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
      setState("idle");
    }
  }

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Workday login</h2>
        {saved ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">Saved</span>
        ) : (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">Needed</span>
        )}
      </div>
      <p className="mt-1 text-sm leading-relaxed text-zinc-500">
        We sign in to each company's Workday with this, or create the account there. Use an email and password, not
        Google or LinkedIn sign-in.
      </p>
      <form onSubmit={save} className="mt-5 space-y-4">
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={(v) => {
            setEmail(v);
            setState("idle");
          }}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          value={password}
          placeholder={saved ? "Saved: type to change it" : ""}
          onChange={(v) => {
            setPassword(v);
            setState("idle");
          }}
        />
        {error && <Notice>{error}</Notice>}
        <div className="flex items-center justify-end gap-3">
          {state === "saved" && <span className="text-sm font-medium text-emerald-600">Saved</span>}
          <Button type="submit" busy={state === "saving"} disabled={!email.trim() || (!saved && !password)}>
            {saved ? "Update" : "Save login"}
          </Button>
        </div>
      </form>
      <p className="mt-4 flex gap-2 border-t border-zinc-100 pt-4 text-xs leading-relaxed text-zinc-500">
        <LockIcon />
        Your password is encrypted and only used by the browser that fills your applications. It is never shown to an AI
        model, and never sent back to this page.
      </p>
    </Card>
  );
}

function ResumeCard({ onUploaded }: { onUploaded: () => void }) {
  const resumes = useData(api.resumes, "resumes");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = resumes.data?.[0];

  async function upload(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) return setError("Please choose a PDF.");
    setBusy(true);
    setError(null);
    try {
      await api.uploadResume(file);
      await resumes.refresh();
      onUploaded();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void upload(e.dataTransfer.files[0]);
  };

  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Resume</h2>
          {current && (
            <p className="mt-0.5 text-sm text-zinc-500">
              {prettyName(current.name)} · added {timeAgo(current.createdAt)}
            </p>
          )}
        </div>
        {current && !busy && (
          <Button variant="secondary" onClick={() => input.current?.click()}>
            Upload a new version
          </Button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => upload(e.target.files?.[0])}
      />
      {(!current || busy) && (
        <section
          aria-label="Drop your resume PDF here"
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
            dragging ? "border-brand-500 bg-brand-50" : "border-zinc-200 bg-zinc-50/60"
          }`}
        >
          {busy ? (
            <>
              <Spinner className="size-6 text-brand-600" />
              <p className="text-sm text-zinc-600">Reading your resume… this takes a few seconds.</p>
            </>
          ) : (
            <>
              <p className="text-[15px] font-medium text-zinc-800">Add your resume to get started</p>
              <p className="text-sm text-zinc-500">Drop a PDF here, or</p>
              <Button variant="secondary" onClick={() => input.current?.click()}>
                Choose a PDF
              </Button>
            </>
          )}
        </section>
      )}
      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
      {current && !busy && <ResumeDetails id={current.id} />}
    </Card>
  );
}

/** The resume as we read it: what the tailoring and the forms start from. */
function ResumeDetails({ id }: { id: string }) {
  const record = useData(() => api.resume(id), id);
  if (!record.data)
    return (
      <div className="flex justify-center py-8 text-zinc-400">
        <Spinner />
      </div>
    );
  const r: Resume = record.data.resume;
  return (
    <div className="mt-6 space-y-6 border-t border-zinc-100 pt-6">
      {r.summary && <p className="text-[15px] leading-relaxed text-zinc-700">{r.summary}</p>}

      {r.experience.length > 0 && (
        <Section title="Experience">
          <ol className="space-y-4">
            {r.experience.map((e) => (
              <li key={`${e.company}-${e.title}-${e.start}`} className="grid gap-0.5 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="font-medium text-zinc-900">{e.title}</div>
                  <div className="text-sm text-zinc-600">{[e.company, e.location].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="text-sm tabular-nums text-zinc-500 sm:text-right">
                  {e.start} – {e.end ?? "Present"}
                </div>
              </li>
            ))}
          </ol>
        </Section>
      )}

      {r.education.length > 0 && (
        <Section title="Education">
          <ul className="space-y-2">
            {r.education.map((e) => (
              <li key={`${e.school}-${e.degree}`} className="text-[15px] text-zinc-700">
                <span className="font-medium text-zinc-900">{e.school}</span>
                {[e.degree, e.field].filter(Boolean).length > 0 &&
                  ` · ${[e.degree, e.field].filter(Boolean).join(", ")}`}
                {e.end && <span className="text-zinc-500"> · {e.end}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {r.skills.length > 0 && (
        <Section title="Skills">
          <div className="flex flex-wrap gap-1.5">
            {r.skills.map((s) => (
              <span key={s} className="rounded-md bg-zinc-100 px-2 py-1 text-sm text-zinc-700">
                {s}
              </span>
            ))}
          </div>
        </Section>
      )}

      {(r.projects.length > 0 || r.certifications.length > 0) && (
        <p className="text-sm text-zinc-500">
          {[
            r.projects.length && `${r.projects.length} project${r.projects.length === 1 ? "" : "s"}`,
            r.certifications.length &&
              `${r.certifications.length} certification${r.certifications.length === 1 ? "" : "s"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-semibold tracking-wider text-zinc-400 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 size-3.5 shrink-0 text-zinc-400" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function ProfileForm() {
  const loaded = useData(api.profile, "profile");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<AnswerRow[]>([]);
  const [links, setLinks] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded.data) return;
    setProfile(loaded.data);
    setLinks(loaded.data.links.join("\n"));
    setRows(Object.entries(loaded.data.answers).map(([q, a]) => newRow(q, a)));
  }, [loaded.data]);

  if (!profile)
    return (
      <div className="flex justify-center py-10 text-zinc-400">
        <Spinner />
      </div>
    );

  const set = (patch: Partial<Profile>) => {
    setProfile({ ...profile, ...patch });
    setState("idle");
  };
  const setAddress = (patch: Partial<Profile["address"]>) => set({ address: { ...profile.address, ...patch } });
  const orNull = (v: string) => (v.trim() ? v : null);
  const updateRow = (id: string, patch: Partial<AnswerRow>) => {
    setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setState("idle");
  };
  const removeRow = (id: string) => {
    setRows(rows.filter((r) => r.id !== id));
    setState("idle");
  };

  async function save(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    setError(null);
    const answers = Object.fromEntries(
      rows.filter((r) => r.q.trim() && r.a.trim()).map((r) => [r.q.trim(), r.a.trim()]),
    );
    try {
      const linkList = links
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      setProfile(await api.saveProfile({ ...profile!, links: linkList, answers }));
      setState("saved");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
      setState("idle");
    }
  }

  return (
    <form onSubmit={save} className="space-y-8">
      <Card className="p-6">
        <h2 className="text-lg font-semibold tracking-tight">Personal details</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Filled in from your resume. Edit anything; your changes are kept when you upload a new version.
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="First name" value={profile.firstName} onChange={(v) => set({ firstName: orNull(v) })} />
          <Field label="Last name" value={profile.lastName} onChange={(v) => set({ lastName: orNull(v) })} />
          <Field
            label="Contact email"
            type="email"
            className="sm:col-span-2"
            value={profile.email}
            onChange={(v) => set({ email: orNull(v) })}
          />
          <Field
            label="Country code"
            placeholder="+91"
            value={profile.phoneCountryCode}
            onChange={(v) => set({ phoneCountryCode: orNull(v) })}
          />
          <Field label="Phone" value={profile.phone} onChange={(v) => set({ phone: orNull(v) })} />
          <Field
            label="Address"
            className="sm:col-span-2"
            value={profile.address.line1}
            onChange={(v) => setAddress({ line1: orNull(v) })}
          />
          <Field label="City" value={profile.address.city} onChange={(v) => setAddress({ city: orNull(v) })} />
          <Field label="State" value={profile.address.state} onChange={(v) => setAddress({ state: orNull(v) })} />
          <Field
            label="Postal code"
            value={profile.address.postalCode}
            onChange={(v) => setAddress({ postalCode: orNull(v) })}
          />
          <Field label="Country" value={profile.address.country} onChange={(v) => setAddress({ country: orNull(v) })} />
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-zinc-700">Links</span>
            <textarea
              value={links}
              rows={3}
              placeholder={"https://linkedin.com/in/…\nhttps://github.com/…"}
              onChange={(e) => {
                setLinks(e.target.value);
                setState("idle");
              }}
              className={`mt-1.5 ${INPUT} font-mono text-sm`}
            />
            <span className="mt-1 block text-xs text-zinc-400">One per line: LinkedIn, GitHub, portfolio.</span>
          </label>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold tracking-tight">Saved answers</h2>
        <p className="mt-0.5 text-sm text-zinc-500">
          Answers to questions forms ask. New ones are added when you answer them during an application.
        </p>
        <div className="mt-5 space-y-3">
          {rows.length === 0 && <p className="text-sm text-zinc-400">No saved answers yet.</p>}
          {rows.map((row) => (
            <div key={row.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
              <input
                value={row.q}
                placeholder="Question, e.g. notice period"
                onChange={(e) => updateRow(row.id, { q: e.target.value })}
                className={INPUT}
              />
              <input
                value={row.a}
                placeholder="Your answer"
                onChange={(e) => updateRow(row.id, { a: e.target.value })}
                className={INPUT}
              />
              <Button type="button" variant="ghost" onClick={() => removeRow(row.id)} aria-label="Remove">
                Remove
              </Button>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setRows([...rows, newRow()])}>
            Add an answer
          </Button>
        </div>
      </Card>

      {error && <Notice>{error}</Notice>}
      <div className="sticky bottom-0 -mx-4 flex items-center justify-end gap-3 border-t border-zinc-200/70 bg-zinc-50/90 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6">
        {state === "saved" && <span className="text-sm font-medium text-emerald-600">Saved</span>}
        <Button type="submit" busy={state === "saving"}>
          Save profile
        </Button>
      </div>
    </form>
  );
}

interface AnswerRow {
  id: string; // stable React key while editing
  q: string;
  a: string;
}

const newRow = (q = "", a = ""): AnswerRow => ({ id: crypto.randomUUID(), q, a });

const INPUT =
  "w-full rounded-lg border-0 px-3.5 py-2.5 text-[15px] ring-1 ring-zinc-200 placeholder:text-zinc-400 focus:ring-2 focus:ring-brand-600 focus:outline-none";

function Field({
  label,
  value,
  onChange,
  placeholder,
  className,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        type={type}
        autoComplete={autoComplete}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1.5 ${INPUT}`}
      />
    </label>
  );
}
