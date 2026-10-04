/**
 * 抜いた行を src/layouts の指定で物質×列の横並びに並べる。
 * 並びファイルの「別表」に書いた別表だけを使う。
 */

import { formatValue } from "./extract.js";
import { labelsForDate } from "./layout.js";

/** 条文の呼び方を、並びファイルの項目名に合わせる。別名の辞書は持たない。 */
export function shortItem(s) {
  const t = String(s || "");
  const m = t.match(/（以下「(.+?)」という。）/);
  if (m) return m[1];
  return t.replace(/（[^）]*）/g, "").trim();
}

export function matrixCell(r, itemKey) {
  if (!r) return "－";
  const out = formatValue(r);
  if (!r.value || r.value === "ND") return out;
  const m = String(r.value_raw || "").match(/につき(.*?)[〇一二三四五六七八九十百千万・0-9.]+ミリグラム/);
  const species = (m ? m[1] : "").replace("検液", "");
  if (species && !itemKey.includes(species) && !species.includes(itemKey)) {
    return `${out}（${species}として）`;
  }
  return out;
}

function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function buildMatrixEras(rows, layout) {
  const byDate = new Map();
  const apiOrder = new Map();
  for (const r of rows) {
    const { tableToColumn, allowed } = labelsForDate(layout, r.enforcement_date);
    if (!allowed.has(r.table)) continue;
    const d = r.enforcement_date || "";
    const ik = shortItem(r.item_raw);
    if (!byDate.has(d)) byDate.set(d, new Map());
    const items = byDate.get(d);
    if (!items.has(ik)) items.set(ik, {});
    items.get(ik)[tableToColumn.get(r.table)] = r;
    if (!apiOrder.has(d)) apiOrder.set(d, []);
    if (!apiOrder.get(d).includes(ik)) apiOrder.get(d).push(ik);
  }

  const dates = [...byDate.keys()].filter(Boolean).sort();
  const colNames = layout.columns.map((c) => c.name);
  const headers = [
    "分類",
    "項目",
    ...layout.columns.map((c) => (c.unit ? `${c.name}（${c.unit}）` : c.name)),
  ];
  const eras = [];

  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const start = dates[i];
    const end = i === dates.length - 1 ? "現行" : dayBefore(dates[i + 1]);
    const cur = byDate.get(start);
    const prev = i > 0 ? byDate.get(dates[i - 1]) : null;
    const seen = apiOrder.get(start) || [];
    const asSpecified = seen.every((ik) => layout.order.includes(ik));
    const iter = asSpecified ? layout.order.filter((ik) => seen.includes(ik)) : seen;
    const body = [];
    for (const ik of iter) {
      const cells = colNames.map((c) => matrixCell(cur.get(ik)?.[c], ik));
      const changed = colNames.map(() => false);
      const notes = colNames.map(() => "");
      if (prev) {
        colNames.forEach((c, k) => {
          const from = prev.has(ik) ? matrixCell(prev.get(ik)?.[c], ik) : null;
          if (from === null) {
            changed[k] = true;
            if (cells[k] !== "－") notes[k] = "この版で追加";
          } else if (from !== cells[k]) {
            changed[k] = true;
            notes[k] = from;
          }
        });
      }
      body.push({
        group: layout.groupOf[ik] || "",
        item: ik,
        cells,
        notes,
        changed,
        removed: false,
      });
    }
    if (prev) {
      for (const ik of prev.keys()) {
        if (cur.has(ik)) continue;
        body.push({
          group: layout.groupOf[ik] || "",
          item: ik,
          cells: colNames.map((c) => matrixCell(prev.get(ik)?.[c], ik)),
          notes: colNames.map(() => ""),
          changed: colNames.map(() => false),
          removed: true,
        });
      }
    }
    eras.push({ start, end, headers, body, apiOrder: !asSpecified });
  }
  return { dates, eras };
}
