/** 法令JSONの木をたどる。ルビ（Rt）は読みなので捨てる。 */

export function* findAll(node, tag) {
  if (Array.isArray(node)) {
    for (const child of node) yield* findAll(child, tag);
    return;
  }
  if (node && typeof node === "object") {
    if (node.tag === tag) yield node;
    for (const child of node.children || []) yield* findAll(child, tag);
  }
}

export function nodeText(node) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node && typeof node === "object") {
    if (node.tag === "Rt") return "";
    return (node.children || []).map(nodeText).join("");
  }
  return "";
}

export function firstText(node, tag) {
  for (const hit of findAll(node, tag)) return nodeText(hit).trim();
  return "";
}

/** 直下の子のうち、tags のどれでもない部分の文字（条の「本文」を取るのに使う）。 */
export function textExcluding(node, tags) {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map((c) => textExcluding(c, tags)).join("");
  if (node && typeof node === "object") {
    if (node.tag === "Rt" || tags.includes(node.tag)) return "";
    return (node.children || []).map((c) => textExcluding(c, tags)).join("");
  }
  return "";
}
