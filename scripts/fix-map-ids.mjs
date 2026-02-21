import fs from "node:fs";
import path from "node:path";

function attr(tag, name) {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = tag.match(new RegExp(`(?:^|\\s)${safeName}=(["'])(.*?)\\1`));
  return m ? m[2] : null;
}

function tokenizePath(d) {
  return d
    .replace(/,/g, " ")
    .replace(/([a-zA-Z])/g, " $1 ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function pathBBox(d) {
  const tokens = tokenizePath(d);
  let i = 0;
  let cmd = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const push = (px, py) => {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  };

  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[a-zA-Z]$/.test(token)) {
      cmd = token;
      i += 1;
      continue;
    }

    if (!cmd) {
      i += 1;
      continue;
    }

    if (cmd === "M" || cmd === "L") {
      x = Number(tokens[i]);
      y = Number(tokens[i + 1]);
      if (cmd === "M") {
        sx = x;
        sy = y;
      }
      push(x, y);
      i += 2;
      continue;
    }
    if (cmd === "m" || cmd === "l") {
      x += Number(tokens[i]);
      y += Number(tokens[i + 1]);
      if (cmd === "m") {
        sx = x;
        sy = y;
      }
      push(x, y);
      i += 2;
      continue;
    }
    if (cmd === "H") {
      x = Number(tokens[i]);
      push(x, y);
      i += 1;
      continue;
    }
    if (cmd === "h") {
      x += Number(tokens[i]);
      push(x, y);
      i += 1;
      continue;
    }
    if (cmd === "V") {
      y = Number(tokens[i]);
      push(x, y);
      i += 1;
      continue;
    }
    if (cmd === "v") {
      y += Number(tokens[i]);
      push(x, y);
      i += 1;
      continue;
    }
    if (cmd === "Z" || cmd === "z") {
      x = sx;
      y = sy;
      push(x, y);
      i += 1;
      continue;
    }
    i += 1;
  }

  if (!Number.isFinite(minX)) return null;

  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY),
  };
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalizeKey(value) {
  return (value ?? "")
    .toLowerCase()
    .replace(/^t-/, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function main() {
  const mapKey = process.argv[2] ?? "world-simplified";
  const root = process.cwd();
  const mapDir = path.join(root, "app", "lib", "game", "maps", mapKey);
  const masterPath = path.join(mapDir, "master.svg");
  const defPath = path.join(mapDir, "definition.json");

  const svg = fs.readFileSync(masterPath, "utf8");
  const def = JSON.parse(fs.readFileSync(defPath, "utf8"));

  const pathTags = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => ({
    tag: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));

  const viewBox = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 1024 560")
    .split(/\s+/)
    .map(Number);
  const vbArea = (viewBox[2] || 1024) * (viewBox[3] || 560);

  const candidates = pathTags
    .map((p, idx) => {
      const d = attr(p.tag, "d");
      if (!d) return null;
      const box = pathBBox(d);
      if (!box) return null;
      return { ...p, idx, d, box, id: attr(p.tag, "id") };
    })
    .filter(Boolean)
    .filter((p) => p.box.area < vbArea * 0.6);

  const expected = def.territories.map((t) => ({ key: t.key, svgId: `t-${t.key}`, centroid: t.centroid }));
  const expectedByNormalizedKey = new Map(expected.map((t) => [normalizeKey(t.key), t]));

  if (candidates.length < expected.length) {
    throw new Error(`Not enough path candidates (${candidates.length}) for territories (${expected.length}).`);
  }

  const unassignedPaths = new Set(candidates.map((c) => c.idx));
  const unassignedTerritories = new Set(expected.map((t) => t.key));
  const assignments = new Map();

  // Pass 1: deterministic mapping from existing id/label/name when possible.
  for (const c of candidates) {
    const rawNames = [
      c.id,
      attr(c.tag, "data-name"),
      attr(c.tag, "name"),
      attr(c.tag, "inkscape:label"),
      attr(c.tag, "aria-label"),
    ].filter(Boolean);
    let target = null;
    for (const rawName of rawNames) {
      const normalized = normalizeKey(rawName);
      if (expectedByNormalizedKey.has(normalized)) {
        target = expectedByNormalizedKey.get(normalized);
        break;
      }
    }
    if (!target) continue;
    if (!unassignedPaths.has(c.idx)) continue;
    if (!unassignedTerritories.has(target.key)) continue;
    assignments.set(c.idx, target.svgId);
    unassignedPaths.delete(c.idx);
    unassignedTerritories.delete(target.key);
  }

  // Pass 2: centroid fallback for the remaining shapes.
  for (const territory of expected) {
    if (!unassignedTerritories.has(territory.key)) continue;
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      if (!unassignedPaths.has(c.idx)) continue;
      const d = distance(territory.centroid, { x: c.box.cx, y: c.box.cy });
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (!best) throw new Error(`Unable to assign path for ${territory.svgId}`);
    assignments.set(best.idx, territory.svgId);
    unassignedPaths.delete(best.idx);
    unassignedTerritories.delete(territory.key);
  }

  const output = [];
  let cursor = 0;
  for (const p of pathTags) {
    output.push(svg.slice(cursor, p.start));

    const c = candidates.find((x) => x.start === p.start);
    if (!c || !assignments.has(c.idx)) {
      output.push(p.tag);
      cursor = p.end;
      continue;
    }

    const nextId = assignments.get(c.idx);
    let nextTag = p.tag;
    if (/\sid="[^"]*"/.test(nextTag)) {
      nextTag = nextTag.replace(/\sid="[^"]*"/, ` id="${nextId}"`);
    } else {
      nextTag = nextTag.replace("<path", `<path id="${nextId}"`);
    }
    output.push(nextTag);
    cursor = p.end;
  }
  output.push(svg.slice(cursor));

  fs.writeFileSync(masterPath, output.join(""), "utf8");
  console.log(`Assigned ${assignments.size} path ids in ${masterPath}`);
}

main();
