import { expect, it } from "vitest";

import { htmlToText } from "../src/lib/html.ts";

it("keeps paragraphs and bullets, decodes entities, drops empty bullets", () => {
  const html = "<p>About us&nbsp;&amp; you</p><ul><li>Python</li><li> <b>Go</b> </li><li></li></ul><p>Apply!</p>";
  expect(htmlToText(html)).toBe("About us & you\n\n- Python\n- Go\n\nApply!");
});

it("keeps bullet text on its line when Workday wraps it in <p>", () => {
  expect(htmlToText("<ul><li><p>One</p></li><li><p>Two</p></li></ul>")).toBe("- One\n- Two");
});
