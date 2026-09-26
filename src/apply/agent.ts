/**
 * The form-filling agent: observe the page, let Jev pick the next action, check it against
 * the guards, do it, repeat. Stops at the Review page (never submits), when blocked on
 * something only the user can answer, or when it runs out of steps.
 */

import type { Experimental_EvaluationModel, LanguageModel } from "ai";
import type { Page } from "playwright";

import { type Decision, decide, describe, OPTION_MIN_SUPPORT, optionSupport } from "./decide.ts";
import type { Facts } from "./facts.ts";
import { forbiddenClick, isReview, SUBMITTED_URL, settle } from "./guards.ts";
import { type FormField, type PageSnapshot, readPage } from "./page.ts";
import { valueFor } from "./values.ts";

export interface Credentials {
  email: string;
  password: string;
}

/** The resume to upload: its file name as Workday will show it, and its bytes. */
export interface ResumeFile {
  name: string;
  buffer: Buffer;
}

export interface AgentOptions {
  page: Page;
  facts: Facts;
  creds: Credentials;
  resumePdf: ResumeFile | null;
  jev?: Experimental_EvaluationModel;
  text?: LanguageModel;
  maxSteps?: number;
  onStep?: (entry: TraceEntry, page: Page) => void | Promise<void>;
}

export interface TraceEntry {
  n: number;
  step: string; // Workday step, e.g. "1 of 4: My Information"
  operation: string;
  target: string | null; // element as Jev saw it
  result: string; // what happened
  confidence: number | null;
  ms: number;
}

/** How a run ends. */
export type Done =
  | { status: "at_review" } // filled in; waiting for the user to submit
  | { status: "already_applied" } // Workday says this account applied before
  | { status: "blocked"; questions: string[]; reason: string } // needs the user (NEEDS_INPUT)
  | { status: "failed"; reason: string };

export type AgentResult = Done & { trace: TraceEntry[] };

const STUCK_AFTER = 6; // this many actions in a row without any change on the page -> blocked
const MAX_RELOADS = 3; // Workday's "Something went wrong, please refresh" page: reload this many times
const WORKDAY_ERROR_PAGE = /something went wrong[\s\S]{0,80}refresh the page/i;
const MAX_MODEL_FAILURES = 5; // Jev/gateway outages in a row before giving up (waits 5 s, 10 s, 15 s...)
// Workday's own wording when this account has applied to the job before.
const ALREADY_APPLIED =
  /you applied for this job on|you(?:'ve| have) already applied|application status\s*application submitted/i;

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const { page, facts, creds, resumePdf, maxSteps = 120 } = opts;
  const trace: TraceEntry[] = [];
  const history: string[] = [];
  const memory: Memory = { openDropdown: null, skipped: new Set() };
  let unchanged = 0;
  let reloads = 0;
  let modelFailures = 0;

  for (let n = 1; n <= maxSteps; n++) {
    await settle(page, 5_000);
    const snap = await readPage(page);
    if (SUBMITTED_URL.test(snap.url))
      return { status: "failed", reason: "Application was submitted unexpectedly", trace };

    const bodyText = await page.innerText("body").catch(() => "");
    if (ALREADY_APPLIED.test(bodyText)) return { status: "already_applied", trace };

    // Workday's own error page asks for a refresh: do that (Workday keeps the draft).
    if (WORKDAY_ERROR_PAGE.test(bodyText)) {
      if (++reloads > MAX_RELOADS)
        return { status: "failed", reason: "Workday keeps showing 'Something went wrong'", trace };
      await page.reload();
      trace.push({
        n,
        step: snap.step?.name ?? "",
        operation: "RELOAD",
        target: null,
        result: "Workday error page: reloaded",
        confidence: null,
        ms: 0,
      });
      continue;
    }

    let decision: Decision;
    try {
      decision = await decide(snap, facts, history, opts.jev, memory.skipped);
      modelFailures = 0;
    } catch (e) {
      // The model service being down is not a reason to lose the application: wait and try again.
      if (++modelFailures > MAX_MODEL_FAILURES)
        return { status: "failed", reason: `Jev unavailable: ${(e as Error).message}`, trace };
      trace.push({
        n,
        step: snap.step?.name ?? "",
        operation: "RETRY",
        target: null,
        result: `Jev call failed, retrying: ${(e as Error).message.slice(0, 80)}`,
        confidence: null,
        ms: 0,
      });
      await page.waitForTimeout(5_000 * modelFailures);
      continue;
    }
    // A failed click or fill is recorded and the agent looks again; it does not end the run.
    const outcome = await act(page, snap, decision, facts, creds, resumePdf, memory, opts.text, opts.jev).catch(
      (e): Outcome => ({ note: `${decision.operation.toLowerCase()} failed: ${(e as Error).message.split("\n")[0]}` }),
    );

    const entry: TraceEntry = {
      n,
      step: snap.step ? `${snap.step.index} of ${snap.step.total}: ${snap.step.name}` : snap.heading || "(no step)",
      operation: decision.operation,
      target: decision.target ? describe(decision.target) : null,
      result: outcome.note,
      confidence: decision.confidence,
      ms: decision.ms,
    };
    trace.push(entry);
    history.push(`${decision.operation}${decision.target ? ` ${describe(decision.target)}` : ""} -> ${outcome.note}`);
    await opts.onStep?.(entry, page);

    if (outcome.done) return { ...outcome.done, trace };

    const after = await readPage(page).catch(() => snap);
    unchanged = fingerprint(after) === fingerprint(snap) ? unchanged + 1 : 0;
    if (unchanged >= STUCK_AFTER) {
      // Stuck with something to ask: ask it. Stuck with nothing to ask: that's a failure, not a question.
      const questions = openQuestions(after);
      const where = after.step?.name ?? after.heading ?? "this page";
      if (questions.length)
        return { status: "blocked", reason: `No progress after ${STUCK_AFTER} actions`, questions, trace };
      return { status: "failed", reason: `Couldn't move forward on "${where}" after ${STUCK_AFTER} tries`, trace };
    }
  }
  return { status: "failed", reason: `Stopped after ${maxSteps} steps`, trace };
}

/** What the agent remembers between steps. */
interface Memory {
  openDropdown: FormField | null; // the dropdown whose option list is open: gives an option its question
  skipped: Set<string>; // optional fields with no answer in the facts: left empty, not offered again
}

interface Outcome {
  note: string;
  done?: Done;
}

async function act(
  page: Page,
  snap: PageSnapshot,
  d: Decision,
  facts: Facts,
  creds: Credentials,
  resumePdf: ResumeFile | null,
  memory: Memory,
  text?: LanguageModel,
  jev?: Experimental_EvaluationModel,
): Promise<Outcome> {
  // No .first(): if a number ever matched two elements, Playwright errors instead of guessing.
  const el = (f: FormField) => page.locator(`[data-aa-idx="${f.idx}"]`);

  // The decision was made on `snap`. If Workday has moved to another step since, it no longer applies.
  if (d.target) {
    const now = await readPage(page).catch(() => null);
    if (now && now.step?.name !== snap.step?.name) return { note: "page changed since the decision: looking again" };
  }

  switch (d.operation) {
    case "AT_REVIEW":
      // Trust the progress bar, not the model.
      if (isReview(snap)) return { note: "reached Review", done: { status: "at_review" } };
      return { note: "not the Review page yet (progress bar disagrees)" };

    case "BLOCKED": {
      // Blocked must name what is missing. Re-read (the page may have finished loading since);
      // if no required field is open, it is not really blocked: wait and look again.
      await page.waitForTimeout(1_000);
      const fresh = await readPage(page).catch(() => snap);
      const questions = openQuestions(fresh);
      if (questions.length === 0) return { note: "blocked, but no required field is open: looking again" };

      // Second opinion: if any open text field CAN be answered from the facts, fill it instead.
      for (const field of openTextFields(fresh)) {
        const v = await valueFor(field, facts, creds, text);
        if (!("missing" in v)) {
          await el(field).fill(v.value, { timeout: 5_000 });
          return { note: `not blocked: filled "${field.label}" from ${v.source}` };
        }
      }
      return {
        note: "blocked",
        done: { status: "blocked", reason: "Required answers are not in the facts", questions },
      };
    }

    case "WAIT":
      await page.waitForTimeout(1_000);
      return { note: "waited" };

    case "CLICK": {
      if (!d.target) return { note: "no target" };
      const why = forbiddenClick(d.target, snap); // candidates() already excludes these; checked again here
      if (why) return { note: `refused: ${why}` };

      if (d.target.kind === "dropdown" && d.target.expanded) return { note: "already open: pick an option" };

      // Picking an answer (a dropdown option, or a Yes/No radio or checkbox under a question) must
      // come from the facts, exactly like typed text. Consent boxes have no question and pass.
      const question = answeredQuestion(d.target, snap, memory);
      if (question) {
        const support = await optionSupport(question, d.target.label, facts, jev);
        if (support < OPTION_MIN_SUPPORT) {
          // Jev's pick isn't backed by the facts. Another option of the same question may be ("No" instead of "Yes").
          const better = await bestSupportedAlternative(d.target, question, snap, facts, jev);
          if (better) {
            await el(better.field)
              .click({ timeout: 5_000 })
              .catch(() => el(better.field).click({ force: true, timeout: 5_000 }));
            memory.openDropdown = null;
            return {
              note: `"${d.target.label}" not supported (${support.toFixed(2)}); chose "${better.field.label}" (${better.support.toFixed(2)})`,
            };
          }
          if (d.target.kind === "option") await page.keyboard.press("Escape"); // close the list without choosing
          memory.openDropdown = null;
          return {
            note: `"${d.target.label}" is not supported by the facts (${support.toFixed(2)}), nor is any other option`,
            done: { status: "blocked", reason: "Missing information", questions: [question] },
          };
        }
      }

      await el(d.target)
        .click({ timeout: 5_000 })
        .catch(() => el(d.target!).click({ force: true, timeout: 5_000 }));
      memory.openDropdown = d.target.kind === "dropdown" ? d.target : null;
      if (d.target.kind === "dropdown") {
        // Workday draws the option list a moment later: wait for it, so the next look sees the options.
        await page
          .locator('[role="option"]')
          .first()
          .waitFor({ state: "visible", timeout: 3_000 })
          .catch(() => {});
      }
      return { note: "clicked" };
    }

    case "FILL": {
      if (!d.target) return { note: "no target" };
      const v = await valueFor(d.target, facts, creds, text);
      if ("missing" in v) {
        if (!d.target.required) {
          memory.skipped.add(d.target.label); // optional: leave it empty
          return { note: "optional, no answer in facts: left empty" };
        }
        return {
          note: "no answer in facts",
          done: { status: "blocked", reason: "Missing information", questions: [v.missing] },
        };
      }
      const input = el(d.target);
      await input.fill(v.value, { timeout: 5_000 });
      // Search-style inputs (Workday multiselects) list matches only after Enter.
      if (d.target.kind === "search" || /multiselect/i.test(d.target.automationId ?? "")) await input.press("Enter");
      return {
        note: v.source === "credentials" ? "typed (from credentials)" : `typed "${v.value.slice(0, 40)}" (${v.source})`,
      };
    }

    case "UPLOAD": {
      if (!d.target) return { note: "no target" };
      if (!resumePdf)
        return {
          note: "no resume PDF",
          done: { status: "blocked", reason: "No resume PDF to upload", questions: ["Resume PDF"] },
        };
      await el(d.target).setInputFiles({ ...resumePdf, mimeType: "application/pdf" });
      return { note: "uploaded resume" };
    }
  }
}

const MAX_ALTERNATIVES = 12; // options checked when Jev's pick is rejected (a Yes/No question has 1)

/** The other answers to the same question (sibling radios, or the open list's options) the facts support best. */
async function bestSupportedAlternative(
  target: FormField,
  question: string,
  snap: PageSnapshot,
  facts: Facts,
  jev?: Experimental_EvaluationModel,
): Promise<{ field: FormField; support: number } | null> {
  const siblings = snap.fields
    .filter((f) => f.idx !== target.idx && !f.honeypot && !f.disabled && f.kind === target.kind)
    .filter((f) => (target.kind === "option" ? true : f.question === target.question))
    .slice(0, MAX_ALTERNATIVES);
  const scored = await Promise.all(
    siblings.map(async (field) => ({ field, support: await optionSupport(question, field.label, facts, jev) })),
  );
  const best = scored.sort((a, b) => b.support - a.support)[0];
  return best && best.support >= OPTION_MIN_SUPPORT ? best : null;
}

/** The question a click answers, if it answers one: an option of the open dropdown, or a radio/checkbox under a question. */
function answeredQuestion(target: FormField, snap: PageSnapshot, memory: Memory): string | null {
  if (target.kind === "option") {
    // The dropdown the page says is open; memory only as a fallback.
    const open = snap.fields.find((f) => f.kind === "dropdown" && f.expanded) ?? memory.openDropdown;
    return open ? open.question || open.label : null;
  }
  if ((target.kind === "radio" || target.kind === "checkbox") && target.question && target.question !== target.label) {
    return target.question;
  }
  return null;
}

const TEXT_KINDS = new Set(["text", "tel", "textarea", "number", "url", "search"]);

/** Required, empty text fields a value could be typed into. */
const openTextFields = (snap: PageSnapshot) =>
  snap.fields.filter(
    (f) => !f.honeypot && !f.chrome && !f.disabled && f.required && TEXT_KINDS.has(f.kind) && !f.value,
  );

/** Required fields that are still empty or marked invalid, plus the page's error messages. */
function openQuestions(snap: PageSnapshot): string[] {
  const open = snap.fields
    .filter(
      (f) =>
        !f.honeypot && !f.chrome && f.required && (f.invalid || f.value === "" || f.value == null || f.value === false),
    )
    .map((f) => f.question || f.label);
  return [...new Set([...open, ...snap.errors])];
}

const fingerprint = (s: PageSnapshot) =>
  JSON.stringify([s.url, s.step?.name, s.fields.map((f) => [f.kind, f.label, f.value])]);
