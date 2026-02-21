import fs from "node:fs";
import path from "node:path";

function parseAttributes(tag) {
  const attrs = {};
  const re = /(\w[\w:-]*)="([^"]*)"/g;
  let m;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
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

    if (!cmd) throw new Error(`Invalid path command in d=\"${d}\"`);

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

    // Fallback: unsupported command, skip token to avoid infinite loop.
    i += 1;
  }

  if (!Number.isFinite(minX)) {
    throw new Error(`Unable to compute bbox for path d=\"${d}\"`);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

function extractSvgPaths(svgContent) {
  const pathTags = svgContent.match(/<path\b[^>]*>/g) ?? [];
  const byId = new Map();
  for (const tag of pathTags) {
    const attrs = parseAttributes(tag);
    if (!attrs.id || !attrs.d) continue;
    if (!byId.has(attrs.id)) {
      byId.set(attrs.id, attrs.d);
      continue;
    }
    byId.set(attrs.id, `${byId.get(attrs.id)} ${attrs.d}`);
  }
  return byId;
}

function main() {
  const mapKey = process.argv[2] ?? "world-simplified";
  const root = process.cwd();
  const mapDir = path.join(root, "app", "lib", "game", "maps", mapKey);
  const masterPath = path.join(mapDir, "master.svg");
  const definitionPath = path.join(mapDir, "definition.json");
  const boardOutPath = path.join(root, "public", "maps", mapKey, "board.svg");

  if (!fs.existsSync(masterPath)) {
    throw new Error(`Missing master svg: ${masterPath}`);
  }
  if (!fs.existsSync(definitionPath)) {
    throw new Error(`Missing definition: ${definitionPath}`);
  }

  const master = fs.readFileSync(masterPath, "utf8");
  const definition = JSON.parse(fs.readFileSync(definitionPath, "utf8"));

  const paths = extractSvgPaths(master);

  const nextTerritories = definition.territories.map((territory) => {
    const svgId = `t-${territory.key}`;
    const d = paths.get(svgId);
    if (!d) {
      throw new Error(`Missing <path id=\"${svgId}\"> in master.svg`);
    }
    const box = pathBBox(d);
    return {
      ...territory,
      svgId,
      pathData: d,
      centroid: {
        x: Number(box.cx.toFixed(2)),
        y: Number(box.cy.toFixed(2)),
      },
    };
  });

  const nextDefinition = { ...definition, territories: nextTerritories };
  fs.writeFileSync(definitionPath, JSON.stringify(nextDefinition, null, 2));

  fs.mkdirSync(path.dirname(boardOutPath), { recursive: true });
  fs.writeFileSync(boardOutPath, master, "utf8");

  console.log(`Updated map definition and board for ${mapKey}`);
}

main();
