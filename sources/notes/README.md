整理メモはここに1出典につき1ファイル置きます。ひな形は templates/source-note.md、足し方は docs/出典を足す.md です。

アプリにつなぐ出典は、ひな形の項目に加えて次の行を書きます（`tools/sources.py` が読みます）。数値は書きません。

- 読み方: tools/sources.py の READERS にある名前（html-table ／ pdf-table ／ pdf-section-table ／ amendment）
- 使う見出し・次の見出し: pdf-section-table のときだけ
- 使う表: 「n番目」
- 項目名の列: 「n列目」
- 基準の文言の列: 「n列目」

「保存したファイル」に書いた1つ目のファイルを読みます。2つ目以降は控えです。
