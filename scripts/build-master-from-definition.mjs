import fs from "node:fs";
import path from "node:path";

function main() {
  const mapKey = process.argv[2] ?? "world-simplified";
  const root = process.cwd();
  const mapDir = path.join(root, "app", "lib", "game", "maps", mapKey);
  const defPath = path.join(mapDir, "definition.json");
  const masterPath = path.join(mapDir, "master.svg");

  if (!fs.existsSync(defPath)) throw new Error(`Missing definition: ${defPath}`);
  const definition = JSON.parse(fs.readFileSync(defPath, "utf8"));

  const paths = definition.territories
    .map(
      (t) =>
        `  <path id="${t.svgId}" class="territory" d="${t.pathData}" data-key="${t.key}" data-name="${t.name}" data-continent="${t.continent ?? ""}"/>`,
    )
    .join("\n");

  const labels = definition.territories
    .map(
      (t) =>
        `  <text x="${Number(t.centroid.x) + 6}" y="${Number(t.centroid.y) - 6}" class="label">${String(t.name).replace(/&/g, "and")}</text>`,
    )
    .join("\n");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${definition.viewBox}">
  <defs>
    <style>
      .territory { fill: rgba(255,255,255,0.08); stroke: #ef4444; stroke-width: 1.5; }
      .label { fill: #0f172a; font-size: 9px; font-family: Arial, sans-serif; }
    </style>
  </defs>
  <rect width="100%" height="100%" fill="#f8fafc"/>
  <image href="/maps/${mapKey}/mapWorld.webp" x="0" y="0" width="100%" height="100%" opacity="0.68" preserveAspectRatio="xMidYMid meet"/>
  ${paths}
  ${labels}
</svg>\n`;

  fs.writeFileSync(masterPath, svg, "utf8");
  console.log(`Master svg rebuilt for ${mapKey}: ${masterPath}`);
}

main();
