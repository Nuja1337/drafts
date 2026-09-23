// Transient toasts (server errors, notices) + the room's keyframe styles.
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../ui";
import { IconX } from "./icons";

export interface Toast {
  id: number;
  tone: "error" | "info";
  text: string;
}

const TOAST_MS = 5000;

export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, number>());
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const h = timers.current.get(id);
    if (h) window.clearTimeout(h);
    timers.current.delete(id);
  }, []);
  const push = useCallback(
    (text: string, tone: Toast["tone"] = "error") => {
      const id = ++seq.current;
      // Collapse identical consecutive messages; cap the stack.
      setToasts((t) => [...t.filter((x) => x.text !== text), { id, tone, text }].slice(-4));
      timers.current.set(id, window.setTimeout(() => dismiss(id), TOAST_MS));
    },
    [dismiss],
  );
  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((h) => window.clearTimeout(h));
  }, []);
  return { toasts, push, dismiss };
}

export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="pointer-events-none fixed right-3 bottom-3 left-3 z-50 flex flex-col items-end gap-2 sm:left-auto sm:w-96" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cn(
            "dl-toast pointer-events-auto flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-xl backdrop-blur",
            t.tone === "error" ? "border-bad/50 bg-red-soft/90 text-text" : "border-line-strong bg-panel-2/95 text-text",
          )}
        >
          <span className="min-w-0 flex-1">{t.text}</span>
          <button onClick={() => dismiss(t.id)} className="shrink-0 rounded p-0.5 text-muted hover:text-text" aria-label="Dismiss">
            <IconX className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

const CSS = `
@keyframes dl-lockin { 0% { transform: scale(1.18); opacity: 0; filter: brightness(2.2); } 45% { opacity: 1; } 100% { transform: scale(1); opacity: 1; filter: none; } }
@keyframes dl-flash { 0% { opacity: 0.55; } 100% { opacity: 0; } }
@keyframes dl-toast { 0% { transform: translateY(8px); opacity: 0; } 100% { transform: none; opacity: 1; } }
.dl-lockin { animation: dl-lockin 650ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.dl-flash { animation: dl-flash 900ms ease-out both; pointer-events: none; }
.dl-toast { animation: dl-toast 200ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .dl-lockin, .dl-flash, .dl-toast, .animate-pulse-ring { animation: none !important; }
}
`;

/** Keyframes used by the room (kept local so the global stylesheet stays generic). */
export function RoomStyles() {
  return <style>{CSS}</style>;
}
