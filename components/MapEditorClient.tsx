"use client";

import { ChangeEvent, MouseEvent, PointerEvent, useEffect, useMemo, useRef, useState } from "react";

type Continent = { key: string; name: string; bonus: number; color: string };
type Territory = {
  svgId: string;
  groupId: string;
  key: string;
  name: string;
  continent: string | null;
  adjacency: string[];
  centroid: { x: number; y: number };
  pathData: string;
};
type SelectionMode = "group" | "solo";
type EditorPersistedState = {
  mapKey: string;
  mapName: string;
  version: number;
  viewBox: string;
  territories: Territory[];
  continents: Continent[];
  a: string | null;
  b: string | null;
  aMode: SelectionMode;
  bMode: SelectionMode;
  zoom: number;
  pan: { x: number; y: number };
  showLinks: boolean;
  showCentroids: boolean;
  showContinentView: boolean;
};

const EDITOR_STATE_KEY = "map_editor_state_v1";

const norm = (v: string) =>
  v.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
const vb = (viewBox: string) => {
  const p = viewBox.split(/\s+/).map(Number);
  return p.length === 4 ? { x: p[0], y: p[1], w: p[2], h: p[3] } : { x: 0, y: 0, w: 1000, h: 600 };
};
const colorFromIndex = (index: number) => {
  const hue = (index * 137.508) % 360;
  const sat = 68 + ((index % 4) * 4);
  const light = 50 + ((index % 3) * 4);
  return `hsl(${hue} ${sat}% ${light}%)`;
};

function centroidFromPathData(d: string) {
  if (typeof document !== "undefined") {
    try {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", d);
      svg.setAttribute("width", "0");
      svg.setAttribute("height", "0");
      svg.style.position = "absolute";
      svg.style.left = "-99999px";
      svg.style.top = "-99999px";
      svg.appendChild(path);
      document.body.appendChild(svg);
      const box = path.getBBox();
      document.body.removeChild(svg);
      if (Number.isFinite(box.x) && Number.isFinite(box.y) && Number.isFinite(box.width) && Number.isFinite(box.height)) {
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
    } catch {
      // fallback below
    }
  }

  const nums = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
  if (nums.length < 2) return { x: 0, y: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < nums.length - 1; i += 2) {
    const x = nums[i];
    const y = nums[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 0, y: 0 };
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function parseSvg(content: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(content, "image/svg+xml");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("Le fichier ne contient pas de balise <svg>.");
  const viewBox = svg.getAttribute("viewBox") ?? "0 0 1000 600";
  const paths = Array.from(svg.querySelectorAll("path"));
  const seen = new Set<string>();
  const territories: Territory[] = [];
  for (let i = 0; i < paths.length; i += 1) {
    const d = paths[i].getAttribute("d")?.trim() ?? "";
    if (!d) continue;
    const raw = paths[i].getAttribute("id")?.trim() || `territory_${i + 1}`;
    const svgId = seen.has(raw) ? `${raw}_${i + 1}` : raw;
    seen.add(svgId);
    const clean = svgId.replace(/^t-/, "");
    const key = norm(clean) || `territory_${i + 1}`;
    territories.push({
      svgId,
      groupId: svgId,
      key,
      name: clean || key,
      continent: null,
      adjacency: [],
      centroid: centroidFromPathData(d),
      pathData: d,
    });
  }
  if (territories.length === 0) throw new Error("Aucun path exploitable trouve dans le SVG.");
  return { viewBox, territories };
}

function buildGroups(territories: Territory[]) {
  const g = new Map<string, Territory[]>();
  for (const t of territories) g.set(t.groupId, [...(g.get(t.groupId) ?? []), t]);
  return g;
}

function centroidForGroup(members: Territory[]) {
  const mergedPath = members.map((m) => m.pathData.trim()).filter(Boolean).join(" ");
  return centroidFromPathData(mergedPath);
}

function buildGroupKeyMap(territories: Territory[]) {
  const groups = buildGroups(territories);
  const ordered = Array.from(groups.entries()).sort((a, b) => a[1][0].key.localeCompare(b[1][0].key));
  const keyByGroup = new Map<string, string>();
  const used = new Set<string>();
  for (const [gid, members] of ordered) {
    const base = norm(members[0].key) || "territory";
    let k = base;
    let i = 2;
    while (used.has(k)) {
      k = `${base}_${i}`;
      i += 1;
    }
    used.add(k);
    keyByGroup.set(gid, k);
  }
  return { groups, ordered, keyByGroup };
}

function exportJson(mapKey: string, mapName: string, version: number, viewBox: string, continents: Continent[], territories: Territory[]) {
  const { ordered, keyByGroup } = buildGroupKeyMap(territories);
  const bySvg = new Map(territories.map((t) => [t.svgId, t]));
  const outTerritories = ordered.map(([gid, members]) => {
    const first = members[0];
    const adjGroups = new Set<string>();
    for (const m of members) {
      for (const n of m.adjacency) {
        const nt = bySvg.get(n);
        if (!nt || nt.groupId === gid) continue;
        adjGroups.add(nt.groupId);
      }
    }
    return {
      key: keyByGroup.get(gid),
      name: first.name,
      continent: first.continent ?? null,
      svgId: first.svgId,
      adjacency: Array.from(adjGroups).map((x) => keyByGroup.get(x)).filter(Boolean).sort(),
      centroid: {
        x: Number((members.reduce((s, m) => s + m.centroid.x, 0) / members.length).toFixed(2)),
        y: Number((members.reduce((s, m) => s + m.centroid.y, 0) / members.length).toFixed(2)),
      },
      pathData: members.map((m) => m.pathData).join(" "),
    };
  });
  return JSON.stringify(
    {
      mapKey: norm(mapKey) || "new-map",
      name: mapName || "Nouvelle carte",
      version: Math.max(1, Math.trunc(version || 1)),
      viewBox,
      continents: continents.map((c) => ({ key: norm(c.key), name: c.name, bonus: Math.max(1, Math.trunc(c.bonus || 1)), color: c.color || null })),
      territories: outTerritories,
    },
    null,
    2,
  );
}

function exportGroupedSvg(viewBox: string, territories: Territory[]) {
  const { ordered, keyByGroup } = buildGroupKeyMap(territories);
  const paths = ordered
    .map(([gid, members]) => {
      const key = keyByGroup.get(gid) ?? "territory";
      const d = members.map((m) => m.pathData.trim()).filter(Boolean).join(" ");
      return `  <path id="t-${key}" d="${d.replace(/"/g, "&quot;")}" />`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n${paths}\n</svg>\n`;
}

export default function MapEditorClient() {
  const [mapKey, setMapKey] = useState("custom-map");
  const [mapName, setMapName] = useState("Carte personnalisee");
  const [version, setVersion] = useState(1);
  const [viewBox, setViewBox] = useState("0 0 1000 600");
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [continents, setContinents] = useState<Continent[]>([{ key: "continent_1", name: "Continent 1", bonus: 2, color: "#22c55e" }]);
  const [a, setA] = useState<string | null>(null);
  const [b, setB] = useState<string | null>(null);
  const [aMode, setAMode] = useState<SelectionMode>("group");
  const [bMode, setBMode] = useState<SelectionMode>("group");
  const [hover, setHover] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{
    svgX: number;
    svgY: number;
    clientX: number;
    clientY: number;
    panX: number;
    panY: number;
  } | null>(null);
  const [showLinks, setShowLinks] = useState(true);
  const [showCentroids, setShowCentroids] = useState(true);
  const [showContinentView, setShowContinentView] = useState(false);
  const [pickCentroid, setPickCentroid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [out, setOut] = useState("");
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panMovedRef = useRef(false);
  const [suppressNextPickClick, setSuppressNextPickClick] = useState(false);
  const hydratedRef = useRef(false);

  const ta = useMemo(() => territories.find((t) => t.svgId === a) ?? null, [territories, a]);
  const tb = useMemo(() => territories.find((t) => t.svgId === b) ?? null, [territories, b]);
  const groups = useMemo(() => buildGroups(territories), [territories]);
  const groupRepresentative = useMemo(() => {
    const rep = new Map<string, string>();
    for (const [groupId, members] of groups.entries()) {
      const first = [...members].sort((x, y) => x.svgId.localeCompare(y.svgId))[0];
      if (first) rep.set(groupId, first.svgId);
    }
    return rep;
  }, [groups]);
  const groupBySvg = useMemo(() => new Map(territories.map((t) => [t.svgId, t.groupId])), [territories]);
  const hoverGroup = hover ? groupBySvg.get(hover) : null;
  const groupColor = useMemo(() => {
    const orderedGroupIds = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b));
    return new Map(orderedGroupIds.map((groupId, index) => [groupId, colorFromIndex(index)]));
  }, [groups]);
  const continentColor = useMemo(() => {
    const palette = new Map<string, string>();
    const sorted = [...continents].sort((a, b) => a.key.localeCompare(b.key));
    sorted.forEach((continent, index) => {
      const color = continent.color?.trim() ? continent.color : colorFromIndex(index);
      palette.set(continent.key, color);
    });
    return palette;
  }, [continents]);

  const links = useMemo(() => {
    const by = new Map(territories.map((t) => [t.svgId, t]));
    const dedup = new Set<string>();
    const arr: Array<{ g1: string; g2: string; x1: number; y1: number; x2: number; y2: number }> = [];
    const center = (gid: string) => {
      const m = groups.get(gid) ?? [];
      return { x: m.reduce((s, t) => s + t.centroid.x, 0) / Math.max(1, m.length), y: m.reduce((s, t) => s + t.centroid.y, 0) / Math.max(1, m.length) };
    };
    for (const t of territories) {
      for (const n of t.adjacency) {
        const nt = by.get(n);
        if (!nt || nt.groupId === t.groupId) continue;
        const [g1, g2] = t.groupId < nt.groupId ? [t.groupId, nt.groupId] : [nt.groupId, t.groupId];
        const k = `${g1}|${g2}`;
        if (dedup.has(k)) continue;
        dedup.add(k);
        const c1 = center(g1);
        const c2 = center(g2);
        arr.push({ g1, g2, x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y });
      }
    }
    return arr;
  }, [territories, groups]);

  const selectionSet = (id: string | null, mode: SelectionMode) => {
    if (!id) return new Set<string>();
    if (mode === "solo") return new Set([id]);
    const gid = groupBySvg.get(id);
    if (!gid) return new Set<string>();
    return new Set((groups.get(gid) ?? []).map((t) => t.svgId));
  };

  const isInSelection = (t: Territory, id: string | null, mode: SelectionMode) => {
    if (!id) return false;
    return mode === "group" ? groupBySvg.get(id) === t.groupId : t.svgId === id;
  };

  const groupCentroids = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    for (const [groupId, members] of groups.entries()) {
      if (members.length === 0) continue;
      out.set(groupId, centroidForGroup(members));
    }
    return out;
  }, [groups]);

  const selectedGroupIds = useMemo(() => {
    const idsFor = (id: string | null, mode: SelectionMode) => {
      if (!id) return new Set<string>();
      if (mode === "solo") return new Set([id]);
      const gid = groupBySvg.get(id);
      if (!gid) return new Set<string>();
      return new Set((groups.get(gid) ?? []).map((t) => t.svgId));
    };
    const out = new Set<string>();
    for (const id of idsFor(a, aMode)) {
      const gid = groupBySvg.get(id);
      if (gid) out.add(gid);
    }
    for (const id of idsFor(b, bMode)) {
      const gid = groupBySvg.get(id);
      if (gid) out.add(gid);
    }
    return out;
  }, [a, aMode, b, bMode, groupBySvg, groups]);

  const pick = (id: string, solo = false) => {
    const gid = groupBySvg.get(id);
    if (!gid) return;
    const groupSize = (groups.get(gid) ?? []).length;
    const mode: SelectionMode = solo ? "solo" : groupSize > 1 ? "group" : "solo";
    const rep = mode === "group" ? groupRepresentative.get(gid) ?? id : id;
    const aGroup = a ? groupBySvg.get(a) : null;
    const bGroup = b ? groupBySvg.get(b) : null;
    const sameAsA = a ? (aMode === "group" && mode === "group" ? aGroup === gid : a === rep && aMode === mode) : false;
    const sameAsB = b ? (bMode === "group" && mode === "group" ? bGroup === gid : b === rep && bMode === mode) : false;

    if (!a) {
      setA(rep);
      setAMode(mode);
      return;
    }
    if (sameAsA) {
      setA(null);
      setAMode("group");
      setB(null);
      setBMode("group");
      return;
    }
    if (!b) {
      setB(rep);
      setBMode(mode);
      return;
    }
    if (sameAsB) {
      setB(null);
      setBMode("group");
      return;
    }
    setA(rep);
    setAMode(mode);
    setB(null);
    setBMode("group");
  };

  const togglePairLink = () => {
    if (!ta || !tb) return;
    const setAGroup = selectionSet(a, aMode);
    const setBGroup = selectionSet(b, bMode);
    if (setAGroup.size === 0 || setBGroup.size === 0) return;
    if (setAGroup.size === setBGroup.size && [...setAGroup].every((id) => setBGroup.has(id))) return;
    const connected = ta.adjacency.some((n) => setBGroup.has(n));
    setTerritories((prev) =>
      prev.map((t) => {
        if (!setAGroup.has(t.svgId) && !setBGroup.has(t.svgId)) return t;
        const adj = new Set(t.adjacency);
        const targets = setAGroup.has(t.svgId) ? setBGroup : setAGroup;
        for (const x of targets) {
          if (connected) adj.delete(x);
          else adj.add(x);
        }
        return { ...t, adjacency: Array.from(adj).sort() };
      }),
    );
  };

  const groupPair = () => {
    if (!ta || !tb) return;
    const setAGroup = selectionSet(a, aMode);
    const setBGroup = selectionSet(b, bMode);
    if (setAGroup.size === 0 || setBGroup.size === 0) return;
    const mergedIds = new Set([...setAGroup, ...setBGroup]);
    const keepGroupId = aMode === "group" ? ta.groupId : ta.svgId;
    const mergedMembers = territories.filter((t) => mergedIds.has(t.svgId));
    const mergedCentroid = centroidForGroup(mergedMembers);
    setTerritories((prev) =>
      prev.map((t) =>
        mergedIds.has(t.svgId)
          ? {
              ...t,
              groupId: keepGroupId,
              key: ta.key,
              name: ta.name,
              continent: ta.continent,
              centroid: mergedCentroid,
            }
          : t,
      ),
    );
    setB(null);
    setBMode("group");
  };

  const ungroupA = () => {
    if (!ta) return;
    const selectedIds = selectionSet(a, aMode);
    setTerritories((prev) => prev.map((t) => (selectedIds.has(t.svgId) ? { ...t, groupId: t.svgId } : t)));
    setB(null);
    setBMode("group");
  };

  const onSvgImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const parsed = parseSvg(await f.text());
      setViewBox(parsed.viewBox);
      setTerritories(parsed.territories);
      setA(parsed.territories[0]?.svgId ?? null);
      setAMode("group");
      setB(null);
      setBMode("group");
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setError(null);
      setOut("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import impossible");
    } finally {
      e.target.value = "";
    }
  };

  const downloadGroupedSvg = () => {
    const svg = exportGroupedSvg(viewBox, territories);
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement("a");
    aEl.href = url;
    aEl.download = `${norm(mapKey) || "new-map"}-grouped.svg`;
    aEl.click();
    URL.revokeObjectURL(url);
  };

  const onMapClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!pickCentroid || !ta || !svgRef.current) return;
    const point = clientToWorldPoint(e.clientX, e.clientY);
    if (!point) return;
    const selectedIds = selectionSet(a, aMode);
    setTerritories((prev) => prev.map((t) => (selectedIds.has(t.svgId) ? { ...t, centroid: point } : t)));
    setPickCentroid(false);
  };

  const toSvgPoint = (clientX: number, clientY: number) => {
    if (!svgRef.current) return null;
    const pt = svgRef.current.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgRef.current.getScreenCTM();
    if (!ctm) return null;
    const mapped = pt.matrixTransform(ctm.inverse());
    return { x: mapped.x, y: mapped.y };
  };

  const clientToWorldPoint = (clientX: number, clientY: number) => {
    const base = toSvgPoint(clientX, clientY);
    if (!base) return null;
    const v = vb(viewBox);
    const afterPanX = base.x - pan.x;
    const afterPanY = base.y - pan.y;
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;

    return {
      x: cx + (afterPanX - cx) / zoom,
      y: cy + (afterPanY - cy) / zoom,
    };
  };

  const placeCentroidFromClientPoint = (clientX: number, clientY: number) => {
    if (!pickCentroid || !ta || !svgRef.current) return;
    const point = clientToWorldPoint(clientX, clientY);
    if (!point) return;
    const selectedIds = selectionSet(a, aMode);
    setTerritories((prev) => prev.map((t) => (selectedIds.has(t.svgId) ? { ...t, centroid: point } : t)));
    setPickCentroid(false);
  };

  const zoomFromDelta = (deltaY: number) => {
    setZoom((prev) => {
      const next = prev + (deltaY > 0 ? -0.08 : 0.08);
      return Math.max(0.55, Math.min(3, Number(next.toFixed(2))));
    });
  };

  const autoCentroidA = () => {
    if (!ta) return;
    const selectedIds = selectionSet(a, aMode);
    const members = territories.filter((t) => selectedIds.has(t.svgId));
    if (members.length === 0) return;
    const centroid = centroidForGroup(members);
    setTerritories((prev) =>
      prev.map((t) =>
        selectedIds.has(t.svgId)
          ? {
              ...t,
              centroid,
            }
          : t,
      ),
    );
  };

  const autoCentroidAll = () => {
    const centroidsByGroup = new Map<string, { x: number; y: number }>();
    for (const [groupId, members] of groups.entries()) {
      centroidsByGroup.set(groupId, centroidForGroup(members));
    }
    setTerritories((prev) =>
      prev.map((t) => ({
        ...t,
        centroid: centroidsByGroup.get(t.groupId) ?? t.centroid,
      })),
    );
  };

  const startPan = (clientX: number, clientY: number) => {
    const point = toSvgPoint(clientX, clientY);
    if (!point) return;
    panMovedRef.current = false;
    setIsPanning(true);
    setPanStart({ svgX: point.x, svgY: point.y, clientX, clientY, panX: pan.x, panY: pan.y });
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!svgRef.current) return;
    if (pickCentroid) return;
    const backgroundClick = e.target === e.currentTarget;
    if (e.button === 0 && (backgroundClick || e.shiftKey)) {
      startPan(e.clientX, e.clientY);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!panStart || !svgRef.current) return;
    const movePx = Math.hypot(e.clientX - panStart.clientX, e.clientY - panStart.clientY);
    if (movePx < 4) return;
    const current = toSvgPoint(e.clientX, e.clientY);
    if (!current) return;
    const dx = current.x - panStart.svgX;
    const dy = current.y - panStart.svgY;
    panMovedRef.current = true;
    setPan({ x: panStart.panX + dx, y: panStart.panY + dy });
  };

  const stopPan = (e?: PointerEvent<SVGSVGElement>) => {
    if (!panStart) return;
    if (panMovedRef.current) {
      setSuppressNextPickClick(true);
      window.setTimeout(() => setSuppressNextPickClick(false), 0);
    }
    panMovedRef.current = false;
    setIsPanning(false);
    setPanStart(null);
    if (e) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const v = vb(viewBox);
  const transform = `translate(${pan.x} ${pan.y}) translate(${v.x + v.w / 2} ${v.y + v.h / 2}) scale(${zoom}) translate(${-v.x - v.w / 2} ${-v.y - v.h / 2})`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EDITOR_STATE_KEY);
      if (!raw) {
        hydratedRef.current = true;
        return;
      }
      const parsed = JSON.parse(raw) as Partial<EditorPersistedState>;
      if (typeof parsed.mapKey === "string") setMapKey(parsed.mapKey);
      if (typeof parsed.mapName === "string") setMapName(parsed.mapName);
      if (typeof parsed.version === "number" && Number.isFinite(parsed.version)) setVersion(Math.max(1, Math.trunc(parsed.version)));
      if (typeof parsed.viewBox === "string") setViewBox(parsed.viewBox);
      if (Array.isArray(parsed.territories)) setTerritories(parsed.territories as Territory[]);
      if (Array.isArray(parsed.continents)) setContinents(parsed.continents as Continent[]);
      setA(typeof parsed.a === "string" ? parsed.a : null);
      setB(typeof parsed.b === "string" ? parsed.b : null);
      setAMode(parsed.aMode === "solo" ? "solo" : "group");
      setBMode(parsed.bMode === "solo" ? "solo" : "group");
      if (typeof parsed.zoom === "number" && Number.isFinite(parsed.zoom)) setZoom(Math.max(0.55, Math.min(3, parsed.zoom)));
      if (parsed.pan && typeof parsed.pan.x === "number" && typeof parsed.pan.y === "number") {
        setPan({ x: parsed.pan.x, y: parsed.pan.y });
      }
      if (typeof parsed.showLinks === "boolean") setShowLinks(parsed.showLinks);
      if (typeof parsed.showCentroids === "boolean") setShowCentroids(parsed.showCentroids);
      if (typeof parsed.showContinentView === "boolean") setShowContinentView(parsed.showContinentView);
    } catch {
      // ignore corrupted local state
    } finally {
      hydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    const state: EditorPersistedState = {
      mapKey,
      mapName,
      version,
      viewBox,
      territories,
      continents,
      a,
      b,
      aMode,
      bMode,
      zoom,
      pan,
      showLinks,
      showCentroids,
      showContinentView,
    };
    try {
      window.localStorage.setItem(EDITOR_STATE_KEY, JSON.stringify(state));
    } catch {
      // storage full / blocked
    }
  }, [
    mapKey,
    mapName,
    version,
    viewBox,
    territories,
    continents,
    a,
    b,
    aMode,
    bMode,
    zoom,
    pan,
    showLinks,
    showCentroids,
    showContinentView,
  ]);

  useEffect(() => {
    const node = svgRef.current;
    if (!node) return;

    const onNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      zoomFromDelta(event.deltaY);
    };

    node.addEventListener("wheel", onNativeWheel, { passive: false });
    return () => {
      node.removeEventListener("wheel", onNativeWheel);
    };
  }, []);

  return (
    <main className="relative min-h-screen overflow-hidden px-4 py-8">
      <section className="relative mx-auto max-w-7xl space-y-4">
        <div className="panel p-4">
          <h1 className="text-2xl font-black text-slate-900">Editeur de carte</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <label className="btn-secondary cursor-pointer">Importer SVG<input type="file" accept=".svg,image/svg+xml" className="hidden" onChange={onSvgImport} /></label>
            <button className="btn-primary" onClick={() => setOut(exportJson(mapKey, mapName, version, viewBox, continents, territories))}>Generer JSON</button>
            <button className="btn-secondary" onClick={downloadGroupedSvg} disabled={territories.length === 0}>Exporter SVG groupe</button>
            <button className="btn-secondary" onClick={togglePairLink} disabled={!ta || !tb}>Creer/Supprimer connexion A-B</button>
            <button className="btn-secondary" onClick={groupPair} disabled={!ta || !tb}>Grouper A+B</button>
            <button className="btn-secondary" onClick={ungroupA} disabled={!ta}>Degrouper A</button>
          </div>
          <div className="mt-2 text-sm">A: <code>{ta?.key ?? "-"}</code> | B: <code>{tb?.key ?? "-"}</code> | Groupes: {groups.size}</div>
          {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
          <div className="panel p-4">
            <div className="mb-3 grid gap-2 md:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">
                Map key
                <input className="mt-1 w-full rounded border px-2 py-1 font-normal" value={mapKey} onChange={(e) => setMapKey(e.target.value)} placeholder="map_key" />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Nom de la carte
                <input className="mt-1 w-full rounded border px-2 py-1 font-normal" value={mapName} onChange={(e) => setMapName(e.target.value)} placeholder="Nom" />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                Version
                <input className="mt-1 w-full rounded border px-2 py-1 font-normal" type="number" min={1} value={version} onChange={(e) => setVersion(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="text-xs font-semibold text-slate-700">
                ViewBox
                <input className="mt-1 w-full rounded border px-2 py-1 font-normal" value={viewBox} onChange={(e) => setViewBox(e.target.value)} placeholder="0 0 1024 560" />
              </label>
            </div>
            <div className="mb-2 flex items-center gap-2 text-sm">
              <button className="btn-secondary" onClick={() => setZoom((z) => Math.max(0.55, Number((z - 0.1).toFixed(2))))}>-</button>
              <button className="btn-secondary" onClick={() => setZoom((z) => Math.min(3, Number((z + 0.1).toFixed(2))))}>+</button>
              <button className="btn-secondary" onClick={() => setZoom(1)}>Reset</button>
              <button className="btn-secondary" onClick={() => setPan({ x: 0, y: 0 })}>Reset pan</button>
              <button className="btn-secondary" onClick={autoCentroidA} disabled={!ta}>Auto centroid A</button>
              <button className="btn-secondary" onClick={autoCentroidAll} disabled={territories.length === 0}>Auto centroid tous</button>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} />Liens</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showCentroids} onChange={(e) => setShowCentroids(e.target.checked)} />Centroids</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={showContinentView} onChange={(e) => setShowContinentView(e.target.checked)} />Continents</label>
              <button className="btn-secondary" onClick={() => setPickCentroid((p) => !p)}>{pickCentroid ? "Annuler centroid" : "Placer centroid A"}</button>
              <span>{Math.round(zoom * 100)}%</span>
            </div>
            <div className="mb-2 text-xs text-slate-600">
              Connexions visibles: <span className="font-semibold">{links.length}</span>
              {links.length === 0 ? " (creer des connexions A-B pour les voir)" : ""}
            </div>
            <div className="overflow-hidden rounded border bg-slate-50">
                <svg
                  ref={svgRef}
                  viewBox={viewBox}
                  onClick={onMapClick}
                  onDragStart={(e) => e.preventDefault()}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={(e) => stopPan(e)}
                  onPointerLeave={(e) => stopPan(e)}
                  className={`h-[480px] w-full select-none ${pickCentroid ? "cursor-crosshair" : isPanning ? "cursor-grabbing" : "cursor-grab"}`}
                  style={{ touchAction: "none" }}
                >
                  <g transform={transform}>
                    {territories.map((t) => {
                    const isA = isInSelection(t, a, aMode);
                    const isB = isInSelection(t, b, bMode);
                    return (
                      <path
                        key={t.svgId}
                        d={t.pathData}
                        fill={
                          showContinentView
                            ? t.continent
                              ? continentColor.get(t.continent) ?? "#cbd5e1"
                              : "#9ca3af"
                            : groupColor.get(t.groupId) ?? "#93c5fd"
                        }
                        fillOpacity={isA || isB ? 0.88 : t.svgId === hover ? 0.72 : 0.55}
                        stroke={isA ? "#14532d" : isB ? "#7f1d1d" : "#1e293b"}
                        strokeWidth={isA || isB ? 2.6 : 1}
                        onMouseEnter={() => setHover(t.svgId)}
                        onMouseLeave={() => setHover((p) => (p === t.svgId ? null : p))}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (suppressNextPickClick) {
                            return;
                          }
                          if (pickCentroid) {
                            placeCentroidFromClientPoint(e.clientX, e.clientY);
                            return;
                          }
                          pick(t.svgId, e.ctrlKey || e.metaKey);
                        }}
                      />
                    );
                    })}
                    {showLinks && links.map((l) => {
                      const hl = hoverGroup && (hoverGroup === l.g1 || hoverGroup === l.g2);
                      if (hl) return null;
                      const relatedToSelection =
                        selectedGroupIds.size > 0 && (selectedGroupIds.has(l.g1) || selectedGroupIds.has(l.g2));
                      return (
                        <line
                          key={`${l.g1}|${l.g2}`}
                          x1={l.x1}
                          y1={l.y1}
                          x2={l.x2}
                          y2={l.y2}
                          stroke="#0f172a"
                          strokeOpacity={relatedToSelection ? 0.42 : 0.08}
                          strokeWidth={relatedToSelection ? 2.2 : 1.6}
                          strokeDasharray="4 3"
                        />
                      );
                    })}
                    {showCentroids && Array.from(groups.entries()).map(([groupId]) => {
                      const c = groupCentroids.get(groupId);
                      if (!c) return null;
                      const isA = Boolean(ta && aMode === "group" && ta.groupId === groupId);
                      const isB = Boolean(tb && bMode === "group" && tb.groupId === groupId && !isA);
                      const label = isA ? "A" : isB ? "B" : null;
                      return (
                        <g key={`${groupId}-centroid`} onClick={(e) => { e.stopPropagation(); const rep = groupRepresentative.get(groupId); if (rep) pick(rep); }}>
                          <circle cx={c.x} cy={c.y} r={isA || isB ? 5.4 : 3.8} fill={isA ? "#14532d" : isB ? "#7f1d1d" : "#0f172a"} />
                          <circle cx={c.x} cy={c.y} r={isA || isB ? 2.4 : 1.6} fill="#ffffff" />
                          {label && (
                            <text x={c.x + 6} y={c.y - 6} fontSize={10} fontWeight={700} fill={isA ? "#14532d" : "#7f1d1d"}>
                              {label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                    {showLinks && links.map((l) => {
                      const hl = hoverGroup && (hoverGroup === l.g1 || hoverGroup === l.g2);
                      if (!hl) return null;
                      return (
                        <line
                          key={`hl-${l.g1}|${l.g2}`}
                          x1={l.x1}
                          y1={l.y1}
                          x2={l.x2}
                          y2={l.y2}
                          stroke="#dc2626"
                          strokeOpacity={0.98}
                          strokeWidth={4.4}
                          strokeLinecap="round"
                          pointerEvents="none"
                        />
                      );
                    })}
                </g>
              </svg>
            </div>
          </div>

          <div className="space-y-4">
            <div className="panel p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-bold">Territoires ({territories.length})</h2>
              </div>
              <div className="max-h-56 overflow-auto rounded border">
                {territories.map((t) => (
                  <button key={t.svgId} onClick={() => pick(t.svgId)} className={`block w-full border-b px-2 py-1 text-left text-sm ${isInSelection(t, a, aMode) ? "bg-emerald-100" : isInSelection(t, b, bMode) ? "bg-rose-100" : "bg-white"}`} style={{ borderLeft: `5px solid ${groupColor.get(t.groupId) ?? "#93c5fd"}` }}>
                    {t.key}
                  </button>
                ))}
              </div>
              {ta && (
                <div className="mt-3 space-y-2 text-sm">
                  <label className="block text-xs font-semibold text-slate-700">
                    Key du territoire
                    <input className="mt-1 w-full rounded border px-2 py-1 font-normal" value={ta.key} onChange={(e) => { const ids = selectionSet(a, aMode); setTerritories((p) => p.map((t) => ids.has(t.svgId) ? { ...t, key: norm(e.target.value) } : t)); }} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Nom du territoire
                    <input className="mt-1 w-full rounded border px-2 py-1 font-normal" value={ta.name} onChange={(e) => { const ids = selectionSet(a, aMode); setTerritories((p) => p.map((t) => ids.has(t.svgId) ? { ...t, name: e.target.value } : t)); }} />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">
                    Continent
                    <select className="mt-1 w-full rounded border px-2 py-1 font-normal" value={ta.continent ?? ""} onChange={(e) => { const ids = selectionSet(a, aMode); setTerritories((p) => p.map((t) => ids.has(t.svgId) ? { ...t, continent: e.target.value || null } : t)); }}>
                    <option value="">Aucun continent</option>
                    {continents.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
                    </select>
                  </label>
                </div>
              )}
            </div>

            <div className="panel p-4">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-bold">Continents</h2>
                <button className="btn-secondary" onClick={() => setContinents((p) => [...p, { key: `continent_${p.length + 1}`, name: `Continent ${p.length + 1}`, bonus: 2, color: "#22c55e" }])}>Ajouter</button>
              </div>
              <div className="space-y-2">
                {continents.map((c, i) => (
                  <div key={`${c.key}-${i}`} className="grid grid-cols-2 gap-2 rounded border bg-slate-50 p-2">
                    <label className="text-[11px] font-semibold text-slate-700">
                      Key
                      <input className="mt-1 w-full rounded border px-2 py-1 text-xs font-normal" value={c.key} onChange={(e) => setContinents((p) => p.map((x, idx) => idx === i ? { ...x, key: norm(e.target.value) } : x))} />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-700">
                      Nom
                      <input className="mt-1 w-full rounded border px-2 py-1 text-xs font-normal" value={c.name} onChange={(e) => setContinents((p) => p.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-700">
                      Bonus
                      <input className="mt-1 w-full rounded border px-2 py-1 text-xs font-normal" type="number" min={1} value={c.bonus} onChange={(e) => setContinents((p) => p.map((x, idx) => idx === i ? { ...x, bonus: Math.max(1, Number(e.target.value) || 1) } : x))} />
                    </label>
                    <label className="text-[11px] font-semibold text-slate-700">
                      Couleur
                      <div className="mt-1 flex items-center gap-1">
                        <input className="h-7 w-9 rounded border p-0" type="color" value={c.color || "#22c55e"} onChange={(e) => setContinents((p) => p.map((x, idx) => idx === i ? { ...x, color: e.target.value } : x))} />
                        <input className="w-full rounded border px-2 py-1 text-xs font-normal" value={c.color} onChange={(e) => setContinents((p) => p.map((x, idx) => idx === i ? { ...x, color: e.target.value } : x))} />
                      </div>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {out && <textarea readOnly value={out} className="panel h-72 w-full p-3 font-mono text-xs" />}
      </section>
    </main>
  );
}
