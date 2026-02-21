"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSocket } from "@/app/lib/socket";
import {
  ActionLogDTO,
  ClientAction,
  GameStatePatchDTO,
  GameStateDTO,
  TerritoryStateDTO,
  submitActionSchema,
} from "@/app/lib/game/protocol";
import TurnBanner from "./TurnBanner";
import MapBoard from "./MapBoard";
import BattleLog from "./BattleLog";

type Feedback = { kind: "success" | "error" | "info"; message: string };
type PendingAction = { action: ClientAction };
type BattleFx = { kind: "win" | "lose"; message: string } | null;

function applyGamePatch(state: GameStateDTO, patch: GameStatePatchDTO): GameStateDTO {
  if (patch.gameCode !== state.gameCode) return state;

  const nextPlayers =
    patch.players && patch.players.length > 0
      ? state.players.map((player) => {
          const diff = patch.players?.find((p) => p.id === player.id);
          if (!diff) return player;
          return {
            ...player,
            isAlive: diff.isAlive ?? player.isAlive,
            isConnected: diff.isConnected ?? player.isConnected,
            reinforcements: diff.reinforcements ?? player.reinforcements,
            territoryCount: diff.territoryCount ?? player.territoryCount,
          };
        })
      : state.players;

  const nextTerritories =
    patch.territories && patch.territories.length > 0
      ? state.territories.map((territory) => {
          const diff = patch.territories?.find((t) => t.territoryKey === territory.territoryKey);
          if (!diff) return territory;
          return {
            ...territory,
            ownerPlayerId: diff.ownerPlayerId ?? territory.ownerPlayerId,
            troops: diff.troops ?? territory.troops,
          };
        })
      : state.territories;

  return {
    ...state,
    status: patch.status ?? state.status,
    turnNumber: patch.turnNumber ?? state.turnNumber,
    currentPhase: patch.currentPhase ?? state.currentPhase,
    currentTurnPlayerId: patch.currentTurnPlayerId ?? state.currentTurnPlayerId,
    winnerPlayerId: patch.winnerPlayerId ?? state.winnerPlayerId,
    players: nextPlayers,
    territories: nextTerritories,
  };
}

function toUserError(reason: string) {
  const lower = reason.toLowerCase();
  if (lower.includes("adjacent") || lower.includes("attack")) {
    return "Ce territoire n'est pas adjacent ou la cible est invalide.";
  }
  if (lower.includes("turn")) {
    return "Ce n'est pas ton tour.";
  }
  if (lower.includes("reinforcement")) {
    return "Tu n'as plus de renforts disponibles.";
  }
  if (lower.includes("fortify")) {
    return "Fortification invalide: garde au moins 1 troupe sur la source.";
  }
  return reason;
}

function applyOptimisticAction(state: GameStateDTO, action: ClientAction, myPlayerId: string | null): GameStateDTO {
  if (!myPlayerId) return state;

  const next: GameStateDTO = {
    ...state,
    players: state.players.map((p) => ({ ...p })),
    territories: state.territories.map((t) => ({ ...t })),
  };
  const byKey = new Map(next.territories.map((t) => [t.territoryKey, t]));
  const me = next.players.find((p) => p.id === myPlayerId);
  if (!me) return state;

  if (action.type === "place_reinforcement") {
    const target = byKey.get(action.territoryKey);
    if (!target || target.ownerPlayerId !== myPlayerId || me.reinforcements <= 0) return state;
    target.troops += 1;
    me.reinforcements -= 1;
    if (me.reinforcements <= 0) next.currentPhase = "attack";
    return next;
  }

  if (action.type === "end_attack_phase") {
    next.currentPhase = "fortify";
    return next;
  }

  if (action.type === "end_turn") {
    const alive = [...next.players].filter((p) => p.isAlive).sort((a, b) => a.seat - b.seat);
    const currentIdx = alive.findIndex((p) => p.id === next.currentTurnPlayerId);
    const nextPlayer = currentIdx >= 0 ? alive[(currentIdx + 1) % alive.length] : alive[0];
    if (!nextPlayer) return state;
    next.turnNumber += 1;
    next.currentTurnPlayerId = nextPlayer.id;
    next.currentPhase = "reinforce";
    const upcoming = next.players.find((p) => p.id === nextPlayer.id);
    if (upcoming) upcoming.reinforcements = 3;
    return next;
  }

  return state;
}

function phaseHint(phase: "reinforce" | "attack" | "fortify", isMyTurn: boolean) {
  if (!isMyTurn) return "Tour adverse. Observe la carte.";
  if (phase === "reinforce") return "Clique un de tes territoires pour y poser 1 renfort.";
  if (phase === "attack") return "Clique source puis cible ennemie adjacente pour attaquer.";
  return "Clique source puis cible alliee adjacente pour fortifier (une seule fois).";
}

export default function GameClient({
  locale,
  code,
  displayName,
}: {
  locale: string;
  code: string;
  displayName: string;
}) {
  const [gameState, setGameState] = useState<GameStateDTO | null>(null);
  const [selectedFrom, setSelectedFrom] = useState<string | null>(null);
  const [selectedTo, setSelectedTo] = useState<string | null>(null);
  const [hoveredTerritoryKey, setHoveredTerritoryKey] = useState<string | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<Feedback | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [pendingAttackCount, setPendingAttackCount] = useState(0);
  const [battleFx, setBattleFx] = useState<BattleFx>(null);
  const [floatingNotice, setFloatingNotice] = useState<Feedback | null>(null);
  const [floatingNoticeVisible, setFloatingNoticeVisible] = useState(false);

  const [attackPrompt, setAttackPrompt] = useState<{
    from: string;
    to: string;
    maxMove: number;
    moveTroops: number;
  } | null>(null);
  const [fortifyPrompt, setFortifyPrompt] = useState<{
    from: string;
    to: string;
    maxTroops: number;
    troops: number;
  } | null>(null);

  const confirmedRef = useRef<GameStateDTO | null>(null);
  const pendingActionsRef = useRef<PendingAction[]>([]);
  const myPlayerIdRef = useRef<string | null>(null);

  const recomputeProjectedState = useCallback(() => {
    const confirmed = confirmedRef.current;
    if (!confirmed) return;
    let projected = confirmed;
    for (const pending of pendingActionsRef.current) {
      projected = applyOptimisticAction(projected, pending.action, myPlayerIdRef.current);
    }
    setGameState(projected);
    setPendingCount(pendingActionsRef.current.length);
    setPendingAttackCount(pendingActionsRef.current.filter((p) => p.action.type === "attack").length);
  }, []);

  useEffect(() => {
    myPlayerIdRef.current = myPlayerId;
  }, [myPlayerId]);

  useEffect(() => {
    if (!actionFeedback || actionFeedback.message === "Etat de partie synchronise.") return;
    const showTimer = window.setTimeout(() => {
      setFloatingNotice(actionFeedback);
      setFloatingNoticeVisible(true);
    }, 0);

    const fadeTimer = window.setTimeout(() => setFloatingNoticeVisible(false), 2100);
    const clearTimer = window.setTimeout(() => setFloatingNotice(null), 2550);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [actionFeedback]);

  useEffect(() => {
    const s = getSocket();
    s.emit("join_game", { gameCode: code });

    const onGameState = (payload: GameStateDTO) => {
      if (payload.gameCode !== code) return;
      setJoinError(null);
      const previousConfirmed = confirmedRef.current;
      const nextConfirmed =
        payload.logs.length === 0 && previousConfirmed ? { ...payload, logs: previousConfirmed.logs } : payload;
      confirmedRef.current = nextConfirmed;
      recomputeProjectedState();
      setActionFeedback((prev) =>
        prev?.kind === "error" ? prev : { kind: "success", message: "Etat de partie synchronise." },
      );
    };

    const onRejected = (payload: { reason: string }) => {
      if (pendingActionsRef.current.length > 0) {
        pendingActionsRef.current = pendingActionsRef.current.slice(1);
      }
      recomputeProjectedState();
      setAttackPrompt(null);
      setFortifyPrompt(null);
      setActionFeedback({ kind: "error", message: toUserError(payload.reason) });
      if (!confirmedRef.current) {
        setJoinError(toUserError(payload.reason));
      }
      s.emit("join_game", { gameCode: code });
    };

    const onFinished = (payload: { gameCode: string; winnerPlayerId: string | null }) => {
      if (payload.gameCode !== code) return;
      setActionFeedback({ kind: "info", message: "Partie terminee." });
    };

    const onActionApplied = (patch: GameStatePatchDTO) => {
      if (patch.gameCode !== code) return;
      if (confirmedRef.current) confirmedRef.current = applyGamePatch(confirmedRef.current, patch);
      if (pendingActionsRef.current.length > 0) {
        pendingActionsRef.current = pendingActionsRef.current.slice(1);
      }
      recomputeProjectedState();
      setActionFeedback({ kind: "success", message: "Action appliquee." });
    };

    const onJoined = (payload: { gameCode: string; playerId: string }) => {
      if (payload.gameCode !== code) return;
      myPlayerIdRef.current = payload.playerId;
      setMyPlayerId(payload.playerId);
      recomputeProjectedState();
    };

    const onActionLog = (payload: ActionLogDTO) => {
      const confirmed = confirmedRef.current;
      if (confirmed && !confirmed.logs.some((log) => log.id === payload.id)) {
        confirmedRef.current = { ...confirmed, logs: [...confirmed.logs, payload].slice(-20) };
        recomputeProjectedState();
      }

      if (payload.type === "attack") {
        const raw = payload.payload as Record<string, unknown>;
        const attackerLosses = Number(raw.attackerLosses ?? 0);
        const defenderLosses = Number(raw.defenderLosses ?? 0);
        const actorIsMe = payload.actorPlayerId && payload.actorPlayerId === myPlayerIdRef.current;
        if (actorIsMe) {
          setBattleFx(
            defenderLosses > attackerLosses
              ? { kind: "win", message: "Attaque favorable" }
              : { kind: "lose", message: "Attaque defavorable" },
          );
          window.setTimeout(() => setBattleFx(null), 1200);
        }
      }
    };

    s.on("game_state", onGameState);
    s.on("action_rejected", onRejected);
    s.on("game_finished", onFinished);
    s.on("joined_game", onJoined);
    s.on("action_log", onActionLog);
    s.on("action_applied", onActionApplied);

    return () => {
      s.off("game_state", onGameState);
      s.off("action_rejected", onRejected);
      s.off("game_finished", onFinished);
      s.off("joined_game", onJoined);
      s.off("action_log", onActionLog);
      s.off("action_applied", onActionApplied);
      s.emit("leave_game", { gameCode: code });
    };
  }, [code, recomputeProjectedState]);

  const territoryByKey = useMemo(
    () => new Map(gameState?.territories.map((t) => [t.territoryKey, t]) ?? []),
    [gameState],
  );

  const isMyTurn = Boolean(myPlayerId) && gameState?.currentTurnPlayerId === myPlayerId;
  const currentPhase = gameState?.currentPhase ?? "reinforce";
  const uiHint = phaseHint(currentPhase, Boolean(isMyTurn));

  const sendAction = (action: ClientAction) => {
    const parsed = submitActionSchema.safeParse(action);
    if (!parsed.success) {
      setActionFeedback({ kind: "error", message: "Action invalide." });
      return;
    }

    const labelByType: Record<ClientAction["type"], string> = {
      ready: "Action envoyee",
      place_reinforcement: "Renfort envoye (optimiste)",
      attack: "Attaque envoyee",
      fortify: "Fortification envoyee",
      end_attack_phase: "Passage en phase fortification",
      end_turn: "Fin de tour",
    };

    setActionFeedback({
      kind: "info",
      message: `${labelByType[parsed.data.type]}, en attente de validation serveur...`,
    });

    pendingActionsRef.current = [...pendingActionsRef.current, { action: parsed.data }];
    recomputeProjectedState();
    getSocket().emit("submit_action", { gameCode: code, action: parsed.data });
  };

  const territoryIsMine = (territory: TerritoryStateDTO | undefined) =>
    Boolean(territory && myPlayerId && territory.ownerPlayerId === myPlayerId);

  const deselect = () => {
    setSelectedFrom(null);
    setSelectedTo(null);
    setAttackPrompt(null);
    setFortifyPrompt(null);
  };

  const pickTerritory = (territoryKey: string) => {
    if (!gameState || !isMyTurn || gameState.status !== "in_progress") return;
    const clicked = territoryByKey.get(territoryKey);
    if (!clicked) return;

    if (currentPhase === "reinforce") {
      if (!territoryIsMine(clicked)) return;
      sendAction({ type: "place_reinforcement", territoryKey });
      return;
    }

    if (currentPhase === "attack") {
      if (!selectedFrom) {
        if (territoryIsMine(clicked) && clicked.troops > 1) setSelectedFrom(territoryKey);
        return;
      }

      const from = territoryByKey.get(selectedFrom);
      if (!from) {
        setSelectedFrom(null);
        return;
      }

      if (territoryKey === selectedFrom) {
        setSelectedFrom(null);
        setSelectedTo(null);
        return;
      }

      if (territoryIsMine(clicked)) {
        if (clicked.troops > 1) {
          setSelectedFrom(territoryKey);
          setSelectedTo(null);
        }
        return;
      }

      if (!from.adjacency.includes(territoryKey)) return;
      const maxMove = Math.max(1, from.troops - 1);
      setSelectedTo(territoryKey);
      setAttackPrompt({ from: selectedFrom, to: territoryKey, maxMove, moveTroops: Math.min(3, maxMove) });
      return;
    }

    if (currentPhase === "fortify") {
      if (!selectedFrom) {
        if (territoryIsMine(clicked) && clicked.troops > 1) setSelectedFrom(territoryKey);
        return;
      }

      const from = territoryByKey.get(selectedFrom);
      if (!from) {
        setSelectedFrom(null);
        return;
      }

      if (territoryKey === selectedFrom) {
        setSelectedFrom(null);
        setSelectedTo(null);
        return;
      }

      if (!territoryIsMine(clicked) || !from.adjacency.includes(territoryKey)) return;
      const maxTroops = Math.max(1, from.troops - 1);
      setSelectedTo(territoryKey);
      setFortifyPrompt({ from: selectedFrom, to: territoryKey, maxTroops, troops: 1 });
    }
  };

  if (!gameState) {
    return (
      <main className="fixed inset-0 z-0 bg-slate-900 px-4 py-6">
        <div className="panel p-4">
          <p>Chargement de la partie {code}...</p>
          {joinError && <p className="mt-2 text-sm text-red-700">{joinError}</p>}
        </div>
      </main>
    );
  }

  const feedbackClass =
    floatingNotice?.kind === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : floatingNotice?.kind === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-700";
  const syncIndicatorClass =
    actionFeedback?.kind === "error"
      ? "bg-red-500"
      : actionFeedback?.kind === "success"
        ? "bg-emerald-500"
        : "bg-slate-500";
  const isSyncIndicator = actionFeedback?.message === "Etat de partie synchronise.";

  const battleFxClass =
    battleFx?.kind === "win" ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-rose-300 bg-rose-100 text-rose-800";

  return (
    <main className="fixed inset-0 overflow-hidden bg-gradient-to-br from-cyan-100 via-amber-50 to-emerald-100">
      <section className="absolute inset-0 z-0">
        <MapBoard
          gameState={gameState}
          myPlayerId={myPlayerId}
          mode={currentPhase}
          selectedFrom={selectedFrom}
          selectedTo={selectedTo}
          hoveredTerritoryKey={hoveredTerritoryKey}
          setHoveredTerritoryKey={setHoveredTerritoryKey}
          adjacencyHintStyle="halo-lines"
          onPick={pickTerritory}
          onDeselect={deselect}
        />
      </section>

      <div className="pointer-events-none absolute left-0 right-0 top-2 z-20 flex justify-center px-2">
        <div className="w-full max-w-5xl space-y-2">
          <TurnBanner
            gameState={gameState}
            myPlayerId={myPlayerId}
            mode={currentPhase}
            displayName={displayName}
            uiHint={uiHint}
          />
          {floatingNotice && (
            <div
              className={`pointer-events-auto rounded-xl border px-3 py-2 text-sm shadow-lg transition-all duration-300 ${feedbackClass} ${
                floatingNoticeVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
              }`}
            >
              {floatingNotice.message}
            </div>
          )}
        </div>
      </div>

      <aside className="pointer-events-none absolute right-2 top-28 z-20 hidden w-[360px] xl:block">
        <div className="pointer-events-auto panel max-h-[72vh] overflow-hidden border-amber-200/80 bg-white/90 p-3 shadow-lg backdrop-blur">
          <BattleLog gameState={gameState} />
        </div>
      </aside>

      <aside className="pointer-events-none absolute right-2 top-[calc(28vh)] z-20 xl:hidden">
        <div className="pointer-events-auto panel max-h-[36vh] w-[320px] overflow-hidden border-amber-200/80 bg-white/90 p-3 shadow-lg backdrop-blur">
          <BattleLog gameState={gameState} />
        </div>
      </aside>

      <div className="pointer-events-none absolute left-2 top-28 z-20 w-[min(540px,calc(100vw-1rem))] space-y-2 sm:left-3 md:left-4">
        {pendingAttackCount > 0 && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
            Attaque en cours de validation serveur...
          </div>
        )}

        {battleFx && (
          <div className={`pointer-events-auto rounded-lg border px-3 py-2 text-sm font-semibold ${battleFxClass}`}>{battleFx.message}</div>
        )}
      </div>

      {isSyncIndicator && (
        <div
          className={`pointer-events-none absolute left-3 top-3 z-30 h-3.5 w-3.5 rounded-sm shadow ${syncIndicatorClass}`}
          title="Etat de partie synchronise"
          aria-label="Etat de partie synchronise"
        />
      )}

      <div className="pointer-events-none absolute bottom-5 left-0 right-0 z-30 flex justify-center px-2">
        <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-xl border border-emerald-200/80 bg-white/90 p-2 shadow-lg backdrop-blur">
          {isMyTurn && currentPhase === "attack" && (
            <button className="btn-secondary border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100" onClick={() => sendAction({ type: "end_attack_phase" })}>
              Passer a la fortification
            </button>
          )}
          {isMyTurn && currentPhase === "fortify" && (
            <button className="btn-secondary border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" onClick={() => sendAction({ type: "end_turn" })}>
              Terminer le tour
            </button>
          )}
        </div>
      </div>

      {attackPrompt && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="panel w-full max-w-md p-4">
            <h3 className="text-base font-semibold">Attaque: troupes a deplacer si capture</h3>
            <p className="mt-1 text-sm text-slate-600">{`${attackPrompt.from} -> ${attackPrompt.to}`}</p>
            <p className="mt-3 text-sm">Deplacement: {attackPrompt.moveTroops}</p>
            <input
              className="mt-1 w-full"
              type="range"
              min={1}
              max={attackPrompt.maxMove}
              value={attackPrompt.moveTroops}
              onChange={(e) =>
                setAttackPrompt((prev) => (prev ? { ...prev, moveTroops: Number(e.target.value) } : prev))
              }
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setAttackPrompt(null)}>Annuler</button>
              <button
                className="btn-primary"
                onClick={() => {
                  sendAction({
                    type: "attack",
                    fromTerritoryKey: attackPrompt.from,
                    toTerritoryKey: attackPrompt.to,
                    attackDice: Math.min(3, Math.max(1, (territoryByKey.get(attackPrompt.from)?.troops ?? 2) - 1)),
                    moveTroopsOnCapture: attackPrompt.moveTroops,
                  });
                  setAttackPrompt(null);
                }}
              >
                Confirmer attaque
              </button>
            </div>
          </div>
        </div>
      )}

      {fortifyPrompt && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="panel w-full max-w-md p-4">
            <h3 className="text-base font-semibold">Fortification</h3>
            <p className="mt-1 text-sm text-slate-600">{`${fortifyPrompt.from} -> ${fortifyPrompt.to}`}</p>
            <p className="mt-3 text-sm">Troupes a deplacer: {fortifyPrompt.troops}</p>
            <input
              className="mt-1 w-full"
              type="range"
              min={1}
              max={fortifyPrompt.maxTroops}
              value={fortifyPrompt.troops}
              onChange={(e) =>
                setFortifyPrompt((prev) => (prev ? { ...prev, troops: Number(e.target.value) } : prev))
              }
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setFortifyPrompt(null)}>Annuler</button>
              <button
                className="btn-primary"
                onClick={() => {
                  sendAction({
                    type: "fortify",
                    fromTerritoryKey: fortifyPrompt.from,
                    toTerritoryKey: fortifyPrompt.to,
                    troops: fortifyPrompt.troops,
                  });
                  setFortifyPrompt(null);
                }}
              >
                Confirmer fortification
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="pointer-events-none absolute bottom-1 left-2 z-30 text-[11px] text-slate-100/90">
        Partie {code} ({locale}) - Joueur local: {displayName}
        {pendingCount > 0 ? ` - ${pendingCount} action(s) en attente` : ""}
      </p>
    </main>
  );
}
