/**
 * Encrypting secrets at rest (users' Workday passwords) with AES-256-GCM.
 * Sealed format: "v1.<iv>.<tag>.<ciphertext>", each part base64url.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretBox {
  private readonly key: Buffer;

  /** `key`: 32 bytes, base64-encoded (e.g. `openssl rand -base64 32`). */
  constructor(key: string) {
    this.key = Buffer.from(key, "base64");
    if (this.key.length !== 32) throw new Error("The encryption key must be 32 bytes, base64-encoded");
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
      .join(".");
  }

  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split(".");
    if (version !== "v1" || !iv || !tag || data === undefined) throw new Error("Not a sealed secret");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }
}
