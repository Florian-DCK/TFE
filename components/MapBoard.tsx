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

type ViewMode = "normal" | "continents";

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

function getConnectedAlliedTerritories(
  sourceKey: string,
  myPlayerId: string,
  territoryByKey: Map<string, TerritoryStateDTO>,
) {
  const source = territoryByKey.get(sourceKey);
  if (!source || source.ownerPlayerId !== myPlayerId) return new Set<string>();

  const visited = new Set<string>([sourceKey]);
  const queue = [sourceKey];
  while (queue.length > 0) {
    const key = queue.shift()!;
    const current = territoryByKey.get(key);
    if (!current) continue;
    for (const neighborKey of current.adjacency) {
      if (visited.has(neighborKey)) continue;
      const neighbor = territoryByKey.get(neighborKey);
      if (!neighbor || neighbor.ownerPlayerId !== myPlayerId) continue;
      visited.add(neighborKey);
      queue.push(neighborKey);
    }
  }
  visited.delete(sourceKey);
  return visited;
}

function getLiftYForTerritory(
  territoryKey: string,
  selectedFrom: string | null,
  selectedTo: string | null,
  hoveredTerritoryKey: string | null,
) {
  if (territoryKey === selectedFrom) return -5;
  if (territoryKey === selectedTo) return -4;
  if (territoryKey === hoveredTerritoryKey) return -3;
  return 0;
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
  opponentFromTerritoryKey,
  opponentToTerritoryKey,
  troopPopups = [],
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
  opponentFromTerritoryKey?: string | null;
  opponentToTerritoryKey?: string | null;
  troopPopups?: Array<{ id: string; territoryKey: string; amount: number; kind: "loss" | "gain" }>;
}) {
  const [showConnections, setShowConnections] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("normal");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const territoryByKey = useMemo(
    () => new Map<string, TerritoryStateDTO>(gameState.territories.map((t) => [t.territoryKey, t])),
    [gameState.territories],
  );
  const continentByKey = useMemo(
    () => new Map(gameState.map.continents.map((continent) => [continent.key, continent])),
    [gameState.map.continents],
  );

  const focusKey = hoveredTerritoryKey || selectedFrom;
  const focusTerritory = focusKey ? territoryByKey.get(focusKey) : null;
  const focusNeighbors = new Set(focusTerritory?.adjacency ?? []);

  const selectedSourceState = selectedFrom ? territoryByKey.get(selectedFrom) : null;
  const sourceOwnedByMe = Boolean(selectedSourceState && myPlayerId && selectedSourceState.ownerPlayerId === myPlayerId);

  const actionableTargets = new Set<string>();
  if (selectedFrom && sourceOwnedByMe) {
    if (mode === "fortify" && myPlayerId) {
      const connected = getConnectedAlliedTerritories(selectedFrom, myPlayerId, territoryByKey);
      for (const key of connected) actionableTargets.add(key);
    } else {
      const neighbors = territoryByKey.get(selectedFrom)?.adjacency ?? [];
      for (const key of neighbors) {
        const targetState = territoryByKey.get(key);
        if (!targetState || !myPlayerId) continue;
        if (mode === "attack" && targetState.ownerPlayerId !== myPlayerId) actionableTargets.add(key);
      }
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

  const territoriesInRenderOrder = useMemo(() => {
    const liftedKeys = new Set<string>();
    if (selectedFrom) liftedKeys.add(selectedFrom);
    if (selectedTo) liftedKeys.add(selectedTo);
    if (hoveredTerritoryKey) liftedKeys.add(hoveredTerritoryKey);

    const base: TerritoryStateDTO[] = [];
    const lifted: TerritoryStateDTO[] = [];
    for (const territory of gameState.territories) {
      if (liftedKeys.has(territory.territoryKey)) lifted.push(territory);
      else base.push(territory);
    }
    return [...base, ...lifted];
  }, [gameState.territories, hoveredTerritoryKey, selectedFrom, selectedTo]);

  const continentBadges = useMemo(() => {
    const grouped = new Map<string, { sumX: number; sumY: number; count: number }>();
    for (const territory of gameState.territories) {
      if (!territory.continent) continue;
      const current = grouped.get(territory.continent) ?? { sumX: 0, sumY: 0, count: 0 };
      current.sumX += territory.centroid.x;
      current.sumY += territory.centroid.y;
      current.count += 1;
      grouped.set(territory.continent, current);
    }

    return [...grouped.entries()]
      .map(([continentKey, value]) => {
        const continent = continentByKey.get(continentKey);
        if (!continent || value.count === 0) return null;
        return {
          key: continentKey,
          name: continent.name,
          bonus: continent.bonus,
          color: continent.color ?? "#94a3b8",
          x: value.sumX / value.count,
          y: value.sumY / value.count,
        };
      })
      .filter(Boolean);
  }, [continentByKey, gameState.territories]);

  const opponentFrom = opponentFromTerritoryKey ? territoryByKey.get(opponentFromTerritoryKey) : null;
  const opponentTo = opponentToTerritoryKey ? territoryByKey.get(opponentToTerritoryKey) : null;
  const opponentArrowPath = useMemo(() => {
    if (!opponentFrom || !opponentTo) return null;
    const ax = opponentFrom.centroid.x;
    const ay = opponentFrom.centroid.y;
    const bx = opponentTo.centroid.x;
    const by = opponentTo.centroid.y;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const curve = Math.min(64, Math.max(24, length * 0.22));
    const cx = mx + nx * curve;
    const cy = my + ny * curve;
    return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }, [opponentFrom, opponentTo]);

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
        <button
          className="btn-secondary px-2 py-1 text-xs"
          onClick={() => setViewMode((prev) => (prev === "normal" ? "continents" : "normal"))}
        >
          {viewMode === "normal" ? "Vue continents" : "Vue normale"}
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
        <defs>
          <marker id="opponent-arrow-head" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
          </marker>
        </defs>

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

        {territoriesInRenderOrder.map((territory) => {
          const isFrom = selectedFrom === territory.territoryKey;
          const isTo = selectedTo === territory.territoryKey;
          const isNeighbor = focusNeighbors.has(territory.territoryKey);
          const isFocus = focusKey === territory.territoryKey;
          const isActionableTarget = actionableTargets.has(territory.territoryKey);
          const shouldDim = Boolean(focusKey) && !isFocus && !isNeighbor;
          const hovered = hoveredTerritoryKey === territory.territoryKey;
          const lifted = isFrom || isTo || hovered;
          const liftY = getLiftYForTerritory(territory.territoryKey, selectedFrom, selectedTo, hoveredTerritoryKey);
          const liftShadow = isFrom || isTo ? "drop-shadow(0px 6px 10px rgba(15,23,42,0.35))" : "drop-shadow(0px 4px 8px rgba(15,23,42,0.25))";

          const continent = territory.continent ? continentByKey.get(territory.continent) : null;
          const continentColor = continent?.color ?? "#94a3b8";
          const fillColor = viewMode === "continents" ? continentColor : ownerColor(territory.ownerPlayerId, myPlayerId);

          return (
            <g
              key={territory.territoryKey}
              className="cursor-pointer"
              data-territory="1"
              onMouseEnter={() => setHoveredTerritoryKey(territory.territoryKey)}
              onMouseLeave={() => setHoveredTerritoryKey(null)}
              onClick={() => onPick(territory.territoryKey)}
              transform={lifted ? `translate(0 ${liftY})` : undefined}
              style={{
                transition: "transform 140ms ease, filter 140ms ease",
                filter: lifted ? liftShadow : "none",
              }}
            >
              <path
                id={territory.svgId}
                d={territory.pathData}
                fill={fillColor}
                stroke={isFrom ? "#0f172a" : isTo ? "#1d4ed8" : isActionableTarget ? "#1f9d67" : "#334155"}
                strokeWidth={isFrom ? 3.5 : isTo ? 2.5 : isActionableTarget ? 3 : 1.25}
                strokeDasharray={isTo ? "5 4" : ""}
                opacity={shouldDim ? 0.28 : viewMode === "continents" ? 0.72 : 0.9}
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

        {gameState.territories.map((territory) => {
          const liftY = getLiftYForTerritory(territory.territoryKey, selectedFrom, selectedTo, hoveredTerritoryKey);
          return (
            <g key={`troops-${territory.territoryKey}`} pointerEvents="none">
              <circle cx={territory.centroid.x} cy={territory.centroid.y + liftY} r={11} fill="#0f172a" opacity={0.86} />
              <text
                x={territory.centroid.x}
                y={territory.centroid.y + 4 + liftY}
                fontSize={10}
                fill="#fff"
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {territory.troops}
              </text>
            </g>
          );
        })}

        {viewMode === "continents" &&
          continentBadges.map((continent) =>
            continent ? (
              <g key={`continent-${continent.key}`} pointerEvents="none">
                <rect
                  x={continent.x - 52}
                  y={continent.y - 18}
                  width={104}
                  height={28}
                  rx={8}
                  fill="rgba(255,255,255,0.88)"
                  stroke={continent.color}
                  strokeWidth={1.5}
                />
                <text x={continent.x} y={continent.y - 7} fontSize={10} fill="#0f172a" textAnchor="middle">
                  {continent.name}
                </text>
                <text x={continent.x} y={continent.y + 8} fontSize={11} fill="#0f172a" fontWeight={700} textAnchor="middle">
                  +{continent.bonus} troupes
                </text>
              </g>
            ) : null,
          )}

        {(opponentFrom || opponentTo) && (
          <g pointerEvents="none">
            {opponentFrom && (
              <path
                d={opponentFrom.pathData}
                fill="none"
                stroke="#dc2626"
                strokeWidth={4}
                strokeOpacity={0.92}
                style={{ filter: "drop-shadow(0px 0px 6px rgba(220,38,38,0.55))" }}
              />
            )}
            {opponentTo && (
              <path
                d={opponentTo.pathData}
                fill="none"
                stroke="#dc2626"
                strokeWidth={4}
                strokeOpacity={0.92}
                strokeDasharray="7 4"
                style={{ filter: "drop-shadow(0px 0px 6px rgba(220,38,38,0.55))" }}
              />
            )}
            {opponentArrowPath && (
              <path
                d={opponentArrowPath}
                fill="none"
                stroke="#dc2626"
                strokeWidth={3.5}
                strokeOpacity={0.95}
                markerEnd="url(#opponent-arrow-head)"
                strokeLinecap="round"
                style={{ filter: "drop-shadow(0px 0px 5px rgba(220,38,38,0.45))" }}
              />
            )}
          </g>
        )}

        {troopPopups.map((popup) => {
          const territory = territoryByKey.get(popup.territoryKey);
          if (!territory) return null;
          const isGain = popup.kind === "gain";
          const color = isGain ? "#16a34a" : "#dc2626";
          const prefix = isGain ? "+" : "-";
          return (
            <g key={popup.id} pointerEvents="none" opacity={0.95}>
              <text
                x={territory.centroid.x}
                y={territory.centroid.y + 24}
                fill={color}
                fontSize={16}
                fontWeight={800}
                textAnchor="middle"
              >
                {prefix}
                {popup.amount}
                <animate attributeName="opacity" from="0" to="1" dur="0.12s" fill="freeze" />
                <animate attributeName="opacity" from="1" to="0" begin="0.65s" dur="0.45s" fill="freeze" />
                <animateTransform
                  attributeName="transform"
                  type="translate"
                  from="0 0"
                  to="0 -28"
                  dur="1.1s"
                  fill="freeze"
                />
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
