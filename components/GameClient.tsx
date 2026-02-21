"use client";

import { useEffect, useMemo, useState } from "react";
import { getSocket } from "@/app/lib/socket";
import {
  ActionLogDTO,
  ClientAction,
  GameStateDTO,
  submitActionSchema,
} from "@/app/lib/game/protocol";
import TurnBanner from "./TurnBanner";
import MapBoard from "./MapBoard";
import ActionPanel, { ActionMode } from "./ActionPanel";
import BattleLog from "./BattleLog";

type Feedback = { kind: "success" | "error" | "info"; message: string };

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
  if (lower.includes("player") || lower.includes("participant")) {
    return "Tu n'es pas reconnu comme joueur de cette partie.";
  }
  return reason;
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
  const [attackDice, setAttackDice] = useState(1);
  const [fortifyTroops, setFortifyTroops] = useState(1);
  const [myPlayerId, setMyPlayerId] = useState<string | null>(null);
  const [mode, setMode] = useState<ActionMode>("reinforce");
  const [actionFeedback, setActionFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    const s = getSocket();
    s.emit("join_game", { gameCode: code });

    const onGameState = (payload: GameStateDTO) => {
      if (payload.gameCode !== code) return;
      setGameState((prev) => {
        if (!prev) return payload;
        if (payload.logs.length === 0) {
          return { ...payload, logs: prev.logs };
        }
        return payload;
      });
      setActionFeedback((prev) =>
        prev?.kind === "error" ? prev : { kind: "success", message: "Etat de partie synchronise." },
      );
    };

    const onRejected = (payload: { reason: string }) => {
      setActionFeedback({ kind: "error", message: toUserError(payload.reason) });
    };

    const onFinished = (payload: { gameCode: string; winnerPlayerId: string | null }) => {
      if (payload.gameCode !== code) return;
      setActionFeedback({ kind: "info", message: "Partie terminee." });
    };

    const onJoined = (payload: { gameCode: string; playerId: string }) => {
      if (payload.gameCode !== code) return;
      setMyPlayerId(payload.playerId);
    };

    const onActionLog = (payload: ActionLogDTO) => {
      setGameState((prev) => {
        if (!prev) return prev;
        if (prev.logs.some((log) => log.id === payload.id)) return prev;
        const nextLogs = [...prev.logs, payload].slice(-20);
        return { ...prev, logs: nextLogs };
      });
    };

    s.on("game_state", onGameState);
    s.on("action_rejected", onRejected);
    s.on("game_finished", onFinished);
    s.on("joined_game", onJoined);
    s.on("action_log", onActionLog);

    return () => {
      s.off("game_state", onGameState);
      s.off("action_rejected", onRejected);
      s.off("game_finished", onFinished);
      s.off("joined_game", onJoined);
      s.off("action_log", onActionLog);
      s.emit("leave_game", { gameCode: code });
    };
  }, [code]);

  const territoryByKey = useMemo(
    () => new Map(gameState?.territories.map((t) => [t.territoryKey, t]) ?? []),
    [gameState],
  );

  const me = useMemo(
    () => gameState?.players.find((p) => p.id === myPlayerId) ?? null,
    [gameState, myPlayerId],
  );

  const isMyTurn = Boolean(myPlayerId) && gameState?.currentTurnPlayerId === myPlayerId;
  const effectiveMode: ActionMode =
    isMyTurn && (me?.reinforcements ?? 0) > 0 ? "reinforce" : mode;
  const uiHint = useMemo(() => {
    if (!isMyTurn) return "Tour adverse: observe la carte et prepare ta prochaine action.";
    if ((me?.reinforcements ?? 0) > 0) return "Place d'abord tes renforts sur tes territoires.";
    return effectiveMode === "attack"
      ? "Selectionne une source puis une cible ennemie adjacente."
      : effectiveMode === "fortify"
        ? "Selectionne deux territoires allies adjacents pour deplacer des troupes."
        : "Tu peux attaquer, fortifier ou terminer ton tour.";
  }, [effectiveMode, isMyTurn, me?.reinforcements]);

  const pickTerritory = (territoryKey: string) => {
    if (!selectedFrom || selectedFrom === territoryKey) {
      setSelectedFrom(territoryKey);
      setSelectedTo(null);
      return;
    }
    setSelectedTo(territoryKey);
  };

  const clearSelection = () => {
    setSelectedFrom(null);
    setSelectedTo(null);
    setHoveredTerritoryKey(null);
  };

  const sendAction = (action: ClientAction) => {
    const parsed = submitActionSchema.safeParse(action);
    if (!parsed.success) {
      setActionFeedback({ kind: "error", message: "Action invalide." });
      return;
    }
    const actionLabel =
      parsed.data.type === "place_reinforcement"
        ? "Renfort envoye"
        : parsed.data.type === "attack"
          ? "Attaque envoyee"
          : parsed.data.type === "fortify"
            ? "Fortification envoyee"
            : "Action envoyee";
    setActionFeedback({ kind: "info", message: `${actionLabel}, en attente de validation serveur...` });
    const s = getSocket();
    s.emit("submit_action", { gameCode: code, action: parsed.data });
  };

  if (!gameState) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="panel p-4">Chargement de la partie {code}...</div>
      </main>
    );
  }

  const feedbackClass =
    actionFeedback?.kind === "error"
      ? "border-red-200 bg-red-50 text-red-700"
      : actionFeedback?.kind === "success"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <main className="mx-auto max-w-7xl px-3 py-4 lg:px-5 lg:py-5">
      <div className="sticky top-2 z-20 mb-3">
        <TurnBanner
          gameState={gameState}
          myPlayerId={myPlayerId}
          mode={effectiveMode}
          displayName={displayName}
          uiHint={uiHint}
        />
      </div>

      {actionFeedback && (
        <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${feedbackClass}`}>{actionFeedback.message}</div>
      )}

      <div className="grid gap-3 lg:grid-cols-12">
        <section className="lg:col-span-8 xl:col-span-9">
          <MapBoard
            gameState={gameState}
            myPlayerId={myPlayerId}
            mode={effectiveMode}
            selectedFrom={selectedFrom}
            selectedTo={selectedTo}
            hoveredTerritoryKey={hoveredTerritoryKey}
            setHoveredTerritoryKey={setHoveredTerritoryKey}
            adjacencyHintStyle="halo-lines"
            onPick={pickTerritory}
            onClearSelection={clearSelection}
          />
        </section>

        <aside className="lg:col-span-4 xl:col-span-3">
          <div className="space-y-3 lg:sticky lg:top-28">
            <div className="hidden panel p-3 lg:block">
              <ActionPanel
                gameState={gameState}
                myPlayerId={myPlayerId}
                mode={effectiveMode}
                setMode={setMode}
                selectedFrom={selectedFrom}
                selectedTo={selectedTo}
                attackDice={attackDice}
                setAttackDice={setAttackDice}
                fortifyTroops={fortifyTroops}
                setFortifyTroops={setFortifyTroops}
                territoryByKey={territoryByKey}
                onAction={sendAction}
                onClearSelection={clearSelection}
              />
            </div>
            <div className="hidden panel p-3 lg:block">
              <BattleLog gameState={gameState} />
            </div>
            <div className="panel p-3 lg:hidden">
              <BattleLog gameState={gameState} />
            </div>
          </div>
        </aside>
      </div>

      <div className="fixed inset-x-2 bottom-2 z-30 lg:hidden">
        <div className="panel p-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-slate-600">Assistant rapide</p>
            <button className="btn-secondary px-2 py-1 text-xs" onClick={clearSelection}>
              Reinitialiser
            </button>
          </div>
          <ActionPanel
            gameState={gameState}
            myPlayerId={myPlayerId}
            mode={effectiveMode}
            setMode={setMode}
            selectedFrom={selectedFrom}
            selectedTo={selectedTo}
            attackDice={attackDice}
            setAttackDice={setAttackDice}
            fortifyTroops={fortifyTroops}
            setFortifyTroops={setFortifyTroops}
            territoryByKey={territoryByKey}
            onAction={sendAction}
            onClearSelection={clearSelection}
            compact
          />
        </div>
      </div>

      <div className="h-44 lg:hidden" aria-hidden="true" />
      <p className="mt-3 text-xs text-slate-500">
        Partie {code} ({locale}) - Joueur local: {displayName}
      </p>
    </main>
  );
}

