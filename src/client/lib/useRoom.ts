// WebSocket hook for a live draft room: signs in with the room key over the socket (never in the URL), reconnects with
// jittered backoff, estimates the server clock offset with ping/pong (for turn timers), keeps the socket alive cheaply
// and cleans up on unmount or room/key change.
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, RoomControlMsg, RoomRole, RoomState, ServerMsg } from "../../shared/room";
import { getRoomLinks, saveRoomLinks } from "../room/links";

export type RoomConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface UseRoomResult {
  state: RoomState | null;
  you: RoomRole | null;
  status: RoomConnStatus;
  /** Last server error message (clears on the next state). */
  error: string | null;
  /** Draft messages, plus the host's {t:"rotateKey"} (the new captain key is saved to the room links store). */
  send: (msg: ClientMsg | RoomControlMsg) => void;
  /** Date.now() corrected by the server clock offset (for timers). */
  serverNow: () => number;
}

/** Transport keepalive; the Durable Object auto-responds without waking up (see DraftRoom). */
const KEEPALIVE = "ka";
const KEEPALIVE_MS = 30_000;
/** No traffic at all (not even keepalive replies) for this long = dead connection. */
const STALE_MS = 75_000;
/** Pings sent back-to-back after connecting; the lowest-RTT sample sets the clock offset. */
const SYNC_PINGS = 3;
const RESYNC_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;
/**
 * Server close codes after which reconnecting is pointless: room not found / expired, or replaced because the same
 * key opened too many connections (reconnecting would just push out another tab).
 */
const FINAL_CLOSE_CODES = new Set([4404, 4410, 4409]);

/** Socket URL. It never carries the key (URLs end up in logs): `?auth=1` tells the server a key frame follows. */
export function roomSocketUrl(roomId: string, key: string | null): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/api/rooms/${encodeURIComponent(roomId)}/ws${key ? "?auth=1" : ""}`;
}

export function useRoom(roomId: string, key: string | null): UseRoomResult {
  const [state, setState] = useState<RoomState | null>(null);
  const [you, setYou] = useState<RoomRole | null>(null);
  const [status, setStatus] = useState<RoomConnStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const offsetRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let attempt = 0;
    let everOpened = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
    let resyncTimer: ReturnType<typeof setInterval> | undefined;
    let lastTrafficAt = 0;
    let pingSentAt: number | null = null;
    let pingsLeft = 0;
    let bestRtt = Infinity;

    setState(null);
    setYou(null);
    setError(null);
    setStatus("connecting");
    offsetRef.current = 0;

    const sendPing = () => {
      if (!ws || ws.readyState !== WebSocket.OPEN || pingSentAt !== null) return;
      pingSentAt = Date.now();
      ws.send(JSON.stringify({ t: "ping" } satisfies ClientMsg));
    };

    const stopTimers = () => {
      clearInterval(keepaliveTimer);
      clearInterval(resyncTimer);
      keepaliveTimer = resyncTimer = undefined;
    };

    const detach = (socket: WebSocket) => {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    };

    const scheduleReconnect = () => {
      setStatus(everOpened ? "reconnecting" : "connecting");
      const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      attempt++;
      retryTimer = setTimeout(connect, delay);
    };

    const handleClose = (socket: WebSocket, code: number) => {
      if (ws !== socket) return;
      detach(socket);
      ws = null;
      wsRef.current = null;
      pingSentAt = null;
      stopTimers();
      if (disposed) return;
      if (FINAL_CLOSE_CODES.has(code)) {
        setStatus("closed");
        return;
      }
      scheduleReconnect();
    };

    const handleMessage = (data: unknown) => {
      lastTrafficAt = Date.now();
      if (typeof data !== "string" || data === KEEPALIVE) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(data) as ServerMsg;
      } catch {
        return;
      }
      switch (msg.t) {
        case "welcome":
          attempt = 0;
          everOpened = true;
          setStatus("open");
          setYou(msg.you);
          setState(msg.state);
          setError(null);
          // rough offset until a ping sample arrives
          if (bestRtt === Infinity) offsetRef.current = msg.serverTime - Date.now();
          break;
        case "state":
          setState(msg.state);
          setError(null);
          break;
        case "error":
          setError(msg.message);
          break;
        case "pong": {
          if (pingSentAt === null) break;
          const now = Date.now();
          const rtt = now - pingSentAt;
          if (rtt <= bestRtt) {
            bestRtt = rtt;
            offsetRef.current = msg.serverTime - (pingSentAt + now) / 2;
          }
          pingSentAt = null;
          if (--pingsLeft > 0) sendPing();
          break;
        }
        case "keyRotated":
          // host replaced a captain link: keep the new one where the share dialog reads links from
          saveRoomLinks(roomId, { captainKeys: { ...getRoomLinks(roomId)?.captainKeys, [msg.slot]: msg.key } });
          break;
      }
    };

    function connect() {
      retryTimer = undefined;
      if (disposed) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(roomSocketUrl(roomId, key));
      } catch {
        setStatus("closed");
        setError("Couldn't open a connection to the room.");
        return;
      }
      ws = socket;
      wsRef.current = socket;
      socket.onopen = () => {
        if (ws !== socket) return;
        lastTrafficAt = Date.now();
        // sign in first: the server holds our welcome until the key arrives
        if (key) socket.send(JSON.stringify({ t: "auth", key } satisfies RoomControlMsg));
        bestRtt = Infinity;
        pingsLeft = SYNC_PINGS;
        sendPing();
        keepaliveTimer = setInterval(() => {
          if (ws !== socket) return;
          if (Date.now() - lastTrafficAt > STALE_MS) {
            // half-open connection: don't wait for the close handshake
            try {
              socket.close();
            } catch {
              /* ignore */
            }
            handleClose(socket, 1006);
            return;
          }
          socket.send(KEEPALIVE);
        }, KEEPALIVE_MS);
        resyncTimer = setInterval(() => {
          bestRtt = Infinity;
          pingsLeft = 1;
          sendPing();
        }, RESYNC_MS);
      };
      socket.onmessage = (ev: MessageEvent) => {
        if (ws === socket) handleMessage(ev.data);
      };
      socket.onclose = (ev: CloseEvent) => handleClose(socket, ev.code);
      socket.onerror = () => {
        // a close event always follows; reconnect logic lives there
      };
    }

    // come back quickly when the network returns or the tab becomes visible during a backoff wait
    const wake = () => {
      if (disposed || ws || retryTimer === undefined) return;
      clearTimeout(retryTimer);
      attempt = 0;
      connect();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") wake();
    };
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", onVisible);

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      stopTimers();
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", onVisible);
      if (ws) {
        const socket = ws;
        detach(socket);
        try {
          socket.close(1000, "Leaving room");
        } catch {
          /* ignore */
        }
      }
      ws = null;
      wsRef.current = null;
    };
  }, [roomId, key]);

  const send = useCallback((msg: ClientMsg | RoomControlMsg) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setError("Not connected to the room. Reconnecting…");
      return;
    }
    ws.send(JSON.stringify(msg));
  }, []);

  const serverNow = useCallback(() => Date.now() + offsetRef.current, []);

  return { state, you, status, error, send, serverNow };
}
