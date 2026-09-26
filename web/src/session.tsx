// Who is signed in. Loaded once; pages read it with useSession().

import { createContext, type ReactNode, useContext } from "react";

import { ApiError, api, type Me } from "./api.ts";
import { useData } from "./hooks.ts";

interface Session {
  me: Me;
  /** Reload the user (e.g. after saving the Workday login). */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession outside <SessionProvider>");
  return session;
}

/** Renders `children` for a signed-in user, `signIn` otherwise. */
export function SessionProvider({
  children,
  signIn,
  loading,
}: {
  children: ReactNode;
  signIn: (onSignedIn: () => Promise<void>) => ReactNode;
  loading: ReactNode;
}) {
  const me = useData(api.me, "me");
  if (me.error instanceof ApiError && me.error.status === 401) return signIn(me.refresh);
  if (!me.data) return loading;

  const session: Session = {
    me: me.data,
    refresh: me.refresh,
    signOut: async () => {
      await api.signOut();
      window.location.assign("/");
    },
  };
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
