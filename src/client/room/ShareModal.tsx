// Share dialog: every room link this browser knows (spectator always; host/captain links when we hold the keys).
// The host can also replace a captain link (e.g. after it leaked): the old link stops working at once.
import { useEffect, useState } from "react";
import type { RoomControlMsg, RoomRole, RoomState } from "../../shared/room";
import type { TeamSlot } from "../../shared/types";
import { Button, CopyField, Modal } from "../ui";
import { getRoomLinks, ROOM_LINKS_EVENT, roomUrl } from "./links";

export function ShareModal({
  open,
  onClose,
  roomId,
  state,
  you,
  yourKey,
  send,
}: {
  open: boolean;
  onClose: () => void;
  roomId: string;
  state: RoomState | null;
  you: RoomRole | null;
  yourKey: string | null;
  /** Needed for "New link" (host only). */
  send?: (msg: RoomControlMsg) => void;
}) {
  // Re-read the links store when a rotated captain key arrives (useRoom saves it there).
  const [, setVersion] = useState(0);
  const [confirming, setConfirming] = useState<TeamSlot | null>(null);
  const [pending, setPending] = useState<{ slot: TeamSlot; oldKey: string | undefined } | null>(null);
  useEffect(() => {
    if (!open) return;
    const onSaved = (e: Event) => {
      if ((e as CustomEvent<{ roomId?: string }>).detail?.roomId === roomId) setVersion((v) => v + 1);
    };
    window.addEventListener(ROOM_LINKS_EVENT, onSaved);
    return () => window.removeEventListener(ROOM_LINKS_EVENT, onSaved);
  }, [open, roomId]);
  useEffect(() => {
    if (!open) {
      setConfirming(null);
      setPending(null);
    }
  }, [open]);

  const links = open ? getRoomLinks(roomId) : undefined;
  const capKeys = { ...links?.captainKeys };
  if (you?.kind === "captain" && yourKey) capKeys[you.slot] = yourKey;
  // the reply has arrived once the stored key differs from the one we replaced
  const waiting = pending && capKeys[pending.slot] === pending.oldKey ? pending.slot : null;
  // no reply (e.g. rate limited or disconnected — the room shows the error as a toast): let the host try again
  useEffect(() => {
    if (!waiting) return;
    const t = setTimeout(() => setPending(null), 8000);
    return () => clearTimeout(t);
  }, [waiting]);

  if (!open) return null;
  const teams = state?.config.teams;
  const captains = state?.config.mode === "captains";
  const isHost = you?.kind === "host";
  const hostKey = isHost ? (yourKey ?? links?.hostKey) : links?.hostKey;

  const rotate = (slot: TeamSlot) => {
    if (!send) return;
    setConfirming(null);
    setPending({ slot, oldKey: capKeys[slot] });
    send({ t: "rotateKey", slot });
  };

  return (
    <Modal open={open} onClose={onClose} title="Share this room">
      <div className="space-y-4">
        <div>
          <CopyField label="Spectator link" value={roomUrl(roomId)} />
          <p className="mt-1 text-xs text-faint">Read-only. Teammates and coaches see the board and suggestions live.</p>
        </div>
        {captains &&
          (["A", "B"] as const).map((slot) => {
            const name = teams?.[slot].name ?? `Team ${slot}`;
            const canRotate = isHost && !!send;
            if (!capKeys[slot] && !canRotate) return null;
            return (
              <div key={slot}>
                {capKeys[slot] ? (
                  <CopyField label={`Captain link — ${name}`} value={roomUrl(roomId, capKeys[slot])} />
                ) : (
                  <div className="text-xs font-semibold tracking-wider text-muted uppercase">Captain link — {name}</div>
                )}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="min-w-0 flex-1 text-xs text-faint">
                    {capKeys[slot] ? "Lets its holder pick and ban for this team. Send it only to that captain." : "This browser doesn't have this link."}
                  </p>
                  {canRotate &&
                    (confirming === slot ? (
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-warn">The current link stops working.</span>
                        <Button size="sm" variant="danger" onClick={() => rotate(slot)}>
                          Replace
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <Button size="sm" variant="ghost" loading={waiting === slot} disabled={waiting !== null} onClick={() => setConfirming(slot)}>
                        {capKeys[slot] ? "New link" : "Create link"}
                      </Button>
                    ))}
                </div>
                {pending?.slot === slot && !waiting && (
                  <p className="mt-1 text-xs text-good">New link ready — the old one no longer works.</p>
                )}
              </div>
            );
          })}
        {hostKey && (
          <div>
            <CopyField label="Host link — keep private" value={roomUrl(roomId, hostKey)} />
            <p className="mt-1 text-xs text-warn">Full control of the room (start, undo, reset, results). Use it to open the room on another device.</p>
          </div>
        )}
      </div>
    </Modal>
  );
}
