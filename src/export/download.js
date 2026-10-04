/**
 * ダウンロード。Excel と Markdown を作り、1つの zip にまとめて保存させる。
 * exceljs と fflate は大きいので、ボタンを押したときに読み込む。
 *
 * 開いた法令: 法令名.xlsx（施行期間ごとのシート。新しい期間が先）＋ markdown/施行期間ごとの .md
 *   変更コメントあり … 前の版との違いに印。コメントなし … 印を付けず、その期間の基準値だけ
 * 主要基準一覧: 主要基準一覧.xlsx（一覧と、注記・出典のシート）＋ 主要基準一覧.md
 */

import {
  LEGEND, READING_NOTES, checkAlerts, columnNotes, describeProblem, lawLine, numberCells, renderSummaryMarkdown, sourceLine, today,
} from "../summary/markdown.js";
import { eraLabel, eraTable, safeName, withoutChanges } from "./tables.js";

const COLOR = {
  header: "FFF3F3F3",
  group: "FFEEF3FA",
  changed: "FFFFF3C4",
  red: "FFC40000",
  gray: "FF777777",
  missing: "FFA40000",
  supplement: "FF6B4E00",
  supplementFill: "FFFBF7EC",
  border: "FFCCCCCC",
};

const thin = { style: "thin", color: { argb: COLOR.border } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };

async function loadLibs() {
  const [{ default: ExcelJS }, { zipSync, strToU8 }] = await Promise.all([import("exceljs"), import("fflate")]);
  return { ExcelJS, zipSync, strToU8 };
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Excel のシート名: 31文字まで、: \ / ? * [ ] は使えない。同じ名前は番号を付ける。 */
function sheetName(name, used) {
  const base = String(name).replace(/[:\\/?*[\]]/g, "_").slice(0, 31) || "Sheet";
  let n = base;
  for (let i = 2; used.has(n); i += 1) n = `${base.slice(0, 28)}(${i})`;
  used.add(n);
  return n;
}

function styleHeader(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.header } };
    cell.border = BORDER;
    cell.alignment = { vertical: "bottom", wrapText: true };
  });
}

/** 変更前の文言は、セルの中に赤いかっこで書く（画面と同じ）。 */
function cellValue(text, note) {
  if (!note) return text;
  return { richText: [{ text }, { text: `（${note}）`, font: { color: { argb: COLOR.red } } }] };
}

function columnWidths(sheet, headers, rows, { min = 8, max = 40 } = {}) {
  headers.forEach((h, i) => {
    const longest = Math.max(
      String(h).length,
      ...rows.map((r) => String(r.cells[i] ?? "").length + (r.notes?.[i] ? r.notes[i].length + 2 : 0)),
    );
    sheet.getColumn(i + 1).width = Math.max(min, Math.min(max, Math.round(longest * 1.8) + 2));
  });
}

// ------------------------------------------------------------------ 開いた法令

function lawEraMarkdown(detail, era, table, annotate) {
  const md = (s) => String(s ?? "").replace(/\|/g, "｜").replace(/\r?\n/g, " ");
  const head = `| ${table.headers.map(md).join(" | ")} |\n| ${table.headers.map(() => "---").join(" | ")} |`;
  const body = table.rows.map((r) => {
    const cells = r.cells.map((c, i) => {
      let t = md(c);
      if (r.removed) return t ? `~~${t}~~` : "";
      if (r.changed[i]) t = `**${t}**`;
      if (r.notes[i]) t += `（${md(r.notes[i])}）`;
      return t;
    });
    return `| ${cells.join(" | ")} |`;
  }).join("\n");
  return `# ${detail.title}

施行 ${eraLabel(era)}

- 法令ID: ${detail.lawId}
- 出典: e-Gov 法令API（${era.start} 施行の版）
- ダウンロード日: ${today()}（${annotate ? "変更コメントあり" : "コメントなし"}）

${head}
${body}

${table.footnote ? `${table.footnote}\n\n` : ""}${annotate
    ? "太字は、1つ前の収録版と項目または基準の文言が違うところです。変更前の文言はかっこ書きです。打ち消し線の行はこの版で廃止されたものです。"
    : ""}${detail.isMatrix ? "該当しない組合せは－。" : ""}
基準は条文の文言そのままです。告示・条例の上乗せ基準は含みません。
`;
}

function addLawSheet(wb, detail, era, table, used, annotate) {
  const sheet = wb.addWorksheet(sheetName(eraLabel(era), used));
  sheet.addRow([detail.title]).font = { bold: true, size: 13 };
  sheet.addRow([`施行 ${eraLabel(era)}　法令ID ${detail.lawId}　出典 e-Gov 法令API（${era.start} 施行の版）　${
    annotate ? "変更コメントあり" : "コメントなし"}`]);
  sheet.addRow([]);
  const headerRow = sheet.addRow(table.headers);
  styleHeader(headerRow);
  for (const r of table.rows) {
    const row = sheet.addRow(r.cells.map((c, i) => cellValue(c, r.notes[i])));
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.alignment = { vertical: "top", wrapText: true };
      if (r.removed) {
        cell.font = { strike: true, color: { argb: COLOR.gray } };
      } else if (r.changed[col - 1]) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.changed } };
      }
    });
  }
  sheet.addRow([]);
  if (table.footnote) sheet.addRow([table.footnote]);
  if (annotate) {
    sheet.addRow(["薄い黄色は、1つ前の収録版と項目または基準の文言が違うところです。変更前の文言は赤いかっこ書きです。打ち消し線の行はこの版で廃止されたものです。"]);
  }
  sheet.addRow(["基準は条文の文言そのままです。告示・条例の上乗せ基準は含みません。"]);
  columnWidths(sheet, table.headers, table.rows);
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: 4 }];
}

/**
 * detail: { title, lawId, isMatrix, eras }（eras は新しい期間が先。画面と同じ順）
 * annotate: true で変更コメントあり、false でコメントなし（印を付けず、その期間に無くなった行も入れない）
 */
export async function downloadLaw(detail, { annotate = true } = {}) {
  const { ExcelJS, zipSync, strToU8 } = await loadLibs();
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const used = new Set();
  const files = {};
  const base = safeName(detail.title);
  detail.eras.forEach((era, i) => {
    const full = eraTable(era, detail.isMatrix);
    const table = annotate ? full : withoutChanges(full);
    addLawSheet(wb, detail, era, table, used, annotate);
    const no = String(i + 1).padStart(2, "0");
    files[`${base}/markdown/${no}_施行${safeName(`${era.start}_${era.end}`)}.md`] = strToU8(lawEraMarkdown(detail, era, table, annotate));
  });
  files[`${base}/${base}.xlsx`] = new Uint8Array(await wb.xlsx.writeBuffer());
  const kind = annotate ? "変更コメントあり" : "コメントなし";
  saveBlob(new Blob([zipSync(files)], { type: "application/zip" }), `${base}_基準値_${kind}_${today()}.zip`);
}

// ------------------------------------------------------------------ 主要基準一覧

export async function downloadSummary(summary, checks) {
  const { ExcelJS, zipSync, strToU8 } = await loadLibs();
  const { columns, laws, sources, problems, labels = [] } = summary;
  const { table, notes } = numberCells(summary);
  const colNotes = columnNotes(columns);
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();

  const sheet = wb.addWorksheet("主要基準一覧");
  sheet.addRow(["主要基準一覧"]).font = { bold: true, size: 13 };
  sheet.addRow([`ダウンロード日 ${today()}。法令は e-Gov 法令API の現行版、告示は環境省のページを保存したものから読んでいます。`]);
  for (const line of LEGEND) sheet.addRow([line]);
  for (const a of checkAlerts(checks)) sheet.addRow([a]).font = { color: { argb: COLOR.missing } };
  for (const p of problems) sheet.addRow([describeProblem(p)]).font = { color: { argb: COLOR.missing } };
  sheet.addRow([]);
  const headers = ["分類", "物質名", ...columns.map(colNotes.header)];
  const headerRow = sheet.addRow(headers);
  styleHeader(headerRow);
  const headerAt = headerRow.number;
  for (const r of table) {
    const row = sheet.addRow([r.group, r.name, ...r.cells.map((c) => (c.note ? `${c.text} ※${c.note}` : c.text))]);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.border = BORDER;
      cell.alignment = { vertical: "top", wrapText: true };
      const c = r.cells[col - 3];
      if (col <= 2) {
        if (col === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.group } };
        if (col === 2) cell.font = { bold: true };
      } else if (c?.kind === "empty") {
        cell.font = { color: { argb: COLOR.gray } };
        cell.alignment = { vertical: "top", horizontal: "center" };
      } else if (c?.kind === "missing") {
        cell.font = { color: { argb: COLOR.missing } };
      } else if (c?.kind === "supplement") {
        cell.font = { color: { argb: COLOR.supplement } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLOR.supplementFill } };
      }
    });
  }
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 26;
  columns.forEach((_, i) => { sheet.getColumn(i + 3).width = 14; });
  sheet.views = [{ state: "frozen", xSplit: 2, ySplit: headerAt }];

  const info = wb.addWorksheet("注記と出典");
  info.getColumn(1).width = 120;
  const heading = (t) => { info.addRow([]); info.addRow([t]).font = { bold: true }; };
  info.addRow(["列の注記"]).font = { bold: true };
  colNotes.list.forEach((c, i) => info.addRow([`注${i + 1} ${c.name}: ${c.note}`]));
  heading("頭に語が付いた値");
  labels.forEach((l) => info.addRow([`${l.label}: ${l.meaning}`]));
  heading("※ 条件付きの基準（文言のまま）");
  notes.forEach((n, i) => info.addRow([`※${i + 1} ${n.row}／${n.column}: ${n.text}`]));
  if (!notes.length) info.addRow(["なし"]);
  heading("出典（法令。e-Gov 法令API）");
  laws.forEach((l) => info.addRow([lawLine(l)]));
  heading("出典（告示など。保存したページ）");
  sources.forEach((s) => info.addRow([sourceLine(s)]));
  heading("この表に無いもの・読み方の注意");
  READING_NOTES.forEach((n) => info.addRow([n]));
  info.eachRow((row) => { row.alignment = { wrapText: true, vertical: "top" }; });

  const md = renderSummaryMarkdown(summary, checks, {
    origin: "画面の「ダウンロード」で保存した表です。トップ画面の主要基準一覧と同じ内容です。",
  });
  const base = "主要基準一覧";
  const files = {
    [`${base}/${base}.xlsx`]: new Uint8Array(await wb.xlsx.writeBuffer()),
    [`${base}/${base}.md`]: strToU8(md),
  };
  saveBlob(new Blob([zipSync(files)], { type: "application/zip" }), `${base}_${today()}.zip`);
}
