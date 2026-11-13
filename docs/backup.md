# バックアップと戻し方

D1 のバックアップの手順です（Issue #202。決めたことは #190 の決めたこと8、受入基準は #198 の「バックアップと復元試験」）。

戻し方は2つあります。

| 戻し方 | 使うとき | 戻せる範囲 |
| --- | --- | --- |
| A. D1 のタイムトラベル | 誤った操作や壊れた書き込みを、すぐ前の時点に戻す | 有料プランで30日前まで（無料プランは7日）。全文検索の索引も含めて丸ごと戻る |
| B. R2 のバックアップから新しい D1 へ | D1 そのものを失った、タイムトラベルより前に戻したい | 毎晩のバックアップ（日本時間の日付ごと）。全文検索の索引は戻したあとで作り直す |

## バックアップの仕組み

自宅サーバー（MS-R1）のバッチ `pnpm backup` が、毎晩次の順に動きます。どれかが失敗したら終了コード1で止まります。

1. **書き出し**：`wrangler d1 export --remote --compatibility sqlite3_cli_only` で D1 を丸ごと書き出す。全文検索（FTS5）の表がある D1 は、ふつうの書き出しが使えないため、sqlite3 の `.dump` と同じ形で書き出す（この形は D1 にそのまま戻せない）
2. **変換**：書き出しを手元の SQLite に入れ直し、D1 に流せる SQL にする。次の表は入れない
   - 全文検索の表（`search_trigram`・`search_bigram`・`readable_search`）と、その影の表（`_data`・`_idx`・`_content`・`_docsize`・`_config`）。戻したあとで、ほかの表から作り直す
   - マイグレーションの記録（`d1_migrations`）、D1 の内部の表（`_cf_` で始まる表）、`sqlite_` で始まる表
3. **置く**：R2 の `<バケット>/d1/<環境>/<日本時間の日付>.sql` に置く（`wrangler r2 object put`。1ファイル 315MB まで）

できた SQL は、マイグレーションを当てた**新しい D1 に流す**前提で書いてあります。

- 先頭のコメントに、作った日時、書き出したときのマイグレーション（件数と最後のファイル）、表ごとの行数がある
- 行を入れるあいだは、INSERT で動くトリガー（`stances_log_insert`）を外す。外さないと、立場（`stances`）を入れたときに立場の履歴（`stance_log`）が二重になる。行を入れたあとでトリガーを戻す
- 行は `INSERT OR REPLACE` で入れる。マイグレーションが入れた行（委員会や分野の1行目）は、バックアップの値に書き換わる
- 最後に、番号の続き（`sqlite_sequence`）を元に合わせる（消した行の番号を使い回さないように）

すでに使っている D1 には流さないでください（トリガーをいったん外し、同じ番号の行を書き換えます）。

## 1. 最初に一度だけする設定

### wrangler を上げる

書き出しの `--compatibility sqlite3_cli_only` は wrangler 4.162.0 からです。このリポジトリの wrangler がそれより古いと、`Unknown arguments: compatibility` で止まります（`npx wrangler --version` で確かめる）。

### R2 のバケットを作る

1. バケットを作る（名前の案：`osrippo-backup`）。公開の設定（r2.dev の URL、カスタムドメイン）は付けない。利用者のメールアドレスなどが入っているため

   ```sh
   npx wrangler r2 bucket create osrippo-backup
   ```

2. 古いバックアップを消す期間は**まだ決めていません**。決めたら、Cloudflare の画面の R2 → バケット → Settings → Object lifecycle rules で、`d1/` の下を N 日で消す規則を足す

### API トークンを作る

自宅サーバーの wrangler が使うトークンです。

1. Cloudflare の画面の My Profile → API Tokens → Create Token → Custom token で、次の権限を付ける
   - Account / D1 / Edit（書き出しに使う）
   - Account / Workers R2 Storage / Edit（置くのに使う）
2. アカウント ID を控える（Cloudflare の画面の Workers & Pages の右側にある）
3. 自宅サーバーで、本人だけが読めるファイルに置く。値はシェルの履歴に残らないよう、画面に出さずに入力する（`read` のあとで値を貼り、Enter を押す）

   ```sh
   install -m 600 /dev/null ~/.osrippo-backup.env
   read -rs token && printf 'CLOUDFLARE_API_TOKEN=%s\n' "$token" > ~/.osrippo-backup.env && unset token
   printf 'CLOUDFLARE_ACCOUNT_ID=%s\n' '<アカウント ID>' >> ~/.osrippo-backup.env
   ```

## 2. 一度、手で流す

このリポジトリ（osrippo）を置いた場所で流します。`--env` は wrangler.jsonc の環境の名前（本番の環境の名前は本番の公開の Issue #203 で決まる）です。

```sh
set -a; . ~/.osrippo-backup.env; set +a
pnpm backup --env staging --bucket osrippo-backup
```

- 終わると「osrippo-backup/d1/staging/2026-11-15.sql に置きました（N バイト、表 N 個、N 行、マイグレーション N 件、N 秒）」と出る
- 書き出しの一時ファイルは OS の一時フォルダ（`/tmp`）に置き、終わったら消す。`/tmp` が小さいときは `--work-dir <フォルダ>` で置き場所を変える（書き出しは全文検索の索引を含むので、DB の大きさの2倍ほど要る）
- 置いたものは `npx wrangler r2 object get osrippo-backup/d1/staging/<日付>.sql --file <保存先> --remote` で取り出せる

## 3. 毎晩流す

時刻は、ほかのバッチから離します。

- 会期の処理（Worker の Cron）：日本時間の 0時1分
- 公開ミラー（`pnpm mirror`）：3時（[docs/mirror.md](mirror.md)）
- 現実の改正の同期（`pnpm sync:laws`）と読める法律の取り込み（`pnpm sync:readable`、週1回・約50分）：時刻は #203 で決める。バックアップと重ねない

バックアップは、会期の処理が終わったあと、利用の少ない時間に流します（D1 の書き出しは、終わるまでほかの問い合わせを待たせることがあります）。たとえば 4時30分にする場合、`crontab -e` に次を足します（パスは自宅サーバーの置き場所に合わせる。1行目の PATH は docs/mirror.md と同じ。すでにあれば足さない）。

```
PATH=/home/<ユーザー>/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin
30 4 * * * cd ~/osrippo && set -a && . ~/.osrippo-backup.env && set +a && pnpm backup --env <環境> --bucket osrippo-backup >> ~/osrippo-backup.log 2>&1
```

ログは `~/osrippo-backup.log` に足されていきます。失敗の通知先は #203 で決めます（終了コード1を見る）。

## A. タイムトラベルですぐ戻す

D1 は、書き込みの履歴から過去の時点に戻せます（全文検索の索引も含めて戻るので、索引の作り直しは要りません）。戻すと、その時点より後の書き込みは消えます。

1. 戻す時点を決める。その時点のブックマークを見る（`--env` は戻す環境）

   ```sh
   npx wrangler d1 time-travel info DB --env <環境> --timestamp 2026-11-14T03:00:00+09:00
   ```

2. 戻す。表示される「戻す前のブックマーク」を控える（戻したのが間違いだったときに、それで戻し直せる）

   ```sh
   npx wrangler d1 time-travel restore DB --env <環境> --timestamp 2026-11-14T03:00:00+09:00
   ```

3. 画面を開き、戻ったことを確かめる。戻し直すときは `--bookmark <控えた値>` で同じ命令を流す

戻すあいだに来た書き込みは失敗することがあります。会期の処理（Cron、日本時間 0時1分）と重なる時刻は避けます。

## B. R2 のバックアップから新しい D1 へ戻す

1. バックアップを取り出す（`<日付>` は日本時間の日付）

   ```sh
   npx wrangler r2 object get osrippo-backup/d1/<環境>/<日付>.sql --file restore.sql --remote
   ```

2. 先頭のコメントを見て、書き出したときのマイグレーションを確かめる

   ```sh
   head -n 4 restore.sql
   ```

   「最後は 00NN_….sql」が、このリポジトリの `drizzle/` の最後のファイルと同じであること。違うときは、その時点のコミットを取り出し（`git worktree add ../osrippo-restore <コミット>`）、そこで以下を流す

3. 新しい D1 を作り、表示される `database_id` を控える

   ```sh
   npx wrangler d1 create osrippo-restore
   ```

4. 戻す先だけを書いた設定ファイルを、リポジトリの外に作る（wrangler.jsonc は書き換えない）。`migrations_dir` はこのリポジトリの `drizzle` の絶対パス

   ```json
   {
   	"name": "osrippo-restore",
   	"compatibility_date": "2026-10-30",
   	"d1_databases": [
   		{ "binding": "DB", "database_name": "osrippo-restore", "database_id": "<控えた値>", "migrations_dir": "/home/<ユーザー>/osrippo/drizzle" }
   	]
   }
   ```

   これを `~/restore.jsonc` に置いたとして、以下の命令には `-c ~/restore.jsonc` を付ける

5. マイグレーションを当てる

   ```sh
   npx wrangler d1 migrations apply DB --remote -c ~/restore.jsonc
   ```

6. バックアップを流す

   ```sh
   npx wrangler d1 execute DB --remote -c ~/restore.jsonc --file restore.sql
   ```

7. 全文検索の索引を作り直す SQL を作り、流す（索引は、取り込みと投稿が書くときと同じ関数で、法令の条・課題・解決策・読める法律の条から作る）

   ```sh
   pnpm restore:index --from restore.sql --output index.sql
   npx wrangler d1 execute DB --remote -c ~/restore.jsonc --file index.sql
   ```

8. 確かめる
   - 行の数が、バックアップの先頭のコメント（「-- 表 user N行」など）と同じ

     ```sh
     grep -E '^-- 表 (user|issues|solutions|bills|stances|stance_log|readable_articles) ' restore.sql
     npx wrangler d1 execute DB --remote -c ~/restore.jsonc --command "SELECT (SELECT count(*) FROM user) AS user, (SELECT count(*) FROM issues) AS issues, (SELECT count(*) FROM solutions) AS solutions, (SELECT count(*) FROM bills) AS bills, (SELECT count(*) FROM stances) AS stances, (SELECT count(*) FROM stance_log) AS stance_log, (SELECT count(*) FROM readable_articles) AS readable_articles"
     ```

   - 全文検索が引ける（行があり、言葉で当たる）

     ```sh
     npx wrangler d1 execute DB --remote -c ~/restore.jsonc --command "SELECT (SELECT count(*) FROM search_trigram) AS trigram, (SELECT count(*) FROM search_bigram) AS bigram, (SELECT count(*) FROM search_trigram WHERE search_trigram MATCH '\"消費者\"') AS hits"
     ```

   - トリガーが6つある：`SELECT name FROM sqlite_schema WHERE type = 'trigger'`

9. その D1 を使うときは、wrangler.jsonc の環境の `database_name` と `database_id` を新しい D1 に替えてデプロイする。試しただけなら消す（`npx wrangler d1 delete osrippo-restore`）

手元の D1 に戻して試すときは、6・7 を `--local --persist-to <フォルダ>` で流すか、6 のあとで `pnpm restore:index --persist-to <フォルダ>` を流します（手元の D1 の索引を直接作り直す）。

## 復元試験の結果

ステージングで1回、B の手順で戻して確かめ、ここに書きます（R2 のバケットができてから）。

**未実施**

書くこと：

| 項目 | 値 |
| --- | --- |
| 日付 | |
| 元の環境とバックアップ | （例：staging、`d1/staging/2026-11-20.sql`） |
| バックアップの大きさ | |
| かかった時間 | 書き出しから置くまで／流す（手順6）／索引（手順7） |
| 行の数の照合 | 先頭のコメントと同じか |
| 立場の履歴 | `stance_log` の行が元と同じ（二重になっていない） |
| 全文検索 | 行の数と、言葉で当たるか |
| 画面 | 戻した D1 でステージングを開き、法令・課題・検索が出るか |
| 困ったこと | |

## 困ったとき

- **`Unknown arguments: compatibility`**：wrangler が 4.162.0 より古い（「wrangler を上げる」）
- **315MB を超えたと出る**：R2 に `wrangler r2 object put` で置ける上限を超えた。分けて置く形にする（その時点で相談する）
- **書き出しに知らない文があると出る**：D1 の書き出しの形が変わった。出た文の頭を Issue に貼って相談する
- **手順6で外部キーの失敗**：戻す先が新しい D1 でない（行が入っている）か、マイグレーションが合っていない。D1 を消して作り直し、3 からやり直す
- **手順6が途中で止まった**：途中まで入った D1 は使わない。消して作り直し、3 からやり直す
