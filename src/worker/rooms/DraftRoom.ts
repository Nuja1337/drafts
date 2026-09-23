// DraftRoom Durable Object — one per room (SQLite-backed, free tier).
// Authoritative state lives in memory + ctx.storage; transitions come from the pure reducer in shared/draft.ts.
// WebSockets use the hibernation API; one alarm is multiplexed between the turn timer and idle cleanup.
//
// Anti-griefing (see the protocol notes in shared/room.ts):
// - Keys arrive in the socket's first frame ({t:"auth"}), never in the URL, so they stay out of request logs.
// - Capacity is per role: spectators (anonymous, public link) have their own cap and a per-network cap, and host /
//   captain sockets never count against it — a spectator flood can't lock the host or captains out. Each keyed role
//   keeps at most MAX_PER_ROLE sockets; a new one replaces the oldest instead of being refused.
// - Storage writes are budgeted per keyed role (token bucket) and hovers are persisted at most every few seconds, so
//   one client can't burn the account-wide free Durable Object write quota. (Many rooms together still can, the same
//   way any free-tier request quota can be exhausted by volume; this bounds what one room can do.)
// - The host can revoke a leaked captain link (rotateKey).
import { DurableObject } from "cloudflare:workers";
import { applyTimeout, initialRoomState, reduce } from "../../shared/draft";
import type { RoomConfig, RoomRole, RoomState, ServerMsg } from "../../shared/room";
import type { TeamSlot } from "../../shared/types";
import { randomKey, safeEqual, sha256 } from "../lib/http";
import { networkKey } from "../lib/net";
import { socketMsgSchema } from "./schema";

/** SHA-256 hex hashes of the room keys (the raw keys are never stored). */
export interface RoomKeyHashes {
  host: string;
  A?: string;
  B?: string;
}

/** Per-socket state that survives hibernation. Roles live here, not in tags: tags can't change after accept. */
interface Attachment {
  role: RoomRole;
  /** Connect time (ms); a keyed role over its cap loses its oldest socket first. */
  at: number;
  /** Client network (IPv4 address or IPv6 /64) for the per-network spectator cap. */
  net: string;
  /** Opened with ?auth and still waiting for its auth frame: no welcome, broadcasts or presence yet. */
  pending?: boolean;
}

interface Conn {
  ws: WebSocket;
  att: Attachment;
}

/** Close codes understood by useRoom: 4404/4410/4409 are final, 4429 is retried with backoff, others reconnect. */
export const CLOSE_NOT_FOUND = 4404;
export const CLOSE_EXPIRED = 4410;
export const CLOSE_FULL = 4429;
/** The same key opened more than MAX_PER_ROLE sockets; this (oldest) one made room. Final, so tabs don't fight. */
export const CLOSE_REPLACED = 4409;
/** The host issued a new link for this captain slot; reconnecting with the old key joins as a spectator. */
export const CLOSE_REVOKED = 4001;
/** Transport keepalive answered by the runtime without waking the object (see useRoom). */
export const KEEPALIVE = "ka";

const IDLE_MS = 14 * 24 * 60 * 60 * 1000;
const TIMER_GRACE_MS = 1_000;
const MAX_MESSAGE_CHARS = 2_048;
const RATE_WINDOW_MS = 1_000;
const RATE_MAX = 15;
/** A socket this far over the limit within one window is closed. */
const RATE_KICK = RATE_MAX * 8;
/** Keyless (and bad-key) sockets. Host and captain sockets don't count against it. */
const MAX_SPECTATORS = 170;
/** Spectator sockets from one network — generous, since a venue or campus shares one IP. */
const MAX_SPECTATORS_PER_NET = 20;
/** Sockets per keyed role (host, captain A, captain B): at most 170 + 3 × 10 = 200 sockets receive broadcasts. */
const MAX_PER_ROLE = 10;
/** ?auth sockets that haven't sent their key yet; each gets AUTH_TIMEOUT_MS to do so. */
const MAX_PENDING = 20;
const AUTH_TIMEOUT_MS = 10_000;
const MAX_KEY_CHARS = 128;
/** State changes per keyed role: a burst of WRITE_BURST, refilling WRITE_REFILL_PER_S (a real draft never gets close). */
const WRITE_BURST = 40;
const WRITE_REFILL_PER_S = 2;
/** Hovers are broadcast at once but written to storage at most this often (leading + trailing write). */
const HOVER_WRITE_EVERY_MS = 2_000;
/** Join/leave presence changes are batched into one broadcast (avoids O(n²) fan-out when many sockets connect). */
const PRESENCE_DELAY_MS = 500;
/** Connections refresh the idle clock at most this often (saves storage writes). */
const SEEN_WRITE_EVERY_MS = 60 * 60 * 1000;

const SPECTATOR: RoomRole = { kind: "spectator" };

/** Budget / cap key of a role: "host", "A", "B" or "spectator". */
const roleKey = (role: RoomRole): string => (role.kind === "captain" ? role.slot : role.kind);

export class DraftRoom extends DurableObject<Env> {
  private room: RoomState | null = null;
  private keys: RoomKeyHashes | null = null;
  /** Last time someone connected (idle cleanup counts connections as activity). */
  private lastSeen = 0;
  /** Mirror of the scheduled alarm to avoid redundant setAlarm writes. */
  private alarmAt: number | null = null;
  private rates = new WeakMap<WebSocket, { start: number; count: number; warned: boolean }>();
  /** Write budget per keyed role (in memory: hibernation needs ~10 s idle, so a reset only ever refills it). */
  private budgets = new Map<string, { tokens: number; at: number }>();
  /** Last time `state` was written to storage, and the pending trailing hover write (it also keeps us awake). */
  private stateWrittenAt = 0;
  private hoverWrite: ReturnType<typeof setTimeout> | null = null;
  private presenceBroadcast: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(KEEPALIVE, KEEPALIVE));
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get(["state", "keys", "seen"]);
      this.room = (stored.get("state") as RoomState | undefined) ?? null;
      this.keys = (stored.get("keys") as RoomKeyHashes | undefined) ?? null;
      this.lastSeen = (stored.get("seen") as number | undefined) ?? 0;
      this.alarmAt = await ctx.storage.getAlarm();
    });
  }

  // ---- RPC (called by the Worker routes) ---------------------------------------------------------

  /** Initializes a fresh room. Returns false if this id is already taken. */
  async init(roomId: string, config: RoomConfig, keys: RoomKeyHashes, now: number): Promise<boolean> {
    if (this.room) return false;
    this.room = initialRoomState(roomId, config, now);
    this.keys = keys;
    this.lastSeen = now;
    this.stateWrittenAt = now;
    await this.ctx.storage.put({ state: this.room, keys, seen: now });
    await this.scheduleAlarm();
    return true;
  }

  /** Current state with live presence, or null when the room doesn't exist. */
  async getState(): Promise<RoomState | null> {
    return this.room ? this.withPresence(this.room) : null;
  }

  // ---- WebSocket upgrade -------------------------------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return Response.json({ error: { code: "upgrade_required", message: "Expected a WebSocket upgrade." } }, { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (!this.room || !this.keys) return this.reject(server, client, CLOSE_NOT_FOUND, "not_found", "This room doesn't exist or has expired.");
    const url = new URL(request.url);
    const now = Date.now();
    const net = networkKey(request.headers.get("cf-connecting-ip"));
    const conns = this.connections();

    if (url.searchParams.has("auth")) {
      // A key holder: its role (and so which cap applies) is known once the auth frame arrives. Pending sockets get no
      // traffic; if too many pile up, the oldest waiting one is dropped (it reconnects).
      const pending = conns.filter((c) => c.att.pending);
      if (pending.length >= MAX_PENDING) this.closeQuietly(oldest(pending).ws, CLOSE_FULL, "Too many connections waiting to sign in");
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role: SPECTATOR, at: now, net, pending: true } satisfies Attachment);
      setTimeout(() => this.expirePending(server), AUTH_TIMEOUT_MS);
    } else {
      const full = this.spectatorsFull(conns, net);
      if (full) return this.reject(server, client, CLOSE_FULL, "room_full", full);
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ role: SPECTATOR, at: now, net } satisfies Attachment);
      this.welcome(server, SPECTATOR);
      // An out-of-date page still putting its key in the URL: it only gets spectator access now.
      if (url.searchParams.has("key")) this.sendError(server, "reload_required", "This page is out of date — reload it to use your room link.");
      this.schedulePresence();
    }

    if (now - this.lastSeen > SEEN_WRITE_EVERY_MS) {
      this.lastSeen = now;
      await this.ctx.storage.put("seen", now);
      await this.scheduleAlarm();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Accepts (non-hibernating) just long enough to explain why, then closes. */
  private reject(server: WebSocket, client: WebSocket, closeCode: number, code: string, message: string): Response {
    server.accept();
    this.send(server, { t: "error", code, message });
    server.close(closeCode, message);
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Why one more spectator from `net` can't join, or null if it can. */
  private spectatorsFull(conns: Conn[], net: string): string | null {
    let total = 0;
    let fromNet = 0;
    for (const { att } of conns) {
      if (att.pending || att.role.kind !== "spectator") continue;
      total++;
      if (att.net === net) fromNet++;
    }
    if (total >= MAX_SPECTATORS) return "This room is full.";
    if (fromNet >= MAX_SPECTATORS_PER_NET) return "Too many viewers from your network are already watching this room.";
    return null;
  }

  private async resolveRole(key: string): Promise<{ role: RoomRole; badKey: boolean }> {
    if (!key) return { role: SPECTATOR, badKey: false };
    if (key.length > MAX_KEY_CHARS || !this.keys) return { role: SPECTATOR, badKey: true };
    const hash = await sha256(key);
    if (safeEqual(hash, this.keys.host)) return { role: { kind: "host" }, badKey: false };
    if (this.keys.A && safeEqual(hash, this.keys.A)) return { role: { kind: "captain", slot: "A" }, badKey: false };
    if (this.keys.B && safeEqual(hash, this.keys.B)) return { role: { kind: "captain", slot: "B" }, badKey: false };
    return { role: SPECTATOR, badKey: true };
  }

  /** Handles {t:"auth"}: (re)assigns the socket's role and welcomes it in that role. */
  private async authenticate(ws: WebSocket, att: Attachment, key: string): Promise<void> {
    const { role, badKey } = await this.resolveRole(key);
    if (!this.room || ws.readyState !== WebSocket.READY_STATE_OPEN) return;
    const others = this.connections().filter((c) => c.ws !== ws);
    if (role.kind === "spectator") {
      // Becoming a spectator needs spectator room (a socket that already is one keeps its place).
      const full = att.pending || att.role.kind !== "spectator" ? this.spectatorsFull(others, att.net) : null;
      if (full) {
        this.sendError(ws, "room_full", badKey ? `That room key isn't valid, and ${full[0].toLowerCase()}${full.slice(1)}` : full);
        this.closeQuietly(ws, CLOSE_FULL, "Room full");
        return;
      }
    } else {
      // Keyed roles are never refused: past the cap, the same key's oldest socket makes room.
      const same = others.filter((c) => !c.att.pending && roleKey(c.att.role) === roleKey(role));
      if (same.length >= MAX_PER_ROLE) {
        const old = oldest(same).ws;
        this.sendError(old, "replaced", "This room link was opened in too many other tabs or devices, so this one was disconnected.");
        this.closeQuietly(old, CLOSE_REPLACED, "Replaced by a newer connection");
      }
    }
    ws.serializeAttachment({ role, at: att.at, net: att.net } satisfies Attachment);
    this.welcome(ws, role);
    if (badKey) this.sendError(ws, "bad_key", "That room key isn't valid — you joined as a spectator.");
    this.schedulePresence();
  }

  /** An ?auth socket that never sent its key: drop it (the client reconnects). */
  private expirePending(ws: WebSocket): void {
    const att = this.attachmentOf(ws);
    if (!att?.pending) return;
    this.sendError(ws, "auth_timeout", "No room key arrived in time.");
    this.closeQuietly(ws, 1008, "Auth timeout");
  }

  // ---- Hibernation handlers ----------------------------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (!this.allow(ws)) return;
    if (typeof message !== "string") return this.sendError(ws, "bad_message", "Binary messages aren't supported.");
    if (message.length > MAX_MESSAGE_CHARS) return this.sendError(ws, "too_large", "Message too large.");
    let raw: unknown;
    try {
      raw = JSON.parse(message);
    } catch {
      return this.sendError(ws, "bad_message", "Messages must be JSON.");
    }
    const parsed = socketMsgSchema.safeParse(raw);
    if (!parsed.success) return this.sendError(ws, "bad_message", "Malformed message.");
    const msg = parsed.data;

    if (msg.t === "ping") return this.send(ws, { t: "pong", serverTime: Date.now() });
    const room = this.room;
    if (!room) {
      this.closeQuietly(ws, CLOSE_NOT_FOUND, "Room not found");
      return;
    }
    const att = this.attachmentOf(ws) ?? { role: SPECTATOR, at: 0, net: "" };
    if (msg.t === "auth") return this.authenticate(ws, att, msg.key);
    if (att.pending) return this.sendError(ws, "auth_required", "Send your room key first.");
    if (msg.t === "rotateKey") return this.rotateKey(ws, att.role, msg.slot);

    const result = reduce(room, att.role, msg, Date.now());
    if (!result.ok) return this.sendError(ws, result.error.code, result.error.message);
    if (result.state === room) return;
    if (!this.spend(att.role)) return this.sendError(ws, "rate_limited", "Too many changes — slow down.");
    if (msg.t === "hover") return this.commitHover(result.state);
    await this.commit(result.state);
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.closeQuietly(ws, 1000, "Closed");
    if (!this.attachmentOf(ws)?.pending) this.schedulePresence();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.closeQuietly(ws, 1011, "Socket error");
    if (!this.attachmentOf(ws)?.pending) this.schedulePresence();
  }

  // ---- Captain link rotation ---------------------------------------------------------------------

  private async rotateKey(ws: WebSocket, role: RoomRole, slot: TeamSlot): Promise<void> {
    if (role.kind !== "host") return this.sendError(ws, "forbidden", "Only the host can issue new captain links.");
    if (!this.room || !this.keys || this.room.config.mode !== "captains") {
      return this.sendError(ws, "no_captains", "This room has no captain links.");
    }
    if (!this.spend(role)) return this.sendError(ws, "rate_limited", "Too many changes — slow down.");
    const key = randomKey("cap");
    const hash = await sha256(key);
    if (!this.keys) return;
    this.keys = { ...this.keys, [slot]: hash };
    await this.ctx.storage.put("keys", this.keys);
    this.send(ws, { t: "keyRotated", slot, key });
    for (const c of this.connections()) {
      if (c.att.role.kind !== "captain" || c.att.role.slot !== slot) continue;
      this.sendError(c.ws, "key_revoked", "The host replaced this captain link — ask them for the new one.");
      this.closeQuietly(c.ws, CLOSE_REVOKED, "Key revoked");
    }
    this.schedulePresence();
  }

  // ---- Alarm: turn timer + idle cleanup ----------------------------------------------------------

  async alarm(): Promise<void> {
    this.alarmAt = null;
    const room = this.room;
    if (!room) {
      await this.ctx.storage.deleteAll();
      return;
    }
    const now = Date.now();
    if (now >= this.idleDeadline(room)) {
      await this.destroy();
      return;
    }
    // this.room includes a hover whose trailing write may still be pending, so the auto-lock sees it
    const outcome = applyTimeout(room, now);
    if (!outcome) {
      await this.scheduleAlarm();
      return;
    }
    await this.commit(outcome.state);
    // after the state so the error survives the client's "clear error on next state"
    if (outcome.expired) this.broadcast({ t: "error", ...outcome.expired });
  }

  private idleDeadline(room: RoomState): number {
    return Math.max(room.updatedAt, this.lastSeen) + IDLE_MS;
  }

  private async scheduleAlarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const cleanupAt = this.idleDeadline(room);
    const timerAt = room.status === "drafting" && room.turnDeadline !== null ? room.turnDeadline + TIMER_GRACE_MS : null;
    const desired = timerAt === null ? cleanupAt : Math.min(timerAt, cleanupAt);
    const current = this.alarmAt;
    // An earlier-than-needed alarm is harmless (alarm() re-evaluates), so only rewrite when it would be late or missing,
    // or when a turn timer needs its exact time.
    const rewrite = current === null || current > desired || (timerAt !== null && current !== desired);
    if (!rewrite) return;
    this.alarmAt = desired;
    await this.ctx.storage.setAlarm(desired);
  }

  private async destroy(): Promise<void> {
    this.clearTimers();
    for (const ws of this.ctx.getWebSockets()) this.closeQuietly(ws, CLOSE_EXPIRED, "Room expired");
    this.room = null;
    this.keys = null;
    this.alarmAt = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---- State writes ------------------------------------------------------------------------------

  private async commit(state: RoomState): Promise<void> {
    this.cancelHoverWrite();
    this.room = state;
    await this.writeState();
    await this.scheduleAlarm();
    this.broadcastState();
  }

  /**
   * Hovers change the state often, so they're broadcast at once but written at most every HOVER_WRITE_EVERY_MS:
   * immediately when the last write is older than that, otherwise by one trailing write. The pending timer keeps the
   * object from hibernating, so the hover can't be lost before it's written; the timer alarm reads this.room anyway.
   */
  private async commitHover(state: RoomState): Promise<void> {
    this.room = state;
    this.broadcastState();
    if (this.hoverWrite) return;
    const wait = this.stateWrittenAt + HOVER_WRITE_EVERY_MS - Date.now();
    if (wait <= 0) return this.writeState();
    this.hoverWrite = setTimeout(() => {
      this.hoverWrite = null;
      this.writeState().catch((e) => console.warn("hover write failed", e));
    }, wait);
  }

  private async writeState(): Promise<void> {
    if (!this.room) return;
    this.stateWrittenAt = Date.now();
    await this.ctx.storage.put("state", this.room);
  }

  private cancelHoverWrite(): void {
    if (this.hoverWrite) clearTimeout(this.hoverWrite);
    this.hoverWrite = null;
  }

  private clearTimers(): void {
    this.cancelHoverWrite();
    if (this.presenceBroadcast) clearTimeout(this.presenceBroadcast);
    this.presenceBroadcast = null;
  }

  /** Token bucket per keyed role over state-changing messages (only accepted changes spend). */
  private spend(role: RoomRole): boolean {
    const k = roleKey(role);
    const now = Date.now();
    const b = this.budgets.get(k) ?? { tokens: WRITE_BURST, at: now };
    b.tokens = Math.min(WRITE_BURST, b.tokens + ((now - b.at) / 1000) * WRITE_REFILL_PER_S);
    b.at = now;
    this.budgets.set(k, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  // ---- Connections + messaging -------------------------------------------------------------------

  private attachmentOf(ws: WebSocket): Attachment | null {
    try {
      return ws.deserializeAttachment() as Attachment | null;
    } catch {
      return null;
    }
  }

  /** Open sockets with their attachments. */
  private connections(): Conn[] {
    const out: Conn[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws.readyState !== WebSocket.READY_STATE_OPEN) continue;
      const att = this.attachmentOf(ws);
      if (att) out.push({ ws, att });
    }
    return out;
  }

  /** Signed-in (non-pending) sockets: they get broadcasts and count towards presence. */
  private members(): Conn[] {
    return this.connections().filter((c) => !c.att.pending);
  }

  /** Presence is derived from live sockets, never persisted. */
  private withPresence(room: RoomState, members = this.members()): RoomState {
    const presence = { host: 0, A: 0, B: 0, spectators: 0 };
    for (const { att } of members) {
      if (att.role.kind === "host") presence.host++;
      else if (att.role.kind === "captain") presence[att.role.slot]++;
      else presence.spectators++;
    }
    return { ...room, presence };
  }

  private welcome(ws: WebSocket, role: RoomRole): void {
    if (!this.room) return;
    this.send(ws, { t: "welcome", you: role, state: this.withPresence(this.room), serverTime: Date.now() });
  }

  /** Coalesces join/leave presence updates into one broadcast shortly after. */
  private schedulePresence(): void {
    if (this.presenceBroadcast) return;
    this.presenceBroadcast = setTimeout(() => {
      this.presenceBroadcast = null;
      this.broadcastState();
    }, PRESENCE_DELAY_MS);
  }

  /** Sends the full state (with current presence) to every signed-in socket. */
  private broadcastState(): void {
    if (this.presenceBroadcast) clearTimeout(this.presenceBroadcast);
    this.presenceBroadcast = null;
    if (!this.room) return;
    const members = this.members();
    this.sendAll(members, { t: "state", state: this.withPresence(this.room, members), serverTime: Date.now() });
  }

  private broadcast(msg: ServerMsg): void {
    this.sendAll(this.members(), msg);
  }

  private sendAll(members: Conn[], msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const { ws } of members) {
      try {
        ws.send(data);
      } catch {
        // socket already closing; its close handler cleans up
      }
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // closed socket
    }
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    this.send(ws, { t: "error", code, message });
  }

  private closeQuietly(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  /** Per-socket fixed-window limiter: drops messages over RATE_MAX/s, closes sockets that keep flooding. */
  private allow(ws: WebSocket): boolean {
    const now = Date.now();
    let r = this.rates.get(ws);
    if (!r || now - r.start >= RATE_WINDOW_MS) {
      r = { start: now, count: 0, warned: false };
      this.rates.set(ws, r);
    }
    r.count++;
    if (r.count <= RATE_MAX) return true;
    if (r.count > RATE_KICK) {
      this.closeQuietly(ws, 1008, "Too many messages");
    } else if (!r.warned) {
      r.warned = true;
      this.sendError(ws, "rate_limited", "Too many messages — slow down.");
    }
    return false;
  }
}

/** The earliest-connected of some sockets. */
const oldest = (conns: Conn[]): Conn => conns.reduce((a, b) => (b.att.at < a.att.at ? b : a));
