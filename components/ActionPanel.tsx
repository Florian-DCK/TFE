import { ClientAction, GameStateDTO, TerritoryStateDTO } from "@/app/lib/game/protocol";

export type ActionMode = "reinforce" | "attack" | "fortify";

export default function ActionPanel({
  gameState,
  myPlayerId,
  mode,
  setMode,
  selectedFrom,
  selectedTo,
  attackDice,
  setAttackDice,
  fortifyTroops,
  setFortifyTroops,
  territoryByKey,
  onAction,
  onClearSelection,
  compact = false,
}: {
  gameState: GameStateDTO;
  myPlayerId: string | null;
  mode: ActionMode;
  setMode: (mode: ActionMode) => void;
  selectedFrom: string | null;
  selectedTo: string | null;
  attackDice: number;
  setAttackDice: (value: number) => void;
  fortifyTroops: number;
  setFortifyTroops: (value: number) => void;
  territoryByKey: Map<string, TerritoryStateDTO>;
  onAction: (action: ClientAction) => void;
  onClearSelection: () => void;
  compact?: boolean;
}) {
  const me = gameState.players.find((p) => p.id === myPlayerId);
  const isMyTurn = Boolean(myPlayerId) && gameState.currentTurnPlayerId === myPlayerId;

  const source = selectedFrom ? territoryByKey.get(selectedFrom) : null;
  const target = selectedTo ? territoryByKey.get(selectedTo) : null;

  const sourceOwnedByMe = Boolean(source && myPlayerId && source.ownerPlayerId === myPlayerId);
  const targetOwnedByMe = Boolean(target && myPlayerId && target.ownerPlayerId === myPlayerId);

  const neighbors = selectedFrom ? territoryByKey.get(selectedFrom)?.adjacency ?? [] : [];
  const isTargetAdjacent = selectedTo ? neighbors.includes(selectedTo) : false;

  const reinforceReady = isMyTurn && sourceOwnedByMe && (me?.reinforcements ?? 0) > 0;
  const attackReady =
    isMyTurn &&
    sourceOwnedByMe &&
    Boolean(source && source.troops > 1) &&
    Boolean(target) &&
    !targetOwnedByMe &&
    isTargetAdjacent;
  const fortifyReady =
    isMyTurn &&
    sourceOwnedByMe &&
    Boolean(source && source.troops > fortifyTroops) &&
    Boolean(target) &&
    targetOwnedByMe &&
    isTargetAdjacent;

  const stepText = !isMyTurn
    ? "Tour adverse: attends ton tour puis prepare une action."
    : !selectedFrom
      ? "Etape 1: selectionne ton territoire source sur la carte."
      : mode === "reinforce"
        ? "Etape 2: ajoute 1 renfort sur ton territoire source."
        : mode === "attack"
          ? "Etape 2: choisis une cible ennemie adjacente puis attaque."
          : "Etape 2: choisis une cible alliee adjacente puis deplace tes troupes.";

  const modeLockedByReinforcement = isMyTurn && (me?.reinforcements ?? 0) > 0;

  return (
    <div className="space-y-3">
      {!compact && <h3 className="text-base font-semibold">Assistant tactique</h3>}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-secondary"
          disabled={!isMyTurn}
          onClick={() => setMode("reinforce")}
          aria-pressed={mode === "reinforce"}
        >
          Renfort
        </button>
        <button
          className="btn-secondary"
          disabled={!isMyTurn || modeLockedByReinforcement}
          onClick={() => setMode("attack")}
          aria-pressed={mode === "attack"}
        >
          Attaque
        </button>
        <button
          className="btn-secondary"
          disabled={!isMyTurn || modeLockedByReinforcement}
          onClick={() => setMode("fortify")}
          aria-pressed={mode === "fortify"}
        >
          Fortifier
        </button>
      </div>

      <div className="panel-muted p-2 text-sm text-slate-700">{stepText}</div>

      <div className="grid grid-cols-2 gap-2 text-xs sm:text-sm">
        <div className="panel-muted p-2">
          <div className="text-slate-500">Source</div>
          <div className="font-medium">{selectedFrom ?? "-"}</div>
        </div>
        <div className="panel-muted p-2">
          <div className="text-slate-500">Cible</div>
          <div className="font-medium">{selectedTo ?? "-"}</div>
        </div>
      </div>

      {mode === "attack" && (
        <div className="space-y-1">
          <label className="text-xs text-slate-600" htmlFor="attack-dice">
            Des d&apos;attaque (1-3)
          </label>
          <input
            id="attack-dice"
            className="w-full rounded-lg border border-slate-300 px-2 py-1"
            type="number"
            min={1}
            max={3}
            value={attackDice}
            onChange={(e) => setAttackDice(Math.max(1, Math.min(3, Number(e.target.value) || 1)))}
          />
        </div>
      )}

      {mode === "fortify" && (
        <div className="space-y-1">
          <label className="text-xs text-slate-600" htmlFor="fortify-troops">
            Troupes a deplacer
          </label>
          <input
            id="fortify-troops"
            className="w-full rounded-lg border border-slate-300 px-2 py-1"
            type="number"
            min={1}
            value={fortifyTroops}
            onChange={(e) => setFortifyTroops(Math.max(1, Number(e.target.value) || 1))}
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {mode === "reinforce" && (
          <button
            className="btn-primary"
            disabled={!reinforceReady}
            onClick={() => selectedFrom && onAction({ type: "place_reinforcement", territoryKey: selectedFrom })}
          >
            Placer renfort
          </button>
        )}

        {mode === "attack" && (
          <button
            className="btn-primary"
            disabled={!attackReady}
            onClick={() =>
              selectedFrom &&
              selectedTo &&
              onAction({
                type: "attack",
                fromTerritoryKey: selectedFrom,
                toTerritoryKey: selectedTo,
                attackDice,
              })
            }
          >
            Lancer attaque
          </button>
        )}

        {mode === "fortify" && (
          <button
            className="btn-primary"
            disabled={!fortifyReady}
            onClick={() =>
              selectedFrom &&
              selectedTo &&
              onAction({
                type: "fortify",
                fromTerritoryKey: selectedFrom,
                toTerritoryKey: selectedTo,
                troops: fortifyTroops,
              })
            }
          >
            Deplacer troupes
          </button>
        )}

        <button className="btn-secondary" onClick={onClearSelection}>
          Reinitialiser la selection
        </button>

        <button className="btn-danger" disabled={!isMyTurn} onClick={() => onAction({ type: "end_turn" })}>
          Terminer mon tour
        </button>
      </div>

      {modeLockedByReinforcement && (
        <p className="text-xs text-amber-700">Tu dois finir de placer tes renforts avant attaque/fortification.</p>
      )}
    </div>
  );
}
