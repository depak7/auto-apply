/**
 * How to reach Temporal: the local development server, or Temporal Cloud. Settings use
 * Temporal's standard environment variables:
 *
 *   TEMPORAL_ADDRESS    localhost:7233 (default), or <namespace>.<account>.tmprl.cloud:7233
 *   TEMPORAL_NAMESPACE  "default" (default), or <namespace>.<account> on Temporal Cloud
 *   TEMPORAL_API_KEY    API key authentication (Temporal Cloud)
 *   TEMPORAL_TLS_CLIENT_CERT_PATH / TEMPORAL_TLS_CLIENT_KEY_PATH   mTLS, as files
 *   TEMPORAL_TLS_CLIENT_CERT_DATA / TEMPORAL_TLS_CLIENT_KEY_DATA   mTLS, as PEM text (e.g. on Heroku)
 *
 * The same settings serve the API's client and both workers.
 */

import { readFileSync } from "node:fs";

export interface TemporalSettings {
  address: string;
  namespace: string;
  /** Present for Temporal Cloud: TLS on, authenticated by API key or client certificate. */
  tls?: true | { clientCertPair: { crt: Buffer; key: Buffer } };
  apiKey?: string;
  /** For logs: where we connect and how, without secrets. */
  description: string;
}

type Env = Record<string, string | undefined>;

const CLOUD_HOST = /\.(tmprl\.cloud|api\.temporal\.io)(:\d+)?$/;

export function temporalSettings(env: Env = process.env): TemporalSettings {
  const address = env.TEMPORAL_ADDRESS?.trim() || "localhost:7233";
  const namespace = env.TEMPORAL_NAMESPACE?.trim() || "default";
  const apiKey = env.TEMPORAL_API_KEY?.trim() || undefined;
  const cert = pem(env.TEMPORAL_TLS_CLIENT_CERT_DATA, env.TEMPORAL_TLS_CLIENT_CERT_PATH);
  const key = pem(env.TEMPORAL_TLS_CLIENT_KEY_DATA, env.TEMPORAL_TLS_CLIENT_KEY_PATH);

  if (apiKey && (cert || key)) {
    throw new Error("Set either TEMPORAL_API_KEY or a TLS client certificate for Temporal, not both");
  }
  if (!cert !== !key) {
    throw new Error("A Temporal TLS client certificate needs both the certificate and the key");
  }
  if (apiKey) return { address, namespace, tls: true, apiKey, description: `${address} (${namespace}, API key)` };
  if (cert && key) {
    return {
      address,
      namespace,
      tls: { clientCertPair: { crt: cert, key } },
      description: `${address} (${namespace}, mTLS)`,
    };
  }
  if (CLOUD_HOST.test(address)) {
    throw new Error(
      `${address} is Temporal Cloud: set TEMPORAL_API_KEY (or TEMPORAL_TLS_CLIENT_CERT_* and _KEY_*) and TEMPORAL_NAMESPACE`,
    );
  }
  return { address, namespace, description: `${address} (${namespace})` };
}

/** PEM from inline text, or else from a file path. */
function pem(data: string | undefined, path: string | undefined): Buffer | undefined {
  if (data) return Buffer.from(data.replace(/\\n/g, "\n")); // env vars often carry "\n" escapes
  if (path) return readFileSync(path);
  return undefined;
}

/** Options for `Connection.connect` / `NativeConnection.connect`. */
export const connectionOptions = ({ address, tls, apiKey }: TemporalSettings) => ({ address, tls, apiKey });
