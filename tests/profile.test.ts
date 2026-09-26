import { describe, expect, it } from "vitest";

import { SecretBox } from "../src/lib/secrets.ts";
import { fillProfileFromResume, parseLocation } from "../src/resume/profile.ts";
import { EMPTY_PROFILE } from "../src/schemas/index.ts";
import { SAMPLE_RESUME } from "./mocks.ts";

describe("fillProfileFromResume", () => {
  it("copies contact details into empty fields", () => {
    const resume = {
      ...SAMPLE_RESUME,
      name: "ASHA RAO",
      phone: "+91 98765 43210",
      location: "Bengaluru, Karnataka, India",
    };
    expect(fillProfileFromResume(EMPTY_PROFILE, resume)).toMatchObject({
      firstName: "Asha",
      lastName: "Rao",
      email: "asha@example.com",
      phone: "9876543210",
      phoneCountryCode: "+91",
      address: { city: "Bengaluru", state: "Karnataka", country: "India", line1: null, postalCode: null },
      links: ["https://github.com/asha"],
    });
  });

  it("never overwrites what the user entered", () => {
    const mine = {
      ...EMPTY_PROFILE,
      firstName: "Ash",
      phone: "111",
      address: { ...EMPTY_PROFILE.address, city: "Pune" },
    };
    const filled = fillProfileFromResume(mine, { ...SAMPLE_RESUME, phone: "+91 98765 43210" });
    expect(filled).toMatchObject({ firstName: "Ash", phone: "111", address: { city: "Pune" } });
  });
});

describe("parseLocation", () => {
  it.each([
    ["Bengaluru, Karnataka, India", { city: "Bengaluru", state: "Karnataka", country: "India" }],
    ["Pune, India", { city: "Pune", state: null, country: "India" }],
    ["Austin, TX", { city: "Austin", state: "TX", country: null }],
    ["Remote", { city: "Remote", state: null, country: null }],
    [null, { city: null, state: null, country: null }],
  ])("%s", (location, expected) => expect(parseLocation(location)).toEqual(expected));
});

describe("SecretBox", () => {
  const box = new SecretBox(Buffer.alloc(32, 3).toString("base64"));

  it("round-trips, with a fresh IV each time", () => {
    const a = box.seal("S3cret!");
    expect(a).not.toContain("S3cret");
    expect(box.seal("S3cret!")).not.toBe(a);
    expect(box.open(a)).toBe("S3cret!");
  });

  it("rejects tampering and the wrong key", () => {
    const sealed = box.seal("S3cret!");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => box.open(parts.join("."))).toThrow();
    expect(() => new SecretBox(Buffer.alloc(32, 4).toString("base64")).open(sealed)).toThrow();
    expect(() => new SecretBox("short")).toThrow("32 bytes");
  });
});
