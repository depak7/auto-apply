/**
 * One Jev call per step: WHAT to do next, and WHICH element, asked together.
 *
 * Jev answers every question independently in a single request, so we ask the operation
 * question and one target question per kind of action at once ("speculative fan-out"),
 * then use only the target that matches the chosen operation.
 * Approach adapted from browser-use/jev-ultrafast (MIT).
 */

import { type Experimental_EvaluationModel, experimental_evaluate } from "ai";

import { decisionModel } from "../ai/models.ts";
import type { Facts } from "./facts.ts";
import { actionable, forbiddenClick } from "./guards.ts";
import type { FormField, PageSnapshot } from "./page.ts";

export const GOAL = `Complete this job application form for the candidate.
- On the job description page, click "Apply".
- If a dialog offers ways to start the application, choose "Apply Manually".
- The candidate may already have an account: if a "Sign In" link or button is offered, sign in first with the
  candidate's email and password. Create an account only if sign-in says the account does not exist.
- Tick any required consent or agreement checkbox.
- On each page, fill every empty required field using only the candidate facts. Leave fields that already have a value.
- A dropdown: click it to open the list, then click the option that matches the candidate facts.
- Attach the resume wherever a resume or CV upload is asked.
- When every required field on the page is filled, click "Save and Continue" (or "Next").
- On the Review page, stop: choose AT_REVIEW. Never click Submit.
- If a required question cannot be answered from the candidate facts, choose BLOCKED.`;

export const OPERATIONS = {
  CLICK: "Click a button, link, dropdown, list option, checkbox, or radio button",
  FILL: "Type into an empty text field",
  UPLOAD: "Attach the resume to a file upload field",
  AT_REVIEW: "This is the final Review page of the application",
  BLOCKED: "A required field is empty and its answer is not in the candidate facts",
  WAIT: "The page is still loading or changing",
} as const;
export type Operation = keyof typeof OPERATIONS;

const CLICKABLE = new Set(["button", "link", "option", "dropdown", "checkbox", "radio", "combobox"]);
const TYPEABLE = new Set(["text", "email", "tel", "password", "textarea", "search", "number", "url"]);

// Never useful for moving forward: error summaries ("Error - Phone Number") only scroll to a field,
// "Back" undoes progress, "Skip to main content" is an accessibility shortcut, and policy links leave the form.
const NOT_FORWARD =
  /^(errors?|alerts?)\b|errors and alerts found|^back$|back to job posting|skip to main content|privacy|terms of (use|service)|cookie/i;

/**
 * Which elements each target question may choose from. Forbidden and trap elements never appear,
 * nor optional fields already skipped for lack of an answer.
 */
export function candidates(page: PageSnapshot, skipped: Set<string> = new Set()) {
  const usable = page.fields.filter(actionable);
  return {
    click: usable.filter((f) => CLICKABLE.has(f.kind) && !forbiddenClick(f, page) && !NOT_FORWARD.test(f.label)),
    fill: usable.filter((f) => TYPEABLE.has(f.kind) && !skipped.has(f.label)),
    upload: page.fields.filter((f) => f.kind === "file" && !f.honeypot), // file inputs are hidden by design
  };
}

/** One element as Jev sees it: `button "Apply Manually"`, `text "Email Address*" required empty`. */
export function describe(f: FormField): string {
  const label = f.question && f.question !== f.label ? `${f.question} > ${f.label}` : f.label;
  const parts = [`${f.kind} "${label.slice(0, 120)}"`];
  if (f.required) parts.push("required");
  if (TYPEABLE.has(f.kind)) parts.push(f.value ? `value="${String(f.value).slice(0, 40)}"` : "empty");
  if (f.kind === "checkbox" || f.kind === "radio") parts.push(f.value ? "checked" : "unchecked");
  if (f.kind === "dropdown")
    parts.push(`shows "${String(f.value ?? "").slice(0, 40)}"`, ...(f.expanded ? ["OPEN: pick an option"] : []));
  if (f.invalid) parts.push("INVALID");
  return parts.join(" ");
}

export interface Decision {
  operation: Operation;
  target: FormField | null; // the element for CLICK / FILL / UPLOAD
  confidence: number | null; // Jev's confidence in the operation
  probabilities: Record<string, number>;
  ms: number;
}

export async function decide(
  page: PageSnapshot,
  facts: Facts,
  history: string[],
  model: Experimental_EvaluationModel = decisionModel(),
  skipped: Set<string> = new Set(),
): Promise<Decision> {
  const c = candidates(page, skipped);
  const key = (f: FormField) => `e${f.idx}`;
  const options = (fields: FormField[]) => Object.fromEntries(fields.slice(0, 250).map((f) => [key(f), describe(f)]));

  // Offer only operations that are possible on this page.
  const ops = Object.fromEntries(
    Object.entries(OPERATIONS).filter(
      ([op]) =>
        (op !== "CLICK" || c.click.length) && (op !== "FILL" || c.fill.length) && (op !== "UPLOAD" || c.upload.length),
    ),
  );

  const questions: Record<string, { type: "choice"; instructions: string; criteria: Record<string, string> }> = {
    operation: {
      type: "choice",
      instructions: "Following `goal`, what should be done next on this page?",
      criteria: ops,
    },
  };
  if (c.click.length)
    questions.click = {
      type: "choice",
      instructions: "Following `goal`, which element should be clicked next to move the application forward?",
      criteria: options(c.click),
    };
  if (c.fill.length)
    questions.fill = {
      type: "choice",
      instructions: "Following `goal`, which empty field should be filled next?",
      criteria: options(c.fill),
    };
  if (c.upload.length)
    questions.upload = {
      type: "choice",
      instructions: "Which upload field asks for the resume or CV?",
      criteria: options(c.upload),
    };

  const started = Date.now();
  const result = await experimental_evaluate({
    model,
    state: {
      goal: GOAL,
      candidate: facts,
      page: {
        step: page.step ? `${page.step.index} of ${page.step.total}: ${page.step.name}` : null,
        heading: page.heading,
        errors: page.errors,
        elements: page.fields.filter(actionable).map((f) => `${key(f)} ${describe(f)}`),
      },
      recent_actions: history.slice(-8),
    },
    questions,
  });

  const choice = (id: string) => {
    const a = result.answers[id];
    return a?.type === "choice" ? a : null;
  };
  const op = choice("operation");
  const probabilities = op?.probabilities ?? {};
  const confidence = (result.providerMetadata?.typesafe?.confidence ?? {}) as Record<string, number>;
  const operation = gate((op?.choice ?? "WAIT") as Operation, confidence.operation ?? null, probabilities);
  const targetKey =
    operation === "CLICK"
      ? choice("click")?.choice
      : operation === "FILL"
        ? choice("fill")?.choice
        : operation === "UPLOAD"
          ? choice("upload")?.choice
          : undefined;

  return {
    operation,
    target: targetKey ? (page.fields.find((f) => key(f) === targetKey) ?? null) : null,
    confidence: confidence.operation ?? null,
    probabilities,
    ms: Date.now() - started,
  };
}

/** Operations that end the run. */
const STOPS: Operation[] = ["BLOCKED", "AT_REVIEW"];
export const STOP_MIN_CONFIDENCE = 0.6;

/**
 * Confidence-gated routing (a Jev pattern): a stopping answer is only accepted when Jev is
 * confident. Otherwise take the most likely operation that keeps going.
 */
export function gate(choice: Operation, confidence: number | null, probabilities: Record<string, number>): Operation {
  if (!STOPS.includes(choice) || (confidence ?? 0) >= STOP_MIN_CONFIDENCE) return choice;
  const next = Object.entries(probabilities)
    .filter(([op]) => !STOPS.includes(op as Operation))
    .sort((a, b) => b[1] - a[1])[0];
  return (next?.[0] as Operation) ?? "WAIT";
}

export const OPTION_MIN_SUPPORT = 0.7;

/**
 * Before picking a dropdown option: do the candidate facts support this answer to this question?
 * Jev's probability that they do. Below OPTION_MIN_SUPPORT the agent asks the user instead.
 */
export async function optionSupport(
  question: string,
  option: string,
  facts: Facts,
  model: Experimental_EvaluationModel = decisionModel(),
): Promise<number> {
  // An answer the user gave to this exact question (every NEEDS_INPUT answer is saved this way).
  const saved = facts.answers[question];
  if (saved !== undefined) return same(saved, option) ? 1 : 0;

  // Only the facts such questions are about: skills, projects and education are noise here, and
  // Jev's accuracy drops as irrelevant state grows.
  const relevant = {
    answers: facts.answers,
    past_employers: facts.past_employers,
    applying_to: facts.applying_to,
    has_worked_at_applying_company: facts.has_worked_at_applying_company,
    address: facts.address,
    phone_country_code: facts.phone_country_code,
    current_title: facts.current_title,
    current_company: facts.current_company,
  };
  const result = await experimental_evaluate({
    model,
    state: { form_question: question, option, candidate: relevant },
    questions: {
      supported: {
        type: "boolean",
        instructions: "Do the candidate facts say that `option` is the candidate's answer to `form_question`?",
        criteria: {
          true:
            "The facts state this answer, or something that clearly means it (e.g. country India -> 'India'). " +
            "Facts about 'this company' refer to the company the candidate is applying to. " +
            "'Worked here before?' is answered by past_employers: if neither this company nor any company the question names is there, the answer is No.",
          false: "The facts do not mention this, so choosing it would be a guess (e.g. how they heard about the job).",
        },
      },
    },
  });
  const a = result.answers.supported;
  return a?.type === "boolean" ? a.probability : 0;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
