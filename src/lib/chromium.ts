/** Chromium flags for small containers: /dev/shm is tiny there, and there is no GPU. */
export const LAUNCH_ARGS = ["--disable-dev-shm-usage", "--disable-gpu"];
