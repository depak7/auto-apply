/**
 * Chromium flags for small containers: /dev/shm is tiny there and there is no GPU. Site isolation
 * is off, so cross-site frames (captcha, analytics) share one renderer instead of starting their own.
 */
export const LAUNCH_ARGS = [
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-features=site-per-process,IsolateOrigins,Translate,MediaRouter,OptimizationHints",
  "--renderer-process-limit=2",
  "--disable-extensions",
  "--disable-background-networking",
];

/** What the form agent never needs, and skipping saves memory: pictures, video, and web fonts. */
export const SKIPPED_RESOURCES = new Set(["image", "media", "font"]);
