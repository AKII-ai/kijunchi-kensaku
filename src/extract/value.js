/**
 * 条文の文言から数値と単位を写す。value_raw が常に正。
 * 「検出されないこと」や「かつ」を含む文は、短い数値に置き換えない（呼び出し側で判断する）。
 */

const KANJI_DIGIT = {
  〇: "0", 一: "1", 二: "2", 三: "3", 四: "4",
  五: "5", 六: "6", 七: "7", 八: "8", 九: "9",
};
const UNIT_WORDS = { 十: 10, 百: 100, 千: 1000 };
const MULTIPLIERS = { 万: 10000, 億: 100000000 };
const NUM = "[〇一二三四五六七八九十百千万・0-9.]+";

/** 「一リットルにつき…ミリグラム」のような条文の言い回し。 */
const WORD_UNITS = [
  ["一ミリリットルにつき", "コロニー形成単位", "CFU/mL"],
  ["一リットルにつき", "ミリグラム", "mg/L"],
  ["一リットルにつき", "マイクログラム", "µg/L"],
  ["一リットルにつき", "ピコグラム", "pg/L"],
  ["一キログラムにつき", "ミリグラム", "mg/kg"],
  ["一立方メートルにつき", "ミリグラム", "mg/m3"],
  ["一グラムにつき", "ナノグラム", "ng/g"],
];

/** 条文に全角記号で書かれる単位（ｍｇ／ｌ など）。長いものを先に見る。 */
const SYMBOL_UNITS = [
  ["mg/kg", "mg/kg"],
  ["mg/m3", "mg/m3"],
  ["µg/m3", "µg/m3"],
  ["ng-teq/g", "ng-TEQ/g"],
  ["pg-teq/m3", "pg-TEQ/m3"],
  ["pg-teq/g", "pg-TEQ/g"],
  ["pg-teq/l", "pg-TEQ/L"],
  ["mg/l", "mg/L"],
  ["µg/l", "µg/L"],
  ["ng/l", "ng/L"],
  ["pg/l", "pg/L"],
  ["bq/l", "Bq/L"],
  ["bq/kg", "Bq/kg"],
  ["cfu/ml", "CFU/mL"],
  ["ppm", "ppm"],
  ["ppb", "ppb"],
  ["db", "dB"],
];

/** 全角英数記号を半角にし、μ と ℓ をまとめる。数値の漢数字は残す。 */
export function foldWide(s) {
  return String(s || "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/／/g, "/")
    .replace(/．/g, ".")
    .replace(/－/g, "-")
    .replace(/ℓ/g, "l")
    .replace(/μ/g, "µ")
    .replace(/㎎/g, "mg")
    .replace(/m³/g, "m3");
}

/** 告示の表に多い「検液1Lにつき0.01mg」「土壌1kgにつき15mg」。 */
const PER_UNITS = [
  [/1Lにつき/i, "mg/L"],
  [/1kgにつき/i, "mg/kg"],
];

function kanjiInt(s) {
  if (!s) throw new Error("empty");
  if ([...s].every((c) => c in KANJI_DIGIT)) {
    return parseInt([...s].map((c) => KANJI_DIGIT[c]).join(""), 10);
  }
  let total = 0;
  let section = 0;
  let num = 0;
  for (const c of s) {
    if (c in KANJI_DIGIT) {
      num = parseInt(KANJI_DIGIT[c], 10);
    } else if (c in UNIT_WORDS) {
      section += (num || 1) * UNIT_WORDS[c];
      num = 0;
    } else if (c in MULTIPLIERS) {
      total += (section + num || 1) * MULTIPLIERS[c];
      section = 0;
      num = 0;
    } else {
      throw new Error(c);
    }
  }
  return total + section + num;
}

export function kanjiToNumber(s) {
  const t = String(s || "").trim();
  if (!t) return null;
  if (/^[0-9]+(\.[0-9]+)?$/.test(t)) return t;
  const parts = t.split("・");
  if (parts.length > 2) return null;
  let intpart;
  try {
    intpart = kanjiInt(parts[0]);
  } catch {
    return null;
  }
  if (parts.length === 1) return String(intpart);
  const frac = [...parts[1]].map((c) => KANJI_DIGIT[c] ?? "?").join("");
  if (frac.includes("?")) return null;
  return `${intpart}.${frac}`;
}

function joinCond(...parts) {
  return parts.filter(Boolean).join("、");
}

/** [value, unit, condition] を返す。写せないときは value を空にする。 */
export function parseValue(text) {
  const t = foldWide(text).replace(/[\s　]/g, "").replace(/(\d),(?=\d{3})/g, "$1");

  for (const [prefix, unitWord, unit] of WORD_UNITS) {
    if (!t.includes(prefix)) continue;
    const m = t.match(new RegExp(
      `(${NUM})(?:（(日間平均${NUM})）)?${unitWord}(以下|未満|以上|を超える)?`,
    ));
    if (!m) continue;
    const v = kanjiToNumber(m[1]);
    if (v == null) continue;
    const conds = [];
    if (m[2]) {
      const avg = kanjiToNumber(m[2].replace("日間平均", ""));
      conds.push(`日間平均${avg || m[2]}`);
    }
    if (m[3] && m[3] !== "以下") conds.push(m[3]);
    return [v, unit, conds.join("、")];
  }

  // 文の中で最初に出てくる「…につき」を使う（土壌のカドミウムは検液の値が先、米の値が後）。
  let per = null;
  for (const [prefix, unit] of PER_UNITS) {
    const m = t.match(new RegExp(`${prefix.source}([0-9.]+)mg(以下|未満|以上|を超える)?`, "i"));
    if (m && (!per || m.index < per.m.index)) per = { m, unit };
  }
  if (per) {
    const suffix = per.m[2] && per.m[2] !== "以下" ? per.m[2] : "";
    return [per.m[1], per.unit, suffix];
  }

  const lower = t.toLowerCase();
  for (const [needle, unit] of SYMBOL_UNITS) {
    const at = lower.indexOf(needle);
    if (at < 0) continue;
    const m = t.slice(0, at).match(new RegExp(`(${NUM})$`));
    if (!m) continue;
    const v = kanjiToNumber(m[1]);
    if (v == null) continue;
    const tail = t.slice(at + needle.length);
    const suffix = (tail.match(/^(以下|未満|以上|を超える)/) || [])[1] || "";
    return [v, unit, suffix && suffix !== "以下" ? suffix : ""];
  }

  if (t.includes("検出されないこと")) return ["ND", "", ""];

  let m = t.match(new RegExp(`(${NUM})以上(${NUM})以下`));
  if (m) {
    const lo = kanjiToNumber(m[1]);
    const hi = kanjiToNumber(m[2]);
    if (lo && hi) return [`${lo}-${hi}`, "", "範囲"];
  }
  m = t.match(new RegExp(`(${NUM})を超え(${NUM})未満`));
  if (m) {
    const lo = kanjiToNumber(m[1]);
    const hi = kanjiToNumber(m[2]);
    if (lo && hi) return [`${lo}-${hi}`, "", "範囲（超え・未満）"];
  }
  m = t.match(new RegExp(`^(日間平均)?(${NUM})(?:（(.+)）)?$`));
  if (m) {
    const v = kanjiToNumber(m[2]);
    if (v) return [v, "", joinCond(m[1], m[3])];
  }
  return ["", "", ""];
}
