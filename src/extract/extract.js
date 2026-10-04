/**
 * law_full_text から4種類の読み方で行を取る。法令ごとの専用プログラムは置かない。
 *
 * 1. 別表（AppdxTable）
 * 2. 号列記（Item の Column）… 条の本文に unit_hints.txt の語がある条だけ
 * 3. 条文の中の表（AppdxTable の外側にある Table）
 * 4. 地の文（「検出されること」「検出されないこと」で基準を定めている条）
 *
 * value_raw（条文の文言）を正とする。value と unit は表に出しやすくするための写し。
 */

import { findAll, firstText, nodeText, textExcluding } from "./tree.js";
import { unitHintFromText } from "./unitHints.js";
import UNIT_HINTS_TEXT from "./unit_hints.txt?raw";
import { parseValue } from "./value.js";

const UNIT_HINT = unitHintFromText(UNIT_HINTS_TEXT);

const KANJI_NUM_ONLY = /^[〇一二三四五六七八九十百千]+$/;
const SEA_SPLIT = /(海域以外の公共用水域に排出されるもの|海域に排出されるもの)/;
// 見出しだけの行を捨てるための語。表の1行目に項目名として出る呼び方もここに書く。
const HEADER_WORD = /^(項目|基準|許容限度|測定方法|第[一二三四五六七八九十]欄|(有害物質|特定有害物質|物質|実施措置)の種類)$/;
const PROSE_STANDARD = /検出され(ない|る)こと/;

export const KIND_APPDX = "別表";
export const KIND_ITEM = "号列記";
export const KIND_TABLE = "条文中の表";
export const KIND_PROSE = "地の文";

function cellsOf(row) {
  return [...findAll(row, "TableColumn")].map((c) => nodeText(c).trim());
}

function appdxTitle(table) {
  const raw = firstText(table, "AppdxTableTitle");
  return (raw.split(/[（(]/)[0] || raw).trim() || raw;
}

/** 1. 別表。行の最後のセルが基準の文言、その手前が項目名。 */
function* appdxRows(body) {
  for (const table of findAll(body, "AppdxTable")) {
    const title = appdxTitle(table);
    for (const row of findAll(table, "TableRow")) {
      yield { kind: KIND_APPDX, article: null, table: title, cells: cellsOf(row), condition: "" };
    }
  }
}

/** 2. 号列記。本文に単位の言い回しがある条だけを対象にする。 */
function* itemRows(body) {
  for (const art of findAll(body, "Article")) {
    if (!UNIT_HINT.test(nodeText(art))) continue;
    const title = firstText(art, "ArticleTitle");
    const paras = [...findAll(art, "Paragraph")].filter((p) => [...findAll(p, "Item")].length > 0);
    for (const para of paras) {
      const pcond = paras.length > 1 ? `第${(para.attr || {}).Num ?? ""}項` : "";
      for (const item of findAll(para, "Item")) {
        const cols = [...findAll(item, "Column")].map((c) => nodeText(c).trim());
        if (cols.length < 2) continue;
        for (let i = 0; i + 1 < cols.length; i += 2) {
          yield {
            kind: KIND_ITEM,
            article: art,
            table: title,
            cells: [cols[i], cols[i + 1]],
            condition: pcond,
          };
        }
      }
    }
  }
}

/** 3. 条文の中の表。別表（AppdxTable・附則別表）の内側は取らない。 */
function* inlineTableRows(body) {
  function* walk(node, art) {
    if (Array.isArray(node)) {
      for (const child of node) yield* walk(child, art);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (/AppdxTable$/.test(node.tag)) return;
    const here = node.tag === "Article" ? node : art;
    if (node.tag === "Table") {
      const title = here ? firstText(here, "ArticleTitle") : "";
      for (const row of findAll(node, "TableRow")) {
        yield {
          kind: KIND_TABLE,
          article: here,
          table: title || "本則",
          cells: cellsOf(row),
          condition: "",
        };
      }
      return;
    }
    for (const child of node.children || []) yield* walk(child, here);
  }
  yield* walk(body, null);
}

/** 4. 地の文。1条につき1行。物質ごとに行を分けない。 */
function* proseRows(body, usedArticles) {
  for (const art of findAll(body, "Article")) {
    if (usedArticles.has(art)) continue;
    if ([...findAll(art, "Table")].length) continue;
    const title = firstText(art, "ArticleTitle");
    const caption = firstText(art, "ArticleCaption").replace(/^（/, "").replace(/）$/, "");
    for (const para of findAll(art, "Paragraph")) {
      const own = textExcluding(para, ["Item", "TableStruct", "Table"]).replace(/[\s　]/g, "");
      if (!PROSE_STANDARD.test(own)) continue;
      yield {
        kind: KIND_PROSE,
        article: art,
        table: title,
        item_raw: caption || title,
        condition: "",
        value_raw: own,
      };
      break;
    }
  }
}

function isHeaderRow(cells) {
  const filled = cells.filter(Boolean);
  if (!filled.length) return true;
  return filled.every((c) => HEADER_WORD.test(c));
}

function splitSeaCondition(text) {
  const parts = String(text).split(SEA_SPLIT);
  if (parts.length < 5) return [["", text]];
  const out = [];
  for (let i = 1; i < parts.length; i += 2) {
    out.push([parts[i].includes("海域以外") ? "海域以外" : "海域", parts[i + 1]]);
  }
  return out;
}

/** セルの読み方。別表・号列記・条文中の表で共通。 */
function readCells(table, cells, carry) {
  let use = cells.filter((c) => c !== "");
  if (!use.length || isHeaderRow(use)) {
    carry[table] = "";
    return [];
  }
  if (use.length >= 3 && KANJI_NUM_ONLY.test(use[0])) use = use.slice(1);
  if (use.length < 2) return [];
  const valueRaw = use[use.length - 1];
  const itemRaw = use[use.length - 2];
  if (HEADER_WORD.test(itemRaw)) {
    carry[table] = "";
    return [];
  }
  if (/掲げる(項目|物質)/.test(itemRaw)) return [];
  const extra = use.slice(0, -2).join("／");
  if (extra) carry[table] = extra;
  const base = extra || carry[table] || "";
  return splitSeaCondition(valueRaw).map(([sea, vtext]) => [
    itemRaw,
    [base, sea].filter(Boolean).join("、"),
    vtext,
  ]);
}

function joinCond(...parts) {
  return parts.filter(Boolean).join("、");
}

export function extractRecords(data) {
  const body = data.law_full_text;
  const ri = data.revision_info || {};
  const meta = {
    law_id: data.law_info?.law_id || ri.law_id || "",
    revision_id: ri.law_revision_id || "",
    enforcement_date: ri.amendment_enforcement_date || "",
  };
  const rows = [];
  const carry = {};
  for (const src of [appdxRows(body), itemRows(body), inlineTableRows(body)]) {
    for (const hit of src) {
      for (const [itemRaw, cond, vtext] of readCells(hit.table, hit.cells, carry)) {
        rows.push({
          ...meta,
          kind: hit.kind,
          article: hit.article,
          table: hit.table,
          item_raw: itemRaw,
          condition: joinCond(hit.condition, cond),
          value_raw: vtext,
        });
      }
    }
  }
  const used = new Set(rows.map((r) => r.article).filter(Boolean));
  for (const hit of proseRows(body, used)) {
    rows.push({ ...meta, ...hit });
  }
  return rows.map((r) => {
    const [value, unit, extraCond] = parseValue(r.value_raw);
    const condition = r.value_raw.includes("当分の間")
      ? joinCond(r.condition, extraCond, "当分の間（本則とは別の条件）")
      : joinCond(r.condition, extraCond);
    const { article, ...rest } = r;
    return { ...rest, value, unit, condition };
  });
}

/** 画面に出す1セル分の文字。文言を短い数値に置き換えない。 */
export function formatValue(r) {
  const raw = String(r.value_raw || "").replace(/。$/, "");
  if (!r.value || raw.includes("かつ")) return raw;
  if (r.value === "ND") return "検出されないこと";
  if ((r.condition || "").includes("範囲")) return `${r.value}${r.unit ? ` ${r.unit}` : ""}`;
  let suffix = "以下";
  for (const w of ["未満", "以上", "を超える"]) {
    if ((r.condition || "").includes(w)) suffix = w;
  }
  return `${r.value}${r.unit ? ` ${r.unit}` : ""} ${suffix}`;
}

export function dayBefore(iso) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 施行日ごとに分ける。1つ前の収録版と「表の名前・項目・条件」が同じ行を比べる。 */
export function groupByEra(rows) {
  const byDate = new Map();
  for (const r of rows) {
    const d = r.enforcement_date || "";
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }
  const dates = [...byDate.keys()].filter(Boolean).sort();
  const key = (r) => `${r.table}\t${r.item_raw}\t${r.condition}`;
  const eras = [];
  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const start = dates[i];
    const end = i === dates.length - 1 ? "現行" : dayBefore(dates[i + 1]);
    const current = byDate.get(start);
    const prev = i > 0 ? byDate.get(dates[i - 1]) : null;
    const prevMap = new Map((prev || []).map((r) => [key(r), r]));
    const curKeys = new Set(current.map(key));
    const out = [];
    for (const r of current) {
      let mark = "";
      let changeNote = "";
      if (prev) {
        if (!prevMap.has(key(r))) {
          mark = "changed";
          changeNote = "この版で追加";
        } else if (prevMap.get(key(r)).value_raw !== r.value_raw) {
          mark = "changed";
          changeNote = formatValue(prevMap.get(key(r)));
        }
      }
      out.push({ ...r, mark, changeNote });
    }
    if (prev) {
      for (const [k, old] of prevMap) {
        if (curKeys.has(k)) continue;
        out.push({ ...old, mark: "removed", changeNote: formatValue(old) });
      }
    }
    eras.push({ start, end, rows: out });
  }
  return { dates, eras };
}
