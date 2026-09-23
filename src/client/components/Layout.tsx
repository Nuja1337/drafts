// App shell: sticky header with nav, page outlet, legal footer.
import { Link, Outlet, ScrollRestoration, useLocation } from "react-router";
import { cn } from "../ui";

interface NavItem {
  to: string;
  label: string;
  /** Path prefixes that mark this item active. */
  match: string[];
}

const NAV: NavItem[] = [
  { to: "/rooms/new", label: "Draft", match: ["/rooms"] },
  { to: "/teams", label: "Teams", match: ["/teams", "/t/", "/join/"] },
  { to: "/data/lol", label: "LoL data", match: ["/data/lol"] },
  { to: "/data/dota2", label: "Dota 2 data", match: ["/data/dota2"] },
];

function NavLinks({ className }: { className?: string }) {
  const { pathname } = useLocation();
  return (
    <nav className={cn("flex gap-1 text-sm", className)} aria-label="Main">
      {NAV.map((n) => {
        const active = n.match.some((m) => pathname === m || pathname.startsWith(m.endsWith("/") ? m : `${m}/`));
        return (
          <Link
            key={n.to}
            to={n.to}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium whitespace-nowrap transition-colors",
              active ? "bg-panel-2 text-text" : "text-muted hover:bg-panel-2/60 hover:text-text",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Layout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link to="/" className="flex shrink-0 items-center gap-2 font-display text-lg font-bold tracking-wide" aria-label="drafts home">
            <img src="/favicon.svg" alt="" className="size-7" />
            <span>
              drafts
            </span>
          </Link>
          <NavLinks className="hidden md:flex" />
          <div className="ml-auto flex items-center gap-2">
            <Link
              to="/teams/new"
              className="hidden h-8 items-center rounded-lg border border-line-strong px-3 text-sm text-muted transition-colors hover:bg-panel-2 hover:text-text sm:inline-flex"
            >
              New team
            </Link>
            <Link
              to="/rooms/new"
              className="inline-flex h-8 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-bg transition-colors hover:bg-accent-strong"
            >
              Start a draft
            </Link>
          </div>
        </div>
        {/* Compact nav row for small screens; scrolls horizontally inside itself, never the page. */}
        <div className="border-t border-line/60 md:hidden">
          <NavLinks className="mx-auto max-w-7xl overflow-x-auto px-3 py-1.5" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 py-6 sm:py-8">
        <Outlet />
      </main>
      <footer className="border-t border-line px-4 py-6 text-xs text-faint">
        <div className="mx-auto max-w-7xl space-y-3">
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link to="/" className="hover:text-muted">
              Home
            </Link>
            <Link to="/teams" className="hover:text-muted">
              Teams
            </Link>
            <Link to="/data/lol" className="hover:text-muted">
              League data
            </Link>
            <Link to="/data/dota2" className="hover:text-muted">
              Dota 2 data
            </Link>
          </div>
          <p className="mx-auto max-w-4xl text-center leading-relaxed">
            This site isn't endorsed by Riot Games or Valve and doesn't reflect the views or opinions of Riot Games, Valve, or anyone officially involved in producing or
            managing League of Legends or Dota 2. League of Legends and Riot Games are trademarks or registered trademarks of Riot Games, Inc. Dota 2 is a trademark of Valve
            Corporation.
          </p>
        </div>
      </footer>
      <ScrollRestoration />
    </div>
  );
}
