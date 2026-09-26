/**
 * What a model reading a PDF page can't see reliably, read from the PDF itself:
 *   links  the real URLs behind "LinkedIn" or "GitHub" (they're in the link annotations)
 *   text   the exact text, line by line, so wording and punctuation are copied, not re-read
 *   bold   the runs of text set in a bold font
 *   page   the paper size
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";

export interface PdfLink {
  text: string; // the words under the link, e.g. "GitHub"
  line: string; // the whole line it is on, e.g. "Actbrow – Production AI Agent Platform | Live | GitHub"
  url: string;
}

type Rect = [number, number, number, number]; // x1, y1, x2, y2 (PDF units, origin bottom-left)

export type PageSize = "a4" | "letter";

/** A run of bold text, and the line it was printed on (to tell which bullet it belongs to). */
export interface BoldRun {
  text: string;
  line: string;
}

export interface PdfInfo {
  links: PdfLink[];
  text: string;
  bold: BoldRun[];
  page: PageSize;
}

// Bold faces: "…-Bold", "…BoldItalic", Computer Modern's CMBX (bold extended), "Semibold", "Heavy", "Black".
const BOLD_FONT = /bold|black|heavy|semibold|demi|cmbx|\+cmb/i;

export async function readPdfInfo(pdf: Uint8Array): Promise<PdfInfo> {
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  const doc = await task.promise;
  const links: PdfLink[] = [];
  const lines: string[] = [];
  const bold: BoldRun[] = [];
  let size: PageSize = "a4";
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      if (p === 1) size = closestSize(page.view);
      const annotations = (await page.getAnnotations()) as { subtype: string; url?: string; rect: Rect }[];
      await page.getOperatorList(); // loads the page's fonts, so their names can be read
      const items = (await page.getTextContent()).items.filter((i): i is TextItem => "str" in i && !!i.str.trim()); // transform: [a, b, c, d, x, y]
      const fontName = (i: TextItem) => {
        try {
          return (page.commonObjs.get(i.fontName) as { name?: string } | undefined)?.name ?? "";
        } catch {
          return "";
        }
      };
      for (const line of textLines(items)) {
        const lineText = line
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        lines.push(lineText);
        // Consecutive bold items on a line form one run ("OpenAPI-to-MCP tool generation").
        let run: string[] = [];
        for (const i of [...line, null]) {
          if (i && BOLD_FONT.test(fontName(i))) run.push(i.str);
          else if (run.length) {
            bold.push({ text: run.join(" ").replace(/\s+/g, " ").trim(), line: lineText });
            run = [];
          }
        }
      }
      for (const a of annotations) {
        if (a.subtype !== "Link" || !a.url) continue;
        // Link boxes can be taller than their text: keep the line closest to the box's centre.
        const centre = (a.rect[1] + a.rect[3]) / 2;
        const touching = items.filter((i) => overlaps(box(i), a.rect));
        const closest = touching.sort((l, r) => distance(l, centre) - distance(r, centre))[0];
        const baseline = closest?.transform[5] ?? a.rect[1];
        const under = touching.filter((i) => Math.abs(i.transform[5]! - baseline) < 2);
        // Separators printed with the linked word ("| Live") are not part of it.
        const text = under
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .replace(/^[\s|·•,;]+|[\s|·•,;]+$/g, "");
        const line = items
          .filter((i) => Math.abs(i.transform[5]! - baseline) < 2)
          .sort((l, r) => l.transform[4]! - r.transform[4]!)
          .map((i) => i.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        links.push({ text: text || a.url, line, url: a.url });
      }
    }
  } finally {
    await task.destroy();
  }
  return { links, text: lines.filter(Boolean).join("\n"), bold: bold.filter((b) => b.text), page: size };
}

/** Text items grouped into lines (same baseline), top to bottom, each left to right. */
function textLines(items: TextItem[]): TextItem[][] {
  const lines: TextItem[][] = [];
  for (const item of [...items].sort(
    (a, b) => b.transform[5]! - a.transform[5]! || a.transform[4]! - b.transform[4]!,
  )) {
    const last = lines.at(-1);
    if (last && Math.abs(last[0]!.transform[5]! - item.transform[5]!) < 2) last.push(item);
    else lines.push([item]);
  }
  return lines.map((l) => l.sort((a, b) => a.transform[4]! - b.transform[4]!));
}

/** US Letter is 612 × 792 points, A4 595 × 842: whichever the page's height is nearer to. */
function closestSize(view: number[]): PageSize {
  const height = Math.abs(view[3]! - view[1]!);
  return Math.abs(height - 792) < Math.abs(height - 842) ? "letter" : "a4";
}

const distance = (i: TextItem, y: number) => Math.abs(i.transform[5]! + i.height / 2 - y);

const box = (i: TextItem): Rect => {
  const [x, y] = [i.transform[4]!, i.transform[5]!];
  return [x, y, x + i.width, y + i.height];
};

/** Text under a link: its vertical centre is inside the link box, and half its width overlaps it. */
function overlaps(t: Rect, a: Rect): boolean {
  const width = Math.min(t[2], a[2]) - Math.max(t[0], a[0]);
  const middle = (t[1] + t[3]) / 2;
  return width > 0.5 * Math.min(t[2] - t[0], a[2] - a[0]) && middle > a[1] && middle < a[3];
}
