import { useLocation } from "react-router";
import { ButtonLink } from "../components/common";
import { useTitle } from "../components/useTitle";

export function NotFound() {
  const { pathname } = useLocation();
  useTitle("Not found");
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center py-16 text-center">
      <div className="font-display text-7xl font-bold tracking-widest text-line-strong">404</div>
      <h1 className="mt-4 font-display text-2xl font-bold">This lane is empty</h1>
      <p className="mt-2 text-sm break-all text-muted">
        Nothing lives at <span className="font-mono text-text">{pathname}</span>. If someone shared this link, it may have a typo, or the team or room may have been
        deleted.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <ButtonLink to="/" variant="primary">
          Back to home
        </ButtonLink>
        <ButtonLink to="/teams">Your teams</ButtonLink>
      </div>
    </div>
  );
}
