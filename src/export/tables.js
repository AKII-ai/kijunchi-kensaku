/**
 * 画面の表（施行期間ごと）を、Excel と Markdown に共通の形にする。
 * { headers, rows: [{ cells, changed, notes, removed }] }
 *   changed[i] … 1つ前の収録版と違うセル（画面の薄い黄色）
 *   notes[i]   … 変更前の文言、または「この版で追加」（画面の赤いかっこ）
 */

import { formatValue } from "../extract/extract.js";

export function eraTable(era, isMatrix) {
  if (isMatrix) {
    return {
      headers: era.headers,
      rows: era.body.map((row) => {
        const any = row.changed.some(Boolean);
        return {
          cells: [row.group, row.item, ...row.cells],
          changed: [any, any, ...row.changed],
          notes: ["", "", ...(row.removed ? row.cells.map(() => "") : row.notes)],
          removed: row.removed,
        };
      }),
      footnote: era.apiOrder
        ? "この版は、物質の構成が並びファイルの指定と違うため、API が返した順で出しています。"
        : "",
    };
  }
  return {
    headers: ["表または条", "項目", "条件", "基準値"],
    rows: era.rows.map((r) => {
      const changed = r.mark === "changed";
      const removed = r.mark === "removed";
      return {
        cells: [r.table, r.item_raw, r.condition, formatValue(r)],
        changed: [false, changed, false, changed],
        notes: ["", "", "", removed ? "" : r.changeNote || ""],
        removed,
      };
    }),
    footnote: "",
  };
}

/**
 * 変更コメントなしの形。変わった印と変更前の文言を外し、その版で廃止された行（前の版にだけある行）を除く。
 */
export function withoutChanges(table) {
  return {
    ...table,
    rows: table.rows.filter((r) => !r.removed).map((r) => ({
      ...r,
      changed: r.changed.map(() => false),
      notes: r.notes.map(() => ""),
    })),
  };
}

/** 施行期間の見出し。「2026-07-01〜現行」 */
export function eraLabel(era) {
  return `${era.start}〜${era.end}`;
}

/** ファイル名に使えない文字を置き換える（Windows でも開けるように）。 */
export function safeName(s) {
  return String(s || "").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim().slice(0, 80) || "無題";
}
