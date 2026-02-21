import { useEffect, useRef } from "react";
import { ActionLogDTO, GameStateDTO } from "@/app/lib/game/protocol";

function actorName(log: ActionLogDTO, gameState: GameStateDTO) {
  if (!log.actorPlayerId) return "Systeme";
  return gameState.players.find((p) => p.id === log.actorPlayerId)?.displayName ?? "Inconnu";
}

function toText(log: ActionLogDTO) {
  const payload = (log.payload ?? {}) as Record<string, unknown>;
  if (log.type === "attack") {
    return `attaque de ${String(payload.fromTerritoryKey ?? "?")} vers ${String(payload.toTerritoryKey ?? "?")}`;
  }
  if (log.type === "place_reinforcement") {
    return `+1 renfort sur ${String(payload.territoryKey ?? "?")}`;
  }
  if (log.type === "fortify") {
    return `fortification ${String(payload.fromTerritoryKey ?? "?")} -> ${String(payload.toTerritoryKey ?? "?")}`;
  }
  if (log.type === "end_turn") {
    return "fin de tour";
  }
  if (log.type === "game_started") {
    return "debut de partie";
  }
  return log.type;
}

export default function BattleLog({ gameState }: { gameState: GameStateDTO }) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const recentIds = new Set(gameState.logs.slice(-3).map((log) => log.id));

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [gameState.logs.length]);

  return (
    <div>
      <h3 className="mb-2 text-sm font-extrabold text-slate-800">Historique recent</h3>
      <ul ref={listRef} className="max-h-72 space-y-1 overflow-y-auto pr-1 text-xs sm:text-sm">
        {gameState.logs.map((log) => {
          const recent = recentIds.has(log.id);
          return (
            <li
              key={log.id}
              className={`rounded-md border px-2 py-1 ${
                recent ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white/85"
              }`}
            >
              <span className="font-semibold">T{log.turn}</span> · {actorName(log, gameState)} · {toText(log)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
