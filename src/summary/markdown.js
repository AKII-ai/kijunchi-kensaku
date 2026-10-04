/**
 * 主要基準一覧の欄外（根拠と注、※、表の見方）と Markdown。
 * 画面（src/ui/app.js）、npm run summary（docs/主要基準一覧.md）、ダウンロード（src/export/）で共通。
 *
 * 表の中は値だけにし、根拠はすべて欄外に出す。
 *   注n … 列見出し（列の根拠）と物質名（その行だけの根拠）に付ける。同じ内容の注は1つの番号にまとめる。
 *   ※n … 条件付きの基準のセルに付ける。文言をそのまま欄外に出す。
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
    unreachable: Boolean(r.unreachable),
    cells: r.cells.map((cell, i) => {
      if (cell.missing) return { text: "出典に見つからない", kind: "missing" };
      if (cell.failed) return { text: "取得できず", kind: "missing" };
      if (!cell.text) return { text: "―", kind: "empty" };
      const kind = cell.supplement ? "supplement" : "value";
      // 参照先の URL を最後の確認で開けなかったセル。値は前回保存したページのもの。
      const text = cell.unreachable ? `${cell.text}（参照不可）` : cell.text;
      if (!cell.note) return { text, kind, unreachable: Boolean(cell.unreachable) };
      notes.push({ row: r.name, column: columns[i].name, text: cell.note });
      return { text, kind, note: notes.length, unreachable: Boolean(cell.unreachable) };
    }),
  }));
  return { table, notes };
}

export function checkAlerts(checks) {
  const out = [];
  for (const c of checks) {
    if (c.result === "開けない") out.push(`${c.name}: ${c.url} を開けませんでした（${c.date}）。`);
    if (c.result === "更新あり") out.push(`${c.name}: 前回保存したページと違ったので、新しいページを読みました（${c.date}）。`);
    if (c.moved_from) out.push(`${c.name}: 参照先の URL が ${c.moved_from} から ${c.url} に移っていたので、新しい URL にしました（${c.date}）。`);
  }
  return out;
}

/** 根拠のリンク1つ分の文字。「URL（2026-04-01 施行の現行版）」 */
export function linkText(l) {
  const base = l.date ? `${l.url}（${l.date}）` : l.url;
  return l.unreachable ? `${base}［${l.unreachable.date} に開けず］` : base;
}

/**
 * 根拠と注。列（同じ根拠・注記の列は1つにまとめる）→ 行（同じ注記の行は1つにまとめる）の順に番号を振る。
 * 返り値: { items: [{ no, title, text, links }], colNo: Map(列名→番号), rowNo: Map(物質名→番号), labels }
 */
export function basisNotes({ columns, rows, labels = [] }) {
  const items = [];
  const colNo = new Map();
  const rowNo = new Map();
  const byKey = new Map();
  const add = (key, title, text, links) => {
    if (byKey.has(key)) {
      const item = byKey.get(key);
      item.titles.push(title);
      return item.no;
    }
    const item = { no: items.length + 1, titles: [title], text, links };
    items.push(item);
    byKey.set(key, item);
    return item.no;
  };
  for (const c of columns) {
    const text = [c.basis, c.note].filter(Boolean).join("。");
    if (!text && !c.links?.length) continue;
    colNo.set(c.name, add(`列\t${text}\t${(c.links || []).map((l) => l.url).join(" ")}`, c.name, text, c.links || []));
  }
  for (const r of rows) {
    if (!r.note && !r.links?.length) continue;
    rowNo.set(r.name, add(`行\t${r.note}\t${(r.links || []).map((l) => l.url).join(" ")}`, r.name, r.note, r.links || []));
  }
  return {
    items: items.map((it) => ({ no: it.no, title: it.titles.join("・"), text: it.text, links: it.links })),
    colNo,
    rowNo,
    labels,
  };
}

/** 表の見方。欄外の最後に出す。 */
export const LEGEND = [
  "数値だけのセルは、列見出しの単位で「以下」。単位が違う値はかっこ書き、「未満」などはセルに書く。",
  "―は、その出典にその物質の項目が無いこと（規制が無いという意味ではない）。",
  "同じ項目で条件の違う値は、条件を添えて並べる（例: 海域以外／海域）。",
  "「要監視」「目標」が頭に付いた値は、その列の本来の基準ではなく、上の「根拠と注」に書いた指針値・目標値。",
  "「参照不可」は、最後に確かめたとき参照先の URL を開けなかったもの（列見出しにあればその列すべて）。値は前回保存したページのもの。",
  "載せていないもの: 要監視項目・水質管理目標設定項目のうちこの表に行の無い物質、水道の要検討項目（現行の一覧を公式資料で確かめられていない）、都道府県の上乗せ基準。",
];

function cellMd(s) {
  return String(s).replace(/\|/g, "｜").replace(/\r?\n/g, " ");
}

/** 列見出し（Markdown・Excel 用）。「土壌環境基準（mg/L） 注1」 */
export function columnHeader(c, basis) {
  const no = basis.colNo.get(c.name);
  return `${c.name}（${c.unit}）${no ? ` 注${no}` : ""}${c.unreachable ? "（参照不可）" : ""}`;
}

/** 物質名（Markdown・Excel 用）。「ダイオキシン類 注9」 */
export function rowName(name, basis, unreachable = false) {
  const no = basis.rowNo.get(name);
  return `${name}${no ? ` 注${no}` : ""}${unreachable ? "（参照不可）" : ""}`;
}

/** 欄外の各行（Markdown・Excel 用の文字）。 */
export function footnoteLines(basis) {
  return {
    basis: basis.items.map((it) => `注${it.no} ${it.title}: ${[it.text, ...it.links.map(linkText)].filter(Boolean).join(" ")}`),
    labels: basis.labels.map((l) => `${l.label}: ${[l.meaning, ...l.links.map(linkText)].filter(Boolean).join(" ")}`),
  };
}

/**
 * origin: 表の由来の1行（「npm run summary で作った表です。…」など）。
 */
export function renderSummaryMarkdown(summary, checks, { origin }) {
  const { columns, problems } = summary;
  const { table, notes } = numberCells(summary);
  const basis = basisNotes(summary);
  const foot = footnoteLines(basis);
  const lines = [
    `| 分類 | 物質名 | ${columns.map((c) => columnHeader(c, basis)).join(" | ")} |`,
    `| ${["---", "---", ...columns.map(() => "---")].join(" | ")} |`,
    ...table.map((r) => `| ${r.group} | ${rowName(r.name, basis, r.unreachable)} | ${r.cells.map((c) => (
      c.note ? `${cellMd(c.text)} ※${c.note}` : cellMd(c.text))).join(" | ")} |`),
  ];
  const alerts = checkAlerts(checks);

  return `# 主要基準一覧

生成日: ${today()}

${origin}
${alerts.length ? `\n## 出典の確認結果\n\n${alerts.map((a) => `- ${a}`).join("\n")}\n` : ""}${
  problems.length ? `\n## 注意\n\n${problems.map((p) => `- ${describeProblem(p)}`).join("\n")}\n` : ""}
## 表

${lines.join("\n")}

## 根拠と注

${foot.basis.map((l) => `- ${cellMd(l)}`).join("\n")}
${foot.labels.map((l) => `- ${cellMd(l)}`).join("\n")}

## ※ 条件付きの基準（文言のまま）

${notes.map((n, i) => `${i + 1}. ${n.row}／${n.column}: ${n.text}`).join("\n") || "なし"}

## 表の見方

${LEGEND.map((n) => `- ${n}`).join("\n")}
`;
}
