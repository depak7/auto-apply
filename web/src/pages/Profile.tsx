// Profile: the resume every application starts from, plus the details and answers forms ask for.

import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";

import { ApiError, api, type Profile } from "../api.ts";
import { Button, Card, Notice, Spinner, timeAgo } from "../components/ui.tsx";
import { prettyName } from "../format.ts";
import { useData } from "../hooks.ts";

export function ProfilePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
        <p className="mt-1 text-[15px] text-zinc-500">
          What we use to fill in applications. We only ever use what's here, never guesses.
        </p>
      </div>
      <ResumeCard />
      <ProfileForm />
    </div>
  );
}

function ResumeCard() {
  const resumes = useData(api.resumes, "once");
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
      <h2 className="text-lg font-semibold tracking-tight">Resume</h2>
      <section
        aria-label="Drop your resume PDF here"
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`mt-4 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
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
            {current ? (
              <p className="text-[15px] text-zinc-800">
                <span className="font-semibold">{prettyName(current.name)}</span>
                <span className="text-zinc-500"> · added {timeAgo(current.createdAt)}</span>
              </p>
            ) : (
              <p className="text-[15px] font-medium text-zinc-800">Add your resume to get started</p>
            )}
            <p className="text-sm text-zinc-500">Drop a PDF here, or</p>
            <Button variant="secondary" onClick={() => input.current?.click()}>
              {current ? "Upload a new version" : "Choose a PDF"}
            </Button>
            <input
              ref={input}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </>
        )}
      </section>
      {error && (
        <div className="mt-3">
          <Notice>{error}</Notice>
        </div>
      )}
    </Card>
  );
}

function ProfileForm() {
  const loaded = useData(api.profile, "once");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rows, setRows] = useState<AnswerRow[]>([]);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded.data) return;
    setProfile(loaded.data);
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
      setProfile(await api.saveProfile({ ...profile!, answers }));
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
        <p className="mt-0.5 text-sm text-zinc-500">Left empty? We use your resume, or ask when a form needs it.</p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="First name" value={profile.firstName} onChange={(v) => set({ firstName: orNull(v) })} />
          <Field label="Last name" value={profile.lastName} onChange={(v) => set({ lastName: orNull(v) })} />
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
}: {
  label: string;
  value: string | null;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-sm font-medium text-zinc-700">{label}</span>
      <input
        value={value ?? ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-1.5 ${INPUT}`}
      />
    </label>
  );
}
