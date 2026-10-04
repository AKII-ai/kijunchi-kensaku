/**
 * 主要基準一覧。物質を行に、複数の法令・告示を列にした1枚の表。
 *
 * 列は columns.md、物質と「各出典での呼び方」は rows.md に書く（どちらも数値は書かない）。
 * 値は、法令は e-Gov 法令API の現行版から、告示は sources/read/*.json（保存したページの読み取り結果）から、
 * 開くたびに埋める。トップ画面と docs/主要基準一覧.md（npm run summary）は、どちらもこのファイルで作る。
 */

import { fetchLawData } from "../api/egov.js";
import { extractRecords } from "../extract/extract.js";
import { firstTable, splitSections } from "../extract/layout.js";
import { shortItem } from "../extract/matrix.js";
import { kanjiToNumber, parseValue } from "../extract/value.js";
import COLUMNS_MD from "./columns.md?raw";
import ROWS_MD from "./rows.md?raw";

const READ = import.meta.glob("../../sources/read/*.json", { eager: true, import: "default" });

/** 出典の読み取り結果。名前 → { name, url, obtained, checked, file, rows } */
export const SOURCES = Object.fromEntries(
  Object.entries(READ)
    .filter(([path]) => !path.endsWith("/_check.json"))
    .map(([, data]) => [data.name, data]),
);

/** python tools/sources.py check の結果。無ければ空。 */
export const CHECKS = Object.entries(READ).find(([path]) => path.endsWith("/_check.json"))?.[1] || [];

const LAW_ID = /^[0-9]{3}[A-Z]{1,2}[0-9A-Z]+$/;

// ---------------------------------------------------------------- 指定の読み方

function tableOf(section) {
  return firstTable(section) || { header: [], body: [] };
}

export function parseColumns(text) {
  const sections = splitSections(text);
  const cols = tableOf(sections.find((s) => s.title === "列") || { lines: [] });
  const names = tableOf(sections.find((s) => s.title.startsWith("法令名")) || { lines: [] });
  const at = (t, name) => t.header.indexOf(name);
  const columns = cols.body.map((row) => {
    const sources = (row[at(cols, "出典")] || "").split(/[、,]/).map((s) => s.trim()).filter(Boolean);
    return {
      name: row[at(cols, "列名")],
      unit: row[at(cols, "単位")] || "",
      sources,
      tables: (row[at(cols, "表")] || "").split(/[、,]/).map((s) => s.trim()).filter(Boolean),
    };
  }).filter((c) => c.name);
  const lawTitles = Object.fromEntries(names.body.map((row) => [row[at(names, "法令ID")], {
    title: row[at(names, "法令名")],
    use: row[at(names, "使う表の意味")] || "",
  }]));
  return { columns, lawTitles };
}

/** rows.md。「## 分類」ごとに | 物質名 | 列名… | の表。セルは、その列の出典での呼び方。 */
export function parseRows(text, columns) {
  const rows = [];
  for (const sec of splitSections(text)) {
    if (!sec.title) continue;
    const t = firstTable(sec);
    if (!t) continue;
    const nameAt = t.header.indexOf("物質名");
    if (nameAt < 0) continue;
    for (const r of t.body) {
      if (!r[nameAt]) continue;
      const refs = columns.map((c) => {
        const i = t.header.indexOf(c.name);
        return i < 0 ? "" : (r[i] || "").trim();
      });
      rows.push({ group: sec.title, name: r[nameAt], refs });
    }
  }
  return rows;
}

/**
 * 呼び方を比べるための形。空白を詰め、半角かっこを全角にし、〈ルビ〉と頭の号番号（「一〇　」）を落とし、
 * 条文の（以下「…」という。）と、かっこ書きを外す。全角・半角の数字はそのまま（書いたとおりに比べる）。
 */
export function itemKey(s) {
  let t = String(s || "")
    .replace(/^[〇一二三四五六七八九十]+[\s　]+/, "")
    .replace(/[\s　]/g, "")
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/〈[^〉]*〉/g, "");
  if (/（以下「.+?」という。）/.test(t)) return shortItem(t);
  // かっこの中にかっこがある書き方（ダイオキシン類（…（平成十一年法律第百五号）…））は内側から外す。
  while (/（[^（）]*）/.test(t)) t = t.replace(/（[^（）]*）/g, "");
  return t.replace(/（[^）]*$/, "");
}

// ---------------------------------------------------------------- セルの文字

const NOTE_WORDS = /かつ|において|にあっては|合計|乗じ|当分の間|ただし/;
const KNUM = "[〇一二三四五六七八九・0-9.]+";

/** 「シス体にあっては…〇・〇〇四ミリグラム、トランス体にあっては…」を「シス体 0.004 / トランス体 0.004」に。 */
function splitCases(raw) {
  const parts = String(raw).split("、").map((seg) => {
    const m = seg.match(new RegExp(`^(.+?)にあっては.*?(${KNUM})ミリグラム`));
    if (!m) return null;
    return `${m[1]} ${kanjiToNumber(m[2]) || m[2]}`;
  });
  return parts.length > 1 && parts.every(Boolean) ? parts.join(" / ") : "";
}

/** 1セル分。text は表に出す短い形、note は文言をそのまま見せるべきときの元の文。 */
export function cellText(raw, colUnit) {
  const src = String(raw || "").replace(/。$/, "");
  if (!src) return { text: "", note: "" };
  const note = NOTE_WORDS.test(src) ? src : "";
  if (src.includes("にあっては")) {
    const cases = splitCases(src);
    if (cases) return { text: cases, note };
  }
  const [value, unit, cond] = parseValue(src);
  if (value === "ND" || (!value && src.includes("検出されないこと"))) {
    return { text: "検出されないこと", note };
  }
  if (!value) return { text: src, note: "" };
  const suffix = /未満|以上|を超える/.exec(cond || "")?.[0] || "";
  const withUnit = unit && unit !== colUnit ? `${value} ${unit}` : value;
  return { text: suffix ? `${withUnit} ${suffix}` : withUnit, note };
}

// ---------------------------------------------------------------- 値を集める

function sourceRef(ref, column) {
  // 「出典名: 呼び方」と書いたセルは、列の出典でなくその出典から取る。
  const m = ref.match(/^(.+?)[:：]\s*(.+)$/);
  if (m && (SOURCES[m[1].trim()] || LAW_ID.test(m[1].trim()))) {
    return { sources: [m[1].trim()], item: m[2].trim() };
  }
  return { sources: column.sources, item: ref };
}

function findIn(source, item, column, laws) {
  const key = itemKey(item);
  if (LAW_ID.test(source)) {
    const law = laws.get(source);
    if (!law) return null;
    const hit = law.rows.find((r) => (!column.tables.length || column.tables.includes(r.table))
      && itemKey(r.item_raw) === key);
    return hit ? { raw: hit.value_raw, from: source, item: hit.item_raw } : null;
  }
  const data = SOURCES[source];
  const hit = data?.rows.find((r) => itemKey(r.item) === key);
  return hit ? { raw: hit.value_raw, from: source, item: hit.item } : null;
}

function lawIdsOf(columns, rows) {
  const ids = new Set();
  for (const c of columns) for (const s of c.sources) if (LAW_ID.test(s)) ids.add(s);
  for (const r of rows) {
    for (const ref of r.refs) {
      const m = ref.match(/^([0-9]{3}[A-Z]{1,2}[0-9A-Z]+)[:：]/);
      if (m) ids.add(m[1]);
    }
  }
  return [...ids];
}

/**
 * 表を組み立てる。法令は現行版を1回ずつ取る。
 * 返り値: { columns, rows: [{ group, name, cells: [{ text, note, from, item, missing }] }], laws, sources, problems }
 */
export async function buildSummary({ fetchLaw = fetchLawData, onProgress } = {}) {
  const { columns, lawTitles } = parseColumns(COLUMNS_MD);
  const specRows = parseRows(ROWS_MD, columns);
  const laws = new Map();
  const problems = [];
  const ids = lawIdsOf(columns, specRows);
  let done = 0;
  await Promise.all(ids.map(async (id) => {
    try {
      const data = await fetchLaw(id);
      laws.set(id, {
        id,
        title: data.revision_info?.law_title || lawTitles[id]?.title || id,
        enforcement_date: data.revision_info?.amendment_enforcement_date || "",
        use: lawTitles[id]?.use || "",
        rows: extractRecords(data),
      });
    } catch (err) {
      problems.push({ kind: "law", id, title: lawTitles[id]?.title || id, message: String(err?.message || err) });
    } finally {
      done += 1;
      onProgress?.(done, ids.length);
    }
  }));

  const rows = specRows.map((r) => ({
    group: r.group,
    name: r.name,
    cells: columns.map((c, i) => {
      const ref = r.refs[i];
      if (!ref) return { text: "", note: "", from: "", item: "", missing: false, failed: false };
      const { sources, item } = sourceRef(ref, c);
      for (const s of sources) {
        const hit = findIn(s, item, c, laws);
        if (hit) return { ...cellText(hit.raw, c.unit), from: hit.from, item: hit.item, missing: false };
      }
      // 法令が取れなかったときは、取得の失敗として表の上に1回だけ出す。
      if (sources.every((s) => LAW_ID.test(s) && !laws.has(s))) {
        return { text: "", note: "", from: sources.join("、"), item, missing: false, failed: true };
      }
      // rows.md に呼び方を書いたのに出典に無い。黙って空欄にしない。
      return { text: "", note: "", from: sources.join("、"), item, missing: true };
    }),
  }));

  for (const r of rows) {
    r.cells.forEach((cell, i) => {
      if (cell.missing) {
        problems.push({ kind: "item", row: r.name, column: columns[i].name, item: cell.item, from: cell.from });
      }
    });
  }

  const usedSources = [...new Set(columns.flatMap((c) => c.sources).concat(
    rows.flatMap((r) => r.cells.map((c) => c.from)),
  ))].filter((s) => s && !LAW_ID.test(s) && SOURCES[s]).map((s) => SOURCES[s]);

  // 出典欄は列の順に並べる（取得が終わった順にしない）。
  const lawOrder = [...laws.values()].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return { columns, rows, laws: lawOrder, sources: usedSources, problems };
}
