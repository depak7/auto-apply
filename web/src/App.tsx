import { Link, Route, Switch, useLocation } from "wouter";

import { cx } from "./components/ui.tsx";
import { ApplicationPage } from "./pages/Application.tsx";
import { ApplicationsPage } from "./pages/Applications.tsx";
import { ProfilePage } from "./pages/Profile.tsx";
import { ResumeReviewPage } from "./pages/ResumeReview.tsx";

export function App() {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-zinc-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span className="text-[15px] font-semibold tracking-tight">AutoApply</span>
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink href="/">Applications</NavLink>
            <NavLink href="/profile">Profile</NavLink>
          </nav>
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
