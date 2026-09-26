/**
 * Read the current page into typed objects, using snapshot.js.
 */

import { readFileSync } from "node:fs";
import type { Page } from "playwright";

// snapshot.js holds one arrow function. It's wrapped as `(fn)()` so evaluate() calls it; a trailing
// semicolon (added by formatters) is removed first, since `(fn;)()` is not valid JavaScript.
const SNAPSHOT_SOURCE = readFileSync(new URL("./snapshot.js", import.meta.url), "utf8")
  .trim()
  .replace(/;$/, "");
const SNAPSHOT_JS = `(${SNAPSHOT_SOURCE})()`;

export interface FormField {
  idx: number; // matches data-aa-idx on the element
  kind: string; // text, email, tel, password, select, dropdown, checkbox, radio, file, textarea, button, link, option...
  label: string;
  automationId: string | null; // Workday's data-automation-id, the key for WORKDAY_MAP later
  fieldWrapper: string | null; // e.g. "formField-legalNameSection_firstName"
  question: string | null; // for radios/checkboxes: the question; label is the option
  name: string | null;
  required: boolean;
  options: string[] | null;
  value: unknown;
  disabled: boolean;
  invalid: boolean; // Workday marked it (aria-invalid) after a failed Save and Continue
  expanded: boolean; // a dropdown whose option list is open
  honeypot: boolean; // a bot trap: must never be filled
  chrome: boolean; // in the page header/footer/nav, not the application itself
}

/** Where we are in Workday's application, from its progress bar. */
export interface Step {
  index: number; // 1-based
  total: number;
  name: string; // "Create Account/Sign In", "My Information", ..., "Review"
}

export interface PageSnapshot {
  url: string;
  title: string;
  heading: string;
  step: Step | null; // null outside the application flow (e.g. the job page)
  errors: string[]; // error messages shown on the page
  fields: FormField[];
}

export async function readPage(page: Page): Promise<PageSnapshot> {
  return page.evaluate(SNAPSHOT_JS) as Promise<PageSnapshot>;
}

/** Something the user fills in, as opposed to a navigation/action button. */
export const isInput = (f: FormField) => !["button", "link", "option"].includes(f.kind);
