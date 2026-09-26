import { describe, expect, it } from "vitest";

import { connectionOptions, temporalSettings } from "../src/workflows/connection.ts";

const CLOUD = "prod.a1b2c.tmprl.cloud:7233";

describe("temporalSettings", () => {
  it("defaults to the local development server", () => {
    const s = temporalSettings({});
    expect(s).toMatchObject({ address: "localhost:7233", namespace: "default" });
    expect(s.tls).toBeUndefined();
  });

  it("uses an API key for Temporal Cloud, with TLS", () => {
    const s = temporalSettings({
      TEMPORAL_ADDRESS: CLOUD,
      TEMPORAL_NAMESPACE: "prod.a1b2c",
      TEMPORAL_API_KEY: "sk-secret-123",
    });
    expect(connectionOptions(s)).toEqual({ address: CLOUD, tls: true, apiKey: "sk-secret-123" });
    expect(s.namespace).toBe("prod.a1b2c");
    expect(s.description).not.toContain("sk-secret-123"); // never log the secret
  });

  it("uses a client certificate given as PEM text (with escaped newlines)", () => {
    const s = temporalSettings({
      TEMPORAL_ADDRESS: CLOUD,
      TEMPORAL_NAMESPACE: "prod.a1b2c",
      TEMPORAL_TLS_CLIENT_CERT_DATA: "-----BEGIN CERTIFICATE-----\\nabc",
      TEMPORAL_TLS_CLIENT_KEY_DATA: "-----BEGIN PRIVATE KEY-----\\ndef",
    });
    expect(s.tls).toEqual({
      clientCertPair: {
        crt: Buffer.from("-----BEGIN CERTIFICATE-----\nabc"),
        key: Buffer.from("-----BEGIN PRIVATE KEY-----\ndef"),
      },
    });
  });

  it("refuses a Temporal Cloud address without credentials, instead of failing later", () => {
    expect(() => temporalSettings({ TEMPORAL_ADDRESS: CLOUD })).toThrow(/Temporal Cloud: set TEMPORAL_API_KEY/);
    expect(() => temporalSettings({ TEMPORAL_ADDRESS: "us-east-1.aws.api.temporal.io:7233" })).toThrow(
      /Temporal Cloud/,
    );
  });

  it("refuses ambiguous or incomplete credentials", () => {
    expect(() =>
      temporalSettings({
        TEMPORAL_API_KEY: "k",
        TEMPORAL_TLS_CLIENT_CERT_DATA: "c",
        TEMPORAL_TLS_CLIENT_KEY_DATA: "k",
      }),
    ).toThrow(/not both/);
    expect(() => temporalSettings({ TEMPORAL_TLS_CLIENT_CERT_DATA: "c" })).toThrow(/both the certificate and the key/);
  });
});

it("ignores whitespace around Temporal settings", () => {
  const settings = temporalSettings({
    TEMPORAL_ADDRESS: "ns.acct.tmprl.cloud:7233   ",
    TEMPORAL_NAMESPACE: " ns.acct ",
    TEMPORAL_API_KEY: "key ",
  });
  expect(settings).toMatchObject({ address: "ns.acct.tmprl.cloud:7233", namespace: "ns.acct", apiKey: "key" });
});
