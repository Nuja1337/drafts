// Blocks in-app navigation (react-router blocker) and tab close (beforeunload) while a form has unsaved changes.
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useBlocker, type BlockerFunction } from "react-router";
import { Button, Modal } from "../ui";

export function useUnsavedChangesGuard(dirty: boolean): { modal: ReactNode; bypass: () => void } {
  // Set right before a deliberate navigation (e.g. after deleting) so the guard doesn't interrupt it.
  const bypassRef = useRef(false);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirty && !bypassRef.current && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search),
    [dirty],
  );
  const blocker = useBlocker(shouldBlock);

  // If the form became clean while a navigation was held (e.g. a save finished), let it through.
  useEffect(() => {
    if (blocker.state === "blocked" && !dirty) blocker.proceed();
  }, [blocker, dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const stay = () => {
    if (blocker.state === "blocked") blocker.reset();
  };
  const leave = () => {
    if (blocker.state === "blocked") blocker.proceed();
  };

  const modal = (
    <Modal open={blocker.state === "blocked"} onClose={stay} title="Discard unsaved changes?">
      <p className="text-sm text-muted">You have edits that haven't been saved. If you leave now, they'll be lost.</p>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={leave}>
          Discard and leave
        </Button>
        <Button variant="primary" onClick={stay} autoFocus>
          Keep editing
        </Button>
      </div>
    </Modal>
  );

  return {
    modal,
    bypass: () => {
      bypassRef.current = true;
    },
  };
}
