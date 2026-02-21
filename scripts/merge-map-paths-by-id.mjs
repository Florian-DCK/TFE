import fs from "node:fs";
import path from "node:path";

function getAttr(tag, name) {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = tag.match(new RegExp(`(?:^|\\s)${safeName}=(["'])(.*?)\\1`));
  return m ? m[2] : null;
}

function setAttr(tag, name, value) {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(\\s${safeName}=)(["']).*?\\2`);
  if (re.test(tag)) {
    return tag.replace(re, `$1"${value}"`);
  }
  return tag.replace("<path", `<path ${name}="${value}"`);
}

function main() {
  const mapKey = process.argv[2] ?? "world-simplified";
  const root = process.cwd();
  const masterPath = path.join(root, "app", "lib", "game", "maps", mapKey, "master.svg");

  if (!fs.existsSync(masterPath)) {
    throw new Error(`Missing master svg: ${masterPath}`);
  }

  const svg = fs.readFileSync(masterPath, "utf8");
  const pathMatches = [...svg.matchAll(/<path\b[^>]*>/g)];
  const pathTags = pathMatches.map((m, idx) => ({
    idx,
    tag: m[0],
    start: m.index,
    end: m.index + m[0].length,
    id: getAttr(m[0], "id"),
    d: getAttr(m[0], "d"),
  }));

  const byId = new Map();
  for (const p of pathTags) {
    if (!p.id || !p.d) continue;
    if (!byId.has(p.id)) {
      byId.set(p.id, []);
    }
    byId.get(p.id).push(p);
  }

  let mergedCount = 0;
  const removeIdx = new Set();
  const replacementByIdx = new Map();

  for (const [id, items] of byId.entries()) {
    if (items.length < 2) continue;
    const combinedD = items.map((p) => p.d.trim()).filter(Boolean).join(" ");
    const first = items[0];
    replacementByIdx.set(first.idx, setAttr(first.tag, "d", combinedD));
    for (let i = 1; i < items.length; i += 1) {
      removeIdx.add(items[i].idx);
    }
    mergedCount += items.length - 1;
    console.log(`Merged ${items.length} paths for ${id}`);
  }

  if (mergedCount === 0) {
    console.log("No duplicate path ids found.");
    return;
  }

  const out = [];
  let cursor = 0;
  for (const p of pathTags) {
    out.push(svg.slice(cursor, p.start));
    if (removeIdx.has(p.idx)) {
      cursor = p.end;
      continue;
    }
    if (replacementByIdx.has(p.idx)) {
      out.push(replacementByIdx.get(p.idx));
      cursor = p.end;
      continue;
    }
    out.push(p.tag);
    cursor = p.end;
  }
  out.push(svg.slice(cursor));

  fs.writeFileSync(masterPath, out.join(""), "utf8");
  console.log(`Merged ${mergedCount} duplicate paths in ${masterPath}`);
}

main();
