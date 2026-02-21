import { GameStateDTO } from "@/app/lib/game/protocol";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function nextReinforcements(gameState: GameStateDTO, playerId: string) {
  const territories = gameState.territories.filter((territory) => territory.ownerPlayerId === playerId);
  const base = Math.max(3, Math.floor(territories.length / 3));

  let continentBonus = 0;
  for (const continent of gameState.map.continents) {
    const continentTerritories = gameState.territories.filter((territory) => territory.continent === continent.key);
    if (continentTerritories.length > 0 && continentTerritories.every((territory) => territory.ownerPlayerId === playerId)) {
      continentBonus += continent.bonus;
    }
  }
  return base + continentBonus;
}

export default function PlayerSidebar({
  gameState,
  myPlayerId,
}: {
  gameState: GameStateDTO;
  myPlayerId: string | null;
}) {
  const troopCountByPlayer = new Map<string, number>();
  for (const territory of gameState.territories) {
    troopCountByPlayer.set(
      territory.ownerPlayerId,
      (troopCountByPlayer.get(territory.ownerPlayerId) ?? 0) + territory.troops,
    );
  }

  const orderedPlayers = [...gameState.players].sort((a, b) => a.seat - b.seat);

  return (
    <aside className="pointer-events-none absolute left-3 top-20 z-20 w-[min(320px,calc(100vw-1.2rem))]">
      <div className="max-h-[74vh] space-y-2 overflow-y-auto pr-1">
        {orderedPlayers.map((player) => {
          const isMe = player.id === myPlayerId;
          const isCurrent = player.id === gameState.currentTurnPlayerId;
          const isCurrentReinforce = isCurrent && gameState.currentPhase === "reinforce";
          const troops = troopCountByPlayer.get(player.id) ?? 0;
          const nextReinforcement = nextReinforcements(gameState, player.id);

          return (
            <div
              key={player.id}
              className={`pointer-events-auto rounded-2xl border px-3 py-2 shadow-lg backdrop-blur transition-all ${
                isCurrent
                  ? "border-emerald-300 bg-emerald-50/90"
                  : "border-slate-300 bg-white/88"
              } ${isMe ? "ring-2 ring-cyan-300/80" : ""}`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-full border text-sm font-black ${
                    isCurrent
                      ? "border-emerald-300 bg-emerald-200 text-emerald-900"
                      : "border-slate-300 bg-slate-200 text-slate-700"
                  }`}
                >
                  {initials(player.displayName)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-extrabold text-slate-900">
                    {player.displayName} {isMe ? "(Toi)" : ""}
                  </p>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {isCurrent ? "Tour actif" : "En attente"}
                  </p>
                </div>
                {isCurrentReinforce && (
                  <div className="rounded-lg bg-emerald-500 px-2 py-1 text-right text-xs font-black text-white shadow">
                    +{player.reinforcements}
                  </div>
                )}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-1.5 text-xs font-semibold text-slate-800">
                <div className="rounded-lg bg-slate-900/90 px-2 py-1 text-white">
                  T {player.territoryCount}
                </div>
                <div className="rounded-lg bg-slate-700/90 px-2 py-1 text-white">
                  U {troops}
                </div>
                <div className="rounded-lg bg-amber-500/95 px-2 py-1 text-amber-950">
                  R+ {nextReinforcement}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
