/**
 * 主要基準一覧。物質を行に、複数の法令・告示を列にした1枚の表。
 *
 * 列は columns.md、物質と「各出典での呼び方」は rows.md に書く（どちらも数値は書かない）。
 * 値は、法令は e-Gov 法令API の現行版から、告示は sources/read/*.json（保存したページの読み取り結果）から、
 * 開くたびに埋める。トップ画面と docs/主要基準一覧.md（npm run summary）は、どちらもこのファイルで作る。
 */

import { fetchLawData, fetchRevisions } from "../api/egov.js";
import { extractRecords } from "../extract/extract.js";
import { firstTable, splitSections } from "../extract/layout.js";
import { shortItem } from "../extract/matrix.js";
import { kanjiToNumber, parseValue } from "../extract/value.js";
import COLUMNS_MD from "./columns.md?raw";
import ROWS_MD from "./rows.md?raw";

const READ = import.meta.glob("../../sources/read/*.json", { eager: true, import: "default" });
const PREVIOUS = import.meta.glob("../../sources/read/_previous/*.json", { eager: true, import: "default" });
const special = (name) => Object.entries(READ).find(([path]) => path.endsWith(`/${name}`))?.[1];

/** 出典の読み取り結果。名前 → { name, url, obtained, checked, file, rows }。「_」で始まるファイルは記録なので除く。 */
export const SOURCES = Object.fromEntries(
  Object.entries(READ)
    .filter(([path]) => !/\/_[^/]*\.json$/.test(path))
    .map(([, data]) => [data.name, data]),
);

/** python tools/sources.py check の結果。無ければ空。 */
export const CHECKS = special("_check.json") || [];

/** これまでの「更新」「移転」の記録（新しい順にしておく）。 */
const CHANGES = [...(special("_changes.json") || [])].sort((a, b) => (a.date < b.date ? 1 : -1));

/** 最後に出典を確かめた日（画面に出す）。 */
export const LAST_CHECKED = CHECKS.map((c) => c.date).sort().pop() || "";

/** 「改正」「更新」「URL変更」を表に出す期間（日）。これより古い変更は印を付けない。 */
export const RECENT_DAYS = 730;

/** 最後の確認で「開けない」だった出典。名前と URL の両方で引けるようにする。 */
const UNREACHABLE = new Map();
for (const c of CHECKS) {
  if (c.result !== "開けない") continue;
  const info = { url: c.url, date: c.date, reason: c.reason || "" };
  UNREACHABLE.set(c.name, info);
  if (c.url) UNREACHABLE.set(c.url, info);
}

const URL_IN_TEXT = /https?:\/\/[^\s）)、。]+/g;

/** 注記の文に書いた URL を取り出す（リンクにするため）。文からは URL を外す。 */
function splitUrls(text) {
  const urls = String(text || "").match(URL_IN_TEXT) || [];
  const rest = String(text || "").replace(URL_IN_TEXT, "").replace(/\s+$/, "").replace(/\s{2,}/g, " ");
  return { text: rest, urls };
}

const LAW_ID = /^[0-9]{3}[A-Z]{1,2}[0-9A-Z]+$/;

// ---------------------------------------------------------------- 指定の読み方

function tableOf(section) {
  return firstTable(section) || { header: [], body: [] };
}

const list = (cell) => String(cell || "").split(/[、,]/).map((s) => s.trim()).filter(Boolean);

export function parseColumns(text) {
  const sections = splitSections(text);
  const section = (pred) => tableOf(sections.find(pred) || { lines: [] });
  const cols = section((s) => s.title === "列");
  const names = section((s) => s.title.startsWith("法令名"));
  const extra = section((s) => s.title === "補う出典");
  const at = (t, name) => t.header.indexOf(name);
  const columns = cols.body.map((row) => {
    // 「別表第二=生活環境項目」と書いた表は、その表から取った値の頭に語を付ける。
    const tables = list(row[at(cols, "表")]).map((t) => {
      const [name, label] = t.split("=").map((x) => x.trim());
      return { name, label: label || "" };
    });
    return {
      name: row[at(cols, "列名")],
      unit: row[at(cols, "単位")] || "",
      sources: list(row[at(cols, "出典")]),
      tables: tables.map((t) => t.name),
      tableLabels: Object.fromEntries(tables.filter((t) => t.label).map((t) => [t.name, t.label])),
      basis: at(cols, "根拠") >= 0 ? row[at(cols, "根拠")] || "" : "",
      note: at(cols, "注記") >= 0 ? row[at(cols, "注記")] || "" : "",
    };
  }).filter((c) => c.name);
  const lawTitles = Object.fromEntries(names.body.map((row) => [row[at(names, "法令ID")], {
    title: row[at(names, "法令名")],
    use: row[at(names, "使う表の意味")] || "",
  }]));
  // 列の本来の出典に無い物質を補う出典（要監視項目など）。セルの頭に付ける語と、その意味。
  const sourceLabels = Object.fromEntries(extra.body.filter((row) => row[at(extra, "出典")]).map((row) => [
    row[at(extra, "出典")], { label: row[at(extra, "頭に付ける語")] || "", meaning: row[at(extra, "意味")] || "" },
  ]));
  return { columns, lawTitles, sourceLabels };
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
      const noteAt = t.header.indexOf("注記");
      rows.push({ group: sec.title, name: r[nameAt], refs, note: noteAt >= 0 ? (r[noteAt] || "").trim() : "" });
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
  const base = suffix ? `${value} ${suffix}` : value;
  // 列見出しの単位と違う値は、単位を付けてかっこ書きにする。
  if (unit && unit !== colUnit) return { text: `（${value} ${unit}${suffix ? ` ${suffix}` : ""}）`, note };
  return { text: base, note };
}

/**
 * 同じ項目で条件の違う値が複数あるとき（排水基準の海域以外／海域など）は、条件を添えて並べる。
 * label はセルの頭に付ける語（要監視、目標、生活環境項目など）。
 */
function combineHits(hits, colUnit, label) {
  const parts = hits.map((h) => cellText(h.raw, colUnit));
  const text = hits.length === 1
    ? parts[0].text
    : parts.map((p, i) => (hits[i].condition ? `${p.text}（${hits[i].condition}）` : p.text)).join(" / ");
  const note = parts.map((p) => p.note).filter(Boolean).join(" ／ ");
  return { text: label && text ? `${label} ${text}` : text, note };
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

/** 出典の中の、その項目の行。法令は同じ表に条件違いの行が複数あることがある。 */
function findIn(source, item, column, laws) {
  const key = itemKey(item);
  if (LAW_ID.test(source)) {
    const law = laws.get(source);
    if (!law) return null;
    const rows = law.rows.filter((r) => (!column.tables.length || column.tables.includes(r.table))
      && itemKey(r.item_raw) === key);
    if (!rows.length) return null;
    return {
      hits: rows.map((r) => ({ raw: r.value_raw, condition: r.condition || "" })),
      from: source,
      item: rows[0].item_raw,
      table: rows[0].table,
    };
  }
  const hit = SOURCES[source]?.rows.find((r) => itemKey(r.item) === key);
  return hit ? { hits: [{ raw: hit.value_raw, condition: "" }], from: source, item: hit.item, table: "" } : null;
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
  const { columns, lawTitles, sourceLabels } = parseColumns(COLUMNS_MD);
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
    note: r.note,
    cells: columns.map((c, i) => {
      const ref = r.refs[i];
      if (!ref) return { text: "", note: "", from: "", item: "", missing: false, failed: false };
      const { sources, item } = sourceRef(ref, c);
      for (const s of sources) {
        const hit = findIn(s, item, c, laws);
        if (!hit) continue;
        const label = sourceLabels[hit.from]?.label || c.tableLabels[hit.table] || "";
        return {
          ...combineHits(hit.hits, c.unit, label),
          from: hit.from,
          item: hit.item,
          label,
          supplement: Boolean(sourceLabels[hit.from]),
          missing: false,
        };
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
  // 根拠のリンク。法令は e-Gov 法令検索の URL と施行日、告示などは保存したページの URL と入手日。
  const linkOf = (name) => {
    if (LAW_ID.test(name)) {
      const law = laws.get(name);
      return {
        name: law?.title || lawTitles[name]?.title || name,
        url: `https://laws.e-gov.go.jp/law/${name}`,
        date: law?.enforcement_date ? `${law.enforcement_date} 施行の現行版` : "",
      };
    }
    const src = SOURCES[name];
    return { name, url: src?.url || "", date: src?.obtained ? `${src.obtained} 入手` : "" };
  };
  // 同じ URL（1つの PDF から複数の表を読む出典など）は1つにする。
  const uniqueLinks = (names) => {
    const seen = new Set();
    return [...new Set(names.filter(Boolean))].map(linkOf)
      .filter((l) => l.url && !seen.has(l.url) && seen.add(l.url));
  };
  // 注記の文に書いた URL は、保存した出典の URL なら入手日を付けてリンクにする。
  const urlLink = (url) => {
    const src = Object.values(SOURCES).find((x) => x.url === url);
    return { name: src?.name || "", url, date: src?.obtained ? `${src.obtained} 入手` : "" };
  };
  const withTextUrls = (links, text) => {
    const { text: rest, urls } = splitUrls(text);
    const seen = new Set(links.map((l) => l.url));
    return { text: rest, links: [...links, ...urls.filter((u) => !seen.has(u) && seen.add(u)).map(urlLink)] };
  };
  const markDead = (links) => links.map((l) => (UNREACHABLE.has(l.url) ? { ...l, unreachable: UNREACHABLE.get(l.url) } : l));
  for (const c of columns) {
    const t = withTextUrls(uniqueLinks(c.sources), c.note);
    c.note = t.text;
    c.links = markDead(t.links);
    // 列の出典の URL が開けないときは、列見出しに1つだけ出す（セルごとには出さない）。
    c.unreachable = c.sources.map((x) => UNREACHABLE.get(x)).find(Boolean) || null;
  }
  // 行の中で、列の出典とも「補う出典」とも違う出典から取ったセル（ダイオキシン類など）は、その行の根拠に足す。
  for (const r of rows) {
    const t = withTextUrls(uniqueLinks(r.cells.map((cell, i) => (
      cell.from && !columns[i].sources.includes(cell.from) && !sourceLabels[cell.from] ? cell.from : ""))), r.note);
    r.note = t.text;
    r.links = markDead(t.links);
    // 行の注だけにある根拠（改正の概要など）が開けないときは、物質名のところに出す。
    r.unreachable = r.links.find((l) => l.unreachable)?.unreachable || null;
    // 列の出典と別の出典（要監視・目標・ダイオキシン類など）から取った値で、その URL が開けないときだけセルに出す。
    r.cells.forEach((cell, i) => {
      if (cell.from && !columns[i].sources.includes(cell.from) && UNREACHABLE.has(cell.from)) {
        cell.unreachable = UNREACHABLE.get(cell.from);
      }
    });
  }

  // 表に出てくる「頭に付ける語」と、その意味と根拠（同じ語の出典はまとめる）。
  const labelMap = new Map();
  for (const from of new Set(rows.flatMap((r) => r.cells.map((c) => c.from)))) {
    const def = sourceLabels[from];
    if (!def?.label) continue;
    if (!labelMap.has(def.label)) labelMap.set(def.label, { label: def.label, meaning: def.meaning, sources: [] });
    labelMap.get(def.label).sources.push(from);
  }
  const labels = [...labelMap.values()].map((l) => ({ ...l, links: markDead(uniqueLinks(l.sources)) }));
  return { columns, rows, laws: lawOrder, sources: usedSources, labels, problems };
}

// ---------------------------------------------------------------- 最近の改正・更新

function daysSince(iso) {
  if (!iso) return Infinity;
  return (Date.now() - new Date(`${iso}T00:00:00`).getTime()) / 86400000;
}

/**
 * 直近 RECENT_DAYS 日の変更をセルに付ける（表を先に出し、あとから呼ぶ）。
 *   法令 … 現行版の施行日が期間内なら、1つ前の版と比べて値の変わったセルに change = { kind: "改正", prev, date }
 *   告示など … 「更新」の記録が期間内なら、そのとき残した前の読み取り結果と比べて change = { kind: "更新", prev, date }
 *   URL の移転 … 列の出典なら列に、別の出典から取ったセルならセルに moved = { from, to, date }
 * 法令の取得に失敗しても表はそのまま（印が付かないだけ）。
 */
export async function addRecentChanges(summary, { fetchLaw = fetchLawData, fetchRevs = fetchRevisions } = {}) {
  const { columns, rows } = summary;
  const lawIds = [...new Set(rows.flatMap((r) => r.cells.map((c) => c.from)).filter((f) => LAW_ID.test(f)))];
  const previousLaw = new Map();
  await Promise.all(lawIds.map(async (id) => {
    try {
      const revs = (await fetchRevs(id)).filter((rv) => rv.amendment_enforcement_date && rv.law_revision_id);
      const [current, prev] = revs;
      if (!current || !prev || daysSince(current.amendment_enforcement_date) > RECENT_DAYS) return;
      previousLaw.set(id, { date: current.amendment_enforcement_date, rows: extractRecords(await fetchLaw(prev.law_revision_id)) });
    } catch {
      /* 改正の印が付かないだけ */
    }
  }));

  const previousSource = new Map();
  for (const ch of CHANGES) {
    if (ch.kind !== "更新" || !ch.previous || previousSource.has(ch.name) || daysSince(ch.date) > RECENT_DAYS) continue;
    const data = Object.entries(PREVIOUS).find(([path]) => path.endsWith(`/${ch.previous.split("/").pop()}`))?.[1];
    if (data) previousSource.set(ch.name, { date: ch.date, rows: data.rows || [] });
  }
  const moved = new Map();
  for (const ch of CHANGES) {
    if (ch.kind === "移転" && !moved.has(ch.name) && daysSince(ch.date) <= RECENT_DAYS) {
      moved.set(ch.name, { from: ch.from_url, to: ch.to_url, date: ch.date });
    }
  }

  for (const c of columns) c.moved = c.sources.map((x) => moved.get(x)).find(Boolean) || null;
  for (const r of rows) {
    r.cells.forEach((cell, i) => {
      const c = columns[i];
      if (!cell.from || cell.missing || cell.failed) return;
      if (!c.sources.includes(cell.from) && moved.has(cell.from)) cell.moved = moved.get(cell.from);
      const key = itemKey(cell.item);
      const label = cell.label || "";
      let prevText = null;
      let found = false;
      let kind = "";
      let date = "";
      if (previousLaw.has(cell.from)) {
        const p = previousLaw.get(cell.from);
        const hits = p.rows.filter((x) => (!c.tables.length || c.tables.includes(x.table)) && itemKey(x.item_raw) === key);
        found = hits.length > 0;
        prevText = found ? combineHits(hits.map((h) => ({ raw: h.value_raw, condition: h.condition || "" })), c.unit, label).text : null;
        kind = "改正";
        date = p.date;
      } else if (previousSource.has(cell.from)) {
        const p = previousSource.get(cell.from);
        const hit = p.rows.find((x) => itemKey(x.item) === key);
        found = Boolean(hit);
        prevText = found ? combineHits([{ raw: hit.value_raw, condition: "" }], c.unit, label).text : null;
        kind = "更新";
        date = p.date;
      } else {
        return;
      }
      if (found && prevText === cell.text) return;
      cell.change = { kind, date, prev: found ? prevText : "", added: !found };
    });
  }
  summary.changesChecked = true;
  return summary;
}
