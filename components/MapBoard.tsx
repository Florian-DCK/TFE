import type { WheelEventHandler } from "react";
import { useMemo, useRef, useState } from "react";
import { GameStateDTO, TerritoryStateDTO } from "@/app/lib/game/protocol";

type Edge = {
  id: string;
  from: string;
  to: string;
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

function ownerColor(ownerPlayerId: string, myPlayerId: string | null) {
  if (!ownerPlayerId) return "var(--neutral)";
  if (myPlayerId && ownerPlayerId === myPlayerId) return "var(--player-me)";
  return "var(--player-opponent)";
}

function canonicalEdge(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildUniqueEdges(territories: TerritoryStateDTO[]) {
  const byKey = new Map(territories.map((t) => [t.territoryKey, t]));
  const seen = new Set<string>();
  const edges: Edge[] = [];

  for (const territory of territories) {
    for (const neighborKey of territory.adjacency) {
      const neighbor = byKey.get(neighborKey);
      if (!neighbor) continue;
      const edgeKey = canonicalEdge(territory.territoryKey, neighborKey);
      if (seen.has(edgeKey)) continue;
      seen.add(edgeKey);
      edges.push({
        id: edgeKey,
        from: territory.territoryKey,
        to: neighborKey,
        ax: territory.centroid.x,
        ay: territory.centroid.y,
        bx: neighbor.centroid.x,
        by: neighbor.centroid.y,
      });
    }
  }

  return edges;
}

export default function MapBoard({
  gameState,
  myPlayerId,
  mode,
  selectedFrom,
  selectedTo,
  hoveredTerritoryKey,
  setHoveredTerritoryKey,
  adjacencyHintStyle,
  onPick,
  onDeselect,
}: {
  gameState: GameStateDTO;
  myPlayerId: string | null;
  mode: "reinforce" | "attack" | "fortify";
  selectedFrom: string | null;
  selectedTo: string | null;
  hoveredTerritoryKey: string | null;
  setHoveredTerritoryKey: (territoryKey: string | null) => void;
  adjacencyHintStyle: "halo-lines";
  onPick: (territoryKey: string) => void;
  onDeselect: () => void;
}) {
  const [showConnections, setShowConnections] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const territoryByKey = useMemo(
    () => new Map<string, TerritoryStateDTO>(gameState.territories.map((t) => [t.territoryKey, t])),
    [gameState.territories],
  );

  const focusKey = hoveredTerritoryKey || selectedFrom;
  const focusTerritory = focusKey ? territoryByKey.get(focusKey) : null;
  const focusNeighbors = new Set(focusTerritory?.adjacency ?? []);

  const selectedSourceState = selectedFrom ? territoryByKey.get(selectedFrom) : null;
  const sourceOwnedByMe = Boolean(selectedSourceState && myPlayerId && selectedSourceState.ownerPlayerId === myPlayerId);

  const actionableTargets = new Set<string>();
  if (selectedFrom && sourceOwnedByMe) {
    const neighbors = territoryByKey.get(selectedFrom)?.adjacency ?? [];
    for (const key of neighbors) {
      const targetState = territoryByKey.get(key);
      if (!targetState || !myPlayerId) continue;
      if (mode === "attack" && targetState.ownerPlayerId !== myPlayerId) actionableTargets.add(key);
      if (mode === "fortify" && targetState.ownerPlayerId === myPlayerId) actionableTargets.add(key);
    }
  }

  const allEdges = useMemo(() => buildUniqueEdges(gameState.territories), [gameState.territories]);

  const focusEdges = useMemo(() => {
    if (!focusKey) return [];
    const adjacency = territoryByKey.get(focusKey)?.adjacency ?? [];
    return adjacency
      .map((neighbor) => {
        const a = territoryByKey.get(focusKey);
        const b = territoryByKey.get(neighbor);
        if (!a || !b) return null;
        return { id: `${focusKey}-${neighbor}`, ax: a.centroid.x, ay: a.centroid.y, bx: b.centroid.x, by: b.centroid.y };
      })
      .filter(Boolean);
  }, [focusKey, territoryByKey]);

  const startDrag = (clientX: number, clientY: number) => {
    dragStartRef.current = { x: clientX, y: clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
  };

  const updateDrag = (clientX: number, clientY: number) => {
    if (!dragStartRef.current) return;
    const dx = clientX - dragStartRef.current.x;
    const dy = clientY - dragStartRef.current.y;
    setPan({ x: dragStartRef.current.panX + dx, y: dragStartRef.current.panY + dy });
  };

  const endDrag = () => {
    dragStartRef.current = null;
    setDragging(false);
  };

  const handleWheel: WheelEventHandler<HTMLDivElement> = (event) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    const next = Math.max(0.7, Math.min(3.2, zoom + direction * 0.12));
    setZoom(Number(next.toFixed(2)));
  };

  return (
    <div
      className="relative h-full w-full overflow-hidden bg-gradient-to-br from-sky-100 via-cyan-50 to-emerald-100"
      onContextMenu={(e) => {
        e.preventDefault();
        onDeselect();
      }}
      onWheel={handleWheel}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("[data-territory='1']")) return;
        startDrag(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => updateDrag(e.clientX, e.clientY)}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
    >
      <div className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-2 rounded-lg border border-sky-200/80 bg-white/90 p-2 shadow backdrop-blur">
        <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setZoom((z) => Math.max(0.7, z - 0.2))}>
          -
        </button>
        <span className="text-xs text-slate-700">{Math.round(zoom * 100)}%</span>
        <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setZoom((z) => Math.min(3.2, z + 0.2))}>
          +
        </button>
        <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setPan({ x: 0, y: 0 })}>
          Center
        </button>
        <button className="btn-secondary px-2 py-1 text-xs" onClick={() => setShowConnections((v) => !v)}>
          {showConnections ? "Liens off" : "Liens on"}
        </button>
      </div>

      <svg
        viewBox={gameState.map.viewBox}
        className="h-full w-full bg-slate-50/60"
        aria-label="Carte de jeu"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "50% 50%",
          transition: dragging ? "none" : "transform 120ms ease-out",
        }}
      >
        <image href={`/maps/${gameState.map.key}/board.svg`} x="0" y="0" width="100%" height="100%" opacity={0.2} />

        {showConnections &&
          allEdges.map((edge) => (
            <line
              key={`base-${edge.id}`}
              x1={edge.ax}
              y1={edge.ay}
              x2={edge.bx}
              y2={edge.by}
              stroke="#64748b"
              strokeWidth={1}
              strokeOpacity={0.12}
            />
          ))}

        {showConnections &&
          adjacencyHintStyle === "halo-lines" &&
          focusEdges.map((line) =>
            line ? (
              <line
                key={`focus-${line.id}`}
                x1={line.ax}
                y1={line.ay}
                x2={line.bx}
                y2={line.by}
                stroke="#64748b"
                strokeWidth={2}
                strokeOpacity={0.45}
                strokeDasharray="7 5"
              />
            ) : null,
          )}

        {gameState.territories.map((territory) => {
          const isFrom = selectedFrom === territory.territoryKey;
          const isTo = selectedTo === territory.territoryKey;
          const isNeighbor = focusNeighbors.has(territory.territoryKey);
          const isFocus = focusKey === territory.territoryKey;
          const isActionableTarget = actionableTargets.has(territory.territoryKey);
          const shouldDim = Boolean(focusKey) && !isFocus && !isNeighbor;
          const hovered = hoveredTerritoryKey === territory.territoryKey;

          return (
            <g
              key={territory.territoryKey}
              className="cursor-pointer"
              data-territory="1"
              onMouseEnter={() => setHoveredTerritoryKey(territory.territoryKey)}
              onMouseLeave={() => setHoveredTerritoryKey(null)}
              onClick={() => onPick(territory.territoryKey)}
            >
              <path
                id={territory.svgId}
                d={territory.pathData}
                fill={ownerColor(territory.ownerPlayerId, myPlayerId)}
                stroke={isFrom ? "#0f172a" : isTo ? "#1d4ed8" : isActionableTarget ? "#1f9d67" : "#334155"}
                strokeWidth={isFrom ? 3.5 : isTo ? 2.5 : isActionableTarget ? 3 : 1.25}
                strokeDasharray={isTo ? "5 4" : ""}
                opacity={shouldDim ? 0.28 : 0.9}
                pointerEvents="all"
              />

              <path
                d={territory.pathData}
                fill="none"
                stroke="transparent"
                strokeWidth={10}
                pointerEvents="stroke"
              />

              {(isNeighbor || isFocus) && (
                <path
                  d={territory.pathData}
                  fill="none"
                  stroke={isFocus ? "#0f172a" : "#64748b"}
                  strokeWidth={2}
                  opacity={0.6}
                />
              )}

              <circle cx={territory.centroid.x} cy={territory.centroid.y} r={11} fill="#0f172a" opacity={0.8} />
              <text x={territory.centroid.x - 4} y={territory.centroid.y + 4} fontSize={10} fill="#fff">
                {territory.troops}
              </text>

              {hovered && (
                <text
                  x={territory.centroid.x + 14}
                  y={territory.centroid.y - 12}
                  fontSize={10}
                  fill="#0f172a"
                  className="pointer-events-none"
                >
                  {territory.territoryName}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
