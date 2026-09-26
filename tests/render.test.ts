import { expect, it } from "vitest";

import { resumeHtml } from "../src/resume/template.ts";
import { SAMPLE_RESUME } from "./mocks.ts";

it("renders every section with the resume's own text", () => {
  const html = resumeHtml(SAMPLE_RESUME);
  for (const text of [
    "Asha Rao",
    "asha@example.com",
    "SRE</b>, Acme",
    "Ran Ceph clusters",
    "2021 – Present",
    "Python, Ceph",
  ]) {
    expect(html).toContain(text);
  }
  expect(html).not.toContain("<h2>Projects</h2>"); // empty sections are left out
});

it("escapes HTML in resume text", () => {
  const html = resumeHtml({ ...SAMPLE_RESUME, name: `<script>alert("x")</script> & Co` });
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co");
});
