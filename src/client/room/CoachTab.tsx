// AI coach tab: sends the engine's grounded context to POST /api/coach and renders the reply.
import { useRef, useState } from "react";
import type { CoachReq, CoachRes } from "../../shared/api";
import type { GameId, Side } from "../../shared/types";
import { api, ApiRequestError } from "../lib/api";
import { Button, cn } from "../ui";
import { IconSpark } from "./icons";
import { Markdown } from "./markdown";

const QUESTION_MAX = 300;

function coachError(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.status === 429) return "You're asking the coach too quickly — give it a minute and try again.";
    // 503: quota used up / model busy — the server's message says which.
    if (err.status === 503) return err.message || "The coach is unavailable right now. Engine suggestions still work.";
    return err.message;
  }
  return err instanceof Error ? err.message : "The coach couldn't answer. Try again.";
}

export function CoachTab({
  game,
  perspective,
  perspectiveName,
  buildContext,
  ready,
}: {
  game: GameId;
  perspective: Side;
  perspectiveName: string;
  /** Builds the grounded context from the latest engine run; null when the engine has no output. */
  buildContext: () => CoachReq["context"] | null;
  ready: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<{ text: string; model: string; at: number; side: Side; question?: string } | null>(null);
  const inFlight = useRef(false);

  const ask = async () => {
    if (inFlight.current) return;
    let context: CoachReq["context"] | null;
    try {
      context = buildContext();
    } catch {
      context = null;
    }
    if (!context) {
      setError("The draft analysis isn't ready yet.");
      return;
    }
    const q = question.trim().slice(0, QUESTION_MAX);
    const req: CoachReq = { game, perspective, context, ...(q ? { question: q } : {}) };
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await api<CoachRes>("POST", "/coach", req);
      if (!res || typeof res.text !== "string") throw new Error("The coach sent an empty reply.");
      setReply({ text: res.text, model: res.model, at: Date.now(), side: perspective, question: q || undefined });
    } catch (err) {
      setError(coachError(err));
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        The coach reads this draft from <span className={cn("font-semibold", perspective === "blue" ? "text-blue" : "text-red")}>{perspectiveName}</span>'s point of
        view — the same facts the engine computed — and gives a short read.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
        className="space-y-2"
      >
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value.slice(0, QUESTION_MAX))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void ask();
            }
          }}
          rows={2}
          maxLength={QUESTION_MAX}
          placeholder="Optional question, e.g. “What should we first-pick?”"
          className="w-full resize-none rounded-lg border border-line bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" size="sm" loading={loading} disabled={!ready}>
            <IconSpark className="size-3.5" />
            Ask the coach
          </Button>
          <span className="ml-auto text-[11px] text-faint tabular-nums">
            {question.length}/{QUESTION_MAX}
          </span>
        </div>
      </form>
      {error && <div className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}
      {reply && (
        <div className="rounded-lg border border-line bg-panel-2/60 p-3">
          {reply.question && <p className="mb-2 text-xs text-faint italic">“{reply.question}”</p>}
          <Markdown text={reply.text} />
          <p className="mt-3 border-t border-line pt-2 text-[10px] text-faint">
            {reply.model} · {new Date(reply.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {reply.side !== perspective && " · written for the other side"} · AI output can be wrong; trust your team's read.
          </p>
        </div>
      )}
    </div>
  );
}
