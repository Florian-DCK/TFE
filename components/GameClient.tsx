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
import MapBoard from "./MapBoard";
import BattleLog from "./BattleLog";
import PlayerSidebar from "./PlayerSidebar";

type Feedback = { kind: "success" | "error" | "info"; message: string };
type PendingAction = { action: ClientAction };
type CaptureFillAnimation = {
  id: string;
  toTerritoryKey: string;
  fromTerritoryKey: string;
  previousOwnerPlayerId: string;
  newOwnerPlayerId: string;
};
type BattleSummary = {
  attackerName: string;
  defenderName: string;
  fromTerritoryKey: string;
  toTerritoryKey: string;
  attackerRolls: number[];
  defenderRolls: number[];
  attackerLosses: number;
  defenderLosses: number;
};
type CombatOverlay = { stage: "rolling" } | null;
type ActionVisual = {
  fromTerritoryKey: string | null;
  toTerritoryKey: string | null;
  actorIsMe: boolean;
} | null;
type TroopPopup = { id: string; territoryKey: string; amount: number; kind: "loss" | "gain" };
type PhaseIntro = {
  phase: "reinforce" | "attack" | "fortify";
  title: string;
  subtitle: string;
  amount: number | null;
  visible: boolean;
} | null;

function singleAttackWinChance(attackerTroops: number, defenderTroops: number, requestedAttackDice: number) {
  if (attackerTroops <= 1 || defenderTroops <= 0) return 0;
  const attackDice = Math.min(Math.max(1, requestedAttackDice), Math.min(3, attackerTroops - 1));
  const defendDice = Math.min(2, defenderTroops);
  const comparisons = Math.min(attackDice, defendDice);

  const generate = (count: number) => {
    const out: number[][] = [];
    const path: number[] = [];
    const dfs = () => {
      if (path.length === count) {
        out.push([...path].sort((a, b) => b - a));
        return;
      }
      for (let die = 1; die <= 6; die += 1) {
        path.push(die);
        dfs();
        path.pop();
      }
    };
    dfs();
    return out;
  };

  const attackRolls = generate(attackDice);
  const defenseRolls = generate(defendDice);
  const total = Math.pow(6, attackDice + defendDice);
  let winningOutcomes = 0;

  for (const a of attackRolls) {
    for (const d of defenseRolls) {
      let defenderLosses = 0;
      for (let i = 0; i < comparisons; i += 1) {
        if (a[i] > d[i]) defenderLosses += 1;
      }
      if (defenderLosses >= defenderTroops) {
        winningOutcomes += 1;
      }
    }
  }

  return total > 0 ? winningOutcomes / total : 0;
}

function computeReinforcementsPreview(state: GameStateDTO, playerId: string) {
  const owned = state.territories.filter((territory) => territory.ownerPlayerId === playerId);
  const base = Math.max(3, Math.floor(owned.length / 3));
  let continentBonus = 0;

  for (const continent of state.map.continents) {
    const continentTerritories = state.territories.filter((territory) => territory.continent === continent.key);
    if (continentTerritories.length === 0) continue;
    if (continentTerritories.every((territory) => territory.ownerPlayerId === playerId)) {
      continentBonus += continent.bonus;
    }
  }

  return base + continentBonus;
}

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
    const troopsToPlace = Math.min(Math.max(1, action.troops ?? 1), me.reinforcements);
    target.troops += troopsToPlace;
    me.reinforcements -= troopsToPlace;
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
    const nextIdx = alive.findIndex((p) => p.id === nextPlayer.id);
    if (currentIdx >= 0 && nextIdx >= 0 && nextIdx <= currentIdx) {
      next.turnNumber += 1;
    }
    next.currentTurnPlayerId = nextPlayer.id;
    next.currentPhase = "reinforce";
    const upcoming = next.players.find((p) => p.id === nextPlayer.id);
    if (upcoming) {
      upcoming.reinforcements = computeReinforcementsPreview(next, nextPlayer.id);
    }
    return next;
  }

  return state;
}

function hasAlliedPathClient(
  fromKey: string,
  toKey: string,
  myPlayerId: string,
  territoryByKey: Map<string, TerritoryStateDTO>,
) {
  const from = territoryByKey.get(fromKey);
  const to = territoryByKey.get(toKey);
  if (!from || !to) return false;
  if (from.ownerPlayerId !== myPlayerId || to.ownerPlayerId !== myPlayerId) return false;
  if (fromKey === toKey) return true;

  const visited = new Set<string>([fromKey]);
  const queue = [fromKey];
  while (queue.length > 0) {
    const currentKey = queue.shift()!;
    const current = territoryByKey.get(currentKey);
    if (!current) continue;
    for (const neighborKey of current.adjacency) {
      if (visited.has(neighborKey)) continue;
      const neighbor = territoryByKey.get(neighborKey);
      if (!neighbor || neighbor.ownerPlayerId !== myPlayerId) continue;
      if (neighborKey === toKey) return true;
      visited.add(neighborKey);
      queue.push(neighborKey);
    }
  }
  return false;
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
  const [combatOverlay, setCombatOverlay] = useState<CombatOverlay>(null);
  const [opponentIntentVisual, setOpponentIntentVisual] = useState<ActionVisual>(null);
  const [opponentActionVisual, setOpponentActionVisual] = useState<ActionVisual>(null);
  const [floatingNotice, setFloatingNotice] = useState<Feedback | null>(null);
  const [floatingNoticeVisible, setFloatingNoticeVisible] = useState(false);
  const [troopPopups, setTroopPopups] = useState<TroopPopup[]>([]);
  const [captureFillAnimations, setCaptureFillAnimations] = useState<CaptureFillAnimation[]>([]);
  const [phaseIntro, setPhaseIntro] = useState<PhaseIntro>(null);
  const [lastBattleSummary, setLastBattleSummary] = useState<BattleSummary | null>(null);

  const [attackPrompt, setAttackPrompt] = useState<{
    from: string;
    to: string;
    maxMove: number;
    moveTroops: number;
  } | null>(null);
  const [reinforcePrompt, setReinforcePrompt] = useState<{
    territoryKey: string;
    maxTroops: number;
    troops: number;
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
  const opponentActionVisualTimerRef = useRef<number | null>(null);
  const opponentIntentVisualRef = useRef<ActionVisual>(null);
  const animatedLogIdsRef = useRef<Set<string>>(new Set());
  const phaseIntroKeyRef = useRef<string>("");
  const phaseIntroShowTimerRef = useRef<number | null>(null);
  const phaseIntroFadeTimerRef = useRef<number | null>(null);
  const phaseIntroClearTimerRef = useRef<number | null>(null);
  const joinNameRef = useRef<string>(displayName);

  useEffect(() => {
    const normalizedProp = displayName.trim().slice(0, 50);
    const guestFromStorage =
      typeof window !== "undefined" ? (window.localStorage.getItem("guest_pseudo") ?? "").trim().slice(0, 50) : "";

    const resolvedName = normalizedProp || guestFromStorage || "Guest-Player";

    joinNameRef.current = resolvedName;
    if (resolvedName.startsWith("Guest-")) {
      window.localStorage.setItem("guest_pseudo", resolvedName);
    }
  }, [displayName]);

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

  const queueTroopPopup = useCallback((territoryKey: string, amount: number) => {
    if (!territoryKey || amount === 0) return;
    const popup: TroopPopup = {
      id: `${territoryKey}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      territoryKey,
      amount: Math.abs(amount),
      kind: amount > 0 ? "gain" : "loss",
    };
    setTroopPopups((prev) => [...prev, popup]);
    window.setTimeout(() => {
      setTroopPopups((prev) => prev.filter((entry) => entry.id !== popup.id));
    }, 1150);
  }, []);

  const queueCaptureFillAnimation = useCallback((animation: CaptureFillAnimation) => {
    setCaptureFillAnimations((prev) => [...prev, animation]);
    window.setTimeout(() => {
      setCaptureFillAnimations((prev) => prev.filter((entry) => entry.id !== animation.id));
    }, 900);
  }, []);

  const animateTroopPopupsFromLog = useCallback(
    (payload: ActionLogDTO) => {
      if (animatedLogIdsRef.current.has(payload.id)) return;
      const raw = payload.payload as Record<string, unknown>;

      if (payload.type === "place_reinforcement") {
        const territoryKey = typeof raw.territoryKey === "string" ? raw.territoryKey : null;
        const troops = Number(raw.troops ?? 1);
        if (territoryKey && Number.isFinite(troops) && troops > 0) {
          queueTroopPopup(territoryKey, troops);
        }
      }

      if (payload.type === "attack") {
        const from = typeof raw.fromTerritoryKey === "string" ? raw.fromTerritoryKey : null;
        const to = typeof raw.toTerritoryKey === "string" ? raw.toTerritoryKey : null;
        const attackerLosses = Number(raw.attackerLosses ?? 0);
        const defenderLosses = Number(raw.defenderLosses ?? 0);
        if (from && Number.isFinite(attackerLosses) && attackerLosses > 0) {
          queueTroopPopup(from, -attackerLosses);
        }
        if (to && Number.isFinite(defenderLosses) && defenderLosses > 0) {
          queueTroopPopup(to, -defenderLosses);
        }
      }

      if (payload.type === "fortify") {
        const from = typeof raw.fromTerritoryKey === "string" ? raw.fromTerritoryKey : null;
        const to = typeof raw.toTerritoryKey === "string" ? raw.toTerritoryKey : null;
        const troops = Number(raw.troops ?? 0);
        if (Number.isFinite(troops) && troops > 0) {
          if (from) queueTroopPopup(from, -troops);
          if (to) queueTroopPopup(to, troops);
        }
      }

      animatedLogIdsRef.current.add(payload.id);
      if (animatedLogIdsRef.current.size > 500) {
        const oldest = animatedLogIdsRef.current.values().next().value;
        if (oldest) animatedLogIdsRef.current.delete(oldest);
      }
    },
    [queueTroopPopup],
  );

  useEffect(() => {
    myPlayerIdRef.current = myPlayerId;
  }, [myPlayerId]);

  useEffect(() => {
    opponentIntentVisualRef.current = opponentIntentVisual;
  }, [opponentIntentVisual]);

  const setOpponentActionVisualWithTTL = useCallback((next: ActionVisual, ttlMs = 2200) => {
    if (opponentActionVisualTimerRef.current) {
      window.clearTimeout(opponentActionVisualTimerRef.current);
      opponentActionVisualTimerRef.current = null;
    }
    setOpponentActionVisual(next);
    if (next && ttlMs > 0) {
      opponentActionVisualTimerRef.current = window.setTimeout(() => {
        setOpponentActionVisual(null);
        opponentActionVisualTimerRef.current = null;
      }, ttlMs);
    }
  }, []);

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
    const tryJoinGame = () => {
      s.emit("join_game", { gameCode: code, name: joinNameRef.current });
    };

    const onGameState = (payload: GameStateDTO) => {
      if (payload.gameCode !== code) return;
      setJoinError(null);
      if (!myPlayerIdRef.current) {
        const resolved = payload.players.find((player) => player.displayName === joinNameRef.current);
        if (resolved) {
          myPlayerIdRef.current = resolved.id;
          setMyPlayerId(resolved.id);
        }
      }
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
      setSelectedFrom(null);
      setSelectedTo(null);
      setAttackPrompt(null);
      setReinforcePrompt(null);
      setFortifyPrompt(null);
      setCombatOverlay(null);
      setActionFeedback({ kind: "error", message: toUserError(payload.reason) });
      if (!confirmedRef.current) {
        setJoinError(toUserError(payload.reason));
      }
      s.emit("join_game", { gameCode: code, name: joinNameRef.current });
    };

    const onFinished = (payload: { gameCode: string; winnerPlayerId: string | null }) => {
      if (payload.gameCode !== code) return;
      setActionFeedback({ kind: "info", message: "Partie terminee." });
    };

    const onActionApplied = (patch: GameStatePatchDTO) => {
      if (patch.gameCode !== code) return;
      const previousConfirmed = confirmedRef.current;
      if (previousConfirmed && patch.territories?.length) {
        for (const territoryPatch of patch.territories) {
          if (!territoryPatch.territoryKey || typeof territoryPatch.ownerPlayerId !== "string") continue;
          const previousTerritory = previousConfirmed.territories.find(
            (territory) => territory.territoryKey === territoryPatch.territoryKey,
          );
          if (
            !previousTerritory ||
            !previousTerritory.ownerPlayerId ||
            previousTerritory.ownerPlayerId === territoryPatch.ownerPlayerId
          ) {
            continue;
          }

          let fromTerritoryKey: string | null = null;
          for (let i = previousConfirmed.logs.length - 1; i >= 0; i -= 1) {
            const log = previousConfirmed.logs[i];
            if (log.type !== "attack") continue;
            const raw = log.payload as Record<string, unknown>;
            const to = typeof raw.toTerritoryKey === "string" ? raw.toTerritoryKey : null;
            if (to !== territoryPatch.territoryKey) continue;
            const from = typeof raw.fromTerritoryKey === "string" ? raw.fromTerritoryKey : null;
            if (from) {
              fromTerritoryKey = from;
              break;
            }
          }

          if (!fromTerritoryKey) continue;
          queueCaptureFillAnimation({
            id: `capture-${territoryPatch.territoryKey}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            toTerritoryKey: territoryPatch.territoryKey,
            fromTerritoryKey,
            previousOwnerPlayerId: previousTerritory.ownerPlayerId,
            newOwnerPlayerId: territoryPatch.ownerPlayerId,
          });
        }
      }
      if (confirmedRef.current) {
        confirmedRef.current = applyGamePatch(confirmedRef.current, patch);
      }
      if (pendingActionsRef.current.length > 0) {
        pendingActionsRef.current = pendingActionsRef.current.slice(1);
      }
      recomputeProjectedState();
      setSelectedFrom(null);
      setSelectedTo(null);
      setAttackPrompt(null);
      setReinforcePrompt(null);
      setFortifyPrompt(null);
      setActionFeedback({ kind: "success", message: "Action appliquee." });
    };

    const onJoined = (payload: { gameCode: string; playerId: string }) => {
      if (payload.gameCode !== code) return;
      myPlayerIdRef.current = payload.playerId;
      setMyPlayerId(payload.playerId);
      recomputeProjectedState();
    };

    const onActionLog = (payload: ActionLogDTO) => {
      animateTroopPopupsFromLog(payload);

      const confirmed = confirmedRef.current;
      if (confirmed && !confirmed.logs.some((log) => log.id === payload.id)) {
        confirmedRef.current = { ...confirmed, logs: [...confirmed.logs, payload].slice(-20) };
        recomputeProjectedState();
      }

      if (payload.type === "attack") {
        const raw = payload.payload as Record<string, unknown>;
        const fromTerritoryKey = typeof raw.fromTerritoryKey === "string" ? raw.fromTerritoryKey : "?";
        const toTerritoryKey = typeof raw.toTerritoryKey === "string" ? raw.toTerritoryKey : "?";
        const attackerRolls = Array.isArray(raw.attackRolls)
          ? raw.attackRolls.map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : [];
        const defenderRolls = Array.isArray(raw.defenseRolls)
          ? raw.defenseRolls.map((value) => Number(value)).filter((value) => Number.isFinite(value))
          : [];
        const attackerLosses = Number(raw.attackerLosses ?? 0);
        const defenderLosses = Number(raw.defenderLosses ?? 0);
        const stateForNames = confirmedRef.current ?? gameState;
        const attackerName =
          stateForNames?.players.find((player) => player.id === payload.actorPlayerId)?.displayName ?? "Attaquant";
        const targetBeforePatch = stateForNames?.territories.find(
          (territory) => territory.territoryKey === toTerritoryKey,
        );
        const defenderName =
          stateForNames?.players.find((player) => player.id === targetBeforePatch?.ownerPlayerId)?.displayName ??
          "Defenseur";
        const summary: BattleSummary = {
          attackerName,
          defenderName,
          fromTerritoryKey,
          toTerritoryKey,
          attackerRolls,
          defenderRolls,
          attackerLosses: Number.isFinite(attackerLosses) ? attackerLosses : 0,
          defenderLosses: Number.isFinite(defenderLosses) ? defenderLosses : 0,
        };
        setLastBattleSummary(summary);
        setCombatOverlay(null);
      }

      if (payload.actorPlayerId) {
        const raw = payload.payload as Record<string, unknown>;
        const actorIsMe = payload.actorPlayerId === myPlayerIdRef.current;
        if ((payload.type === "attack" || payload.type === "fortify") && !opponentIntentVisualRef.current) {
          const from = typeof raw.fromTerritoryKey === "string" ? raw.fromTerritoryKey : null;
          const to = typeof raw.toTerritoryKey === "string" ? raw.toTerritoryKey : null;
          if (from || to) {
            setOpponentActionVisualWithTTL({ fromTerritoryKey: from, toTerritoryKey: to, actorIsMe }, 2400);
          }
        } else if (payload.type === "place_reinforcement" && !opponentIntentVisualRef.current) {
          const at = typeof raw.territoryKey === "string" ? raw.territoryKey : null;
          if (at) {
            setOpponentActionVisualWithTTL({ fromTerritoryKey: at, toTerritoryKey: null, actorIsMe }, 1800);
          }
        }
      }
    };

    const onOpponentIntent = (payload: {
      gameCode: string;
      playerId: string;
      kind: "select" | "clear";
      fromTerritoryKey: string | null;
      toTerritoryKey: string | null;
    }) => {
      if (payload.gameCode !== code) return;
      if (payload.playerId === myPlayerIdRef.current) return;
      if (payload.kind === "clear") {
        setOpponentIntentVisual(null);
        return;
      }
      setOpponentIntentVisual({
        fromTerritoryKey: payload.fromTerritoryKey,
        toTerritoryKey: payload.toTerritoryKey,
        actorIsMe: false,
      });
    };

    s.on("game_state", onGameState);
    s.on("action_rejected", onRejected);
    s.on("game_finished", onFinished);
    s.on("joined_game", onJoined);
    s.on("action_log", onActionLog);
    s.on("action_applied", onActionApplied);
    s.on("opponent_intent", onOpponentIntent);
    s.on("connect", tryJoinGame);
    tryJoinGame();

    return () => {
      s.off("game_state", onGameState);
      s.off("action_rejected", onRejected);
      s.off("game_finished", onFinished);
      s.off("joined_game", onJoined);
      s.off("action_log", onActionLog);
      s.off("action_applied", onActionApplied);
      s.off("opponent_intent", onOpponentIntent);
      s.off("connect", tryJoinGame);
      s.emit("leave_game", { gameCode: code });
    };
  }, [animateTroopPopupsFromLog, code, queueCaptureFillAnimation, recomputeProjectedState, setOpponentActionVisualWithTTL]);

  useEffect(() => {
    if (!gameState?.logs?.length) return;
    for (const log of gameState.logs) {
      animateTroopPopupsFromLog(log);
    }
  }, [animateTroopPopupsFromLog, gameState?.logs]);

  const territoryByKey = useMemo(
    () => new Map(gameState?.territories.map((t) => [t.territoryKey, t]) ?? []),
    [gameState],
  );
  const isMyTurn = Boolean(myPlayerId) && gameState?.currentTurnPlayerId === myPlayerId;
  const currentPhase = gameState?.currentPhase ?? "reinforce";
  const localActionVisual = useMemo<ActionVisual>(() => {
    if (!isMyTurn || !gameState || gameState.status !== "in_progress") return null;
    if (currentPhase === "reinforce") {
      if (!reinforcePrompt?.territoryKey) return null;
      return { fromTerritoryKey: null, toTerritoryKey: reinforcePrompt.territoryKey, actorIsMe: true };
    }
    if (currentPhase === "attack" || currentPhase === "fortify") {
      if (!selectedFrom) return null;
      return { fromTerritoryKey: selectedFrom, toTerritoryKey: selectedTo, actorIsMe: true };
    }
    return null;
  }, [currentPhase, gameState, isMyTurn, reinforcePrompt?.territoryKey, selectedFrom, selectedTo]);
  const effectiveOpponentVisual = localActionVisual ?? opponentIntentVisual ?? opponentActionVisual;
  const myPlayer = useMemo(
    () => gameState?.players.find((player) => player.id === myPlayerId) ?? null,
    [gameState?.players, myPlayerId],
  );
  const turnNumber = gameState?.turnNumber ?? 0;
  const currentTurnPlayerId = gameState?.currentTurnPlayerId ?? null;

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
    if (parsed.data.type === "attack") {
      setCombatOverlay({ stage: "rolling" });
    }

    pendingActionsRef.current = [...pendingActionsRef.current, { action: parsed.data }];
    recomputeProjectedState();
    getSocket().emit("action_intent", {
      gameCode: code,
      intent: {
        kind: "clear",
        phase: gameState?.currentPhase ?? "reinforce",
        fromTerritoryKey: null,
        toTerritoryKey: null,
      },
    });
    getSocket().emit("submit_action", { gameCode: code, action: parsed.data });
  };

  const emitIntent = useCallback(
    (fromTerritoryKey: string | null, toTerritoryKey: string | null, kind: "select" | "clear" = "select") => {
      getSocket().emit("action_intent", {
        gameCode: code,
        intent: {
          kind,
          phase: gameState?.currentPhase ?? "reinforce",
          fromTerritoryKey,
          toTerritoryKey,
        },
      });
    },
    [code, gameState?.currentPhase],
  );

  const territoryIsMine = (territory: TerritoryStateDTO | undefined) =>
    Boolean(territory && myPlayerId && territory.ownerPlayerId === myPlayerId);

  const deselect = () => {
    setSelectedFrom(null);
    setSelectedTo(null);
    setReinforcePrompt(null);
    setAttackPrompt(null);
    setFortifyPrompt(null);
    emitIntent(null, null, "clear");
  };

  useEffect(() => {
    if (!gameState || gameState.status !== "in_progress") return;

    const currentPlayer = gameState.players.find((player) => player.id === currentTurnPlayerId) ?? null;
    if (!currentPlayer) return;
    const isCurrentTurnMine = Boolean(myPlayerId) && currentTurnPlayerId === myPlayerId;

    const introKey = `${turnNumber}-${currentTurnPlayerId}-${currentPhase}`;
    if (phaseIntroKeyRef.current === introKey) return;
    phaseIntroKeyRef.current = introKey;

    if (phaseIntroShowTimerRef.current) window.clearTimeout(phaseIntroShowTimerRef.current);
    if (phaseIntroFadeTimerRef.current) window.clearTimeout(phaseIntroFadeTimerRef.current);
    if (phaseIntroClearTimerRef.current) window.clearTimeout(phaseIntroClearTimerRef.current);

    const nextIntro: Exclude<PhaseIntro, null> =
      currentPhase === "reinforce"
        ? {
            phase: "reinforce",
            title: isCurrentTurnMine ? "Ton tour" : "Tour adverse",
            subtitle: "Phase Renfort",
            amount: Math.max(0, currentPlayer.reinforcements ?? 0),
            visible: false,
          }
        : currentPhase === "attack"
          ? {
              phase: "attack",
              title: isCurrentTurnMine ? "Ton tour" : "Tour adverse",
              subtitle: "Phase Attaque",
              amount: null,
              visible: false,
            }
          : {
              phase: "fortify",
              title: isCurrentTurnMine ? "Ton tour" : "Tour adverse",
              subtitle: "Phase Fortification",
              amount: null,
              visible: false,
            };

    phaseIntroShowTimerRef.current = window.setTimeout(() => {
      setPhaseIntro({ ...nextIntro, visible: true });
    }, 0);
    phaseIntroFadeTimerRef.current = window.setTimeout(
      () => setPhaseIntro((prev) => (prev ? { ...prev, visible: false } : prev)),
      1250,
    );
    phaseIntroClearTimerRef.current = window.setTimeout(() => setPhaseIntro(null), 1750);
  }, [currentPhase, currentTurnPlayerId, gameState, myPlayerId, turnNumber]);

  useEffect(() => {
    return () => {
      if (phaseIntroShowTimerRef.current) window.clearTimeout(phaseIntroShowTimerRef.current);
      if (phaseIntroFadeTimerRef.current) window.clearTimeout(phaseIntroFadeTimerRef.current);
      if (phaseIntroClearTimerRef.current) window.clearTimeout(phaseIntroClearTimerRef.current);
    };
  }, []);

  const pickTerritory = (territoryKey: string) => {
    if (!gameState || !isMyTurn || gameState.status !== "in_progress") return;
    const clicked = territoryByKey.get(territoryKey);
    if (!clicked) return;

    if (currentPhase === "reinforce") {
      if (!territoryIsMine(clicked)) return;
      const maxTroops = myPlayer?.reinforcements ?? 0;
      if (maxTroops <= 0) return;
      emitIntent(territoryKey, null);
      setReinforcePrompt({
        territoryKey,
        maxTroops,
        troops: 1,
      });
      return;
    }

    if (currentPhase === "attack") {
      if (!selectedFrom) {
        if (territoryIsMine(clicked) && clicked.troops > 1) {
          setSelectedFrom(territoryKey);
          emitIntent(territoryKey, null);
        }
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
        emitIntent(null, null, "clear");
        return;
      }

      if (territoryIsMine(clicked)) {
        if (clicked.troops > 1) {
          setSelectedFrom(territoryKey);
          setSelectedTo(null);
          emitIntent(territoryKey, null);
        }
        return;
      }

      if (!from.adjacency.includes(territoryKey)) return;
      const maxMove = Math.max(1, from.troops - 1);
      setSelectedTo(territoryKey);
      emitIntent(selectedFrom, territoryKey);
      setAttackPrompt({ from: selectedFrom, to: territoryKey, maxMove, moveTroops: Math.min(3, maxMove) });
      return;
    }

    if (currentPhase === "fortify") {
      if (!selectedFrom) {
        if (territoryIsMine(clicked) && clicked.troops > 1) {
          setSelectedFrom(territoryKey);
          emitIntent(territoryKey, null);
        }
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
        emitIntent(null, null, "clear");
        return;
      }

      if (!territoryIsMine(clicked) || !myPlayerId) return;
      if (!hasAlliedPathClient(selectedFrom, territoryKey, myPlayerId, territoryByKey)) return;
      const maxTroops = Math.max(1, from.troops - 1);
      setSelectedTo(territoryKey);
      emitIntent(selectedFrom, territoryKey);
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

  const phaseTitle =
    currentPhase === "reinforce"
      ? "Phase Renfort"
      : currentPhase === "attack"
        ? "Phase Attaque"
        : "Phase Fortification";
  const phaseCardClass = isMyTurn
    ? "border-emerald-200 bg-white/92 text-slate-800"
    : "border-amber-200 bg-white/92 text-slate-700";

  return (
    <main
      className="fixed inset-0 overflow-hidden"
      style={{
        backgroundColor: "#0f172a",
      }}
    >
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
          opponentFromTerritoryKey={effectiveOpponentVisual?.fromTerritoryKey ?? null}
          opponentToTerritoryKey={effectiveOpponentVisual?.toTerritoryKey ?? null}
          opponentActorIsMe={effectiveOpponentVisual?.actorIsMe ?? false}
          captureFillAnimations={captureFillAnimations}
          troopPopups={troopPopups}
        />
      </section>

      <PlayerSidebar gameState={gameState} myPlayerId={myPlayerId} />

      {floatingNotice && (
        <div className="pointer-events-none absolute left-0 right-0 top-3 z-20 flex justify-center px-2">
          <div
            className={`pointer-events-auto w-full max-w-xl rounded-xl border px-3 py-2 text-sm shadow-lg transition-all duration-300 ${feedbackClass} ${
              floatingNoticeVisible ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
            }`}
          >
            {floatingNotice.message}
          </div>
        </div>
      )}

      <aside className="pointer-events-none absolute right-2 top-28 z-20 hidden w-[360px] xl:block">
        <div className="pointer-events-auto panel max-h-[72vh] overflow-y-auto border-amber-200/80 bg-white/90 p-3 shadow-lg backdrop-blur">
          <BattleLog gameState={gameState} />
          <div className="mt-3 rounded-lg border border-slate-200 bg-white/90 p-3">
            <h3 className="text-sm font-extrabold text-slate-800">Derniere bataille</h3>
            {lastBattleSummary ? (
              <>
                <p className="mt-1 text-xs text-slate-600">
                  {lastBattleSummary.fromTerritoryKey} {"->"} {lastBattleSummary.toTerritoryKey}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="font-semibold text-slate-700">{lastBattleSummary.attackerName}</p>
                    <p className="mt-1 text-slate-800">Des: {lastBattleSummary.attackerRolls.join(" - ") || "-"}</p>
                    <p className="text-rose-700">Pertes: -{lastBattleSummary.attackerLosses}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="font-semibold text-slate-700">{lastBattleSummary.defenderName}</p>
                    <p className="mt-1 text-slate-800">Des: {lastBattleSummary.defenderRolls.join(" - ") || "-"}</p>
                    <p className="text-rose-700">Pertes: -{lastBattleSummary.defenderLosses}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Aucune bataille pour le moment.</p>
            )}
          </div>
        </div>
      </aside>

      <aside className="pointer-events-none absolute right-2 top-[calc(28vh)] z-20 xl:hidden">
        <div className="pointer-events-auto panel max-h-[45vh] w-[320px] overflow-y-auto border-amber-200/80 bg-white/90 p-3 shadow-lg backdrop-blur">
          <BattleLog gameState={gameState} />
          <div className="mt-3 rounded-lg border border-slate-200 bg-white/90 p-3">
            <h3 className="text-sm font-extrabold text-slate-800">Derniere bataille</h3>
            {lastBattleSummary ? (
              <>
                <p className="mt-1 text-xs text-slate-600">
                  {lastBattleSummary.fromTerritoryKey} {"->"} {lastBattleSummary.toTerritoryKey}
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="font-semibold text-slate-700">{lastBattleSummary.attackerName}</p>
                    <p className="mt-1 text-slate-800">Des: {lastBattleSummary.attackerRolls.join(" - ") || "-"}</p>
                    <p className="text-rose-700">Pertes: -{lastBattleSummary.attackerLosses}</p>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <p className="font-semibold text-slate-700">{lastBattleSummary.defenderName}</p>
                    <p className="mt-1 text-slate-800">Des: {lastBattleSummary.defenderRolls.join(" - ") || "-"}</p>
                    <p className="text-rose-700">Pertes: -{lastBattleSummary.defenderLosses}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Aucune bataille pour le moment.</p>
            )}
          </div>
        </div>
      </aside>

      <div className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2">
        <div className={`rounded-xl border px-4 py-2 text-center shadow-lg backdrop-blur ${phaseCardClass}`}>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tour {gameState.turnNumber}</p>
          <p className="text-sm font-extrabold">{phaseTitle}</p>
        </div>
      </div>

      <div className="pointer-events-none absolute left-2 top-28 z-20 w-[min(540px,calc(100vw-1rem))] space-y-2 sm:left-3 md:left-4">
        {pendingAttackCount > 0 && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-amber-600 border-t-transparent" />
            Attaque en cours de validation serveur...
          </div>
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
          {isMyTurn && currentPhase === "attack" && !attackPrompt && (
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

      {combatOverlay && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div className="rounded-2xl border border-amber-200 bg-white/92 px-8 py-6 text-center shadow-2xl backdrop-blur">
            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full border-4 border-amber-300 border-t-amber-600 animate-spin" />
            <p className="text-lg font-extrabold text-amber-700">COMBAT</p>
            <p className="text-sm text-slate-600">Resolution des des...</p>
          </div>
        </div>
      )}

      {phaseIntro && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center">
          <div
            className={`rounded-2xl border px-8 py-6 text-center shadow-2xl backdrop-blur transition-all duration-300 ${
              phaseIntro.phase === "reinforce"
                ? "border-emerald-300 bg-emerald-100/95 text-emerald-800"
                : phaseIntro.phase === "attack"
                  ? "border-amber-300 bg-amber-100/95 text-amber-800"
                  : "border-sky-300 bg-sky-100/95 text-sky-800"
            } ${phaseIntro.visible ? "scale-100 opacity-100" : "scale-95 opacity-0"}`
            }
          >
            <p
              className={`text-xs font-bold uppercase tracking-[0.25em] ${
                phaseIntro.phase === "reinforce"
                  ? "text-emerald-700"
                  : phaseIntro.phase === "attack"
                    ? "text-amber-700"
                    : "text-sky-700"
              }`}
            >
              {phaseIntro.title}
            </p>
            <p className="mt-2 text-3xl font-black">{phaseIntro.subtitle}</p>
            {phaseIntro.phase === "reinforce" && phaseIntro.amount && phaseIntro.amount > 0 && (
              <>
                <p className="mt-2 text-5xl font-black">+{phaseIntro.amount}</p>
                <p className="mt-1 text-sm font-semibold text-emerald-700">troupes recues</p>
              </>
            )}
            {phaseIntro.phase !== "reinforce" && (
              <p className="mt-2 text-sm font-semibold">
                {phaseIntro.title === "Ton tour" ? "A toi de jouer" : "Observe et prepare ta riposte"}
              </p>
            )}
          </div>
        </div>
      )}

      {attackPrompt && (
        <div className="pointer-events-none absolute bottom-5 left-0 right-0 z-40 flex justify-center px-2">
          <div className="pointer-events-auto panel w-full max-w-md p-4 shadow-2xl">
            {(() => {
              const fromTroops = territoryByKey.get(attackPrompt.from)?.troops ?? 2;
              const toTroops = territoryByKey.get(attackPrompt.to)?.troops ?? 1;
              const attackDice = Math.min(3, Math.max(1, fromTroops - 1));
              const chance = singleAttackWinChance(fromTroops, toTroops, attackDice);
              const chancePct = (chance * 100).toFixed(1);

              return (
                <>
                  <h3 className="text-base font-semibold">Attaque: troupes a deplacer si capture</h3>
                  <p className="mt-1 text-sm text-slate-600">{`${attackPrompt.from} -> ${attackPrompt.to}`}</p>
                  <p className="mt-1 text-xs text-slate-500">{`Des utilises: ${attackDice} vs ${Math.min(2, toTroops)}`}</p>
                  <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-sm font-semibold text-amber-800">
                    Chance de prendre le territoire: {chancePct}%
                  </p>
                </>
              );
            })()}
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
              <button
                className="btn-secondary"
                onClick={() => {
                  setAttackPrompt(null);
                  setSelectedTo(null);
                  emitIntent(attackPrompt.from, null);
                }}
              >
                Annuler
              </button>
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

      {reinforcePrompt && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/35 p-4">
          <div className="panel w-full max-w-md p-4">
            <h3 className="text-base font-semibold">Renforts</h3>
            <p className="mt-1 text-sm text-slate-600">Territoire: {reinforcePrompt.territoryKey}</p>
            <p className="mt-3 text-sm">Troupes a ajouter: {reinforcePrompt.troops}</p>
            <input
              className="mt-1 w-full"
              type="range"
              min={1}
              max={reinforcePrompt.maxTroops}
              value={reinforcePrompt.troops}
              onChange={(e) =>
                setReinforcePrompt((prev) => (prev ? { ...prev, troops: Number(e.target.value) } : prev))
              }
            />
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setReinforcePrompt(null)}>Annuler</button>
              <button
                className="btn-primary"
                onClick={() => {
                  sendAction({
                    type: "place_reinforcement",
                    territoryKey: reinforcePrompt.territoryKey,
                    troops: reinforcePrompt.troops,
                  });
                  setReinforcePrompt(null);
                }}
              >
                Confirmer renfort
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
