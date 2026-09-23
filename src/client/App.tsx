// Route table. Pages live in src/client/pages; the shell is components/Layout.
// Heavy pages are code-split (the draft room carries the scoring engine), so invite/team links opened on a phone
// don't download the whole app first.
import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter } from "react-router";
import { Layout } from "./components/Layout";
import { Home } from "./pages/Home";
import { TeamsList } from "./pages/TeamsList";
import { TeamNew } from "./pages/TeamNew";
import { NotFound } from "./pages/NotFound";
import { Spinner } from "./ui";

const RELOADED = "drafts.chunkReload";

/** React.lazy for a named page export. A failed chunk load (a deploy replaced the hashed files) reloads once. */
function lazyPage<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  const Page = lazy<ComponentType>(() =>
    load().then(
      (m) => {
        try {
          sessionStorage.removeItem(RELOADED);
        } catch {
          /* storage unavailable */
        }
        return { default: m[name] as ComponentType };
      },
      (err: unknown) => {
        try {
          if (!sessionStorage.getItem(RELOADED)) {
            sessionStorage.setItem(RELOADED, "1");
            window.location.reload();
            return new Promise<never>(() => {});
          }
        } catch {
          /* storage unavailable: surface the error */
        }
        throw err;
      },
    ),
  );
  return function LazyPage() {
    return (
      <Suspense fallback={<PageFallback full={name === "Room"} />}>
        <Page />
      </Suspense>
    );
  };
}

function PageFallback({ full }: { full: boolean }) {
  return (
    <div className={full ? "flex min-h-dvh items-center justify-center bg-bg" : "flex min-h-[40vh] items-center justify-center"} role="status" aria-label="Loading">
      <Spinner className="size-7 text-accent" />
    </div>
  );
}

const TeamDashboard = lazyPage(() => import("./pages/TeamDashboard"), "TeamDashboard");
const PlayerEditor = lazyPage(() => import("./pages/PlayerEditor"), "PlayerEditor");
const JoinTeam = lazyPage(() => import("./pages/JoinTeam"), "JoinTeam");
const DataBrowser = lazyPage(() => import("./pages/DataBrowser"), "DataBrowser");
const RoomNew = lazyPage(() => import("./pages/RoomNew"), "RoomNew");
const Room = lazyPage(() => import("./pages/Room"), "Room");

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/teams", element: <TeamsList /> },
      { path: "/teams/new", element: <TeamNew /> },
      { path: "/t/:teamId", element: <TeamDashboard /> },
      { path: "/t/:teamId/p/:playerId", element: <PlayerEditor /> },
      { path: "/join/:teamId/:code", element: <JoinTeam /> },
      { path: "/data/:game", element: <DataBrowser /> },
      { path: "/rooms/new", element: <RoomNew /> },
      { path: "*", element: <NotFound /> },
    ],
  },
  // The draft room uses the full viewport with its own header.
  { path: "/r/:roomId", element: <Room /> },
]);
