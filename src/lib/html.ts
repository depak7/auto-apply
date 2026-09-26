/**
 * Turn job-description HTML into readable plain text (paragraphs + "- " bullets).
 */

import { Parser } from "htmlparser2";

const BLOCK_TAGS = new Set(["p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "tr", "section"]);

export function htmlToText(html: string): string {
  const parts: string[] = [];
  // How many <li> we are inside. Workday wraps bullet text in <p> (<li><p>text</p></li>);
  // block tags inside a bullet must not add line breaks, or the text leaves its "- ".
  let liDepth = 0;

  const parser = new Parser({
    onopentag(tag) {
      if (tag === "li") {
        parts.push("\n- ");
        liDepth++;
      } else if (BLOCK_TAGS.has(tag) && liDepth === 0) {
        parts.push("\n");
      }
    },
    onclosetag(tag) {
      if (tag === "li") liDepth = Math.max(0, liDepth - 1);
      else if (BLOCK_TAGS.has(tag) && liDepth === 0) parts.push("\n");
    },
    ontext(text) {
      parts.push(text); // entities (&amp; &nbsp; &#39;) are already decoded
    },
  });
  parser.write(html);
  parser.end();

  return parts
    .join("")
    .replaceAll(" ", " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/^-[ \t]*\n/gm, "") // empty bullets
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
