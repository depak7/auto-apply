/**
 * Offline: a mock model stands in for Gemini, so this checks our wiring, not the model's quality.
 */

import { describe, expect, it } from "vitest";

import { applyBold, fixLayout, mergeLeadIns, parseResume } from "../src/resume/parse.ts";
import { renderResumePdf } from "../src/resume/pdf.ts";
import { readPdfInfo } from "../src/resume/pdf-info.ts";
import { LAID_OUT, mockTextModel as mockModel, SAMPLE_RESUME as RESUME } from "./mocks.ts";

const fakePdf = () => Buffer.from("%PDF-1.4 fake");

describe("parseResume", () => {
  it("sends the PDF as a file and returns the validated Resume, with links and skills derived", async () => {
    const { links, skills, ...extracted } = RESUME;
    const reply = {
      ...extracted,
      contactLinks: [{ label: "GitHub", url: "https://github.com/asha" }],
      skillGroups: [{ label: null, items: ["Python", "Ceph"] }],
    };
    const model = mockModel(JSON.stringify(reply));
    const resume = await parseResume(fakePdf(), model);

    expect(resume).toEqual({ ...RESUME, ...reply, links, skills });
    const [call] = model.doGenerateCalls;
    const user = call!.prompt.find((m) => m.role === "user")!;
    expect(JSON.stringify(user.content)).toContain("application/pdf");
    expect(call!.responseFormat?.type).toBe("json"); // structured output was requested
  });

  it("rejects a reply that does not match the schema", async () => {
    await expect(parseResume(fakePdf(), mockModel('{"name": "only a name"}'))).rejects.toThrow();
  });

  it("rejects non-PDF files", async () => {
    await expect(parseResume(Buffer.from("PK\x03\x04 docx"), mockModel("{}"))).rejects.toThrow("Expected a PDF");
  });
});

describe("reading the PDF itself", () => {
  it("finds the real link URLs, bold runs, and paper size", async () => {
    const info = await readPdfInfo(await renderResumePdf(LAID_OUT));
    expect(info.page).toBe("letter");
    expect(info.links.map((l) => l.url)).toEqual(
      expect.arrayContaining(["https://github.com/asha", "https://stor.dev/", "mailto:asha@example.com"]),
    );
    expect(info.links.find((l) => l.url === "https://stor.dev/")?.text).toBe("Live");
    expect(info.bold.map((b) => b.text)).toEqual(expect.arrayContaining(["Ceph", "Hackathon — 1st:"]));
    expect(info.text).toContain("Achievements & Open Source");
  }, 30_000);

  it("gives each entry only the bold runs printed on its own lines", () => {
    const r = {
      experience: [{ ...LAID_OUT.experience[0]!, bullets: ["Ran Ceph clusters"], bold: [] }],
      projects: [{ ...LAID_OUT.projects[0]!, bullets: ["Used Ceph too"], bold: [] }],
      sections: [],
    };
    const out = applyBold(r, [{ text: "Ceph", line: "• Ran Ceph clusters" }]);
    expect(out.experience[0]!.bold).toEqual(["Ceph"]);
    expect(out.projects[0]!.bold).toEqual([]); // "Ceph" isn't bold on the project's line
  });

  it("puts a bold lead-in the model split off back into its bullet", () => {
    const r = {
      sections: [
        {
          title: "Achievements",
          entries: [
            {
              heading: "Hackathon — 1st",
              subheading: null,
              date: null,
              location: null,
              bullets: ["Won the finals"],
              bold: [],
            },
          ],
        },
      ],
    };
    const out = mergeLeadIns(r, "Achievements\n• Hackathon — 1st: Won the finals");
    expect(out.sections[0]!.entries[0]).toMatchObject({ heading: null, bullets: ["Hackathon — 1st: Won the finals"] });
  });

  it("recognizes a standard section the model labelled as 'other'", () => {
    const layout = fixLayout({
      layout: [
        { kind: "other", title: "Technical Skills" },
        { kind: "other", title: "Achievements" },
      ],
      sections: [{ title: "Achievements", entries: [] }],
    });
    expect(layout.map((l) => l.kind)).toEqual(["skills", "other"]);
  });
});
