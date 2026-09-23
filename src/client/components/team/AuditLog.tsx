// Activity tab: paginated audit log; the owner can revert revertible entries.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditEntry, TeamProfile } from "../../../shared/types";
import { errorMessage, teamApi } from "../../lib/teams";
import { Badge, Button, cn, EmptyState, ErrorNote } from "../../ui";
import { LoadingBlock } from "../common";
import { ConfirmModal } from "../ConfirmModal";
import { fullDate, timeAgo } from "../format";

const PAGE = 25;

const ACTION_LABEL: Record<string, string> = {
  "team.create": "Created",
  "team.update": "Team",
  "player.add": "Player added",
  "player.update": "Profile",
  "player.remove": "Player removed",
  "player.release": "Link released",
  "player.claim": "Claimed",
  "player.join": "Joined",
  "keys.rotate": "Keys",
  "audit.revert": "Revert",
};

function actorLabel(e: AuditEntry, team: TeamProfile): string {
  if (e.actorName) return e.actorName;
  if (e.actor === "owner") return "Owner";
  if (e.actor === "system") return "System";
  if (e.actor.startsWith("player:")) {
    const id = e.actor.slice("player:".length);
    return team.players.find((p) => p.id === id)?.name ?? "Former player";
  }
  return e.actor;
}

function actorTone(e: AuditEntry): string {
  if (e.actor === "owner") return "border-accent/50 bg-accent/15 text-accent";
  if (e.actor.startsWith("player:")) return "border-blue/40 bg-blue/15 text-blue";
  return "border-line-strong bg-panel-3 text-muted";
}

export function AuditLog({
  team,
  teamKey,
  canRevert,
  onTeam,
}: {
  team: TeamProfile;
  teamKey: string;
  canRevert: boolean;
  onTeam: (t: TeamProfile) => void;
}) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reverting, setReverting] = useState<AuditEntry | null>(null);
  const reqRef = useRef(0);

  const loadFirst = useCallback(async () => {
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await teamApi.audit(team.id, teamKey, { limit: PAGE });
      if (req !== reqRef.current) return;
      setEntries(res.entries);
      setNextBefore(res.nextBefore);
    } catch (e) {
      if (req === reqRef.current) setError(errorMessage(e));
    } finally {
      if (req === reqRef.current) setLoading(false);
    }
  }, [team.id, teamKey]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    if (!nextBefore || loadingMore) return;
    const req = reqRef.current;
    setLoadingMore(true);
    setError(null);
    try {
      const res = await teamApi.audit(team.id, teamKey, { before: nextBefore, limit: PAGE });
      if (req !== reqRef.current) return;
      setEntries((prev) => {
        const seen = new Set(prev.map((e) => e.id));
        return [...prev, ...res.entries.filter((e) => !seen.has(e.id))];
      });
      setNextBefore(res.nextBefore);
    } catch (e) {
      if (req === reqRef.current) setError(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  const now = Date.now();

  return (
    <section className="rounded-xl border border-line bg-panel">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold tracking-wider text-muted uppercase">Activity</h2>
          <p className="text-xs text-faint">Every change to the {team.kind === "scout" ? "profile" : "team"}, newest first.{canRevert ? " Revert undoes a single change." : ""}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void loadFirst()} disabled={loading} aria-label="Refresh activity">
          ↻ Refresh
        </Button>
      </header>

      <div className="p-4">
        {loading && entries.length === 0 ? (
          <LoadingBlock label="Loading activity…" className="py-10" />
        ) : entries.length === 0 && !error ? (
          <EmptyState title="No activity yet">Changes to the team and its players will appear here.</EmptyState>
        ) : (
          <ol className="space-y-1">
            {entries.map((e) => {
              const who = actorLabel(e, team);
              return (
                <li key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-panel-2/60">
                  <span
                    aria-hidden
                    className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border font-display text-xs font-bold", actorTone(e))}
                  >
                    {[...who][0]?.toUpperCase() ?? "?"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm break-words">{e.summary}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                      <span className="font-medium text-muted">{who}</span>
                      <span aria-hidden>·</span>
                      <time dateTime={e.createdAt} title={fullDate(e.createdAt)}>
                        {timeAgo(e.createdAt, now)}
                      </time>
                      <Badge className="text-[10px]">{ACTION_LABEL[e.action] ?? e.action}</Badge>
                    </div>
                  </div>
                  {canRevert && e.revertible && (
                    <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={() => setReverting(e)}>
                      Revert
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {error && (
          <div className="mt-3">
            <ErrorNote error={error} />
          </div>
        )}
        {nextBefore && entries.length > 0 && (
          <div className="mt-3 flex justify-center">
            <Button size="sm" onClick={loadMore} loading={loadingMore}>
              Load older
            </Button>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!reverting}
        onClose={() => setReverting(null)}
        title="Revert this change?"
        tone="primary"
        confirmLabel="Revert"
        onConfirm={async () => {
          if (!reverting) return;
          const res = await teamApi.revert(team.id, teamKey, reverting.id);
          onTeam(res.team);
          void loadFirst();
        }}
      >
        <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-text">{reverting?.summary}</p>
        <p>
          Restores what this entry changed to its previous value. Later edits to other fields are kept. The revert itself is logged and can be reverted too.
        </p>
      </ConfirmModal>
    </section>
  );
}
