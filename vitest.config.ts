import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests never touch the real data/ folder.
    env: { DATA_DIR: mkdtempSync(join(tmpdir(), "autoapply-test-")) },
    testTimeout: 60_000, // the workflow test starts Temporal's test server
  },
});
