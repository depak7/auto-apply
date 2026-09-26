// Small building blocks used across the pages.

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { STAGES, STATUS, type Status, type Tone } from "../status.ts";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 disabled:bg-brand-600/50",
  secondary: "bg-white text-zinc-800 ring-1 ring-zinc-200 shadow-sm hover:bg-zinc-50 disabled:text-zinc-400",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
  danger: "bg-white text-red-600 ring-1 ring-red-200 hover:bg-red-50",
};

export function Button({
  variant = "primary",
  busy = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-semibold transition",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed",
        VARIANTS[variant],
        className,
      )}
    >
      {busy && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-2xl bg-white ring-1 ring-zinc-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04)]", className)}>
      {children}
    </div>
  );
}

export function Spinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const TONES: Record<Tone, string> = {
  progress: "bg-sky-50 text-sky-700 ring-sky-200",
  action: "bg-amber-50 text-amber-800 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-orange-50 text-orange-700 ring-orange-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
  muted: "bg-zinc-100 text-zinc-600 ring-zinc-200",
};

export function StatusPill({ status }: { status: Status }) {
  const info = STATUS[status];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
        TONES[info.tone],
      )}
    >
      {info.working ? <Spinner className="size-3" /> : <span className="size-1.5 rounded-full bg-current" />}
      {info.label}
    </span>
  );
}

export function Stepper({ status }: { status: Status }) {
  const current = STATUS[status].stage;
  const done = status === "SUBMITTED";
  return (
    <ol className="flex items-center gap-2">
      {STAGES.map((stage, i) => {
        const state = done || i < current ? "done" : i === current ? "current" : "todo";
        return (
          <li key={stage} className="flex flex-1 items-center gap-2">
            <span
              className={cx(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                state === "done" && "bg-brand-600 text-white",
                state === "current" && "bg-brand-50 text-brand-700 ring-2 ring-brand-600",
                state === "todo" && "bg-zinc-100 text-zinc-400",
              )}
            >
              {state === "done" ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span
              className={cx(
                "hidden text-sm sm:block",
                state === "todo" ? "text-zinc-400" : "font-medium text-zinc-800",
              )}
            >
              {stage}
            </span>
            {i < STAGES.length - 1 && (
              <span className={cx("h-px flex-1", i < current || done ? "bg-brand-600" : "bg-zinc-200")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function Check({ className = "size-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M5 10.5l3.2 3.2L15 7"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "Fit 71 → 74" as a tile: the number that matters large, the change beside it. */
export function ScoreTile({
  label,
  before,
  after,
  suffix = "",
  hint,
}: {
  label: string;
  before: number;
  after: number;
  suffix?: string;
  hint: string;
}) {
  const delta = after - before;
  return (
    <div className="rounded-xl bg-zinc-50 p-4 ring-1 ring-zinc-200/70">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-zinc-900">
          {after}
          {suffix}
        </span>
        {delta !== 0 ? (
          <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">
            +{delta}
            {suffix} from {before}
            {suffix}
          </span>
        ) : (
          <span className="text-xs text-zinc-500">unchanged</span>
        )}
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-200">
        <div
          className="h-full rounded-full bg-brand-600 transition-all"
          style={{ width: `${Math.min(100, after)}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500">{hint}</p>
    </div>
  );
}

export function Notice({ tone = "danger", children }: { tone?: "danger" | "warning" | "info"; children: ReactNode }) {
  const styles = {
    danger: "bg-red-50 text-red-800 ring-red-200",
    warning: "bg-orange-50 text-orange-800 ring-orange-200",
    info: "bg-brand-50 text-brand-700 ring-brand-100",
  }[tone];
  return <div className={cx("rounded-xl px-4 py-3 text-sm ring-1 ring-inset", styles)}>{children}</div>;
}

/** The user's photo, or their initial. */
export function Avatar({
  name,
  picture,
  className = "size-8",
}: {
  name: string;
  picture: string | null;
  className?: string;
}) {
  if (picture)
    return (
      <img src={picture} alt="" referrerPolicy="no-referrer" className={cx("rounded-full object-cover", className)} />
    );
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700",
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const steps: [number, string][] = [
    [60, "s"],
    [60, "m"],
    [24, "h"],
    [7, "d"],
  ];
  let value = seconds;
  for (const [size, unit] of steps) {
    if (value < size) return `${value}${unit} ago`;
    value = Math.floor(value / size);
  }
  return new Date(iso).toLocaleDateString();
}

export { cx };
