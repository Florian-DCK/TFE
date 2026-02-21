import { GameStateDTO } from "@/app/lib/game/protocol";
import { ActionMode } from "./ActionPanel";

function objectiveFor(mode: ActionMode, isMyTurn: boolean, reinforcements: number) {
  if (!isMyTurn) return "Observe les mouvements adverses et prepare ta source.";
  if (reinforcements > 0) return "Placer tes renforts.";
  if (mode === "attack") return "Choisir une attaque valide.";
  if (mode === "fortify") return "Repositionner tes troupes pour defendre.";
  return "Finir ton tour ou passer en attaque.";
}

export default function TurnBanner({
  gameState,
  myPlayerId,
  mode,
  displayName,
  uiHint,
}: {
  gameState: GameStateDTO;
  myPlayerId: string | null;
  mode: ActionMode;
  displayName: string;
  uiHint: string | null;
}) {
  const current = gameState.players.find((p) => p.id === gameState.currentTurnPlayerId);
  const me = gameState.players.find((p) => p.id === myPlayerId);
  const isMyTurn = Boolean(myPlayerId) && gameState.currentTurnPlayerId === myPlayerId;
  const objective = objectiveFor(mode, isMyTurn, me?.reinforcements ?? 0);

  return (
    <div className="panel p-3">
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="panel-muted p-2">
          <p className="text-xs text-slate-500">Tu joues en</p>
          <div className="mt-1 flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: "var(--player-me)" }}
              aria-hidden="true"
            />
            <p className="font-semibold">{me?.displayName ?? displayName}</p>
            <span className="stat-pill">Seat {me?.seat ?? "?"}</span>
          </div>
          <p className="mt-1 text-xs text-slate-600">Renforts: {me?.reinforcements ?? 0}</p>
        </div>

        <div className="panel-muted p-2">
          <p className="text-xs text-slate-500">Tour actuel</p>
          <p className="mt-1 text-sm font-semibold">Tour {gameState.turnNumber}</p>
          <p className={`text-sm font-medium ${isMyTurn ? "text-emerald-700" : "text-amber-700"}`}>
            {isMyTurn ? "Ton tour" : `Tour adverse (${current?.displayName ?? "N/A"})`}
          </p>
          {gameState.status === "finished" && (
            <p className="mt-1 text-sm text-emerald-700">
              Vainqueur: {gameState.players.find((p) => p.id === gameState.winnerPlayerId)?.displayName ?? "N/A"}
            </p>
          )}
        </div>

        <div className="panel-muted p-2">
          <p className="text-xs text-slate-500">Objectif immediat</p>
          <p className="mt-1 text-sm font-medium">{objective}</p>
          {uiHint && <p className="mt-1 text-xs text-slate-600">{uiHint}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {gameState.players.map((player) => {
          const isMe = player.id === myPlayerId;
          return (
            <span key={player.id} className="chip">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: isMe ? "var(--player-me)" : "var(--player-opponent)" }}
                aria-hidden="true"
              />
              {player.displayName}
            </span>
          );
        })}
      </div>
    </div>
  );
}

