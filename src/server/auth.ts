/**
 * Sign-in with Google, and the session cookie that follows it.
 *
 * The browser gets an ID token from Google's "Sign in with Google" button. We check it (signed by
 * Google, issued for our client ID, not expired, email verified) and set a signed session cookie.
 * Only the client ID is needed: no client secret, since we never call Google APIs for the user.
 *
 * Without a client ID (local development) there is one local user, signed in with a click.
 */

import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { Identity } from "../store/store.ts";

export interface AuthConfig {
  /** Google OAuth client ID. Unset: local development, one local user. */
  googleClientId?: string;
  /** Signs the session cookie. */
  sessionSecret: string;
  /** Send the cookie over HTTPS only (true when deployed). */
  secureCookies: boolean;
  /** Checks a Google ID token. Replaced in tests. */
  verifyGoogle?: (credential: string, clientId: string) => Promise<Identity>;
}

export const LOCAL_IDENTITY: Identity = { sub: "local", email: "you@localhost", name: "You", picture: null };

const COOKIE = "aa_session";
const SESSION_DAYS = 30;

const GOOGLE_KEYS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export async function verifyGoogleIdToken(credential: string, clientId: string): Promise<Identity> {
  const { payload } = await jwtVerify(credential, GOOGLE_KEYS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });
  if (typeof payload.sub !== "string" || typeof payload.email !== "string" || payload.email_verified !== true) {
    throw new Error("Google account has no verified email");
  }
  const text = (v: unknown) => (typeof v === "string" && v ? v : null);
  return { sub: payload.sub, email: payload.email, name: text(payload.name), picture: text(payload.picture) };
}

/** Start a session for `userId`. The cookie holds the user id and an expiry, signed so it can't be forged. */
export async function startSession(c: Context, userId: string, config: AuthConfig): Promise<void> {
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await setSignedCookie(c, COOKIE, `${userId}.${expires}`, config.sessionSecret, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

/** The signed-in user's id, or null. */
export async function sessionUser(c: Context, config: AuthConfig): Promise<string | null> {
  const value = await getSignedCookie(c, config.sessionSecret, COOKIE);
  if (!value) return null;
  const [userId, expires] = value.split(".");
  return userId && Number(expires) > Date.now() ? userId : null;
}

export function endSession(c: Context, config: AuthConfig): void {
  deleteCookie(c, COOKIE, { path: "/", secure: config.secureCookies });
}
