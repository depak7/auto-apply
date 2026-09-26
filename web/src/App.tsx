import { Link, Route, Switch, useLocation } from "wouter";

import { Avatar, Button, cx, Spinner } from "./components/ui.tsx";
import { ApplicationPage } from "./pages/Application.tsx";
import { ApplicationsPage } from "./pages/Applications.tsx";
import { ProfilePage } from "./pages/Profile.tsx";
import { ResumeReviewPage } from "./pages/ResumeReview.tsx";
import { SignInPage } from "./pages/SignIn.tsx";
import { SessionProvider, useSession } from "./session.tsx";

export function App() {
  return (
    <SessionProvider
      signIn={(onSignedIn) => <SignInPage onSignedIn={onSignedIn} />}
      loading={
        <div className="flex min-h-dvh items-center justify-center text-zinc-400">
          <Spinner />
        </div>
      }
    >
      <Shell />
    </SessionProvider>
  );
}

function Shell() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="text-[15px] font-semibold tracking-tight">AutoApply</span>
          </Link>
          <div className="flex items-center gap-3">
            <nav className="flex items-center gap-1">
              <NavLink href="/">Applications</NavLink>
              <NavLink href="/profile">Profile</NavLink>
            </nav>
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Switch>
          <Route path="/" component={ApplicationsPage} />
          <Route path="/applications/:id/resume">{(p) => <ResumeReviewPage id={p.id} />}</Route>
          <Route path="/applications/:id">{(p) => <ApplicationPage id={p.id} />}</Route>
          <Route path="/profile" component={ProfilePage} />
          <Route>
            <p className="text-zinc-500">Page not found.</p>
          </Route>
        </Switch>
      </main>
    </div>
  );
}

function UserMenu() {
  const { me, signOut } = useSession();
  const name = me.user.name ?? me.user.email;
  return (
    <div className="flex items-center gap-2 border-l border-zinc-200 pl-3">
      <Link href="/profile" title={`${name} · ${me.user.email}`}>
        <Avatar name={name} picture={me.user.picture} />
      </Link>
      <Button variant="ghost" className="hidden px-2.5 sm:inline-flex" onClick={signOut}>
        Sign out
      </Button>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  const [location] = useLocation();
  const active = href === "/" ? location === "/" || location.startsWith("/applications") : location.startsWith(href);
  return (
    <Link
      href={href}
      className={cx(
        "rounded-lg px-3 py-2 text-sm font-medium transition",
        active ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:text-zinc-900",
      )}
    >
      {children}
    </Link>
  );
}
