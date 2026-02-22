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

function reinforcementBreakdown(gameState: GameStateDTO, playerId: string) {
  const ownedTerritories = gameState.territories.filter((territory) => territory.ownerPlayerId === playerId);
  const territoriesCount = ownedTerritories.length;
  const base = Math.max(3, Math.floor(territoriesCount / 3));

  const continentBonuses: Array<{ name: string; bonus: number }> = [];
  for (const continent of gameState.map.continents) {
    const continentTerritories = gameState.territories.filter((territory) => territory.continent === continent.key);
    if (continentTerritories.length === 0) continue;
    if (continentTerritories.every((territory) => territory.ownerPlayerId === playerId)) {
      continentBonuses.push({ name: continent.name, bonus: continent.bonus });
    }
  }

  const total = base + continentBonuses.reduce((sum, continent) => sum + continent.bonus, 0);
  return { territoriesCount, base, continentBonuses, total };
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
      <div className="space-y-2 pr-1">
        {orderedPlayers.map((player) => {
          const isMe = player.id === myPlayerId;
          const isCurrent = player.id === gameState.currentTurnPlayerId;
          const isCurrentReinforce = isCurrent && gameState.currentPhase === "reinforce";
          const troops = troopCountByPlayer.get(player.id) ?? 0;
          const nextReinforcement = nextReinforcements(gameState, player.id);
          const breakdown = reinforcementBreakdown(gameState, player.id);
          const tooltipContent = (
            <>
              <p className="font-bold text-slate-900">Calcul des renforts</p>
              <p className="mt-1">
                {breakdown.territoriesCount} territoires {"->"} +{breakdown.base}
              </p>
              {breakdown.continentBonuses.length > 0 ? (
                <div className="mt-1 space-y-0.5">
                  {breakdown.continentBonuses.map((continent) => (
                    <p key={`${player.id}-${continent.name}`}>
                      {continent.name} {"->"} +{continent.bonus}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-slate-500">Aucun bonus de continent</p>
              )}
              <p className="mt-1 border-t border-slate-200 pt-1 font-bold text-slate-900">
                Total {"->"} +{breakdown.total}
              </p>
            </>
          );

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
                  <div className="group relative">
                    <div className="rounded-lg bg-emerald-500 px-2 py-1 text-right text-xs font-black text-white shadow">
                      +{player.reinforcements}
                    </div>
                    <div
                      role="tooltip"
                      className="pointer-events-none invisible absolute bottom-[calc(100%+8px)] right-0 z-40 w-64 rounded-lg border border-slate-200 bg-white p-2 text-left text-[11px] text-slate-700 opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100"
                    >
                      {tooltipContent}
                    </div>
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
                <div className="group relative rounded-lg bg-amber-500/95 px-2 py-1 text-amber-950">
                  R+ {nextReinforcement}
                  <div
                    role="tooltip"
                    className="pointer-events-none invisible absolute bottom-[calc(100%+8px)] right-0 z-40 w-64 rounded-lg border border-slate-200 bg-white p-2 text-left text-[11px] text-slate-700 opacity-0 shadow-xl transition-opacity duration-150 group-hover:visible group-hover:opacity-100"
                  >
                    {tooltipContent}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
