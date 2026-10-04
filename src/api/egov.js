/**
 * e-Gov 法令API v2 の取得だけ。基準値の読み方も画面も持たない。
 * 開発サーバでは /egov が vite.config.js で API へ転送される。
 */

// npm run summary（Node で実行）は CORS が無いので、開発中でも API へ直接行く。
const API_BASE = import.meta.env?.DEV && !import.meta.env?.SSR ? "/egov" : "https://laws.e-gov.go.jp/api/2";

// 「最新に更新」のときは、ブラウザの保存（キャッシュ）を使わず API から取り直す。
let bypassCache = false;
export function setBypassCache(on) {
  bypassCache = Boolean(on);
}

async function apiGet(path, params = {}) {
  const q = new URLSearchParams({ response_format: "json", ...params });
  const res = await fetch(`${API_BASE}/${path}?${q}`, {
    headers: { Accept: "application/json" },
    cache: bypassCache ? "no-store" : "default",
  });
  if (!res.ok) throw new Error(`e-Gov API ${res.status}: ${path}`);
  return res.json();
}

/** 法令名から探す。law_title か law_id のどちらかを渡す。 */
export async function searchLaws({ title, law_id, limit = 40 } = {}) {
  const params = { limit: String(limit) };
  if (title) params.law_title = title;
  if (law_id) params.law_id = law_id;
  return apiGet("laws", params);
}

/** 本文を取る。法令IDでも版IDでもよい。 */
export async function fetchLawData(id) {
  return apiGet(`law_data/${encodeURIComponent(id)}`);
}

/** 改正の一覧。 */
export async function fetchRevisions(lawId) {
  const data = await apiGet(`law_revisions/${encodeURIComponent(lawId)}`);
  return data.revisions || [];
}

/** 1法令のカード表示に使う項目だけを取り出す。 */
export function lawCard(entry) {
  const info = entry.law_info || {};
  const rev = entry.revision_info || {};
  return {
    law_id: info.law_id || "",
    title: rev.law_title || "",
    type_label: TYPE_LABEL[info.law_type] || info.law_type || "",
    law_num: info.law_num || "",
    enforcement_date: rev.amendment_enforcement_date || "",
    repealed: Boolean(rev.repeal_status && rev.repeal_status !== "None"),
  };
}

const TYPE_LABEL = {
  Constitution: "憲法",
  Act: "法律",
  CabinetOrder: "政令",
  ImperialOrder: "勅令",
  MinisterialOrdinance: "府省令",
  Rule: "規則",
  Misc: "その他",
};

export function describeFetchFailure(err) {
  const msg = String(err?.message || err);
  if (/Failed to fetch|NetworkError|CORS/i.test(msg)) {
    return "ブラウザから e-Gov 法令API に届きませんでした（CORS）。npm run dev の開発サーバで開いてください。";
  }
  return msg;
}
