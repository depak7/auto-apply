// The resume's typeface, served with the UI so the review page matches the PDF.

import italic from "../../src/resume/fonts/cmu-serif-500-italic.woff2?url";
import regular from "../../src/resume/fonts/cmu-serif-500-roman.woff2?url";
import boldItalic from "../../src/resume/fonts/cmu-serif-700-italic.woff2?url";
import bold from "../../src/resume/fonts/cmu-serif-700-roman.woff2?url";
import type { Fonts } from "../../src/resume/template.ts";

export const RESUME_FONTS: Fonts = { regular, italic, bold, boldItalic };
