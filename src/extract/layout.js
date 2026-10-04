/**
 * src/layouts/{法令ID}.md を読む。見出しは「列」「別表」「分類名」の3種類だけ。
 * 表の区切り行（|---|）は読み飛ばす。基準値の数値はこのファイル群に入っていない。
 */

import LAYOUT_DOJO from "../layouts/414M60001000029.md?raw";

export function splitCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

export function isSepRow(line) {
  return /^[\s:|\-—－]+$/.test(line.trim().replace(/\|/g, "")) && line.includes("-");
}

export function splitSections(text) {
  const sections = [{ title: "", lines: [] }];
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) sections.push({ title: m[1].trim(), lines: [] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections;
}

export function firstTable(section) {
  const block = [];
  let inTable = false;
  for (const line of section.lines) {
    if (line.trim().startsWith("|")) {
      inTable = true;
      if (!isSepRow(line)) block.push(line);
      continue;
    }
    if (inTable) break;
  }
  if (!block.length) return null;
  const rows = block.map(splitCells);
  return { header: rows[0], body: rows.slice(1) };
}

export function parseLayout(text) {
  const raw = String(text || "");
  const idMatch = raw.match(/法令ID[:：]\s*`?([A-Za-z0-9]+)`?/);
  if (!idMatch) return null;

  const columns = [];
  const mappings = [];
  const groups = [];

  for (const sec of splitSections(raw)) {
    const table = firstTable(sec);
    if (!table) continue;
    const at = (name) => table.header.indexOf(name);
    if (sec.title === "列") {
      const [n, u] = [at("列名"), at("単位")];
      if (n < 0) continue;
      for (const row of table.body) {
        if (row[n]) columns.push({ name: row[n], unit: u >= 0 ? row[u] || "" : "" });
      }
    } else if (sec.title === "別表") {
      const [f, c, t] = [at("から"), at("列名"), at("別表")];
      if (c < 0 || t < 0) continue;
      for (const row of table.body) {
        if (row[c] && row[t]) {
          mappings.push({ from: (f >= 0 ? row[f] : "") || "", column: row[c], table: row[t] });
        }
      }
    } else if (sec.title) {
      const i = at("項目");
      if (i < 0) continue;
      const items = table.body.map((row) => row[i]).filter(Boolean);
      if (items.length) groups.push({ name: sec.title, items });
    }
  }

  if (!columns.length) return null;
  const groupOf = {};
  for (const g of groups) for (const item of g.items) groupOf[item] = g.name;
  return {
    lawId: idMatch[1],
    columns,
    mappings,
    groups,
    order: groups.flatMap((g) => g.items),
    groupOf,
  };
}

/** 施行日が「から」以上ならその行を使う。同じ列に新しい「から」があれば新しい行が勝つ。 */
export function labelsForDate(layout, enforceDate) {
  const date = enforceDate || "";
  const byCol = new Map();
  for (const m of layout.mappings) {
    if (m.from && date && m.from > date) continue;
    const prev = byCol.get(m.column);
    if (!prev || (m.from || "") >= (prev.from || "")) byCol.set(m.column, m);
  }
  const tableToColumn = new Map();
  for (const col of layout.columns) {
    const m = byCol.get(col.name);
    if (m) tableToColumn.set(m.table, col.name);
  }
  return { tableToColumn, allowed: new Set(tableToColumn.keys()) };
}

const byId = new Map();

function register(text) {
  const layout = parseLayout(typeof text === "string" ? text : text?.default);
  if (layout?.lawId) byId.set(layout.lawId, layout);
}

register(LAYOUT_DOJO);
// 2件目以降は src/layouts/ に法令ID.md を置くだけで読み込まれる。
if (typeof import.meta.glob === "function") {
  const extras = import.meta.glob("../layouts/*.md", {
    query: "?raw",
    eager: true,
    import: "default",
  });
  for (const text of Object.values(extras || {})) register(text);
}

export function getLayout(lawId) {
  return byId.get(lawId) || null;
}
