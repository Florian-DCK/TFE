export const MAP_TERRITORIES = [
  { key: "n1", name: "Nord 1", svgId: "t-n1", adjacency: ["n2", "n3"] },
  { key: "n2", name: "Nord 2", svgId: "t-n2", adjacency: ["n1", "n4", "c1"] },
  { key: "n3", name: "Nord 3", svgId: "t-n3", adjacency: ["n1", "c1", "c2"] },
  { key: "n4", name: "Nord 4", svgId: "t-n4", adjacency: ["n2", "c2"] },
  { key: "c1", name: "Centre 1", svgId: "t-c1", adjacency: ["n2", "n3", "c2", "s1"] },
  { key: "c2", name: "Centre 2", svgId: "t-c2", adjacency: ["n3", "n4", "c1", "s2"] },
  { key: "s1", name: "Sud 1", svgId: "t-s1", adjacency: ["c1", "s2", "s3"] },
  { key: "s2", name: "Sud 2", svgId: "t-s2", adjacency: ["c2", "s1", "s4"] },
  { key: "s3", name: "Sud 3", svgId: "t-s3", adjacency: ["s1", "s4", "e1"] },
  { key: "s4", name: "Sud 4", svgId: "t-s4", adjacency: ["s2", "s3", "e2"] },
  { key: "e1", name: "Est 1", svgId: "t-e1", adjacency: ["s3", "e2"] },
  { key: "e2", name: "Est 2", svgId: "t-e2", adjacency: ["s4", "e1"] },
];

export function validateMapConfig(territories) {
  if (!Array.isArray(territories) || territories.length === 0) {
    throw new Error("Map config must contain at least one territory.");
  }
  const keys = new Set(territories.map((t) => t.key));
  for (const territory of territories) {
    if (!territory.key || !territory.svgId || !Array.isArray(territory.adjacency)) {
      throw new Error(`Invalid territory config for key "${territory.key ?? "unknown"}".`);
    }
    for (const neighbor of territory.adjacency) {
      if (!keys.has(neighbor)) {
        throw new Error(`Territory "${territory.key}" has unknown adjacency "${neighbor}".`);
      }
    }
  }

  const visited = new Set();
  const queue = [territories[0].key];
  while (queue.length > 0) {
    const key = queue.shift();
    if (visited.has(key)) continue;
    visited.add(key);
    const territory = territories.find((t) => t.key === key);
    for (const neighbor of territory.adjacency) {
      if (!visited.has(neighbor)) queue.push(neighbor);
    }
  }
  if (visited.size !== territories.length) {
    throw new Error("Map graph must be connected.");
  }
}
