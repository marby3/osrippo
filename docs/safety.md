# 公開前の安全策（コードでやるもの）

Issue #190 の決めたこと8のうち、コードでやるものを確かめた結果です（Issue #196、2026-11-13）。送信先や上限を変えたら、この表も直してください。

## 非公式の表示

全部の画面のフッターに「国会・政府とは無関係の非公式サービスです」を出します（ルートのレイアウト `src/routes/+layout.svelte`。文言は `ja.unofficial`）。見つからないときのページにも出ます。

確かめているテスト：`e2e/anzen.spec.ts` の基準1

## 登録・投稿・投票の Turnstile とレート制限

レート制限の名前は `src/lib/domain/limits.ts` の `LIMITS` のキーと、断るときの種類（`RefusalKind`）です。Turnstile は、全部の送信先を `e2e/anzen.spec.ts` の基準2がまとめて確かめています。下の「テスト」の列には、それ以外に確かめているテストを書きます。

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
| 修正案の票 | `/houan/[id]/shusei?/vote` | あり | 本案の票と合わせて数える | `shusei.spec.ts`、`saiketsu.spec.ts` |
| 委員長選挙の票 | `/iinkai?/vote` | あり | `chair-vote-ip` | `iinkai.spec.ts` |

### Turnstile を使わない操作（設計で決めたもの）

次の操作は、Turnstile を使わずにレート制限だけで守ります。押す回数が多い操作に毎回 Turnstile を出さないためで、それぞれの設計書で決めています。

- 「わかる」「考えが変わった」：課題・解決策の `?/support`・`?/react`、評価 `?/evaluate`、答弁イベントの「わたしも聞きたい」 `?/want`
- 法案と修正案の賛同：`/houan/[id]?/support`、`/houan/[id]/shusei?/support`
- 共同提出者の申し出、出し直し、統合案を作る
- 立場（1つの法案で変えられる回数に上限がある）
- 通報：`report-day`

### 対象外（議員だけの操作）

認証を受けた議員だけの操作で、使う人が少ないので、Turnstile もレート制限もかけません（Issue #196 の決定）。

- 答弁イベントの告知 `/toben/kaku`、取り消し `/toben/[id]?/cancel`、答弁 `/toben/[id]?/answer`
- 「拾った」 `/giin?/hirotta`・`/kadai/[id]?/hirotta`

運営の画面（`/kanri`、`/unei`）は運営だけの操作です。テスト用のログインと取り込み、Cron の入口は、本番にはありません。公開ミラーはトークンで守ります。

## 残っていること

- **ログインのレート制限**：いまは国の確認と Turnstile だけです。β では招待コード（#190 の実装 Issue 3）で登録を絞ります。一般公開（v0.7）の前に、Cloudflare の WAF で回線ごとの上限をかけるかを決めます。
- **e2e で上限（429）を確かめていない種類**：答弁・補足・修正案・評価・先議の賛同・委員長選挙の票などの上限です。質疑・答弁・補足、評価、票、委員長選挙は単体テスト（`src/lib/db/posts.test.ts`・`evaluations.test.ts`・`votes.test.ts`・`chairs.test.ts`）で確かめています。修正案と先議の賛同の上限は、どちらのテストでも確かめていません。
