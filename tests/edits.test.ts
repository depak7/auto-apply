import { describe, expect, it } from "vitest";

import { diffResumes, editableLines, getText, isReorderOnly, setText } from "../src/resume/edits.ts";
import { SAMPLE_RESUME } from "./mocks.ts";

describe("editable paths", () => {
  it("lists bullets and skills, never company, title, dates or education", () => {
    expect(editableLines(SAMPLE_RESUME)).toEqual([
      { path: "experience.0.bullets.0", text: "Ran Ceph clusters" },
      { path: "skills", text: "Python, Ceph" },
    ]);
  });

  it.each(["experience.0.company", "education.0.school", "experience.5.bullets.0", "summary", "nonsense"])(
    "getText(%s) is null (not editable, or missing)",
    (path) => expect(getText(SAMPLE_RESUME, path)).toBeNull(),
  );

  it("setText returns a changed copy and leaves the original alone", () => {
    const edited = setText(SAMPLE_RESUME, "experience.0.bullets.0", "Operated Ceph clusters");
    expect(getText(edited, "experience.0.bullets.0")).toBe("Operated Ceph clusters");
    expect(getText(SAMPLE_RESUME, "experience.0.bullets.0")).toBe("Ran Ceph clusters");
    expect(setText(SAMPLE_RESUME, "skills", "Ceph, Python").skills).toEqual(["Ceph", "Python"]);
    expect(() => setText(SAMPLE_RESUME, "experience.0.title", "CTO")).toThrow();
  });
});

describe("isReorderOnly", () => {
  it("accepts a new order of the same skills (ignoring case and spacing)", () => {
    expect(isReorderOnly("Python, Ceph, Go", "ceph,  Go, python")).toBe(true);
  });
  it("rejects an added or removed skill", () => {
    expect(isReorderOnly("Python, Ceph", "Python, Ceph, CUDA")).toBe(false);
    expect(isReorderOnly("Python, Ceph", "Python")).toBe(false);
  });
});

it("diffResumes lists only changed lines, before and after", () => {
  const edited = setText(SAMPLE_RESUME, "skills", "Ceph, Python");
  expect(diffResumes(SAMPLE_RESUME, edited)).toEqual([
    { path: "skills", before: "Python, Ceph", after: "Ceph, Python" },
  ]);
});
