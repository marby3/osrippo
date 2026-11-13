# 公開前の安全策（コードでやるもの）

Issue #190 の決めたこと8のうち、コードでやるものを確かめた結果です（Issue #196、2026-11-13）。送信先や上限を変えたら、この表も直してください。

## 非公式の表示

全部の画面のフッターに「国会・政府とは無関係の非公式サービスです」を出します（ルートのレイアウト `src/routes/+layout.svelte`。文言は `ja.unofficial`）。見つからないときのページにも出ます。

確かめているテスト：`e2e/anzen.spec.ts` の基準1

## 登録・投稿・投票の Turnstile とレート制限

レート制限の列は、断るときの種類（`src/lib/domain/limits.ts` の `RefusalKind`）です。数は `LIMITS` にあります（例：`post-account` は `postPerAccount`）。Turnstile は、この表で「あり」の送信先を全部、`e2e/anzen.spec.ts` の基準2がまとめて確かめています（トークンなしと、通らないトークンの両方）。「テスト」の列には、それ以外に Turnstile か上限（429）を確かめているテストを書きます。

| 操作 | 送信先 | Turnstile | レート制限 | テスト |
| --- | --- | --- | --- | --- |
| 登録（ログイン） | `/login?/google`・`?/line` | あり | なし（下の「残っていること」） | `kadai.spec.ts` |
| 課題 | `/kadai/kaku` | あり | `post-account`・`post-new`・`post-ip` | `kadai.spec.ts`、`kaiki.spec.ts` |
| 解決策 | `/kadai/[id]/kaiketsu/kaku` | あり | `solution-account`・`solution-new`・`solution-ip` | `kaiketsu.spec.ts` |
| 法案の下書きを作る | `/houan/kaku` | あり | `bill-draft-account`・`bill-draft-ip` | `houan.spec.ts` |
| 法案の下書きを保存する | `/houan/[id]/kaku` | あり | `bill-save-account` | `houan.spec.ts` |
| 質疑 | `/houan/[id]/shitsugi/kaku` | あり | `question-day`・`bill-post-burst`・`bill-post-ip` | `shitsugi.spec.ts` |
| 答弁・補足 | `/houan/[id]/shitsugi?/answer`・`?/supplement` | あり | `answer-day`・`supplement-day`・`bill-post-burst`・`bill-post-ip` | — |
| 修正案を出す・更新する | `/houan/[id]/shusei/kaku` | あり | `amendment-account`・`amendment-ip` | — |
| 専門家の解説 | `/houan/[id]?/commentary` | あり | なし（有識者だけ。1つの法案に1人1件） | `kaisetsu.spec.ts` |
| 答弁イベントの質問 | `/toben/[id]?/ask` | あり | なし（1回のイベントに1人1件） | `toben-shitsumon.spec.ts` |
| 委員長選挙の立候補 | `/iinkai?/stand` | あり | なし（1つの会期に1人1件） | `iinkai.spec.ts` |
| 解任動議の署名 | `/iinkai?/recall` | あり | `recall-ip` | `iinkai.spec.ts` |
| 本案の票 | `/saiketsu/[id]?/vote` | あり | `vote-day`・`vote-burst`・`vote-ip` | `saiketsu.spec.ts` |
| 修正案の票 | `/houan/[id]/shusei?/vote` | あり | `vote-day`・`vote-burst`・`vote-ip`（本案の票と合わせて数える） | `shusei.spec.ts`、`saiketsu.spec.ts` |
| 委員長選挙の票 | `/iinkai?/vote` | あり | `chair-vote-ip` | `iinkai.spec.ts` |
| 答弁イベントの告知・取り消し・答弁 | `/toben/kaku`、`/toben/[id]?/cancel`・`?/answer` | 対象外 | 対象外 | 議員だけの操作で、使う人が少ないため（Issue #196 の決定） |
| 「拾った」 | `/giin?/hirotta`・`/kadai/[id]?/hirotta` | 対象外 | 対象外 | 同上 |

### Turnstile を使わない操作（設計で決めたもの）

次の操作は、Turnstile を使わずにレート制限だけで守ります。押す回数が多い操作に毎回 Turnstile を出さないためで、それぞれの設計書で決めています。投稿でも投票でもないので、基準2の対象ではありません。

| 操作 | 送信先 | レート制限 | 上限（429）を確かめているテスト |
| --- | --- | --- | --- |
| 課題の「わかる」 | `/kadai/[id]?/support` | `support-day`・`support-burst`・`support-ip` | `kadai.spec.ts`、`kaiketsu.spec.ts` |
| 解決策の「わかる」「考えが変わった」 | `/kadai/[id]?/react`・`/kadai/[id]/kaiketsu?/react` | `support-day`・`support-burst`・`reaction-ip`（課題の「わかる」と合わせて数える） | `kaiketsu.spec.ts` |
| 評価（「筋が通っている」「考えが変わった」） | `/houan/[id]/shitsugi?/evaluate` | `evaluation-day`・`evaluation-burst`・`evaluation-ip` | `src/lib/domain/evaluations.test.ts`（判定の関数） |
| 「わたしも聞きたい」 | `/toben/[id]?/want` | `want-day`・`want-burst`・`want-ip` | — |
| 法案の賛同 | `/houan/[id]?/support` | `bill-support-day`・`bill-support-burst`・`bill-support-ip` | `sandou.spec.ts` |
| 修正案の賛同（本案より先に採決するため） | `/houan/[id]/shusei?/support` | `amendment-support-day`・`amendment-support-burst`・`amendment-support-ip` | — |
| 共同提出者の申し出 | `/houan/[id]?/cosponsor` | `bill-cosponsor-day` | — |
| 出し直し、統合案を作る | `/houan/[id]?/resubmit`・`?/merge` | `bill-draft-account`・`bill-draft-ip` | — |
| 立場 | `/houan/[id]/shitsugi?/stance` | 1つの法案で変えられる回数（`STANCE_CHANGES`） | — |
| 通報（課題・解決策・質疑・修正案・解説・答弁イベント） | 各画面の `?/report…` | `report-day` | `tsuho.spec.ts`、`kaiketsu-tsuho.spec.ts` |

運営の画面（`/kanri`、`/unei`）は運営だけの操作です。テスト用のログインと取り込み、Cron の入口は、本番にはありません。公開ミラーはトークンで守ります。

## 残っていること

- **ログインのレート制限**：いまは国の確認と Turnstile だけです。β では招待コード（#190 の実装 Issue 3）で登録を絞ります。一般公開（v0.7）の前に、Cloudflare の WAF で回線ごとの上限をかけるかを決めます。
- **e2e で上限（429）を確かめていない種類**：答弁・補足・修正案・評価・先議の賛同・委員長選挙の票などの上限です。質疑・答弁・補足、票、委員長選挙は `src/lib/db/posts.test.ts`・`votes.test.ts`・`chairs.test.ts`、評価は `src/lib/domain/evaluations.test.ts` で確かめています。修正案と先議の賛同の上限は、どちらのテストでも確かめていません。
