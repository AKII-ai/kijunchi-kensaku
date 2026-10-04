/** unit_hints.txt の読み方。語の一覧はプログラムに持たない。 */

function foldUnitTerm(s) {
  return String(s)
    .replace(/／/g, "/")
    .replace(/ℓ/g, "l")
    .replace(/μ/g, "µ")
    .replace(/m³/g, "m3");
}

/** 1行1語。空行と # の行は読み飛ばす。 */
export function parseUnitHintSource(text) {
  const terms = [];
  const seen = new Set();
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const key = foldUnitTerm(t).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(t);
  }
  return terms;
}

export function compileUnitHint(terms) {
  const parts = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => foldUnitTerm(t)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/µ/g, "(?:µ|μ)")
      .replace(/\//g, "[/／]"));
  if (!parts.length) return { test: () => false };
  return new RegExp(parts.join("|"), "i");
}

export function unitHintFromText(text) {
  return compileUnitHint(parseUnitHintSource(text));
}
