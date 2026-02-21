import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const mapTerritorySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  continent: z.string().nullable().optional(),
  svgId: z.string().min(1),
  adjacency: z.array(z.string().min(1)),
  centroid: z.object({
    x: z.number(),
    y: z.number(),
  }),
  pathData: z.string().min(1),
});

const mapDefinitionSchema = z.object({
  mapKey: z.string().min(1),
  name: z.string().min(1),
  version: z.number().int().positive(),
  viewBox: z.string().min(1),
  continents: z
    .array(
      z.object({
        key: z.string().min(1),
        name: z.string().min(1),
        bonus: z.number().int().min(1),
        color: z.string().min(1).nullable().optional(),
      }),
    )
    .min(1),
  territories: z.array(mapTerritorySchema).min(1),
});

const definitionCache = new Map();

function mapsRoot() {
  return path.join(process.cwd(), "app", "lib", "game", "maps");
}

function parseSvgPathIds(svgContent) {
  const ids = new Set();
  const pathTags = svgContent.match(/<path\b[^>]*>/g) ?? [];
  for (const tag of pathTags) {
    const match = tag.match(/\sid="([^"]+)"/);
    if (match?.[1]) ids.add(match[1]);
  }
  return ids;
}

function validateSymmetry(territories) {
  const byKey = new Map(territories.map((t) => [t.key, t]));
  for (const territory of territories) {
    for (const neighbor of territory.adjacency) {
      const target = byKey.get(neighbor);
      if (!target) {
        throw new Error(`Unknown adjacency "${neighbor}" for "${territory.key}".`);
      }
      if (!target.adjacency.includes(territory.key)) {
        throw new Error(`Adjacency must be symmetric: "${territory.key}" <-> "${neighbor}".`);
      }
    }
  }
}

function validateGraphConnectivity(territories) {
  const byKey = new Map(territories.map((t) => [t.key, t]));
  const visited = new Set();
  const queue = [territories[0].key];
  while (queue.length > 0) {
    const key = queue.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    for (const neighbor of byKey.get(key).adjacency) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  if (visited.size !== territories.length) {
    throw new Error("Map graph must be connected.");
  }
}

export function validateMapDefinition(definition) {
  const parsed = mapDefinitionSchema.parse(definition);

  const keys = new Set();
  const svgIds = new Set();
  for (const territory of parsed.territories) {
    if (keys.has(territory.key)) {
      throw new Error(`Duplicate territory key "${territory.key}".`);
    }
    if (svgIds.has(territory.svgId)) {
      throw new Error(`Duplicate svgId "${territory.svgId}".`);
    }
    keys.add(territory.key);
    svgIds.add(territory.svgId);
  }

  validateSymmetry(parsed.territories);
  validateGraphConnectivity(parsed.territories);

  const continentByKey = new Map(parsed.continents.map((continent) => [continent.key, continent]));
  for (const territory of parsed.territories) {
    if (!territory.continent) continue;
    if (!continentByKey.has(territory.continent)) {
      throw new Error(`Territory "${territory.key}" references unknown continent "${territory.continent}".`);
    }
  }

  const mapFolder = path.join(mapsRoot(), parsed.mapKey);
  const masterSvgPath = path.join(mapFolder, "master.svg");
  if (fs.existsSync(masterSvgPath)) {
    const svgContent = fs.readFileSync(masterSvgPath, "utf8");
    const pathIds = parseSvgPathIds(svgContent);
    for (const territory of parsed.territories) {
      if (!territory.pathData || territory.pathData.trim().length === 0) {
        throw new Error(`Territory "${territory.key}" must have non-empty pathData.`);
      }
      if (!pathIds.has(territory.svgId)) {
        throw new Error(`svgId "${territory.svgId}" not found in ${masterSvgPath}.`);
      }
    }
  }

  return parsed;
}

export function listAvailableMaps() {
  const root = mapsRoot();
  const folders = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  return folders;
}

export function loadMapDefinition(mapKey) {
  const filePath = path.join(mapsRoot(), mapKey, "definition.json");
  if (!fs.existsSync(filePath)) {
    throw new Error(`Unknown map key "${mapKey}".`);
  }
  const stat = fs.statSync(filePath);
  const cached = definitionCache.get(mapKey);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.definition;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  const definition = validateMapDefinition(json);
  definitionCache.set(mapKey, { mtimeMs: stat.mtimeMs, definition });
  return definition;
}
