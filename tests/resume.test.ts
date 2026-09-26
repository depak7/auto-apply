/**
 * Offline: a mock model stands in for Gemini, so this checks our wiring, not the model's quality.
 */

import { describe, expect, it } from "vitest";

import { parseResume } from "../src/resume/parse.ts";
import { mockTextModel as mockModel, SAMPLE_RESUME as RESUME } from "./mocks.ts";

const fakePdf = () => Buffer.from("%PDF-1.4 fake");

describe("parseResume", () => {
  it("sends the PDF as a file and returns the validated Resume", async () => {
    const model = mockModel(JSON.stringify(RESUME));
    const resume = await parseResume(fakePdf(), model);

    expect(resume).toEqual(RESUME);
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
