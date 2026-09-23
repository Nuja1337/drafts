// The live draft room: connects via useRoom, runs the engine locally and composes header, board, grid and analysis.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { buildCoachContext } from "../../shared/engine/coach";
import { analyzeDraft } from "../../shared/engine/index";
import type { EngineInput, EngineOutput, Suggestion } from "../../shared/engine/types";
import { getFormat } from "../../shared/formats";
import { GAMES } from "../../shared/games";
import type { ClientMsg, RoomRole, RoomState } from "../../shared/room";
import type { Champion, Side, TeamSlot } from "../../shared/types";
import { useGameData } from "../lib/gameData";
import { getRoom, roomKeyRank, saveRoom, saveRoomKey } from "../lib/keys";
import { useRoom } from "../lib/useRoom";
import { Button, cn, Spinner } from "../ui";
import { ActionBar } from "./ActionBar";
import { BansBar, PickColumn, SeriesStrip } from "./Board";
import { ChampionGrid } from "./ChampionGrid";
import { IconChevron } from "./icons";
import { getRoomLinks } from "./links";
import { Lobby } from "./Lobby";
import { RoomHeader } from "./RoomHeader";
import { ShareModal } from "./ShareModal";
import { Suggestions } from "./Suggestions";
import { ConfirmDialog, Summary } from "./Summary";
import { RoomStyles, Toasts, useToasts } from "./Toasts";
import { useTeamProfiles } from "./useTeamProfiles";
import { useWeights } from "./useWeights";
import { actionsKey, buildDraftView, isSelectable, lockedKey } from "./view";

const isEditable = (el: EventTarget | null): boolean => {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
};
const isInteractive = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (isEditable(el) || el.tagName === "BUTTON" || el.tagName === "A" || el.getAttribute("role") === "tab" || !!el.closest("[role=dialog]"));

export function FullScreenMessage({ title, children, spinner }: { title: string; children?: ReactNode; spinner?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-bg p-6 text-center">
      {spinner && <Spinner className="size-8 text-accent" />}
      <h1 className="font-display text-2xl font-bold">{title}</h1>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function RoomView({ roomId, urlKey, initial }: { roomId: string; urlKey: string | null; initial: RoomState | null }) {
  // A key from the link wins for this visit; otherwise use the key this browser has stored for the room.
  const [roomKey, setRoomKey] = useState<string | null>(() => urlKey ?? getRoom(roomId)?.key ?? null);
  const room = useRoom(roomId, roomKey);
  const state = room.state ?? initial;
  const { toasts, push, dismiss } = useToasts();

  // Surface server errors as toasts.
  useEffect(() => {
    if (room.error) push(room.error);
  }, [room.error, push]);

  // Store a key only after the server confirmed it (never over a stronger one: host > captain). A key the server
  // rejected (we joined as a spectator) falls back to the key this browser already holds.
  // Each welcome is handled once, so a role left over from the previous key's socket is never credited to a new key.
  const handledWelcome = useRef<RoomRole | null>(null);
  useEffect(() => {
    if (!room.you || room.you === handledWelcome.current || !roomKey) return;
    handledWelcome.current = room.you;
    if (room.you.kind !== "spectator") saveRoomKey(roomId, roomKey);
    else {
      const stored = getRoom(roomId)?.key;
      if (stored && stored !== roomKey) setRoomKey(stored);
    }
  }, [room.you, roomKey, roomId]);

  if (!state) {
    if (room.status === "closed")
      return (
        <FullScreenMessage title="Couldn't connect">
          <p>The room connection closed. Check your network and try again.</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>
            Retry
          </Button>
        </FullScreenMessage>
      );
    return <FullScreenMessage title="Joining room…" spinner />;
  }
  return <RoomLive roomId={roomId} roomKey={roomKey} onUseKey={setRoomKey} state={state} room={room} toasts={toasts} dismiss={dismiss} />;
}

type RoomHook = ReturnType<typeof useRoom>;

function RoomLive({
  roomId,
  roomKey,
  onUseKey,
  state,
  room,
  toasts,
  dismiss,
}: {
  roomId: string;
  roomKey: string | null;
  onUseKey: (key: string) => void;
  state: RoomState;
  room: RoomHook;
  toasts: ReturnType<typeof useToasts>["toasts"];
  dismiss: ReturnType<typeof useToasts>["dismiss"];
}) {
  const { you, send, serverNow, status } = room;
  const cfg = state.config;
  const game = cfg.game;
  const format = getFormat(cfg.formatId);
  const { data, error: dataError, loading: dataLoading } = useGameData(game);
  const { weights, setWeight, reset: resetWeights, isDefault: weightsDefault } = useWeights();
  const profiles = useTeamProfiles(game, { A: cfg.teams.A.profileId, B: cfg.teams.B.profileId });

  const [shareOpen, setShareOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [seriesOpen, setSeriesOpen] = useState(cfg.fearless !== "off");
  const [perspSlot, setPerspSlot] = useState<TeamSlot | null>(null);
  const [sel, setSel] = useState<{ id: string; step: number; game: number } | null>(null);
  const [pendingStep, setPendingStep] = useState<number | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Remember the room (label/game) for the recent-rooms list; the key is kept by saveRoom.
  const label = `${cfg.teams.A.name} vs ${cfg.teams.B.name}`;
  useEffect(() => {
    const prev = getRoom(roomId);
    if (!prev || prev.label !== label || prev.game !== game) saveRoom({ roomId, label, game });
    document.title = `${label} · drafts`;
  }, [roomId, label, game]);
  useEffect(() => () => void (document.title = "drafts"), []);

  const view = useMemo(() => (format ? buildDraftView(state, format, you) : null), [state, format, you]);

  // Opened a captain link in the browser that holds the host key (e.g. to test it): offer a way back.
  const hostKey = useMemo(() => {
    if (!you || you.kind === "host") return null;
    return [getRoom(roomId)?.key, getRoomLinks(roomId)?.hostKey].find((k): k is string => roomKeyRank(k) === 3 && k !== roomKey) ?? null;
  }, [you, roomId, roomKey]);

  // Lock pending: cleared by a server error, the step advancing, or a safety timeout.
  useEffect(() => {
    if (room.error) setPendingStep(null);
  }, [room.error]);
  useEffect(() => {
    if (pendingStep === null) return;
    const t = window.setTimeout(() => setPendingStep(null), 4000);
    return () => window.clearTimeout(t);
  }, [pendingStep]);

  // ---- perspective --------------------------------------------------------
  const defaultSlot: TeamSlot = (() => {
    if (view?.yourSlot) return view.yourSlot;
    const a = profiles.A.profile;
    const b = profiles.B.profile;
    if (a && !b) return "A";
    if (b && !a) return "B";
    if (a && b && a.kind !== b.kind) return a.kind === "team" ? "A" : "B";
    return state.sides.blue;
  })();
  const perspectiveSlot = perspSlot ?? defaultSlot;
  const perspective: Side = state.sides.blue === perspectiveSlot ? "blue" : "red";
  const enemy: Side = perspective === "blue" ? "red" : "blue";
  const names: Record<Side, string> = { blue: cfg.teams[state.sides.blue].name, red: cfg.teams[state.sides.red].name };

  // ---- engine (memoized on draft content, not on hover/presence updates) --
  const aKey = actionsKey(state.actions);
  const actions = useMemo(() => state.actions, [aKey]);
  const lKey = view ? lockedKey(view.locked) : "";
  const locked = useMemo(() => view?.locked ?? { blue: [], red: [] }, [lKey]);
  const blueProfile = profiles[state.sides.blue].profile;
  const redProfile = profiles[state.sides.red].profile;

  const engineInput = useMemo<EngineInput | null>(() => {
    if (!data || !format) return null;
    return {
      data,
      format,
      firstSide: state.firstSide,
      actions,
      unavailable: locked,
      perspective,
      teams: { blue: blueProfile, red: redProfile },
      weights,
    };
  }, [data, format, state.firstSide, actions, locked, perspective, blueProfile, redProfile, weights]);

  const engine = useMemo<{ output: EngineOutput | null; error: string | null }>(() => {
    if (!engineInput) return { output: null, error: null };
    try {
      return { output: analyzeDraft(engineInput), error: null };
    } catch (e) {
      console.error("analyzeDraft failed", e);
      return { output: null, error: e instanceof Error ? e.message : "Unknown engine error" };
    }
  }, [engineInput]);
  const output = engine.output;

  const buildCtx = useCallback(() => {
    if (!engineInput || !output || !view) return null;
    return buildCoachContext(engineInput, output, { our: names[perspective], enemy: names[enemy] }, view.phase);
  }, [engineInput, output, view, names.blue, names.red, perspective, enemy]);

  const lookup = useCallback((id: string | null | undefined): Champion | undefined => (id ? data?.byId.get(id) : undefined), [data]);

  // ---- selection / actions ---------------------------------------------------
  const next = view?.next ?? null;
  const stepIndex = next?.index ?? -1;
  const gridSide: Side = view && next && view.canAct ? next.side : (view?.yourSide ?? next?.side ?? perspective);
  const stepType = next?.type ?? "pick";
  const selected = sel && sel.step === stepIndex && sel.game === state.gameNumber ? sel.id : null;
  const available = useCallback((id: string) => !!view && isSelectable(view, gridSide, stepType, id), [view, gridSide, stepType]);
  const lockPending = pendingStep !== null && pendingStep === stepIndex;

  // Hover/lock carry the step index so the server rejects them if the turn moved on (e.g. a timeout auto-lock).
  const sendTurn = useCallback((t: "hover" | "lock", championId: string | null) => {
    send({ t, championId, index: stepIndex } satisfies Extract<ClientMsg, { t: "hover" | "lock" }>);
  }, [send, stepIndex]);

  const select = useCallback(
    (id: string) => {
      if (!available(id)) return;
      setSel({ id, step: stepIndex, game: state.gameNumber });
      if (view?.canAct && next && state.hovers[next.side] !== id) sendTurn("hover", id);
    },
    [available, stepIndex, state.gameNumber, state.hovers, view?.canAct, next, sendTurn],
  );

  const lockIn = useCallback(() => {
    if (!view?.canAct || !selected || !available(selected) || lockPending) return;
    sendTurn("lock", selected);
    setPendingStep(stepIndex);
  }, [view?.canAct, selected, available, lockPending, sendTurn, stepIndex]);

  const noBan = useCallback(() => {
    if (!view?.canAct || next?.type !== "ban" || lockPending) return;
    sendTurn("lock", null);
    setPendingStep(stepIndex);
  }, [view?.canAct, next?.type, lockPending, sendTurn, stepIndex]);

  // Keyboard: "/" focuses search, Enter locks in, Escape clears the selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      // Shortcuts are off while a dialog is open.
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "/" && !isEditable(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "Enter" && !isInteractive(e.target)) {
        e.preventDefault();
        lockIn();
      } else if (e.key === "Escape" && !isEditable(e.target) && !isInteractive(e.target)) {
        setSel(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lockIn]);

  if (!format || !view) {
    return (
      <FullScreenMessage title="Unsupported draft format">
        <p>This room uses a format ({cfg.formatId}) this version of the site doesn't know. Try reloading the page.</p>
      </FullScreenMessage>
    );
  }

  const gridSuggestions: Suggestion[] = !output || !next ? [] : gridSide === perspective ? (next.type === "ban" ? output.bans : output.picks) : next.type === "pick" ? output.enemyThreats : [];
  const suggestionLabel = gridSide === perspective ? `Suggested for ${names[perspective]}` : `Likely ${names[gridSide]} picks`;
  const lobby = state.status === "lobby";
  const complete = !lobby && view.complete;
  const gridMode = !lobby && !complete;
  // Phones: someone who can't act right now (spectator, waiting captain) sees the board, then the analysis; the
  // champion grid opens on demand. Desktop always shows it.
  const canCollapse = gridMode && !view.canAct;
  const gridCollapsed = canCollapse && !browseOpen;

  let center: ReactNode;
  if (lobby) {
    center = <Lobby state={state} view={view} profiles={profiles} send={send} />;
  } else if (complete) {
    center = <Summary state={state} view={view} output={output} perspective={perspective} lookup={lookup} send={send} onReset={() => setResetOpen(true)} />;
  } else if (dataError) {
    center = (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-bad">{dataError.message}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  } else if (!data) {
    center = (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted">
        <Spinner className="size-5" /> Loading {GAMES[game].unitPlural.toLowerCase()}…
      </div>
    );
  } else {
    center = (
      <>
        {canCollapse && (
          <button
            type="button"
            onClick={() => setBrowseOpen((o) => !o)}
            aria-expanded={!gridCollapsed}
            className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-left text-sm font-semibold text-muted hover:text-text lg:hidden"
          >
            {gridCollapsed ? `Browse ${GAMES[game].unitPlural.toLowerCase()}` : `Hide ${GAMES[game].unitPlural.toLowerCase()}`}
            <IconChevron className={cn("size-4 transition-transform", gridCollapsed ? "" : "rotate-180")} />
          </button>
        )}
        <div className={cn("min-h-0 flex-1 flex-col", gridCollapsed ? "hidden lg:flex" : "flex")}>
          <ChampionGrid
            data={data}
            state={state}
            view={view}
            gridSide={gridSide}
            stepType={stepType}
            selected={selected}
            onSelect={select}
            onLock={lockIn}
            suggestions={gridSuggestions}
            suggestionLabel={suggestionLabel}
            searchRef={searchRef}
            selectable={view.canAct}
            stepIndex={stepIndex}
          />
        </div>
        <ActionBar
          state={state}
          view={view}
          selectedChamp={lookup(selected)}
          selectedId={selected}
          selectedAvailable={!!selected && available(selected)}
          lockPending={lockPending}
          onLock={lockIn}
          onNoBan={noBan}
          send={send}
          onReset={() => setResetOpen(true)}
        />
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:h-dvh lg:min-h-[38rem] lg:overflow-hidden">
      <RoomStyles />
      <RoomHeader
        state={state}
        view={view}
        you={you}
        status={status}
        serverNow={serverNow}
        onShare={() => setShareOpen(true)}
        onSwitchToHost={hostKey ? () => onUseKey(hostKey) : undefined}
      />
      <ConnectionBanner status={status} hasLiveState={!!room.state} />

      <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_22rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
        <main className="flex min-h-0 min-w-0 flex-col">
          <BansBar state={state} view={view} lookup={lookup} serverNow={serverNow} />
          <SeriesStrip
            state={state}
            view={view}
            lookup={lookup}
            open={seriesOpen}
            onToggle={() => setSeriesOpen((o) => !o)}
            onSetResult={you?.kind === "host" ? (game, winner) => send({ t: "setWinner", winner, game }) : undefined}
          />
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 p-2 lg:grid-cols-[10.5rem_minmax(0,1fr)_10.5rem] lg:gap-3 lg:p-3 xl:grid-cols-[12rem_minmax(0,1fr)_12rem] 2xl:grid-cols-[15rem_minmax(0,1fr)_15rem]">
            <PickColumn state={state} view={view} side="blue" lookup={lookup} roles={output?.roles.blue} serverNow={serverNow} />
            <section
              className={cn(
                "order-3 col-span-2 flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-panel/80 lg:order-none lg:col-span-1 lg:h-auto lg:min-h-0",
                gridMode ? !gridCollapsed && "h-[78dvh] min-h-[26rem]" : "min-h-[20rem]",
              )}
              aria-label={lobby ? "Lobby" : complete ? "Draft summary" : `${GAMES[game].unit} select`}
            >
              {center}
            </section>
            <PickColumn state={state} view={view} side="red" lookup={lookup} roles={output?.roles.red} serverNow={serverNow} />
          </div>
        </main>

        <Suggestions
          className="min-h-[24rem] border-t border-line lg:min-h-0 lg:border-t-0 lg:border-l"
          game={game}
          output={output}
          engineError={engine.error ?? (dataError ? dataError.message : null)}
          dataLoading={dataLoading}
          perspective={perspective}
          onPerspective={(side) => setPerspSlot(state.sides[side])}
          names={names}
          profiles={{ blue: blueProfile, red: redProfile }}
          yourSide={view.yourSide}
          lookup={lookup}
          onSelect={select}
          isAvailable={available}
          weights={weights}
          setWeight={setWeight}
          resetWeights={resetWeights}
          weightsDefault={weightsDefault}
          buildCoachContext={buildCtx}
          next={next}
          complete={complete}
        />
      </div>

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} roomId={roomId} state={state} you={you} yourKey={roomKey} send={send} />
      <ConfirmDialog
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={`Reset game ${state.gameNumber}?`}
        body="All picks and bans of this game are cleared and the room returns to the lobby (captains ready up again). Earlier games in the series are kept."
        confirmLabel="Reset draft"
        onConfirm={() => send({ t: "reset" })}
      />
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

function ConnectionBanner({ status, hasLiveState }: { status: RoomHook["status"]; hasLiveState: boolean }) {
  if (status === "open") return null;
  if (status === "connecting" && hasLiveState) return null;
  const tone = status === "closed" ? "border-bad/40 bg-bad/15 text-bad" : "border-warn/40 bg-warn/10 text-warn";
  return (
    <div className={cn("flex items-center justify-center gap-2 border-b px-3 py-1.5 text-center text-xs font-medium", tone)} role="status">
      {status !== "closed" && <Spinner className="size-3.5" />}
      {status === "connecting" && "Connecting to the live room… showing the last known state."}
      {status === "reconnecting" && "Connection lost — reconnecting. The board may be out of date."}
      {status === "closed" && (
        <>
          Disconnected from the room.
          <button onClick={() => window.location.reload()} className="underline underline-offset-2 hover:text-text">
            Reconnect
          </button>
        </>
      )}
    </div>
  );
}

export function RoomNotFound({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  return (
    <FullScreenMessage title="Room not found">
      <p>
        There's no draft room <span className="font-mono break-all text-text">{roomId}</span>. The link may be mistyped, or the room has expired.
      </p>
      <div className="mt-5 flex justify-center gap-2">
        <Button variant="primary" onClick={() => navigate("/rooms/new")}>
          Create a new draft
        </Button>
        <Button variant="ghost" onClick={() => navigate("/")}>
          Home
        </Button>
      </div>
    </FullScreenMessage>
  );
}
