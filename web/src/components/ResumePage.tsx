// A resume page exactly as the PDF prints it: the same HTML template, at A4 size, scaled to fitToWidth
// the available width. Rendered in a sandboxed frame so the page's styles and the app's never mix.

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";

import { PAGE } from "../../../src/resume/template.ts";

export interface ResumePageHandle {
  /** Scroll so change `n` is in view, and flash it. */
  show(n: number): void;
}

export const ResumePage = forwardRef<ResumePageHandle, { html: string; maxScale?: number; label?: string }>(
  function ResumePage({ html, maxScale = 1, label }, ref) {
    const box = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const [scale, setScale] = useState(1);
    const [height, setHeight] = useState(PAGE.heightPx);

    // Fit the A4 width into the column.
    useLayoutEffect(() => {
      const el = box.current;
      if (!el) return;
      const fitToWidth = () => setScale(Math.min(maxScale, el.clientWidth / PAGE.widthPx));
      fitToWidth();
      const observer = new ResizeObserver(fitToWidth);
      observer.observe(el);
      return () => observer.disconnect();
    }, [maxScale]);

    // The frame is as tall as its content: no inner scrollbar.
    // biome-ignore lint/correctness/useExhaustiveDependencies: a new `html` reloads the frame, which must be re-measured
    useEffect(() => {
      const f = frame.current;
      if (!f) return;
      const measure = () => setHeight(Math.max(PAGE.heightPx, f.contentDocument?.documentElement.scrollHeight ?? 0));
      f.addEventListener("load", measure);
      return () => f.removeEventListener("load", measure);
    }, [html]);

    useImperativeHandle(ref, () => ({
      show(n) {
        const doc = frame.current?.contentDocument;
        const badge = doc?.getElementById(`c${n}`);
        if (!badge || !box.current) return;
        const top =
          box.current.getBoundingClientRect().top + window.scrollY + badge.getBoundingClientRect().top * scale;
        window.scrollTo({ top: top - 160, behavior: "smooth" });
        const line = badge.parentElement!;
        line.classList.remove("flash");
        void line.offsetWidth; // restart the animation
        line.classList.add("flash");
      },
    }));

    return (
      <div ref={box} className="w-full">
        {label && <div className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</div>}
        <div
          className="mx-auto overflow-hidden rounded-sm bg-white shadow-[0_1px_3px_rgba(0,0,0,0.1),0_12px_32px_-12px_rgba(0,0,0,0.18)] ring-1 ring-zinc-200"
          style={{ width: PAGE.widthPx * scale, height: height * scale }}
        >
          <iframe
            ref={frame}
            title={label ?? "Resume"}
            srcDoc={html}
            sandbox="allow-same-origin"
            scrolling="no"
            style={{
              width: PAGE.widthPx,
              height,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              border: 0,
              display: "block",
            }}
          />
        </div>
      </div>
    );
  },
);
