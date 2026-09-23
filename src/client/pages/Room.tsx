// /r/:roomId — full-viewport draft room. Takes a ?k= key from the link for this visit and strips it from the URL
// (RoomView stores it only once the server confirms what it grants), and probes the room over HTTP (fast first paint
// + clean "not found") while the WebSocket connects.
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { ROOM_ID_RE } from "../../shared/draft";
import type { RoomState } from "../../shared/room";
import { api, ApiRequestError } from "../lib/api";
import { RoomNotFound, RoomView } from "../room/RoomView";

const KEY_RE = /^[A-Za-z0-9_-]{8,200}$/;

type Probe = { status: "loading" } | { status: "ok"; state: RoomState } | { status: "notfound" } | { status: "error" };

const looksLikeRoomState = (v: unknown): v is RoomState =>
  !!v && typeof v === "object" && "config" in v && "actions" in v && "sides" in v && Array.isArray((v as RoomState).actions);

export function Room() {
  const { roomId = "" } = useParams();
  // Keyed so switching rooms resets key/probe state.
  return <RoomLoader key={roomId} roomId={roomId} />;
}

function RoomLoader({ roomId }: { roomId: string }) {
  const location = useLocation();
  const navigate = useNavigate();
  const validId = ROOM_ID_RE.test(roomId);

  const [urlKey] = useState<string | null>(() => {
    const k = new URLSearchParams(location.search).get("k")?.trim();
    return k && KEY_RE.test(k) ? k : null;
  });

  // Drop the key from the address bar (no history entry).
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (!params.has("k")) return;
    params.delete("k");
    const qs = params.toString();
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : "", hash: location.hash }, { replace: true, state: location.state });
  }, [location, navigate]);

  const [probe, setProbe] = useState<Probe>({ status: "loading" });
  useEffect(() => {
    if (!validId) return;
    let alive = true;
    api<unknown>("GET", `/rooms/${encodeURIComponent(roomId)}`).then(
      (res) => alive && setProbe(looksLikeRoomState(res) ? { status: "ok", state: res } : { status: "error" }),
      (err: unknown) => alive && setProbe(err instanceof ApiRequestError && err.status === 404 ? { status: "notfound" } : { status: "error" }),
    );
    return () => {
      alive = false;
    };
  }, [roomId, validId]);

  if (!validId || probe.status === "notfound") return <RoomNotFound roomId={roomId} />;
  return <RoomView roomId={roomId} urlKey={urlKey} initial={probe.status === "ok" ? probe.state : null} />;
}
