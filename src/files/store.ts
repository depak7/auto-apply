/**
 * Where files live: uploaded resumes, tailored PDFs, screenshots, and agent traces. Files are
 * addressed by key (e.g. `applications/<id>/resume.pdf`); the database stores keys, not paths.
 *
 *   Vercel Blob (private store)  when BLOB_READ_WRITE_TOKEN is set; shared by every process
 *   Local disk (DATA_DIR/files)  otherwise, for development on one machine
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { get, put } from "@vercel/blob";

export interface FileStore {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** The file's bytes, or null if there is no file with that key. */
  get(key: string): Promise<Buffer | null>;
}

/** Keys must stay inside the store: no absolute paths, no "..". */
function checkKey(key: string): string {
  const clean = normalize(key);
  if (clean.startsWith("/") || clean.startsWith("..") || clean.includes("\0"))
    throw new Error(`Invalid file key: ${key}`);
  return clean;
}

export class LocalFileStore implements FileStore {
  constructor(private readonly root: string) {}

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const path = join(this.root, checkKey(key));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(join(this.root, checkKey(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

export class BlobFileStore implements FileStore {
  constructor(private readonly token: string) {}

  async put(key: string, data: Buffer, contentType: string): Promise<void> {
    // Keys are chosen by the app, so the same key replaces the file (e.g. the latest screenshot).
    await put(checkKey(key), data, { access: "private", contentType, allowOverwrite: true, token: this.token });
  }

  async get(key: string): Promise<Buffer | null> {
    // useCache: false, so a replaced file is read at once rather than after the CDN refreshes.
    const result = await get(checkKey(key), { access: "private", token: this.token, useCache: false });
    if (result?.statusCode !== 200 || !result.stream) return null;
    return Buffer.from(await new Response(result.stream).arrayBuffer());
  }
}

/** Keeps files in memory. For tests. */
export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Buffer>();

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    this.files.set(checkKey(key), data);
  }

  async get(key: string): Promise<Buffer | null> {
    return this.files.get(checkKey(key)) ?? null;
  }
}

/** The file store the environment asks for. */
export function openFileStore(env: Record<string, string | undefined>, dataDir: string): FileStore {
  return env.BLOB_READ_WRITE_TOKEN
    ? new BlobFileStore(env.BLOB_READ_WRITE_TOKEN)
    : new LocalFileStore(join(dataDir, "files"));
}

/** File keys, in one place so every process names files the same way. */
export const fileKeys = {
  uploadedResume: (uuid: string) => `resumes/${uuid}.pdf`,
  tailoredResume: (applicationId: string) => `applications/${applicationId}/resume.pdf`,
  screenshot: (applicationId: string, name = "last") => `applications/${applicationId}/${name}.png`,
  trace: (applicationId: string, at: number) => `applications/${applicationId}/traces/${at}.json`,
};
