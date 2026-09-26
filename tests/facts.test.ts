import { describe, expect, it } from "vitest";

import { optionSupport } from "../src/apply/decide.ts";
import { buildFacts } from "../src/apply/facts.ts";
import { sameCompany } from "../src/lib/company.ts";
import { nameCase, splitPhone } from "../src/lib/person.ts";
import { EMPTY_PROFILE } from "../src/schemas/index.ts";
import { SAMPLE_RESUME } from "./mocks.ts";

describe("splitPhone", () => {
  it.each([
    ["+91-9876543210", null, { code: "+91", number: "9876543210" }],
    ["+91 98765 43210", null, { code: "+91", number: "9876543210" }],
    ["+1 (415) 555-0100", null, { code: "+1", number: "4155550100" }],
    ["98765 43210", "+91", { code: "+91", number: "9876543210" }], // code from the profile
    ["+919876543210", "+91", { code: "+91", number: "9876543210" }],
    ["9876543210", null, { code: null, number: "9876543210" }], // unknown code: ask, don't guess
    [null, "+91", { code: "+91", number: null }],
  ] as const)("%s (profile code %s)", (raw, code, expected) => {
    expect(splitPhone(raw, code)).toEqual(expected);
  });
});

it.each([
  ["DEEPAK", "Deepak"],
  ["S", "S"],
  ["McDonald", "McDonald"],
  ["o'brien", "o'brien"],
])("nameCase(%s) = %s", (input, expected) => expect(nameCase(input)).toBe(expected));

it("buildFacts: names in form wording, never the password itself", () => {
  const facts = buildFacts({ ...SAMPLE_RESUME, name: "ASHA RAO", phone: "+91-9000000000" }, EMPTY_PROFILE, "a@x.com");
  expect(facts).toMatchObject({
    given_name_first_name: "Asha",
    family_name_last_name_surname: "Rao",
    phone_country_code: "+91",
    phone_number: "9000000000",
  });
  expect(facts.password).toMatch(/typed by the system/);
});

describe("optionSupport with a saved answer", () => {
  const facts = buildFacts(
    SAMPLE_RESUME,
    { ...EMPTY_PROFILE, answers: { "Do you have a PAN number?*": "Yes" } },
    "a@x.com",
  );
  const noModel = "must-not-be-called" as never; // a real call would fail on this

  it("accepts the saved option and rejects others, without asking the model", async () => {
    expect(await optionSupport("Do you have a PAN number?*", "yes", facts, noModel)).toBe(1);
    expect(await optionSupport("Do you have a PAN number?*", "No", facts, noModel)).toBe(0);
  });
});

describe("worked at the company before?", () => {
  it.each([
    ["KaptureCX", "Kapture CX Pvt Ltd", true],
    ["LNW India Solutions Private Limited", "lnw", true],
    ["Worldpay India Pte Ltd", "Worldpay", true],
    ["KaptureCX", "LNW India Solutions Private Limited", false],
    ["Yectra Technologies", "Guidewire Software Solutions India Private Limited", false],
    ["Acme", "", false],
  ])("sameCompany(%s, %s) = %s", (a, b, expected) => expect(sameCompany(a, b)).toBe(expected));

  it("answers from the resume's employers", () => {
    const facts = (company: string, tenant?: string) =>
      buildFacts(SAMPLE_RESUME, EMPTY_PROFILE, "a@x.com", { company, tenant });
    expect(facts("LNW India Solutions Private Limited", "lnw")).toMatchObject({
      past_employers: ["Acme"],
      has_worked_at_applying_company: "No",
    });
    expect(facts("Acme Corp").has_worked_at_applying_company).toBe("Yes");
    expect(buildFacts(SAMPLE_RESUME, EMPTY_PROFILE, "a@x.com").has_worked_at_applying_company).toBeNull();
  });
});
