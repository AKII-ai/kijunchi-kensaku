/**
 * 画面。検索、主要基準一覧、「よく使うもの」、選んだ法令の表。
 * API の URL の組み立ては src/api/、抜き出しは src/extract/ にある。
 */

import { describeFetchFailure, fetchLawData, fetchRevisions, lawCard, searchLaws } from "../api/egov.js";
import { extractRecords, formatValue, groupByEra } from "../extract/extract.js";
import { getLayout } from "../extract/layout.js";
import { buildMatrixEras } from "../extract/matrix.js";
import { buildSummary, CHECKS } from "../summary/summary.js";
import { downloadLaw, downloadSummary } from "../export/download.js";
import { FEATURED } from "./featured.js";

const els = {
  form: document.querySelector("#search-form"),
  input: document.querySelector("#q"),
  status: document.querySelector("#status"),
  nav: document.querySelector("#view-nav"),
  summary: document.querySelector("#summary"),
  featured: document.querySelector("#featured"),
  results: document.querySelector("#results"),
  detail: document.querySelector("#detail"),
};

let searchToken = 0;
let loadToken = 0;
let featuredReady = false;
let summaryLoad = null;
let lastSummary = null; // ダウンロード用。画面に出している主要基準一覧
let currentDetail = null; // ダウンロード用。画面に出している法令の表
let lastSearch = { query: "", laws: [] };
const standardsCache = new Map();

function setStatus(text, kind = "") {
  els.status.textContent = text;
  els.status.dataset.kind = kind;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 変更前の文言は、そのセルの中に赤いかっこで書く。欄外には書かない。 */
function changeFrom(note) {
  return note ? `<span class="change-from">（${esc(note)}）</span>` : "";
}

// ---------------------------------------------------------------- 法令カード

function renderCard(law) {
  const repealed = Boolean(law.repealed);
  const has = law.hasStandards === true;
  return `
    <button type="button"
      class="law-card${repealed ? " is-repealed" : ""}${has ? " has-standards" : ""}"
      data-law-id="${esc(law.law_id)}" data-title="${esc(law.title)}">
      <span>
        <span class="law-card__title">${esc(law.title)}</span>
        <span class="law-card__meta">
          <span class="pill">${esc(law.type_label)}</span>
          ${law.law_num ? `<span>${esc(law.law_num)}</span>` : ""}
          ${law.enforcement_date ? `<span>施行 ${esc(law.enforcement_date)}</span>` : ""}
          ${repealed ? `<span class="pill pill--warn">廃止等</span>` : ""}
          ${has ? `<span class="pill pill--ok">基準値あり</span>` : ""}
        </span>
      </span>
      <span class="law-card__id">${esc(law.law_id)}</span>
    </button>`;
}

function bindCards(root) {
  root.querySelectorAll("[data-law-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectLaw(btn.dataset.lawId, btn.dataset.title));
  });
}

function applyStandardsMark(lawId, has) {
  const law = lastSearch.laws.find((item) => item.law_id === lawId);
  if (law) law.hasStandards = has;
  document.querySelectorAll(`[data-law-id="${CSS.escape(lawId)}"]`).forEach((btn) => {
    if (!btn.classList.contains("law-card")) return;
    btn.classList.toggle("has-standards", has);
    const meta = btn.querySelector(".law-card__meta");
    if (has && meta && !meta.querySelector(".pill--ok")) {
      meta.insertAdjacentHTML("beforeend", `<span class="pill pill--ok">基準値あり</span>`);
    }
  });
}

/** 抜き出しで行が1件以上取れたカードを緑にする。 */
async function markStandards(laws, token = null) {
  const alive = () => token == null || token === searchToken;
  const pending = laws.filter((law) => law.hasStandards == null);
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length && alive()) {
      const law = pending[cursor];
      cursor += 1;
      try {
        let has = standardsCache.get(law.law_id);
        if (has == null) {
          has = extractRecords(await fetchLawData(law.law_id)).length > 0;
          standardsCache.set(law.law_id, has);
        }
        if (alive()) applyStandardsMark(law.law_id, has);
      } catch {
        /* 判定できない法令には色を付けない */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker));
}

// ------------------------------------------------------------ 最初の画面

/**
 * 画面の上に固定する移動ボタン。最初の画面では出さない。
 * 検索結果: 主要基準一覧へ。法令の表: 法令一覧（検索結果）へ戻る＋主要基準一覧へ。
 */
function setNav(view) {
  if (view === "home") {
    els.nav.hidden = true;
    els.nav.innerHTML = "";
    return;
  }
  const home = (primary) => `<button type="button" class="nav-btn${primary ? " nav-btn--primary" : ""}" data-home>${
    primary ? "← " : ""}主要基準一覧${primary ? "に戻る" : ""}</button>`;
  if (view === "search") {
    els.nav.innerHTML = home(true);
  } else if (lastSearch.query) {
    els.nav.innerHTML = `<button type="button" class="nav-btn nav-btn--primary" data-back>← 法令一覧に戻る</button>
      <span class="nav-hint">「${esc(lastSearch.query)}」の検索結果</span>${home(false)}`;
  } else {
    els.nav.innerHTML = home(true);
  }
  els.nav.hidden = false;
}

function clearHash() {
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
}

/** 主要基準一覧（最初の画面）に戻る。検索は終わりにする。 */
function goHome() {
  ++searchToken;
  ++loadToken;
  clearHash();
  lastSearch = { query: "", laws: [] };
  els.input.value = "";
  loadFeatured();
  window.scrollTo({ top: 0 });
}

function showHome() {
  setNav("home");
  els.summary.hidden = false;
  refitSummaryColumns();
  els.featured.hidden = false;
  els.results.hidden = true;
  els.results.innerHTML = "";
  els.detail.hidden = true;
  els.detail.innerHTML = "";
  setStatus("");
}

async function loadFeatured() {
  void loadSummary();
  if (featuredReady) {
    showHome();
    return;
  }
  els.featured.hidden = false;
  els.featured.innerHTML = `<p class="progress">よく使う法令を読み込んでいます…</p>`;
  const seeds = FEATURED.flatMap((g) => g.laws);
  const cards = await Promise.all(seeds.map(async (seed) => {
    try {
      const json = await searchLaws({ law_id: seed.law_id, limit: 5 });
      const hit = (json.laws || []).find((e) => e.law_info?.law_id === seed.law_id);
      if (hit) return { ...lawCard(hit), hasStandards: standardsCache.get(seed.law_id) ?? null };
    } catch {
      /* 取れなければ featured.js の法令名と種別だけで出す */
    }
    return { ...seed, hasStandards: standardsCache.get(seed.law_id) ?? null };
  }));
  const byId = new Map(cards.map((c) => [c.law_id, c]));
  els.featured.innerHTML = `
    <h2 class="featured__heading">よく使うもの</h2>
    <p class="featured__lead">検索対象を狭めるものではありません。入口です。</p>
    ${FEATURED.map((group) => `
      <section class="featured__group">
        <h3>${esc(group.name)}</h3>
        <div class="results">
          ${group.laws.map((seed) => renderCard(byId.get(seed.law_id) || seed)).join("")}
        </div>
      </section>`).join("")}`;
  bindCards(els.featured);
  featuredReady = true;
  showHome();
  void markStandards(cards);
}

// ------------------------------------------------------------ 主要基準一覧

/** 最初の画面の一番上。物質×基準の1枚の表。法令は API の現行版、告示は保存したページの読み取り結果。 */
function loadSummary() {
  if (summaryLoad) return summaryLoad;
  els.summary.innerHTML = `
    <h2 class="summary__heading" id="summary-heading">主要基準一覧</h2>
    <p class="progress">法令の現行版を取得しています… <span id="summary-progress"></span></p>`;
  summaryLoad = buildSummary({
    onProgress: (done, total) => {
      const label = document.querySelector("#summary-progress");
      if (label) label.textContent = `${done} / ${total}`;
    },
  }).then(renderSummary).catch((err) => {
    summaryLoad = null;
    els.summary.innerHTML = `
      <h2 class="summary__heading" id="summary-heading">主要基準一覧</h2>
      <p class="status status--error">${esc(describeFetchFailure(err))}</p>`;
  });
  return summaryLoad;
}

function summaryCell(cell, noteNo) {
  if (cell.failed) return `<td class="is-missing">取得できず</td>`;
  if (cell.missing) {
    return `<td class="is-missing" title="${esc(`${cell.from} に「${cell.item}」が見つかりません`)}">出典に見つからない</td>`;
  }
  if (!cell.text) return `<td class="is-empty">―</td>`;
  const text = cell.text.length > 14 ? `<span class="long">${esc(cell.text)}</span>` : esc(cell.text);
  const from = cell.item ? `${cell.from}「${cell.item}」` : cell.from;
  const mark = noteNo ? `<span class="note-mark" title="${esc(cell.note)}">※${noteNo}</span>` : "";
  return `<td title="${esc(from)}">${text}${mark}</td>`;
}

function renderSummary(summary) {
  lastSummary = summary;
  const { columns, rows, laws, sources, problems } = summary;
  const notes = [];
  let group = "";
  const body = rows.map((r) => {
    const head = r.group !== group
      ? `<tr class="group-row"><th colspan="${columns.length + 1}"><span>${esc(r.group)}</span></th></tr>`
      : "";
    group = r.group;
    const cells = r.cells.map((cell, i) => {
      if (!cell.note || cell.missing) return summaryCell(cell, 0);
      notes.push({ row: r.name, column: columns[i].name, text: cell.note });
      return summaryCell(cell, notes.length);
    });
    return `${head}<tr><th class="col-name" scope="row">${esc(r.name)}</th>${cells.join("")}</tr>`;
  }).join("");

  // 出典の確認結果（python tools/sources.py check）。「同じ」は出さない。
  const alerts = [
    ...CHECKS.filter((c) => c.result === "開けない").map((c) => `<li class="is-error">${
      esc(c.name)}: ${esc(c.url)} を開けませんでした（${esc(c.date)}）。</li>`),
    ...CHECKS.filter((c) => c.result === "更新あり").map((c) => `<li>${
      esc(c.name)}: 前回保存したページと違います（${esc(c.date)}）。</li>`),
    ...problems.filter((p) => p.kind === "law").map((p) => `<li class="is-error">${
      esc(p.title)}（${esc(p.id)}）を e-Gov 法令API から取得できませんでした。</li>`),
  ];
  const missing = problems.filter((p) => p.kind === "item").length;
  if (missing) {
    alerts.push(`<li class="is-error">出典に見つからない組合せが ${missing} か所あります（src/summary/rows.md の呼び方を確認してください）。</li>`);
  }

  els.summary.innerHTML = `
    <h2 class="summary__heading" id="summary-heading">主要基準一覧</h2>
    <div class="summary__tools">
      <button type="button" class="summary__reset" data-reset-widths>列幅を戻す</button>
      <button type="button" class="download-btn" data-download="summary">ダウンロード（Excel・Markdown／zip）</button>
    </div>
    ${alerts.length ? `<ul class="summary__alerts">${alerts.join("")}</ul>` : ""}
    <div class="table-wrap"><div class="table-scroll">
      <table class="summary-table">
        ${colGroup(columns.length + 1)}
        <thead><tr>
          <th class="col-name">物質名</th>
          ${columns.map((c) => `<th>${esc(c.name)}<span class="unit">${esc(c.unit)}</span></th>`).join("")}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div></div>
    ${notes.length ? `
      <h3 class="summary__sub">※ 条件付きの基準（文言のまま）</h3>
      <ol class="summary__notes">${notes.map((n) => `<li>${esc(n.row)}／${esc(n.column)}: ${esc(n.text)}</li>`).join("")}</ol>` : ""}
    <h3 class="summary__sub">出典</h3>
    <ul class="summary__sources">
      ${laws.map((l) => `<li><button type="button" data-law-id="${esc(l.id)}" data-title="${esc(l.title)}">${
    esc(l.title)}</button>（e-Gov ${esc(l.id)}、${esc(l.enforcement_date)} 施行の現行版）${l.use ? `… ${esc(l.use)}` : ""}</li>`).join("")}
      ${sources.map((src) => `<li>${esc(src.name)}（環境省、入手日 ${esc(src.obtained)}）… <a href="${
    esc(src.url)}" target="_blank" rel="noopener">${esc(src.url)}</a></li>`).join("")}
    </ul>
    <p class="summary__lead">地下浸透は平成元年環境庁告示第39号の備考欄の値です。環境省掲載の全文は平成24年改正までのため、令和6年改正（六価クロム化合物）を改正の概要から上書きしています。</p>`;
  els.summary.querySelectorAll("[data-law-id]").forEach((btn) => {
    btn.addEventListener("click", () => selectLaw(btn.dataset.lawId, btn.dataset.title));
  });
  setupSummaryColumns();
}

// ------------------------------------------- 主要基準一覧の列幅（ドラッグで変える）

// 列幅は、見ている人のブラウザにだけ覚える（画面の大きさは人と端末で違うため）。
const WIDTHS_KEY = "kijunchi.summary.colWidths";
const MIN_COL_PX = 44;
let summaryCols = null;

function loadWidths(count) {
  try {
    const saved = JSON.parse(localStorage.getItem(WIDTHS_KEY) || "null");
    return Array.isArray(saved) && saved.length === count ? saved : null;
  } catch {
    return null;
  }
}

function saveWidths(widths) {
  try {
    if (widths) localStorage.setItem(WIDTHS_KEY, JSON.stringify(widths));
    else localStorage.removeItem(WIDTHS_KEY);
  } catch {
    /* 覚えられなくても表は使える */
  }
}

/**
 * 最初の幅。中身に合わせて測り、画面の幅で上限をかける（長い物質名で1列が画面を占めないように）。
 * 表が隠れているときは測れないので、見えたときに測り直す。
 */
function measureNatural(table) {
  table.classList.remove("is-fixed");
  table.style.width = "";
  table.querySelectorAll("col").forEach((col) => { col.style.width = ""; });
  const view = els.summary.clientWidth || window.innerWidth;
  const nameMax = Math.max(96, Math.min(220, Math.round(view * 0.32)));
  const colMax = Math.max(72, Math.min(200, Math.round(view * 0.25)));
  return [...table.tHead.rows[0].cells].map((th, i) => {
    const w = Math.ceil(th.getBoundingClientRect().width);
    return w ? Math.min(w, i === 0 ? nameMax : colMax) : 0;
  });
}

function applyWidths(table, widths) {
  const cols = table.querySelectorAll("col");
  widths.forEach((w, i) => { if (cols[i]) cols[i].style.width = `${w}px`; });
  table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
  table.classList.add("is-fixed");
}

/**
 * 画面の幅に収まるよう、列を縮める。物質名は 110px、ほかの列は 60px より狭くしない。
 * それでも収まらない（スマホなど）ときは縮めず、横にスクロールさせる。
 */
function fitToWidth(widths) {
  const avail = (els.summary.querySelector(".table-scroll")?.clientWidth || 0) - 2;
  const total = widths.reduce((a, b) => a + b, 0);
  if (avail <= 0 || total <= avail) return widths;
  const mins = widths.map((w, i) => Math.min(w, i === 0 ? 110 : 60));
  const minTotal = mins.reduce((a, b) => a + b, 0);
  if (minTotal > avail) return widths;
  const ratio = (total - avail) / (total - minTotal);
  const fitted = widths.map((w, i) => Math.floor(w - (w - mins[i]) * ratio));
  return fitted;
}

/** 表が枠に収まっているかで、横スクロールの有無を切り替える。 */
function updateSummaryOverflow() {
  const scroll = els.summary.querySelector(".table-scroll");
  const table = summaryCols?.table;
  if (!scroll || !table) return;
  scroll.classList.toggle("fits", table.getBoundingClientRect().width <= scroll.clientWidth + 1);
}

function setupSummaryColumns() {
  const table = els.summary.querySelector("table.summary-table");
  if (!table) return;
  els.summary.querySelector(".table-scroll")?.classList.remove("fits");
  const ths = [...table.tHead.rows[0].cells];
  const measured = measureNatural(table);
  if (measured.every((w) => w === 0)) {
    summaryCols = { table, natural: null, widths: null };
    return;
  }
  // 「元の幅」は、画面の幅に合わせたあとの幅。
  const natural = fitToWidth(measured);
  const widths = loadWidths(ths.length) || natural.slice();
  summaryCols = { table, natural, widths };
  applyWidths(table, widths);
  updateSummaryOverflow();
  ths.forEach((th, i) => {
    const grip = document.createElement("span");
    grip.className = "col-grip";
    grip.dataset.col = String(i);
    grip.title = "ドラッグで列の幅を変える（ダブルクリックで元の幅）";
    th.appendChild(grip);
  });
}

/** 一覧に戻ったとき、表が隠れていて測れなかった場合だけ測り直す。 */
function refitSummaryColumns() {
  if (summaryCols && !summaryCols.natural && !els.summary.hidden) {
    els.summary.querySelectorAll(".col-grip").forEach((g) => g.remove());
    setupSummaryColumns();
  }
}

function bindSummaryResize() {
  els.summary.addEventListener("pointerdown", (e) => {
    const grip = e.target.closest?.(".col-grip");
    if (!grip || !summaryCols?.widths || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    const i = Number(grip.dataset.col);
    const startX = e.clientX;
    const start = summaryCols.widths[i];
    grip.classList.add("is-active");
    grip.setPointerCapture?.(e.pointerId);
    const move = (ev) => {
      summaryCols.widths[i] = Math.max(MIN_COL_PX, Math.round(start + ev.clientX - startX));
      applyWidths(summaryCols.table, summaryCols.widths);
      updateSummaryOverflow();
    };
    const end = () => {
      grip.classList.remove("is-active");
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", end);
      grip.removeEventListener("pointercancel", end);
      saveWidths(summaryCols.widths);
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", end);
    grip.addEventListener("pointercancel", end);
  });
  els.summary.addEventListener("dblclick", (e) => {
    const grip = e.target.closest?.(".col-grip");
    if (!grip || !summaryCols?.natural) return;
    const i = Number(grip.dataset.col);
    summaryCols.widths[i] = summaryCols.natural[i];
    applyWidths(summaryCols.table, summaryCols.widths);
    updateSummaryOverflow();
    saveWidths(summaryCols.widths);
  });
  els.summary.addEventListener("click", (e) => {
    if (!e.target.closest?.("[data-reset-widths]") || !summaryCols) return;
    saveWidths(null);
    els.summary.querySelectorAll(".col-grip").forEach((g) => g.remove());
    setupSummaryColumns();
  });
  // 窓の大きさが変わったら、幅を自分で変えていない人だけ、画面の幅に合わせ直す。
  let timer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!summaryCols?.table || els.summary.hidden) return;
      if (loadWidths(summaryCols.widths?.length || 0)) {
        updateSummaryOverflow();
        return;
      }
      els.summary.querySelectorAll(".col-grip").forEach((g) => g.remove());
      setupSummaryColumns();
    }, 150);
  });
}

// ---------------------------------------------------------------- 検索

function paintSearchResults(laws) {
  setNav("search");
  els.summary.hidden = true;
  els.featured.hidden = true;
  els.results.hidden = false;
  els.results.innerHTML = laws.map(renderCard).join("");
  bindCards(els.results);
  const green = laws.filter((l) => l.hasStandards === true).length;
  setStatus(green
    ? `${laws.length}件。基準値がある法令は緑色です（${green}件）。`
    : `${laws.length}件。基準値の有無を確認しています…`);
}

async function runSearch(raw) {
  const q = String(raw || "").trim();
  const token = ++searchToken;
  if (!q) {
    lastSearch = { query: "", laws: [] };
    await loadFeatured();
    return;
  }
  setNav("search");
  els.summary.hidden = true;
  els.featured.hidden = true;
  els.results.hidden = false;
  els.results.innerHTML = "";
  els.detail.hidden = true;
  els.detail.innerHTML = "";
  setStatus("検索しています…");
  try {
    const json = await searchLaws({ title: q });
    if (token !== searchToken) return;
    const laws = (json.laws || []).map((entry) => ({
      ...lawCard(entry),
      hasStandards: standardsCache.get(entry.law_info?.law_id) ?? null,
    }));
    lastSearch = { query: q, laws };
    if (!laws.length) {
      setStatus("近い法令が見つかりませんでした。告示は e-Gov 法令API にないので、検索結果には出ません。");
      return;
    }
    paintSearchResults(laws);
    await markStandards(laws, token);
    if (token === searchToken && els.detail.hidden) paintSearchStatus();
  } catch (err) {
    if (token === searchToken) setStatus(describeFetchFailure(err), "error");
  }
}

function paintSearchStatus() {
  const laws = lastSearch.laws;
  const green = laws.filter((l) => l.hasStandards === true).length;
  setStatus(green
    ? `${laws.length}件。基準値がある法令は緑色です（${green}件）。`
    : `${laws.length}件。基準値は見つかりませんでした。`);
}

/** 法令を1件選んだら、ほかのカードは消す。 */
function isolateSelected(lawId, title) {
  els.summary.hidden = true;
  els.featured.hidden = true;
  els.results.hidden = false;
  const source = document.querySelector(`.law-card[data-law-id="${CSS.escape(lawId)}"]`);
  const clone = source?.cloneNode(true);
  els.results.innerHTML = clone
    ? ""
    : renderCard({ law_id: lawId, title: title || lawId, type_label: "" });
  if (clone) {
    clone.hidden = false;
    clone.disabled = true;
    clone.classList.add("is-selected");
    els.results.appendChild(clone);
  } else {
    const btn = els.results.querySelector("[data-law-id]");
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-selected");
    }
  }
}

/** 戻ると、検索していたときはその結果を残す。検索していなければ「よく使うもの」に戻す。 */
function goBack() {
  els.detail.hidden = true;
  els.detail.innerHTML = "";
  if (lastSearch.query) {
    els.input.value = lastSearch.query;
    paintSearchResults(lastSearch.laws);
    paintSearchStatus();
    window.scrollTo({ top: 0 });
    return;
  }
  els.input.value = "";
  loadFeatured();
  window.scrollTo({ top: 0 });
}

// ------------------------------------------------------------ 選んだあと

async function selectLaw(lawId, title = "") {
  const token = ++loadToken;
  const next = `#/law/${encodeURIComponent(lawId)}`;
  if (location.hash !== next) history.replaceState(null, "", next);
  isolateSelected(lawId, title);
  setNav("detail");
  els.detail.hidden = false;
  setStatus(`「${title || lawId}」の条文を取得しています…`);
  els.detail.innerHTML = `
    <section class="panel panel--loading">
      <p class="progress-kicker">選択した法令</p>
      <h2 class="progress-title">${esc(title || lawId)}</h2>
      <p class="progress">条文を取得しています… <span id="progress-label">版の一覧を確認中</span></p>
    </section>`;
  window.scrollTo({ top: 0, behavior: "smooth" });
  try {
    const revisions = await fetchRevisions(lawId);
    if (token !== loadToken) return;
    const usable = revisions.filter((rv) => rv.amendment_enforcement_date && rv.law_revision_id);
    if (!usable.length) {
      const current = await fetchLawData(lawId);
      if (token !== loadToken) return;
      renderDetail(current.revision_info?.law_title || title, lawId, [current]);
      return;
    }
    const bodies = [];
    for (let i = 0; i < usable.length; i += 1) {
      if (token !== loadToken) return;
      const label = document.querySelector("#progress-label");
      if (label) label.textContent = `${i + 1} / ${usable.length} 版を取得中`;
      bodies.push(await fetchLawData(usable[i].law_revision_id));
    }
    if (token !== loadToken) return;
    renderDetail(bodies[0]?.revision_info?.law_title || title, lawId, bodies);
  } catch (err) {
    if (token !== loadToken) return;
    els.detail.innerHTML = `
        <section class="panel"><p class="status status--error">${esc(describeFetchFailure(err))}</p></section>`;
  }
}

/** 上の移動ボタンと、左上のアプリ名。 */
function bindNav() {
  document.addEventListener("click", (e) => {
    const home = e.target.closest?.("[data-home]");
    if (home) {
      e.preventDefault();
      goHome();
      return;
    }
    if (e.target.closest?.("#view-nav [data-back]")) {
      clearHash();
      goBack();
      return;
    }
    const dl = e.target.closest?.("[data-download]");
    if (dl) runDownload(dl);
  });
}

/** Excel と Markdown を作って zip で保存する。作っている間はボタンを押せなくする。 */
async function runDownload(btn) {
  if (btn.disabled) return;
  const kind = btn.dataset.download;
  if (kind === "law" && !currentDetail) return;
  if (kind === "summary" && !lastSummary) return;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "作成中…";
  try {
    if (kind === "law") await downloadLaw(currentDetail, { annotate: btn.dataset.annotate !== "0" });
    else await downloadSummary(lastSummary, CHECKS);
  } catch (err) {
    setStatus(`ダウンロードを作れませんでした: ${String(err?.message || err)}`, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

function renderDetail(title, lawId, bodies) {
  const rows = bodies.flatMap(extractRecords);
  standardsCache.set(lawId, rows.length > 0);
  applyStandardsMark(lawId, rows.length > 0);

  currentDetail = null;
  // 行が1件も取れないときは、その旨を出す。空の表は作らない。
  if (!rows.length) {
    setStatus("この法令から基準値の行は取れませんでした。");
    els.detail.innerHTML = `
        <section class="panel">
        <header class="detail-head">
          <h2>${esc(title)}</h2>
          <p class="detail-meta">法令ID ${esc(lawId)}</p>
        </header>
        <p class="empty-lead">この法令から基準値の行は取れませんでした。</p>
        <p class="status">別表、号列記、条文の中の表、地の文のどれにも基準がありません。告示・条例は e-Gov 法令API の対象外です。</p>
      </section>`;
    return;
  }

  const layout = getLayout(lawId);
  const matrix = layout ? buildMatrixEras(rows, layout) : null;
  const vertical = matrix ? null : groupByEra(rows);
  const dates = matrix ? matrix.dates : vertical.dates;
  const eras = matrix ? matrix.eras : vertical.eras;
  const count = matrix
    ? `${eras[0]?.body.length ?? 0}物質`
    : `${eras[0]?.rows.length ?? 0}行`;
  setStatus(`${count}（収録 ${dates.length}版）`);
  const range = dates.length ? `${dates[0]} 〜 ${dates[dates.length - 1]}` : "—";
  currentDetail = { title, lawId, isMatrix: Boolean(matrix), eras };

  els.detail.innerHTML = `
    <section class="panel">
      <header class="detail-head">
        <h2>${esc(title)}</h2>
        <p class="detail-meta">
          法令ID ${esc(lawId)}　／　出典 e-Gov 法令API　／
          収録 ${dates.length}版（${esc(range)} 施行）。これより古い版は API にありません。
        </p>
        <p class="detail-tools">
          <span class="detail-tools__label">ダウンロード（Excel・Markdown／zip）</span>
          <button type="button" class="download-btn" data-download="law" data-annotate="1">変更コメントあり</button>
          <button type="button" class="download-btn" data-download="law" data-annotate="0">コメントなし</button>
          <span>Excel は施行期間ごとのシート、Markdown は施行期間ごとのファイル。新しい期間が先です。
            「コメントなし」は変更の印と、その期間に無くなった行を入れません。</span>
        </p>
      </header>
      ${eras.map(matrix ? renderMatrixEra : renderEra).join("")}
      <footer class="notes">
        <p>薄い黄色は、1つ前の収録版と項目または基準の文言が違うところです。変更前は同じセルの赤いかっこ書きです。打ち消し線の行はこの版で廃止されたものです。${
    matrix ? "該当しない組合せは－。" : ""}</p>
        <p>基準は条文の文言そのままです。告示・条例の上乗せ基準は含みません。列の境目をドラッグすると、その列の幅が変わります。</p>
      </footer>
    </section>`;
  colShares = null;
  layoutColumns();
}

// -------------------------------------------------------------- 法令ごとの表

/** 並びファイルが無い法令は、抜いた順の縦の表。 */
function renderEra(era) {
  return `
    <article class="era">
      <h3>施行 ${esc(era.start)} 〜 ${esc(era.end)}</h3>
      <div class="table-wrap"><div class="table-scroll">
        <table>
          ${colGroup(4)}
          <thead><tr><th>表または条</th><th>項目</th><th>条件</th><th>基準値</th></tr></thead>
          <tbody>
            ${era.rows.map((r) => {
    const removed = r.mark === "removed";
    const changed = r.mark === "changed";
    return `<tr class="${removed ? "is-removed" : ""}">
                <td>${esc(r.table)}</td>
                <td class="${changed ? "is-changed" : ""}">${esc(r.item_raw)}</td>
                <td>${esc(r.condition)}</td>
                <td class="${changed ? "is-changed" : ""}">${esc(formatValue(r))}${
      removed ? "" : changeFrom(r.changeNote)}</td>
              </tr>`;
  }).join("")}
          </tbody>
        </table>
      </div></div>
    </article>`;
}

/** 並びファイルがある法令は、物質×基準の横並び。 */
function renderMatrixEra(era) {
  const note = era.apiOrder
    ? `<p class="era-note">この版は、物質の構成が並びファイルの指定と違うため、API が返した順で出しています。</p>`
    : "";
  return `
    <article class="era">
      <h3>施行 ${esc(era.start)} 〜 ${esc(era.end)}</h3>
      <div class="table-wrap"><div class="table-scroll">
        <table class="matrix">
          ${colGroup(era.headers.length)}
          <thead><tr>${era.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>
            ${era.body.map((row) => {
    // 変わった行は、分類と物質名も黄色にする。
    const mark = row.changed.some(Boolean) ? "is-changed" : "";
    return `<tr class="${row.removed ? "is-removed" : ""}">
                <td class="${mark}">${esc(row.group)}</td>
                <td class="${mark}">${esc(row.item)}</td>
                ${row.cells.map((c, i) => `<td class="${row.changed[i] ? "is-changed" : ""}">${
      esc(c)}${row.removed ? "" : changeFrom(row.notes[i])}</td>`).join("")}
              </tr>`;
  }).join("")}
          </tbody>
        </table>
      </div></div>
      ${note}
    </article>`;
}

// --------------------------------------------------- 列の幅（ドラッグで変える）

let colShares = null;
let layingOut = false;

function colGroup(count) {
  return `<colgroup>${"<col>".repeat(count)}</colgroup>`;
}

function layoutColumns() {
  if (layingOut) return;
  const tables = [...els.detail.querySelectorAll("table")];
  if (!tables.length) {
    colShares = null;
    return;
  }
  const count = tables[0].tHead?.rows[0]?.cells.length || 0;
  if (!count) return;
  layingOut = true;
  try {
    if (!colShares || colShares.length !== count) {
      colShares = Array.from({ length: count }, () => 100 / count);
    }
    for (const table of tables) {
      const cols = table.querySelectorAll("col");
      if (cols.length !== colShares.length) continue;
      colShares.forEach((share, i) => {
        cols[i].style.width = `${share}%`;
      });
    }
    placeColHandles();
  } finally {
    layingOut = false;
  }
}

function placeColHandles() {
  els.detail.querySelectorAll(".col-resize").forEach((el) => el.remove());
  for (const table of els.detail.querySelectorAll("table")) {
    const scroll = table.closest(".table-scroll");
    const cells = table.tHead?.rows[0]?.cells;
    if (!scroll || !cells || cells.length < 2) continue;
    const scrollRect = scroll.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    for (let i = 0; i < cells.length - 1; i += 1) {
      const handle = document.createElement("div");
      handle.className = "col-resize";
      handle.dataset.col = String(i);
      handle.title = "ドラッグで列の幅を変える";
      // 横にスクロールしているときも、つまみが列の境目に来るようにする。
      handle.style.left = `${cells[i].getBoundingClientRect().right - scrollRect.left + scroll.scrollLeft - 4}px`;
      handle.style.top = `${tableRect.top - scrollRect.top + scroll.scrollTop}px`;
      handle.style.height = `${tableRect.height}px`;
      scroll.appendChild(handle);
    }
  }
}

function bindTableResize() {
  els.detail.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest?.(".col-resize");
    if (!handle || e.button !== 0) return;
    const index = Number(handle.dataset.col);
    const table = handle.closest(".table-scroll")?.querySelector("table");
    if (!table || !colShares || !Number.isInteger(index) || index >= colShares.length - 1) return;
    e.preventDefault();
    const startX = e.clientX;
    const startShares = colShares.slice();
    const width = table.getBoundingClientRect().width || 1;
    const move = (ev) => {
      const minShare = Math.min(18, (72 / width) * 100);
      let left = startShares[index] + ((ev.clientX - startX) / width) * 100;
      let right = startShares[index + 1] - ((ev.clientX - startX) / width) * 100;
      if (left < minShare) {
        right -= minShare - left;
        left = minShare;
      }
      if (right < minShare) {
        left -= minShare - right;
        right = minShare;
      }
      colShares = startShares.slice();
      colShares[index] = left;
      colShares[index + 1] = right;
      layoutColumns();
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
  window.addEventListener("resize", () => {
    if (els.detail.querySelector("table")) placeColHandles();
  });
  new MutationObserver(() => {
    if (!layingOut && els.detail.querySelector("table")) layoutColumns();
  }).observe(els.detail, { childList: true });
}

// ---------------------------------------------------------------- 起動

function hashLawId() {
  const m = location.hash.match(/^#\/law\/([^/?#]+)$/);
  return m ? decodeURIComponent(m[1]) : "";
}

export function bindApp() {
  els.form.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(els.input.value);
  });
  document.querySelector("#hints")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-q]");
    if (!btn) return;
    els.input.value = btn.dataset.q;
    runSearch(btn.dataset.q);
  });
  bindTableResize();
  bindSummaryResize();
  bindNav();
  window.addEventListener("hashchange", () => {
    const id = hashLawId();
    if (id) selectLaw(id);
    else goBack();
  });
  const initial = hashLawId();
  if (initial) selectLaw(initial);
  else loadFeatured();
}
