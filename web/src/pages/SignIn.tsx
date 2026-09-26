// The front door: Google sign-in, or a one-click local sign-in in development.

import { useEffect, useRef, useState } from "react";

import { ApiError, api } from "../api.ts";
import { Button, Card, Notice, Spinner } from "../components/ui.tsx";
import { useData } from "../hooks.ts";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
          renderButton(element: HTMLElement, options: Record<string, unknown>): void;
        };
      };
    };
  }
}

const GOOGLE_SCRIPT = "https://accounts.google.com/gsi/client";

export function SignInPage({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const config = useData(api.authConfig, "auth-config");
  const [error, setError] = useState<string | null>(null);

  async function run(signIn: () => Promise<unknown>) {
    setError(null);
    try {
      await signIn();
      await onSignedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't sign you in. Try again.");
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50/60 to-zinc-50 px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-9" />
          <span className="text-xl font-semibold tracking-tight">AutoApply</span>
        </div>
        <Card className="p-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Apply to Workday jobs, tailored</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-zinc-500">
            We tailor your resume to each job, show you every change, fill in the application, and submit only when you
            say so.
          </p>
          <div className="mt-8 flex min-h-11 justify-center">
            {!config.data ? (
              <Spinner className="size-5 text-zinc-400" />
            ) : config.data.googleClientId ? (
              <GoogleButton
                clientId={config.data.googleClientId}
                onCredential={(credential) => run(() => api.signInWithGoogle(credential))}
              />
            ) : (
              <Button onClick={() => run(api.signInLocally)}>Continue (local development)</Button>
            )}
          </div>
          {error && (
            <div className="mt-4 text-left">
              <Notice>{error}</Notice>
            </div>
          )}
        </Card>
        <p className="mt-6 text-center text-xs leading-relaxed text-zinc-400">
          Your Workday password is encrypted and is never shown to an AI model.
        </p>
      </div>
    </div>
  );
}

function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (credential: string) => void }) {
  const holder = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const render = () => {
      if (!window.google || !holder.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => callback.current(r.credential) });
      window.google.accounts.id.renderButton(holder.current, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 300,
      });
    };
    if (window.google) return render();
    let script = document.querySelector<HTMLScriptElement>(`script[src="${GOOGLE_SCRIPT}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = GOOGLE_SCRIPT;
      script.async = true;
      document.head.appendChild(script);
    }
    const fail = () => setFailed(true);
    script.addEventListener("load", render);
    script.addEventListener("error", fail);
    return () => {
      script.removeEventListener("load", render);
      script.removeEventListener("error", fail);
    };
  }, [clientId]);

  if (failed) return <Notice>Couldn't load Google sign-in. Check your connection or content blocker.</Notice>;
  return <div ref={holder} />;
}
