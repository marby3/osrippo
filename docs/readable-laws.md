# 読める法律の取り込みの大きさ

Issue #162 の基準5。全件を取り込んだときの DB の大きさと書き込んだ行数を書く（設計書 [docs/spec/162.md](spec/162.md) 決めたこと8）。

**未計測**（全件の取り込みは e-Gov に2,100回以上つなぐ長い作業なので、別に流す）。

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
