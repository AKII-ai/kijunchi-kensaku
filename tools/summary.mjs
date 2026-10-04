/**
 * docs/主要基準一覧.md を作り直す。npm run summary
 * 別の場所に書くときは npm run summary -- 書き出し先.md（アプリのフォルダからの相対パスか、絶対パス）。
 *
 * トップ画面と同じ src/summary/summary.js で表を組み立て、src/summary/markdown.js で Markdown にする
 * （画面の「ダウンロード」と同じ書き方。vite の読み込みで ?raw と JSON を解決する）。
 * 法令は e-Gov 法令API の現行版、告示は sources/read/*.json。先に python tools/sources.py read を済ませておく。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createServer } from "vite";

const root = resolve(import.meta.dirname, "..");
const out = resolve(root, process.argv[2] || "docs/主要基準一覧.md");

const server = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});

try {
  const { buildSummary, addRecentChanges, CHECKS } = await server.ssrLoadModule("/src/summary/summary.js");
  const { renderSummaryMarkdown, describeProblem } = await server.ssrLoadModule("/src/summary/markdown.js");
  const summary = await buildSummary({
    onProgress: (done, total) => process.stdout.write(`\r法令 ${done}/${total}`),
  });
  process.stdout.write("\n");
  // 直近の改正（1つ前の版との違い）と、告示などの更新・URL の移転の印も付ける（画面と同じ）。
  await addRecentChanges(summary);
  const md = renderSummaryMarkdown(summary, CHECKS, {
    origin: "`npm run summary` で作った表です。手で直さないでください。トップ画面の表と同じ組み立て（`src/summary/`）です。",
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, md, "utf8");
  console.log(`書いた: ${out}`);
  for (const p of summary.problems) console.log(`注意: ${describeProblem(p)}`);
} finally {
  await server.close();
}
