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
type CaptureFillAnimation = {
  id: string;
  toTerritoryKey: string;
  fromTerritoryKey: string;
  previousOwnerPlayerId: string;
  newOwnerPlayerId: string;
};

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3 ? normalized.split("").map((c) => `${c}${c}`).join("") : normalized;
  const int = Number.parseInt(full, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mixHex(a: string, b: string, ratio: number) {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  const t = Math.max(0, Math.min(1, ratio));
  return rgbToHex(ar.r + (br.r - ar.r) * t, ar.g + (br.g - ar.g) * t, ar.b + (br.b - ar.b) * t);
}

function troopBadgeBaseColor(ownerPlayerId: string, myPlayerId: string | null) {
  const territoryTint = ownerFillHexColor(ownerPlayerId, myPlayerId);
  return mixHex(territoryTint, "#0f172a", 0.12);
}

function ownerColor(ownerPlayerId: string, myPlayerId: string | null) {
  if (!ownerPlayerId) return "var(--neutral)";
  if (myPlayerId && ownerPlayerId === myPlayerId) return "var(--player-me)";
  return "var(--player-opponent)";
}

function ownerFillHexColor(ownerPlayerId: string, myPlayerId: string | null) {
  if (!ownerPlayerId) return "#cbd5e1";
  if (myPlayerId && ownerPlayerId === myPlayerId) return "#2f80ed";
  return "#ef4444";
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
  opponentActorIsMe = false,
  captureFillAnimations = [],
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
  opponentActorIsMe?: boolean;
  captureFillAnimations?: CaptureFillAnimation[];
  troopPopups?: Array<{ id: string; territoryKey: string; amount: number; kind: "loss" | "gain" }>;
}) {
  const [showConnections, setShowConnections] = useState(true);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
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
  const captureByTerritory = useMemo(
    () => new Map(captureFillAnimations.map((animation) => [animation.toTerritoryKey, animation])),
    [captureFillAnimations],
  );

  const opponentFrom = opponentFromTerritoryKey ? territoryByKey.get(opponentFromTerritoryKey) : null;
  const opponentTo = opponentToTerritoryKey ? territoryByKey.get(opponentToTerritoryKey) : null;
  const [vbX, vbY, vbW, vbH] = gameState.map.viewBox.split(/\s+/).map((v) => Number(v));
  const reserveX = Number.isFinite(vbX) && Number.isFinite(vbW) ? vbX + vbW * 0.08 : 40;
  const reserveY = Number.isFinite(vbY) && Number.isFinite(vbH) ? vbY + vbH * 0.1 : 40;
  const actionArrowColor = opponentActorIsMe ? "#22d3ee" : "#dc2626";
  const opponentFromLiftY =
    opponentActorIsMe && opponentFrom?.territoryKey
      ? getLiftYForTerritory(opponentFrom.territoryKey, selectedFrom, selectedTo, hoveredTerritoryKey)
      : 0;
  const opponentToLiftY =
    opponentActorIsMe && opponentTo?.territoryKey
      ? getLiftYForTerritory(opponentTo.territoryKey, selectedFrom, selectedTo, hoveredTerritoryKey)
      : 0;
  const opponentArrowPath = useMemo(() => {
    const fromPoint = opponentFrom
      ? { x: opponentFrom.centroid.x, y: opponentFrom.centroid.y + opponentFromLiftY }
      : null;
    const toPoint = opponentTo
      ? { x: opponentTo.centroid.x, y: opponentTo.centroid.y + opponentToLiftY }
      : null;

    const start = fromPoint ?? (toPoint ? { x: reserveX, y: reserveY } : null);
    const end = toPoint ?? fromPoint;
    if (!start || !end) return null;

    const ax = start.x;
    const ay = start.y;
    const bx = end.x;
    const by = end.y;
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
  }, [opponentFrom, opponentFromLiftY, opponentTo, opponentToLiftY, reserveX, reserveY]);

  return (
    <div
      className="relative h-full w-full overflow-hidden"
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
        className="h-full w-full"
        aria-label="Carte de jeu"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: "50% 50%",
          transition: dragging ? "none" : "transform 120ms ease-out",
        }}
      >
        <defs>
          <marker id="opponent-arrow-head-red" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#dc2626" />
          </marker>
          <marker id="opponent-arrow-head-cyan" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#22d3ee" />
          </marker>
          <filter id="territory-relief" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="-1.2" dy="1.2" stdDeviation="0.7" floodColor="#ffffff" floodOpacity="0.45" />
            <feDropShadow dx="1.8" dy="-1.8" stdDeviation="1.1" floodColor="#0f172a" floodOpacity="0.32" />
          </filter>
          <filter id="territory-relief-active" x="-25%" y="-25%" width="150%" height="150%">
            <feDropShadow dx="-1.5" dy="1.5" stdDeviation="0.9" floodColor="#ffffff" floodOpacity="0.52" />
            <feDropShadow dx="2.2" dy="-2.2" stdDeviation="1.5" floodColor="#0f172a" floodOpacity="0.42" />
          </filter>
        </defs>

        {showConnections &&
          allEdges.map((edge) => (
            <line
              key={`base-${edge.id}`}
              x1={edge.ax}
              y1={edge.ay}
              x2={edge.bx}
              y2={edge.by}
              stroke={hoveredEdgeId === edge.id ? "#dc2626" : "#64748b"}
              strokeWidth={hoveredEdgeId === edge.id ? 3 : 2}
              strokeOpacity={1}
              strokeDasharray="7 6"
              strokeLinecap="round"
              pointerEvents="stroke"
              onMouseEnter={() => setHoveredEdgeId(edge.id)}
              onMouseLeave={() => setHoveredEdgeId((prev) => (prev === edge.id ? null : prev))}
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
                stroke="#dc2626"
                strokeWidth={3}
                strokeOpacity={1}
                strokeDasharray="7 6"
                strokeLinecap="round"
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
          const baseFillColor =
            viewMode === "continents" ? continentColor : ownerFillHexColor(territory.ownerPlayerId, myPlayerId);
          const fillColor = shouldDim ? mixHex(baseFillColor, "#0f172a", 0.32) : baseFillColor;
          const captureAnimation = captureByTerritory.get(territory.territoryKey) ?? null;
          const captureFrom = captureAnimation ? territoryByKey.get(captureAnimation.fromTerritoryKey) : null;
          const captureOverlayColor = captureAnimation
            ? ownerFillHexColor(captureAnimation.previousOwnerPlayerId, myPlayerId)
            : null;
          const captureClipId = captureAnimation ? `capture-clip-${captureAnimation.id}` : null;
          const captureAngleDeg =
            captureAnimation && captureFrom
              ? (Math.atan2(territory.centroid.y - captureFrom.centroid.y, territory.centroid.x - captureFrom.centroid.x) * 180) / Math.PI
              : 0;

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
                stroke={isFrom ? "#0f172a" : isTo ? "#1d4ed8" : isActionableTarget ? "#1f9d67" : isNeighbor ? "#f8fafc" : "#1f2937"}
                strokeWidth={isFrom ? 3.5 : isTo ? 2.5 : isActionableTarget ? 3 : isNeighbor ? 2 : 1.25}
                strokeDasharray={isTo ? "5 4" : ""}
                opacity={1}
                pointerEvents="all"
                filter={isFrom || isTo || hovered ? "url(#territory-relief-active)" : "url(#territory-relief)"}
              />
              {captureAnimation && captureOverlayColor && captureClipId && captureFrom && (
                <>
                  <defs>
                    <clipPath id={captureClipId}>
                      <g transform={`rotate(${captureAngleDeg} ${territory.centroid.x} ${territory.centroid.y})`}>
                        <rect
                          x={territory.centroid.x - 2200}
                          y={territory.centroid.y - 2200}
                          width={4400}
                          height={4400}
                        >
                          <animate
                            attributeName="x"
                            from={territory.centroid.x - 2200}
                            to={territory.centroid.x + 2200}
                            dur="0.85s"
                            fill="freeze"
                          />
                        </rect>
                      </g>
                    </clipPath>
                  </defs>
                  <path
                    d={territory.pathData}
                    fill={captureOverlayColor}
                    clipPath={`url(#${captureClipId})`}
                    pointerEvents="none"
                  />
                </>
              )}

              <path
                d={territory.pathData}
                fill="none"
                stroke="transparent"
                strokeWidth={10}
                pointerEvents="stroke"
              />

              <path
                d={territory.pathData}
                fill="none"
                stroke={isFrom || isTo || hovered || isNeighbor ? "#f8fafc" : "#334155"}
                strokeWidth={isFrom || isTo || hovered || isNeighbor ? 1.5 : 1}
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />

              {(isNeighbor || isFocus) && (
                <path
                  d={territory.pathData}
                  fill="none"
                  stroke={isFocus ? "#0f172a" : "#f8fafc"}
                  strokeWidth={2}
                  opacity={1}
                />
              )}

              {hovered && (
                (() => {
                  const labelX = territory.centroid.x + 16;
                  const labelY = territory.centroid.y - 18 + liftY;
                  const base = troopBadgeBaseColor(territory.ownerPlayerId, myPlayerId);
                  const rim = mixHex(base, "#0f172a", 0.5);
                  const core = mixHex(base, "#ffffff", 0.2);
                  const textColor = mixHex(base, "#0f172a", 0.82);
                  const labelWidth = Math.max(60, territory.territoryName.length * 6.5 + 18);
                  const labelHeight = 18;

                  return (
                    <g className="pointer-events-none">
                      <rect
                        x={labelX - labelWidth / 2 + 1}
                        y={labelY - labelHeight / 2 + 1.3}
                        width={labelWidth}
                        height={labelHeight}
                        rx={9}
                        fill="#0f172a"
                        opacity={0.24}
                      />
                      <rect
                        x={labelX - labelWidth / 2}
                        y={labelY - labelHeight / 2}
                        width={labelWidth}
                        height={labelHeight}
                        rx={9}
                        fill={rim}
                      />
                      <rect
                        x={labelX - labelWidth / 2 + 1.2}
                        y={labelY - labelHeight / 2 + 1.2}
                        width={labelWidth - 2.4}
                        height={labelHeight - 2.4}
                        rx={8}
                        fill={core}
                      />
                      <text
                        x={labelX}
                        y={labelY}
                        fontSize={10}
                        fontWeight={800}
                        fill={textColor}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        alignmentBaseline="middle"
                        dy="0.02em"
                      >
                        {territory.territoryName}
                      </text>
                    </g>
                  );
                })()
              )}
            </g>
          );
        })}

        {gameState.territories.map((territory) => {
          const liftY = getLiftYForTerritory(territory.territoryKey, selectedFrom, selectedTo, hoveredTerritoryKey);
          const base = troopBadgeBaseColor(territory.ownerPlayerId, myPlayerId);
          const rim = mixHex(base, "#0f172a", 0.55);
          const core = mixHex(base, "#ffffff", 0.12);
          const specular = mixHex(base, "#ffffff", 0.58);
          return (
            <g key={`troops-${territory.territoryKey}`} pointerEvents="none">
              <circle cx={territory.centroid.x + 1.2} cy={territory.centroid.y + liftY + 1.6} r={11.6} fill="#0f172a" opacity={0.32} />
              <circle cx={territory.centroid.x} cy={territory.centroid.y + liftY} r={11.4} fill={rim} />
              <circle cx={territory.centroid.x} cy={territory.centroid.y + liftY} r={9.8} fill={core} />
              <text
                x={territory.centroid.x}
                y={territory.centroid.y + liftY}
                fontSize={10}
                fill="#0f172a"
                fontWeight={800}
                textAnchor="middle"
                dominantBaseline="middle"
                alignmentBaseline="middle"
                dy="0.02em"
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
                stroke={actionArrowColor}
                strokeWidth={4}
                strokeOpacity={1}
                transform={opponentFromLiftY !== 0 ? `translate(0 ${opponentFromLiftY})` : undefined}
                style={{ filter: "drop-shadow(0px 0px 6px rgba(15,23,42,0.5))" }}
              />
            )}
            {opponentTo && (
              <path
                d={opponentTo.pathData}
                fill="none"
                stroke={actionArrowColor}
                strokeWidth={4}
                strokeOpacity={1}
                strokeDasharray="7 4"
                transform={opponentToLiftY !== 0 ? `translate(0 ${opponentToLiftY})` : undefined}
                style={{ filter: "drop-shadow(0px 0px 6px rgba(15,23,42,0.5))" }}
              />
            )}
            {opponentArrowPath && (
              <>
                <path
                  d={opponentArrowPath}
                  fill="none"
                  stroke={actionArrowColor}
                  strokeWidth={3.5}
                  strokeOpacity={1}
                  markerEnd={opponentActorIsMe ? "url(#opponent-arrow-head-cyan)" : "url(#opponent-arrow-head-red)"}
                  strokeLinecap="round"
                  strokeDasharray="12 8"
                  style={{ filter: "drop-shadow(0px 0px 5px rgba(15,23,42,0.45))" }}
                >
                  <animate attributeName="stroke-dashoffset" from="0" to="-40" dur="0.85s" repeatCount="indefinite" />
                </path>
                <circle r={4.2} fill={actionArrowColor}>
                  <animateMotion dur="0.75s" repeatCount="indefinite" path={opponentArrowPath} keyPoints="0;0.9" keyTimes="0;1" calcMode="linear" />
                </circle>
              </>
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
            <g key={popup.id} pointerEvents="none" opacity={1}>
              <text
                className="troop-popup-text"
                x={territory.centroid.x}
                y={territory.centroid.y + 24}
                fill={color}
                fontSize={16}
                fontWeight={800}
                textAnchor="middle"
              >
                {prefix}
                {popup.amount}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
