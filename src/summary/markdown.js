/**
 * 主要基準一覧を Markdown にする。npm run summary（docs/主要基準一覧.md）と、画面のダウンロードで共通。
 * Excel（src/export/）も、※の番号と注意書きはここのものを使う。
 */

export function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function describeProblem(p) {
  if (p.kind === "law") return `${p.title}（${p.id}）を取得できませんでした: ${p.message}`;
  return `「${p.row}」の「${p.column}」: ${p.from} に「${p.item}」が見つかりません`;
}

/** セルの表示文字と ※ の番号。表の上から順に番号を振る。 */
export function numberCells({ columns, rows }) {
  const notes = [];
  const table = rows.map((r) => ({
    group: r.group,
    name: r.name,
    cells: r.cells.map((cell, i) => {
      if (cell.missing) return { text: "出典に見つからない", kind: "missing" };
      if (cell.failed) return { text: "取得できず", kind: "missing" };
      if (!cell.text) return { text: "―", kind: "empty" };
      if (!cell.note) return { text: cell.text, kind: "value" };
      notes.push({ row: r.name, column: columns[i].name, text: cell.note });
      return { text: cell.text, kind: "value", note: notes.length };
    }),
  }));
  return { table, notes };
}

export function lawLine(l) {
  return `${l.title}（e-Gov ${l.id}、${l.enforcement_date} 施行の現行版）${l.use ? `… ${l.use}` : ""}`;
}

export function sourceLine(s) {
  return `${s.name}（入手日 ${s.obtained}、保存 ${s.file}）… ${s.url}`;
}

export function checkAlerts(checks) {
  return checks.filter((c) => c.result === "更新あり" || c.result === "開けない")
    .map((c) => (c.result === "開けない"
      ? `${c.name}: ${c.url} を開けませんでした（${c.date}）。`
      : `${c.name}: 前回保存したページと違います（${c.date}）。読み取りをやり直してください。`));
}

export const LEGEND = [
  "数値だけのセルは、列見出しの単位で「以下」です。単位や「未満」が違うときはセルに書いています。",
  "※ は条件付きの基準です。文言を表の下に載せています。",
  "空欄（―）は「その出典にその物質の項目が無い」で、規制が無いという意味ではありません。",
];

export const READING_NOTES = [
  "地下浸透は水質汚濁防止法施行規則第六条の二の「検出されること」の判定に使う、平成元年環境庁告示第39号の別表備考欄の値です。"
    + "環境省が掲載している告示全文は平成24年改正までなので、令和6年4月1日施行の改正（六価クロム化合物）は改正の概要から読んで上書きしています。"
    + "平成24年から令和6年の間に他の改正が無いかは、官報で確かめていません。",
  "ダイオキシン類の環境基準は別の告示（ダイオキシン類対策特別措置法）です。土壌は「土壌」、地下水・水質は「水質（水底の底質を除く。）」の値で、単位は pg-TEQ です。"
    + "水底土砂のダイオキシン類は省令第一条の本文にあり、別表ではないのでこの表には入っていません。排水のダイオキシン類は排水基準を定める省令ではないので空欄です。",
  "硝酸性窒素及び亜硝酸性窒素の排水基準・地下浸透は、アンモニア等を含む項目の値です（※の文言を参照）。",
  "銅の排水基準は別表第二（生活環境項目）の「銅含有量」、土壌環境基準は農用地（田）の値です。",
  "要監視項目、水質管理目標設定項目は列にしていません（sources/notes/ に整理メモのみ）。",
  "水道水質基準は水質基準に関する省令の表のうち、この表の物質に当たる項目だけを載せています。",
];

function cellMd(s) {
  return String(s).replace(/\|/g, "｜").replace(/\r?\n/g, " ");
}

/**
 * origin: 表の由来の1行（「npm run summary で作った表です。…」など）。
 */
export function renderSummaryMarkdown(summary, checks, { origin }) {
  const { columns, laws, sources, problems } = summary;
  const { table, notes } = numberCells(summary);
  const lines = [
    `| 分類 | 物質名 | ${columns.map((c) => `${c.name}（${c.unit}）`).join(" | ")} |`,
    `| ${["---", "---", ...columns.map(() => "---")].join(" | ")} |`,
    ...table.map((r) => `| ${r.group} | ${r.name} | ${r.cells.map((c) => (
      c.note ? `${cellMd(c.text)} ※${c.note}` : cellMd(c.text))).join(" | ")} |`),
  ];
  const alerts = checkAlerts(checks);

  return `# 主要基準一覧

生成日: ${today()}

${origin}
法令は e-Gov 法令API の現行版、告示は環境省のページを保存したもの（\`sources/saved/\`）から読んでいます。
物質と列の対応は \`src/summary/rows.md\`、列の出典は \`src/summary/columns.md\` です。

${LEGEND.join("\n")}
${alerts.length ? `\n## 出典の確認結果\n\n${alerts.map((a) => `- ${a}`).join("\n")}\n` : ""}${
  problems.length ? `\n## 注意\n\n${problems.map((p) => `- ${describeProblem(p)}`).join("\n")}\n` : ""}
## 表

${lines.join("\n")}

## ※ 条件付きの基準（文言のまま）

${notes.map((n, i) => `${i + 1}. ${n.row}／${n.column}: ${n.text}`).join("\n") || "なし"}

## 出典

法令（e-Gov 法令API）

${laws.map((l) => `- ${lawLine(l)}`).join("\n")}

告示など（保存したページ）

${sources.map((s) => `- ${sourceLine(s)}`).join("\n")}

## この表に無いもの・読み方の注意

${READING_NOTES.map((n) => `- ${n}`).join("\n")}
`;
}
