# 読める法律の取り込みの大きさ

Issue #162 の基準5。全件を取り込んだときの DB の大きさと書き込んだ行数を書く（設計書 [docs/spec/162.md](spec/162.md) 決めたこと8）。

## 結果（2026-11-13、手元の D1 に全件を取り込んだ）

| 項目 | 値 |
| --- | --- |
| 取り込んだ法律 | 2,102本（法律 2,101本と憲法 1本。未施行だけの法律は除く） |
| 条文を出せる法律 | 1,988本（本則の条がない法律は除く） |
| 本則の条がない法律 | 113本（条に分かれていない短い法律。ページは出さない。Issue を分けて扱う） |
| 条 | 98,184条 |
| 条文（`paragraphs` の JSON）の合計 | 約 43.8MB |
| いちばん大きい条 | 約 35KB（100KB の上限を超えた法律は0本） |
| 改正日のない法律（制定から改正なし） | 236本 |
| 全文検索の影の表の行 | data 25,724行、idx 22,641行、docsize 98,184行 |
| DB の大きさ | 約 270MB（`.sqlite` 255MB と、書き込み途中の WAL 15MB。遊べる法律の表と画面のテスト用の行はない状態） |
| かかった時間 | 2,971秒（約50分。1件ずつ1秒あけるため） |
| 失敗 | 0本 |

- DB の大きさは 2GB を大きく下回るので、条文の全文検索をそのまま入れる（ユーザーの決定4のとおり）
- 書き込んだ行数の目安は、表の行と影の表の行を足した約25万行。D1 の有料プランに含まれる書き込み（月5,000万行）の0.5%ほど。2回目からは変わった法律だけを入れ直すので、ふつうは週に数十本ぶん
- `amendment_law_id` があって改正日が null の法律は0本だった（設計書 決めたこと2の注意の場合は起きていない）

## 測る手順

1. 使い捨てのフォルダに、手元の D1 を作る

   ```sh
   npx wrangler d1 migrations apply DB --local --persist-to <フォルダ>
   ```

2. 取り込みを流し、かかった時間を控える（最後に「本文を読んだ法令 N 件、消した法令 N 件（N 秒）」が出る）

   ```sh
   pnpm sync:readable --persist-to <フォルダ>
   ```

3. 表ごとの行数を数える

   ```sh
   npx wrangler d1 execute DB --local --persist-to <フォルダ> --command "SELECT (SELECT count(*) FROM readable_laws) AS laws, (SELECT count(*) FROM readable_articles) AS articles, (SELECT count(*) FROM readable_search_docsize) AS search_docs, (SELECT count(*) FROM readable_search_data) AS search_data"
   ```

4. DB の大きさを見る：`<フォルダ>/v3/d1/miniflare-D1DatabaseObject/` の `.sqlite` ファイルの大きさ。2GB を超えたら、索引を見出しだけにする前に止めて相談する

5. 書き込んだ行数：取り込みは D1 の `meta.rows_written` を集めていないので、表ごとの行数（手順3）に、FTS5 の影の表（`readable_search_data`・`readable_search_idx`・`readable_search_docsize`）の行数を足したものを目安にする

6. 次の2つも確かめて書く
   - 1条の本文（`paragraphs`）が 100KB を超えて失敗した法令の有無
   - 本則の条がない法令（取り込みの最後に「本則の条がない法令：…」と出る）
