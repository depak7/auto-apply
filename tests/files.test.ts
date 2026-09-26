import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { BlobFileStore, fileKeys, LocalFileStore, MemoryFileStore, openFileStore } from "../src/files/store.ts";

describe.each([
  ["local", () => new LocalFileStore(mkdtempSync(join(tmpdir(), "files-")))],
  ["memory", () => new MemoryFileStore()],
])("%s file store", (_, make) => {
  it("reads back what it stored, and replaces a file under the same key", async () => {
    const files = make();
    const key = fileKeys.screenshot("app-1");
    await files.put(key, Buffer.from("one"), "image/png");
    await files.put(key, Buffer.from("two"), "image/png");
    expect((await files.get(key))?.toString()).toBe("two");
  });

  it("returns null for a missing file", async () => {
    expect(await make().get("applications/none/resume.pdf")).toBeNull();
  });

  it("rejects keys that leave the store", async () => {
    const files = make();
    for (const key of ["../outside.pdf", "/etc/passwd", "a/../../b"]) {
      await expect(files.put(key, Buffer.from("x"), "text/plain")).rejects.toThrow("Invalid file key");
    }
  });
});

it("uses Vercel Blob when a token is set, local disk otherwise", () => {
  expect(openFileStore({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" }, "/tmp/d")).toBeInstanceOf(BlobFileStore);
  expect(openFileStore({}, "/tmp/d")).toBeInstanceOf(LocalFileStore);
});
