# 負荷試験

Issue #201（#190 の決めたこと6、#198 の「負荷試験」）。β の規模のデータを入れたステージングに、ログインしないで見る7つの画面を100人で5分読ませ、合否を決める。あわせて、画面ごとの D1 の読んだ行数を測り、100人・1000人のときの月の使用量を見積もる。

数字は、Workers を有料プランに切り替えたあとでステージングに流して入れる（無料プランの CPU の上限では、合格するかを確かめられないため）。いまはどれも「未計測」。

## 合否

`pnpm test:load -- --base <URL>` が、Docker の k6（`grafana/k6:2.4.0`）で `load/load.js` を流す。終了コードは、合格 0、不合格 1、流せなかった 2（引数の誤り、Docker がない、k6 のエラー）。

| 条件 | k6 の thresholds |
| --- | --- |
| 5xx が0件 | `server_5xx: count<1` |
| p95 が1秒以内 | `http_req_duration: p(95)<1000` |
| CPU の制限で落ちた応答が0件 | `cpu_exceeded: count<1`（本文に「Error 1102」か「exceeded resource limits」を含む応答） |
| 応答のなかったものが0件 | `no_response: count<1`（つながらない・時間切れ。向ける先が落ちていても合格にならないように足した） |
| 200 でも 5xx でもない応答が0件 | `other_status: count<1`（404・403 など。画面がなかったり断られたりしても合格にならないように足した。リダイレクトは追いかけた先の応答で見る） |

- 100人同時は、k6 の VU 100人が、それぞれ画面を1つ読んでは1〜5秒あける形。時間は5分
- 読む画面は `load/pages.json` の7つ。毎回くじで選ぶ（法律の一覧は、`q` なしとありを半分ずつ）

  | 名前 | 画面 | URL |
  | --- | --- | --- |
  | `home` | ホーム | `/` |
  | `kadai` | 課題の一覧 | `/kadai` |
  | `hourei-joubun` | 法令の条文（消費者契約法） | `/hourei/412AC0000000061` |
  | `hourei-hikaku` | 時点比較（特定商取引法。民法は取り込んでいないので代わり） | `/hourei/351AC0000000057/hikaku` |
  | `toukei` | 統計 | `/toukei` |
  | `kensaku` | 検索 | `/kensaku?q=解約` |
  | `hourei-ichiran` | 法律の一覧 | `/hourei` |
  | `hourei-ichiran-q` | 法律の一覧（言葉で絞る） | `/hourei?q=消費者` |

- 要約の JSON は `load/out/summary-<日時>.json`（.gitignore）。標準出力には、条件ごとの合否と、画面ごとの回数・p95・最大を出す
- 引数：`--duration 1m`（既定 5m）、`--vus 10`（既定 100）、`--page <名前>`（その画面だけを読む。行数を測るとき）
- 書く処理は測らない（決めたこと6）

## ユーザーの手作業

順番どおりに。

1. Workers を有料プランに切り替える
2. Cloudflare の API トークンを作る。権限は「Account Analytics Read」（試験のあとで、CPU の制限で落ちた件数と D1 の読んだ行数を GraphQL と SQL API で見るため）。`wrangler d1 insights` を使うときも同じ権限が要る
3. ステージングにいまのコードをデプロイし、マイグレーションを当てる（`.review/config` の deploy=、`npx wrangler d1 migrations apply DB --env staging --remote`）。β のデータは法令が取り込み済みの DB に入れるので、`SELECT count(*) FROM laws` と `SELECT count(*) FROM readable_laws` が0でないことを確かめる（0なら、対象3法の取り込みと `pnpm sync:readable` を先に流す。本番の公開の手順 #203 と同じ）
4. 下の「β の規模のデータを入れる」
5. 下の「流す」。5分の試験のあとで「CPU の制限で落ちた件数を確かめる」
6. 下の「画面ごとの読んだ行数を測る」で表を埋め、「月の使用量の見積もり」を計算する
7. 終わったら「β の規模のデータを消す」

## β の規模のデータを入れる

ステージングにはログインがないので、シミュレーション（`pnpm simulate`）は流せない。代わりに、時刻を「いま」に合わせた行を SQL にして、D1 に直接入れる。本物の送信先（form action）は通らない。

作る行（`src/lib/db/beta-data.ts`。件数は DB のテスト `src/lib/db/beta-data.test.ts` で確かめる）：

| 行 | 数 |
| --- | --- |
| 利用者 | 100人（id は `beta-u001`〜、名前は `beta-参加者001`〜、メールは `beta-u001@users.invalid`〜。前の会期の45日前に登録） |
| 課題 | 50件（全文検索の索引の行は、題名・困っている人・具体例で150行。10件は前の会期の前の週、40件は前の会期の始まりからいままで） |
| 解決策 | 100件（課題ごとに2件。索引の行も100行） |
| 「わかる」 | 課題に300件（1人3件）、解決策に100件（1人1件） |
| 法案 | 10本。前の会期に5本、いまの会期に5本。どれも発議済みで、変える条が1つ、元にした解決策が1つ、賛同が8人（合わせて80件） |
| 立場と票 | 法案を出した人と賛同した人のほかで、1人が会期ごとに3本。立場は554件。票は、前の会期は採決の週に277件。いまの会期は、採決の週（22日〜）に入っていれば「いま」までに277件、入る前なら0件 |
| 前の会期の結果 | 5本ぶん（統計のページは結果を作らないので、入れないと中身が出ない） |
| 行動の記録（actions） | 上のそれぞれに1行（今月の参加者と投票資格に数える） |

- 法案はどれも否決になる票にしている（可決すると会期の終わりの処理で IF世界の条文が変わり、消すだけでは戻せないため）
- 番号は DB に振らせ、ほかの行からは題名・本文で引く（固定の番号はステージングの行とぶつかるため）
- ステージングに本当の利用者がいない前提で使う（本番には流さない）。消す SQL は、β の課題・法案についた行を、だれが書いたものでも消す（ほかの人の票・立場・通知など）
- 法案の「基にした版」は、いま施行されている現実の版にしている（ステージングに IF世界の版があっても、その版にはしない）。採決のくじの割り当て（vote_assignments）は作らない。どちらも読む画面の重さにはほぼ効かない

手順（PowerShell と Linux で同じ）：

```sh
pnpm beta:data -- --out .wrangler/beta.sql
npx wrangler d1 execute DB --env staging --remote --file .wrangler/beta.sql
pnpm beta:data -- --check .wrangler/beta.sql --env staging --remote
```

- 1行目で、入れる SQL（`beta.sql`）、消す SQL（`beta.delete.sql`）、作った行の数（`beta.expected.json`）ができる。時刻は流した時点の「いま」。会期をまたぐと前の会期といまの会期がずれるので、作ったらすぐに入れて、その会期のうちに試験を終える
- 3行目は、D1 の β の行を数え、作った数と比べる（違えば終了コード1）。`--env staging --remote` を外すと手元の D1。入れた直後に流す（`sessionParticipants`・`notifications` は、入れたあとで画面が読まれると本体が作る行で、入れた直後は0）
- 今月の参加者の数（session_participants）は、その会期で最初に読まれたときに固定される。データを入れる前にいまの会期の数が固定されていたら、β の利用者は入らない（発議要件の表示が変わるだけで、試験の画面には効かない）。データを作ったあとに固定された行は β の利用者を数えているので、消す SQL で消す（次に読まれたときに数え直す）

## β の規模のデータを消す

```sh
npx wrangler d1 execute DB --env staging --remote --file .wrangler/beta.delete.sql
pnpm beta:data -- --check .wrangler/beta.sql --env staging --remote
```

2行目で全部の数が0になっていることを確かめる（作った数と違うので終了コード1になる）。消す SQL は、読んだときに本体が作る行（立場別の分布、確認、通知、データを作ったあとに固定された今月の参加者の数）も消す。β の課題・法案についた行は、だれが書いたものでも消すので、ステージングに本当の利用者がいないときだけ流す。IF世界の行ができていたら（可決にはしないので、ふつうはできない）、`bill_laws` を消すところで外部キーの違反で止まるので、手で確かめる。

## 流す

```sh
pnpm test:load -- --base https://osrippo-staging.marbyxmax10.workers.dev
```

- 会期の終わりの処理（Cron、日本時間の0時1分）と重ならない時間に流す
- 始まりと終わりの時刻（UTC）が出るので控える（下の確かめと、行数を測るのに使う）
- 手元で試すときは、`pnpm preview:test` を立てて `pnpm test:load -- --base http://localhost:4173 --duration 1m`。手元のサーバーは1つのプロセスなので、100人では p95 を満たさない（動くかの確かめだけ）

## CPU の制限で落ちた件数を確かめる

k6 は本文の「Error 1102」で数えるが、落ちた応答の形は Cloudflare が決めるので、試験のあとで Workers の記録でも確かめる。始まりと終わりの時刻のあいだで、ステータスが `exceededResources`（エラー 1102・1027）の呼び出しが0件なら合格。

```graphql
query ($accountTag: string!, $start: Time!, $end: Time!) {
	viewer {
		accounts(filter: { accountTag: $accountTag }) {
			workersInvocationsAdaptive(limit: 100, filter: { scriptName: "osrippo-staging", datetime_geq: $start, datetime_leq: $end }) {
				sum {
					requests
					errors
				}
				quantiles {
					cpuTimeP50
					cpuTimeP99
				}
				dimensions {
					status
				}
			}
		}
	}
}
```

- `scriptName` は、ステージングの Worker の名前（ダッシュボードの Workers の一覧で確かめる）
- `https://api.cloudflare.com/client/v4/graphql` に、ヘッダー `Authorization: Bearer <API トークン>` を付けて POST する。本文は `{"query": "<上の1行にしたもの>", "variables": {"accountTag": "<アカウントID>", "start": "<始まり>", "end": "<終わり>"}}`
- `status` ごとの `requests` が出る。`exceededResources` の行がないか、0なら合格。`cpuTimeP50`・`cpuTimeP99`（マイクロ秒）は見積もりに使う

## 画面ごとの読んだ行数を測る

画面を1つずつ単独で流し、そのあいだの D1 の読んだ行数を、読んだ回数で割る。

1. 画面ごとに流す（ほかの画面と混ぜない。10人で2分）

   ```sh
   pnpm test:load -- --base https://osrippo-staging.marbyxmax10.workers.dev --page home --vus 10 --duration 2m
   ```

   始まりと終わりの時刻と、要約の `http_reqs{page:home}` の count（読んだ回数）を控える。画面のあいだは1分以上あける

2. そのあいだに D1 が読んだ行数を集める。Cloudflare の SQL API（`https://api.cloudflare.com/client/v4/analytics/sql`）を curl で呼ぶ。サンプリングの重みは `SUM`・`COUNT` に自動でかかる。PowerShell でも引用符で困らないよう、本文はファイルにする

   `rows.json`（`<アカウントID>`・`<始まり>`・`<終わり>` を書き換える。時刻は手順1で出た UTC のまま）：

   ```json
   {
   	"query": "SELECT SUM(rowsRead) AS rowsRead, SUM(rowsWritten) AS rowsWritten, COUNT(*) AS queries FROM events.d1Queries WHERE databaseId = 'ca1c0d81-d4ea-4b62-a31e-58048ac622c6' AND error = ''",
   	"scope": { "accountTag": "<アカウントID>" },
   	"time_range": { "start": "<始まり>", "end": "<終わり>" }
   }
   ```

   ```sh
   curl https://api.cloudflare.com/client/v4/analytics/sql --header "Authorization: Bearer <API トークン>" --header "Content-Type: application/json" --data "@rows.json"
   ```

   - PowerShell では `curl` が別のコマンドを指すことがあるので `curl.exe` と書く
   - 答えの `data[0]` に `rowsRead`・`rowsWritten`・`queries` が入る。項目名が違うと断られたら、`curl --get https://api.cloudflare.com/client/v4/analytics/sql/introspection --header "Authorization: Bearer <API トークン>" --data-urlencode "account_tag=<アカウントID>" --data-urlencode "dataset_name=events.d1Queries" --data-urlencode "include_columns=true"` で列の名前を確かめる
   - SQL API が使えないときは、GraphQL（`https://api.cloudflare.com/client/v4/graphql`。上の CPU の確かめと同じ呼び方）の `d1AnalyticsAdaptiveGroups`（`sum { rowsRead rowsWritten readQueries }`、`databaseId` で絞る）を集める（時刻の絞り方の項目名は GraphQL の introspection で確かめる）

3. 1回あたりの読んだ行数 = 読んだ行数 ÷ 読んだ回数。下の表に入れる
4. どの問い合わせが重いかは `npx wrangler d1 insights DB --env staging --sort-by reads --time-period 1d --limit 20 --json` で見る（wrangler はリポジトリの版。引数は wrangler 4.156.0 の `--help` で確かめた。`--time-period` は「いま」からさかのぼる長さ）。課題の一覧の既定の並びと、ホームの注目の課題は、デプロイのときにやることの一覧で「重ければ直す」としている

- 統計は、立場別の分布の行を最初に読まれたときに1回作る（書く）。書いた行数も控える
- ホームの今日の条文は Workers の中で1日覚えるので、isolate が変わったときだけ読む。行数は平均で見る
- 時点比較は、改正を選ばないときの既定の比較で測る

## 結果

### 合否（5分、100人）

| 項目 | 値 |
| --- | --- |
| 流した日時 | 未計測 |
| 読んだ回数 | 未計測 |
| 5xx | 未計測 |
| p95 | 未計測 |
| CPU の制限で落ちた応答（k6） | 未計測 |
| `exceededResources`（GraphQL） | 未計測 |
| CPU 時間 p50 / p99 | 未計測 |
| 合否 | 未計測 |

### 画面ごと

| 画面 | p95（100人のとき） | 1回の読んだ行数 | 1回の書いた行数 |
| --- | --- | --- | --- |
| ホーム | 未計測 | 未計測 | 未計測 |
| 課題の一覧 | 未計測 | 未計測 | 未計測 |
| 法令の条文 | 未計測 | 未計測 | 未計測 |
| 時点比較 | 未計測 | 未計測 | 未計測 |
| 統計 | 未計測 | 未計測 | 未計測 |
| 検索 | 未計測 | 未計測 | 未計測 |
| 法律の一覧 | 未計測 | 未計測 | 未計測 |
| 法律の一覧（言葉で絞る） | 未計測 | 未計測 | 未計測 |

## 月の使用量の見積もり

前提（数字を入れるときに見直す）：

- 1人が月に見るページは300（1日10ページ × 30日）。どの画面を見るかは負荷試験と同じ割合（7つの画面を同じだけ。法律の一覧は2つで1画面ぶん）
- ログインして書く操作と、クローラーは入れない
- データは β の規模で測った値を使う。1000人のときは課題・法案・票が増えるので、データの量で行数が増える画面（課題の一覧、統計、検索）は多めに見る

式：

- 1回の平均の読んだ行数 R = Σ（画面の割合 × 画面の1回の読んだ行数）
- 月の読んだ行数 = 人数 × 300 × R
- 月のリクエスト = 人数 × 300（静的なファイルは数えない）
- 月の CPU 時間（ms）= 月のリクエスト × 1回の CPU 時間（GraphQL の cpuTimeP50。単位はマイクロ秒なので、1000 で割ってミリ秒にする）

有料プランに含まれる量（2026-11 時点の公開価格）：D1 の読んだ行は月250億行、書いた行は月5,000万行。Workers のリクエストは月1,000万、CPU 時間は月3,000万ミリ秒。

| | 100人 | 1000人 | 有料プランに含まれる量 |
| --- | --- | --- | --- |
| リクエスト | 30,000 | 300,000 | 10,000,000 |
| D1 の読んだ行数 | 未計測（30,000 × R） | 未計測（300,000 × R） | 25,000,000,000 |
| CPU 時間 | 未計測 | 未計測 | 30,000,000ms |

## 手元で試した記録

2026-11-14、手元の `pnpm preview:test`（1つのプロセス）に β の規模のデータを入れ、100人で1分流した。合否の判定と要約の JSON が出ることの確かめで、数字はステージングの見積もりには使わない。

- 1,718回読み、5xx 0件、CPU の制限 0件、応答なし 0件、200 でも 5xx でもない応答 0件。p95 は 2,996ms で不合格（終了コード1）
- 3人で15秒・検索だけ（`--page kensaku`）は合格（終了コード0）。止めたサーバーに向けると「応答なし」で不合格。Docker がないと終了コード2
- 消す SQL を流したあと、β の行は0になった（統計を読んで本体が作った立場別の分布の行も消えた）
