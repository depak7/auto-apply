import { expect, it } from "vitest";

import { pageOf, resumeHtml } from "../src/resume/template.ts";
import { Resume } from "../src/schemas/index.ts";
import { LAID_OUT, SAMPLE_RESUME } from "./mocks.ts";

it("renders every section with the resume's own text", () => {
  const html = resumeHtml(SAMPLE_RESUME);
  for (const text of [
    "Asha Rao",
    "asha@example.com",
    "<b>Acme</b> | <b><i>SRE</i></b>",
    "Ran Ceph clusters",
    "2021 - Present",
    "Python, Ceph",
  ]) {
    expect(html).toContain(text);
  }
  expect(html).not.toContain("<h2>Projects</h2>"); // empty sections are left out
});

it("keeps the resume's section order and headings, including its own sections", () => {
  const html = resumeHtml(LAID_OUT);
  const order = ["Technical Skills", "Experience", "Achievements &amp; Open Source", "Projects", "Education"].map((t) =>
    html.indexOf(`<h2>${t}</h2>`),
  );
  expect(order.every((i) => i > 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(html).toContain("<b>Languages:</b> Python, Go");
  expect(html).toContain("<b>(Ceph, Python)</b>"); // the tech stack beside the title
});

it("links show their label and point at the real URL", () => {
  const html = resumeHtml(LAID_OUT);
  expect(html).toContain('<a href="https://github.com/asha">GitHub</a>');
  expect(html).toContain('<b>Stor – S3 gateway</b> | <a href="https://stor.dev/">Live</a>');
  expect(html).toContain('<a href="mailto:asha@example.com">asha@example.com</a>');
});

it("bolds the resume's bold phrases, whole words only", () => {
  const html = resumeHtml(LAID_OUT);
  expect(html).toContain("Ran <b>Ceph</b> clusters");
  expect(html).toContain("<b>Hackathon — 1st:</b> Won");
  const partial = resumeHtml(
    Resume.parse({ ...LAID_OUT, experience: [{ ...LAID_OUT.experience[0]!, bullets: ["Ran Cephalopod"] }] }),
  );
  expect(partial).not.toContain("<b>Ceph</b>alopod");
});

it("shows an all-caps name in small caps with its capitals, and uses the resume's paper size", () => {
  expect(resumeHtml(LAID_OUT)).toContain("<h1>Asha Rao</h1>");
  expect(pageOf(LAID_OUT).format).toBe("Letter");
  expect(pageOf(SAMPLE_RESUME).format).toBe("A4");
});

it("escapes HTML in resume text", () => {
  const html = resumeHtml({ ...SAMPLE_RESUME, name: `<script>alert("x")</script> & Co` });
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co");
});
