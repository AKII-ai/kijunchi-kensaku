"""API に無い出典（sources/saved/ に保存したページ）を読む道具。

  python tools/sources.py read    保存したページから項目と文言を抜き、sources/read/{名前}.json に書く
  python tools/sources.py check   URL を開き、前回保存したページと比べる（docs/出典を足す.md「更新の確かめ方」）

正本は保存したページ。sources/read/ の JSON は、このスクリプトが毎回作り直す写しで、手で直さない。
どの出典をどう読むかは、sources/notes/{名前}.md の次の行で決める（数値はメモに書かない）。

  - URL:
  - 入手日:
  - 前回確認日:
  - 保存したファイル:   読むファイル（1つ目）。2つ目以降は参考として保存しているだけ
  - 読み方:            READERS の名前（html-table / pdf-table / amendment）
  - 使う表:            「n番目」と書く。html-table と pdf-table で使う
  - 項目名の列:        「n列目」
  - 基準の文言の列:    「n列目」
  - 使う見出し:        pdf-section-table で、この見出しの後の表を読む（「別紙１*」のように * で前方一致）
  - 次の見出し:        pdf-section-table で、この見出しの前までを読む（書かなければ文書の終わりまで）

PDF は PyMuPDF（pip install pymupdf）の罫線検出で表を読む。

新しい形のページを読むときは、read_xxx(path, note) を1つ書いて READERS に足す。
返すのは [{"item": 項目名, "value_raw": 基準の文言}] の並び。ほかは直さない。
"""

from __future__ import annotations

import datetime as dt
import html
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES = ROOT / "sources" / "notes"
SAVED = ROOT / "sources" / "saved"
READ = ROOT / "sources" / "read"

FIELD = re.compile(r"^-\s*(URL|入手日|前回確認日|保存したファイル|読み方|使う表|項目名の列|基準の文言の列|使う見出し|次の見出し)\s*[:：]\s*(.*)$")
NTH = re.compile(r"([0-9０-９]+)\s*(番目|列目)")


def zen2han(s: str) -> str:
    return s.translate(str.maketrans("０１２３４５６７８９", "0123456789"))


def nth(text: str, default: int = 1) -> int:
    m = NTH.search(zen2han(text or ""))
    return int(m.group(1)) if m else default


def read_note(path: Path) -> dict:
    note = {"名前": path.stem, "path": path}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = FIELD.match(line.strip())
        if m and m.group(1) not in note:
            note[m.group(1)] = m.group(2).strip()
    files = re.findall(r"`([^`]+)`", note.get("保存したファイル", ""))
    note["files"] = [ROOT / f for f in files]
    note["読み方"] = (note.get("読み方") or "").split()[0] if note.get("読み方") else ""
    return note


def clean(s: str) -> str:
    """セルの文字。改行と空白を詰める。全角・半角はそのまま残す。"""
    return re.sub(r"[\s　]+", "", html.unescape(s or ""))


# ------------------------------------------------------------------ 読み方


def read_html_table(path: Path, table_no: int, item_col: int, value_col: int) -> list[dict]:
    text = path.read_text(encoding="utf-8", errors="replace")
    tables = re.findall(r"<table.*?</table>", text, re.S)
    if len(tables) < table_no:
        raise ValueError(f"{path.name}: 表が{len(tables)}個しかない")
    rows = []
    for tr in re.findall(r"<tr.*?</tr>", tables[table_no - 1], re.S):
        cells = [clean(re.sub(r"<rt>.*?</rt>|<.*?>", "", c, flags=re.S))
                 for c in re.findall(r"<t[hd][^>]*>.*?</t[hd]>", tr, re.S)]
        rows.append(cells)
    return pick(rows, item_col, value_col)


def read_pdf_table(path: Path, table_no: int, item_col: int, value_col: int) -> list[dict]:
    """ページをまたぐ1つの表として読む。

    項目名・文言の片方が空文字の行は、ページの境目で割れた上の行の続きとしてつなぐ。
    結合セル（None）がある行は、備考など表の本体でない行なので捨てる。
    """
    import fitz  # PyMuPDF

    rows: list[list] = []
    for page in fitz.open(path):
        tabs = page.find_tables().tables
        if len(tabs) >= table_no:
            rows.extend(table_rows(page, tabs[table_no - 1]))
    return merge_rows(rows, item_col, value_col)


def table_rows(page, table) -> list[list]:
    """表の行。セルの文字からルビを除く。結合セルは None のまま残す。"""
    ruby = ruby_spans(page)
    return [
        [None if t is None else drop_ruby(clean(t), ruby, bbox) for t, bbox in zip(texts, row.cells)]
        for row, texts in zip(table.rows, table.extract())
    ]


def merge_rows(rows: list[list], item_col: int, value_col: int) -> list[dict]:
    """ページの境目で割れた行（項目名・文言の片方が空）を上の行につなぐ。結合セルの行（備考など）は捨てる。"""
    merged: list[list] = []
    for r in rows:
        if len(r) < max(item_col, value_col):
            continue
        item, value = r[item_col - 1], r[value_col - 1]
        if item is None or value is None:
            continue
        if merged and (not item or not value):
            merged[-1][item_col - 1] += item
            merged[-1][value_col - 1] += value
            continue
        merged.append(list(r))
    return pick(merged, item_col, value_col)


def heading_match(line: str, heading: str) -> bool:
    """見出しの行か。空白を除いて同じなら見出し。「別紙１*」のように * で終わるときは、その文字で始まる行。"""
    line = re.sub(r"[\s　]+", "", line)
    heading = re.sub(r"[\s　]+", "", heading)
    if heading.endswith("*"):
        return line.startswith(heading[:-1])
    return line == heading


def read_pdf_section_table(path: Path, start: str, end: str, item_col: int, value_col: int) -> list[dict]:
    """見出し start の後、見出し end（無ければ文書の終わり）の前にある表を、ページをまたいで1つの表として読む。

    1つの PDF に同じ形の表がいくつもあるとき（要監視項目の「公共用水域」と「地下水」など）に使う。
    """
    import fitz

    if not start:
        raise ValueError("「使う見出し」が書かれていない")
    rows: list[list] = []
    inside = False
    for page in fitz.open(path):
        events = []
        for b in page.get_text("dict")["blocks"]:
            for line in b.get("lines", []):
                text = "".join(sp["text"] for sp in line["spans"])
                if heading_match(text, start):
                    events.append((line["bbox"][1], "start", None))
                elif end and heading_match(text, end):
                    events.append((line["bbox"][1], "end", None))
        for t in page.find_tables().tables:
            events.append((t.bbox[1], "table", t))
        for _, kind, table in sorted(events, key=lambda e: e[0]):
            if kind == "start":
                inside = True
            elif kind == "end":
                inside = False
            elif inside:
                rows.extend(table_rows(page, table))
    return merge_rows(rows, item_col, value_col)


def ruby_spans(page) -> list[tuple]:
    """本文より小さい字（ルビ）の位置と文字。"""
    spans = [
        (s["bbox"], s["size"], s["text"].strip())
        for b in page.get_text("dict")["blocks"]
        for line in b.get("lines", [])
        for s in line["spans"]
        if s["text"].strip()
    ]
    sizes = sorted(s[1] for s in spans)
    body = sizes[len(sizes) // 2] if sizes else 0
    return [s for s in spans if s[1] < body * 0.75]


def drop_ruby(text: str, ruby: list[tuple], bbox) -> str:
    """セルの中にあるルビの字を1回ずつ取り除く。ルビは読みなので捨てる。"""
    if not bbox:
        return text
    x0, y0, x1, y1 = bbox
    for (bx0, by0, bx1, by1), _, t in ruby:
        if x0 <= (bx0 + bx1) / 2 <= x1 and y0 <= (by0 + by1) / 2 <= y1:
            text = text.replace(clean(t), "", 1)
    return text


AMEND = re.compile(r"「([^「」]+)」の別表下欄に掲げる値を(.+?)に改める")


def read_amendment(path: Path) -> list[dict]:
    """改正の概要の「「物質」の別表下欄に掲げる値を…に改める」だけを読む。"""
    import fitz

    text = "".join(page.get_text() for page in fitz.open(path))
    text = re.sub(r"[\s　]+", "", text)
    return [{"item": m.group(1), "value_raw": m.group(2)} for m in AMEND.finditer(text)]


# 見出しの行と、番号だけ残った「削除」の行は項目にしない。
HEADER = re.compile(r"^(項目|媒体|有害物質の種類|農薬名|基準値|環境上の条件|備考|削除)$")


def pick(rows: list[list[str]], item_col: int, value_col: int) -> list[dict]:
    out = []
    for r in rows:
        if len(r) < max(item_col, value_col):
            continue
        item, value = r[item_col - 1], r[value_col - 1]
        if not item or not value or HEADER.match(item):
            continue
        out.append({"item": item, "value_raw": value})
    return out


def read_one(note: dict) -> dict:
    kind = note["読み方"]
    if not note["files"]:
        raise ValueError(f"{note['名前']}: 保存したファイルが書かれていない")
    path = note["files"][0]
    reader = READERS.get(kind)
    if not reader:
        raise ValueError(f"{note['名前']}: 読み方「{kind}」は知らない（使えるのは {'、'.join(READERS)}）")
    rows = reader(path, note)
    if not rows:
        raise ValueError(f"{note['名前']}: 行が1件も取れなかった（{path.name}）")
    return {
        "name": note["名前"],
        "url": note.get("URL", ""),
        "obtained": note.get("入手日", ""),
        "checked": note.get("前回確認日", ""),
        "file": path.relative_to(ROOT).as_posix(),
        "rows": rows,
    }


def table_cols(note: dict) -> tuple[int, int, int]:
    """メモの「使う表」「項目名の列」「基準の文言の列」。書いていなければ 1番目・1列目・2列目。"""
    return nth(note.get("使う表")), nth(note.get("項目名の列")), nth(note.get("基準の文言の列"), 2)


# メモの「読み方」→ 読む関数。新しい読み方はここに1行足す。
READERS = {
    "html-table": lambda path, note: read_html_table(path, *table_cols(note)),
    "pdf-table": lambda path, note: read_pdf_table(path, *table_cols(note)),
    "amendment": lambda path, note: read_amendment(path),
    "pdf-section-table": lambda path, note: read_pdf_section_table(
        path, note.get("使う見出し", ""), note.get("次の見出し", ""), *table_cols(note)[1:]),
}


def readable_notes() -> list[dict]:
    notes = [read_note(p) for p in sorted(NOTES.glob("*.md")) if p.name != "README.md"]
    return [n for n in notes if n["読み方"]]


def cmd_read() -> int:
    READ.mkdir(parents=True, exist_ok=True)
    ok = True
    for note in readable_notes():
        try:
            data = read_one(note)
        except Exception as e:  # 1件の失敗で他を止めない
            print(f"失敗  {note['名前']}: {e}")
            ok = False
            continue
        out = READ / f"{note['名前']}.json"
        out.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"読んだ {note['名前']}: {len(data['rows'])}行 → {out.relative_to(ROOT).as_posix()}")
    return 0 if ok else 1


# ------------------------------------------------------------------ 確認


def body_of(data: bytes, suffix: str) -> str:
    """比べるための本文。HTML はタグとスクリプトを除いた文字、PDF は全ページの文字。"""
    if suffix == ".pdf":
        import fitz

        return clean("".join(p.get_text() for p in fitz.open(stream=data, filetype="pdf")))
    text = data.decode("utf-8", errors="replace")
    main = re.search(r"<main.*?</main>", text, re.S)
    text = main.group(0) if main else text
    text = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", text, flags=re.S)
    return clean(re.sub(r"<.*?>", "", text))


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "kijunchi-app source check"})
    with urllib.request.urlopen(req, timeout=30) as res:
        data = res.read()
    if not data.strip():
        raise ValueError("中身が空")
    return data


def set_field(path: Path, field: str, value: str) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    for i, line in enumerate(lines):
        if re.match(rf"^-\s*{field}\s*[:：]", line.strip()):
            lines[i] = f"- {field}: {value}"
            break
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def cmd_check() -> int:
    """結果は sources/read/_check.json。画面は「更新あり」「開けない」だけを出す。"""
    today = dt.date.today().isoformat()
    results = []
    for note in readable_notes():
        url = note.get("URL", "")
        saved = note["files"][0] if note["files"] else None
        entry = {"name": note["名前"], "url": url, "date": today}
        try:
            data = fetch(url)
            if saved and saved.exists() and body_of(data, saved.suffix) == body_of(saved.read_bytes(), saved.suffix):
                entry["result"] = "同じ"
                set_field(note["path"], "前回確認日", today)
            else:
                # 新しいページを保存し、入手日と前回確認日をその日にする。古いファイルは消さない。
                stem = re.sub(r"_\d{4}-\d{2}-\d{2}$", "", saved.stem) if saved else note["名前"]
                new = SAVED / f"{stem}_{today}{saved.suffix if saved else '.html'}"
                new.write_bytes(data)
                text = note["path"].read_text(encoding="utf-8")
                if saved:
                    text = text.replace(saved.relative_to(ROOT).as_posix(), new.relative_to(ROOT).as_posix(), 1)
                note["path"].write_text(text, encoding="utf-8")
                set_field(note["path"], "入手日", today)
                set_field(note["path"], "前回確認日", today)
                entry["result"] = "更新あり"
                entry["file"] = new.relative_to(ROOT).as_posix()
        except Exception as e:
            entry["result"] = "開けない"
            entry["reason"] = str(e)
        results.append(entry)
        print(f"{entry['result']:<4} {note['名前']}  {url}")
    READ.mkdir(parents=True, exist_ok=True)
    (READ / "_check.json").write_text(json.dumps(results, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("読み直すときは: python tools/sources.py read")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "read":
        sys.exit(cmd_read())
    if cmd == "check":
        sys.exit(cmd_check())
    print(__doc__)
    sys.exit(2)
