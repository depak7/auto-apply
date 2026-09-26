/**
 * The form-filling agent: observe the page, let Jev pick the next action, check it against
 * the guards, do it, repeat. Stops at the Review page (never submits), when blocked on
 * something only the user can answer, or when it runs out of steps.
 */

import type { Experimental_EvaluationModel, LanguageModel } from "ai";
import type { Page } from "playwright";
import type { JobBoard } from "../boards/types.ts";
import { workday } from "../boards/workday.ts";
import { type Decision, decide, describe, OPTION_MIN_SUPPORT, optionSupport } from "./decide.ts";
import type { Facts } from "./facts.ts";
import { forbiddenClick, openRequiredFields, settle } from "./guards.ts";
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
  /** The job board the form is on (default Workday): its instructions, Submit button and confirmation. */
  board?: JobBoard;
  onStep?: (entry: TraceEntry, page: Page) => void | Promise<void>;
  /**
   * Workday is asking for a verification code: ask the user, with the browser left open on the
   * page. Resolves to the code, or null if none arrived in time. Without it, the run fails there.
   */
  askCode?: (question: string) => Promise<string | null>;
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
  | { status: "failed"; reason: string; retry?: false }; // retry: false -> running it again won't help

export type AgentResult = Done & { trace: TraceEntry[] };

const STUCK_AFTER = 6; // this many actions in a row without any change on the page -> blocked
const MAX_RELOADS = 3; // Workday's "Something went wrong, please refresh" page: reload this many times
const WORKDAY_ERROR_PAGE = /something went wrong[\s\S]{0,80}refresh the page/i;
const MAX_MODEL_FAILURES = 5; // Jev/gateway outages in a row before giving up (waits 5 s, 10 s, 15 s...)
// Workday's own wording when this account has applied to the job before.
const ALREADY_APPLIED =
  /you applied for this job on|you(?:'ve| have) already applied|application status\s*application submitted/i;
// Workday's wording when sign-in is refused. It says the same when the account doesn't exist at this company.
const WRONG_LOGIN =
  /wrong email address or password|account might be locked|invalid (?:user ?name|email)(?: address)? or password|incorrect (?:email|password)/i;
const CREATE_ACCOUNT_HINT =
  "Sign-in failed: Workday doesn't accept this email and password here. The account probably doesn't exist at this " +
  'company yet: click "Create Account" and create it with the same email and password. Do not click Sign In again.';
const WRONG_LOGIN_REASON =
  "Workday didn't accept your Workday login for this company, even after trying to create the account. " +
  "Check the email and password on your profile (too many failed sign-ins can also lock the account for a while).";

export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const { page, facts, creds, resumePdf, maxSteps = 120, board = workday } = opts;
  const trace: TraceEntry[] = [];
  const history: string[] = [];
  const memory: Memory = { openDropdown: null, skipped: new Set() };
  let unchanged = 0;
  let reloads = 0;
  let modelFailures = 0;
  let loginFailures = 0;

  /** Every step, including retries and reloads, is traced and reported (logs, heartbeats). */
  const record = async (entry: TraceEntry) => {
    trace.push(entry);
    await opts.onStep?.(entry, page);
  };
  const note = (n: number, snap: PageSnapshot, operation: string, result: string) =>
    record({ n, step: snap.step?.name ?? "", operation, target: null, result, confidence: null, ms: 0 });

  for (let n = 1; n <= maxSteps; n++) {
    await settle(page, 5_000);
    const snap = await readPage(page);
    if (board.submitted(snap.url)) return { status: "failed", reason: "Application was submitted unexpectedly", trace };

    const bodyText = await page.innerText("body").catch(() => "");
    if (ALREADY_APPLIED.test(bodyText)) return { status: "already_applied", trace };

    // Sign-in refused right after clicking Sign In. First time: the account may not exist at this company,
    // so create it. Second time: stop, since more attempts can lock the account.
    if (WRONG_LOGIN.test(bodyText) && /^CLICK .*sign ?in/i.test(history.at(-1) ?? "")) {
      if (++loginFailures >= 2) return { status: "failed", reason: WRONG_LOGIN_REASON, retry: false, trace };
      history.push(CREATE_ACCOUNT_HINT);
      await note(n, snap, "SIGN_IN_FAILED", "Workday refused the login: trying Create Account");
      continue;
    }

    // Workday's own error page asks for a refresh: do that (Workday keeps the draft).
    if (WORKDAY_ERROR_PAGE.test(bodyText)) {
      if (++reloads > MAX_RELOADS)
        return { status: "failed", reason: "Workday keeps showing 'Something went wrong'", trace };
      await page.reload();
      await note(n, snap, "RELOAD", "Workday error page: reloaded");
      continue;
    }

    let decision: Decision;
    try {
      decision = await decide(snap, facts, history, opts.jev, memory.skipped, board);
      modelFailures = 0;
    } catch (e) {
      // The model service being down is not a reason to lose the application: wait and try again.
      if (++modelFailures > MAX_MODEL_FAILURES)
        return { status: "failed", reason: `Jev unavailable: ${(e as Error).message}`, trace };
      await note(n, snap, "RETRY", `Jev call failed, retrying: ${(e as Error).message.slice(0, 120)}`);
      await page.waitForTimeout(5_000 * modelFailures);
      continue;
    }
    // A failed click or fill is recorded and the agent looks again; it does not end the run.
    const outcome = await act(page, snap, decision, { ...opts, facts, creds, resumePdf, memory, board }).catch(
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
    history.push(`${decision.operation}${decision.target ? ` ${describe(decision.target)}` : ""} -> ${outcome.note}`);
    await record(entry);

    if (outcome.done) return { ...outcome.done, trace };

    const after = await readPage(page).catch(() => snap);
    unchanged = fingerprint(after) === fingerprint(snap) ? unchanged + 1 : 0;
    if (unchanged >= STUCK_AFTER) {
      // Stuck with something to ask: ask it. Stuck with nothing to ask: that's a failure, not a question.
      const questions = openQuestions(after);
      const where = after.step?.name || after.heading || "this page";
      const errors = after.errors.length ? ` (the page says: ${after.errors.join("; ").slice(0, 200)})` : "";
      if (questions.length)
        return { status: "blocked", reason: `No progress after ${STUCK_AFTER} actions${errors}`, questions, trace };
      return {
        status: "failed",
        reason: `Couldn't move forward on "${where}" after ${STUCK_AFTER} tries${errors}`,
        trace,
      };
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

type ActContext = Pick<AgentOptions, "facts" | "creds" | "resumePdf" | "text" | "jev" | "askCode"> & {
  memory: Memory;
  board: JobBoard;
};

async function act(page: Page, snap: PageSnapshot, d: Decision, ctx: ActContext): Promise<Outcome> {
  const { facts, creds, resumePdf, memory, text, jev, board } = ctx;
  // No .first(): if a number ever matched two elements, Playwright errors instead of guessing.
  const el = (f: FormField) => page.locator(`[data-aa-idx="${f.idx}"]`);

  // The decision was made on `snap`. If Workday has moved to another step since, it no longer applies.
  if (d.target) {
    const now = await readPage(page).catch(() => null);
    if (now && now.step?.name !== snap.step?.name) return { note: "page changed since the decision: looking again" };
  }

  switch (d.operation) {
    case "AT_REVIEW":
      // Trust the board's own signal (Workday's progress bar, Lever's filled form), not the model.
      if (board.formComplete(snap))
        return { note: "form complete: only Submit is left", done: { status: "at_review" } };
      return { note: "not complete yet (the page disagrees)" };

    case "BLOCKED": {
      // Blocked must name what is missing. Re-read (the page may have finished loading since);
      // if no required field is open, it is not really blocked: wait and look again.
      await page.waitForTimeout(1_000);
      const fresh = await readPage(page).catch(() => snap);
      const questions = openQuestions(fresh);
      if (questions.length === 0) return { note: "blocked, but no required field is open: looking again" };

      // A verification code comes from the user, while the browser waits on this page.
      const codeField = openTextFields(fresh).find(isCodeField);
      if (codeField) return enterCode(page, codeField, ctx);

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
      const why = forbiddenClick(d.target, snap, board); // candidates() already excludes these; checked again here
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
      if (isCodeField(d.target)) return enterCode(page, d.target, ctx);
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
      if (d.target.kind === "select") {
        await input.selectOption({ label: v.value }, { timeout: 5_000 });
        return { note: `chose "${v.value.slice(0, 40)}" (${v.source})` };
      }
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

// "Verification Code", "One-time passcode", "Security code", "Enter the code we sent", "OTP".
const CODE_FIELD =
  /verification code|verify code|one[- ]?time (?:pass)?code|passcode|security code|authentication code|enter (?:the )?code|\bOTP\b/i;
const CODE_KINDS = new Set(["text", "tel", "number", "password"]);

export const isCodeField = (f: FormField) =>
  CODE_KINDS.has(f.kind) && (CODE_FIELD.test(f.label) || CODE_FIELD.test(f.question ?? ""));

/** Ask the user for the code Workday sent, and type it. The code never goes to a model. */
async function enterCode(page: Page, field: FormField, ctx: ActContext): Promise<Outcome> {
  const question = field.question && field.question !== field.label ? field.question : field.label;
  if (!ctx.askCode) {
    return {
      note: "verification code needed",
      done: { status: "failed", reason: `Workday asked for a verification code ("${question}")`, retry: false },
    };
  }
  const code = await ctx.askCode(question);
  if (!code) {
    return {
      note: "no verification code entered",
      done: { status: "failed", reason: "No verification code was entered in time", retry: false },
    };
  }
  await page.locator(`[data-aa-idx="${field.idx}"]`).fill(code, { timeout: 5_000 });
  return { note: "typed the verification code (from the user)" };
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

/**
 * What to ask the user: required fields that are still empty or marked invalid. Never the sign-in
 * fields (the login is on the profile, not a question), verification codes (asked separately),
 * or the page's error messages ("Error: Please enter your password" is not a question).
 */
function openQuestions(snap: PageSnapshot): string[] {
  const open = openRequiredFields(snap)
    .filter((f) => !isLoginField(f) && !isCodeField(f))
    .map((f) => f.question || f.label);
  return [...new Set(open)];
}

const isLoginField = (f: FormField) =>
  f.kind === "password" || f.kind === "email" || /e-?mail|password/i.test(`${f.label} ${f.question ?? ""}`);

const fingerprint = (s: PageSnapshot) =>
  JSON.stringify([s.url, s.step?.name, s.fields.map((f) => [f.kind, f.label, f.value])]);
