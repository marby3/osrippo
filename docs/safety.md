# 公開前の安全策（コードでやるもの）

Issue #190 の決めたこと8のうち、コードでやるものを確かめた結果です（Issue #196、2026-11-13）。送信先や上限を変えたら、この表も直してください。

## 非公式の表示

全部の画面のフッターに「国会・政府とは無関係の非公式サービスです」を出します（ルートのレイアウト `src/routes/+layout.svelte`。文言は `ja.unofficial`）。見つからないときのページにも出ます。

確かめているテスト：`e2e/anzen.spec.ts` の基準1

## 登録・投稿・投票の Turnstile とレート制限

レート制限の列は、断るときの種類（`src/lib/domain/limits.ts` の `RefusalKind`）です。数は `LIMITS` にあります（例：`post-account` は `postPerAccount`）。Turnstile は、この表で「あり」の送信先を全部、`e2e/anzen.spec.ts` の基準2がまとめて確かめています（トークンなしと、通らないトークンの両方）。「テスト」の列には、それ以外に Turnstile か上限を確かめているテスト（画面のテスト、DB のテスト、判定の関数のテスト）を書きます。

この表は、登録・投稿・投票（Issue #196 の範囲）と、Turnstile を使わずにレート制限で守る操作だけです。発議、撤回の同意、修正案の取り込み、立候補の取り下げ、署名の取り消し、「読んだ」の記録のように、自分のものへの操作や取り消しで、増やして荒らせない操作は載せていません。

| 操作 | 送信先 | Turnstile | レート制限 | テスト |
| --- | --- | --- | --- | --- |
| 登録（ログイン） | `/login?/google`・`?/line` | あり | なし（下の「残っていること」）。β のあいだは、新規登録に使っていない招待コードが要る（1つのコードで1人。運営が `/kanri` で作る。Issue #199） | `kadai.spec.ts`、`shotai.spec.ts`、`src/lib/db/invites.test.ts` |
| 課題 | `/kadai/kaku` | あり | `post-account`・`post-new`・`post-ip` | `kadai.spec.ts`、`kaiki.spec.ts` |
| 解決策 | `/kadai/[id]/kaiketsu/kaku` | あり | `solution-account`・`solution-new`・`solution-ip` | `kaiketsu.spec.ts` |
| 法案の下書きを作る | `/houan/kaku` | あり | `bill-draft-account`・`bill-draft-ip` | `houan.spec.ts` |
| 法案の下書きを保存する | `/houan/[id]/kaku` | あり | `bill-save-account` | `houan.spec.ts` |
| 質疑 | `/houan/[id]/shitsugi/kaku` | あり | `question-day`・`bill-post-burst`・`bill-post-ip` | `shitsugi.spec.ts` |
| 答弁・補足 | `/houan/[id]/shitsugi?/answer`・`?/supplement` | あり | `answer-day`・`supplement-day`・`bill-post-burst`・`bill-post-ip` | `src/lib/db/posts.test.ts` |
| 修正案を出す・更新する | `/houan/[id]/shusei/kaku` | あり | `amendment-account`・`amendment-ip` | `src/lib/domain/amendments.test.ts` |
| 専門家の解説 | `/houan/[id]?/commentary` | あり | なし（有識者だけ。1つの法案に1人1件） | — |
| 答弁イベントの質問 | `/toben/[id]?/ask` | あり | なし（1回のイベントに1人1件） | `toben-shitsumon.spec.ts` |
| 委員長選挙の立候補 | `/iinkai?/stand` | あり | なし（1つの会期に1人1件） | `iinkai.spec.ts` |
| 解任動議の署名 | `/iinkai?/recall` | あり | `recall-ip` | `iinkai.spec.ts` |
| 本案の票 | `/saiketsu/[id]?/vote` | あり | `vote-day`・`vote-burst`・`vote-ip` | `saiketsu.spec.ts` |
| 修正案の票 | `/houan/[id]/shusei?/vote` | あり | `vote-day`・`vote-burst`・`vote-ip`（本案の票と合わせて数える） | `shusei.spec.ts`、`saiketsu.spec.ts` |
| 委員長選挙の票 | `/iinkai?/vote` | あり | `chair-vote-ip` | `iinkai.spec.ts` |
| 答弁イベントの告知 | `/toben/kaku` | 対象外 | 対象外 | 議員だけの操作で、使う人が少ないため（Issue #196 の決定） |
| 「拾った」 | `/giin?/hirotta`・`/kadai/[id]?/hirotta` | 対象外 | 対象外 | 同上（課題のページからの送信先も同じ操作） |
| 答弁イベントの取り消し・答弁 | `/toben/[id]?/cancel`・`?/answer` | 対象外 | 対象外 | 同じ理由で足した（議員だけの操作） |
| 質疑の論点を立てる・閉じる | `/houan/[id]/shitsugi?/openPoint`・`?/closePoint` | 対象外 | 対象外 | 委員長・代行中の理事・運営・運営協力者だけの操作のため（Issue #168）。役職と時期は `ronten.spec.ts` |

### Turnstile を使わない操作（設計で決めたもの）

次の操作は、Turnstile を使わずにレート制限だけで守ります。押す回数が多い操作に毎回 Turnstile を出さないためで、それぞれの設計書で決めています。投稿でも投票でもないので、基準2の対象ではありません。

| 操作 | 送信先 | レート制限 | 上限を確かめているテスト |
| --- | --- | --- | --- |
| 課題の「わかる」 | `/kadai/[id]?/support` | `support-day`・`support-burst`・`support-ip` | `kadai.spec.ts`、`kaiketsu.spec.ts` |
| 解決策の「わかる」「考えが変わった」 | `/kadai/[id]?/react`・`/kadai/[id]/kaiketsu?/react` | `support-day`・`support-burst`・`reaction-ip`（課題の「わかる」と合わせて数える） | `kaiketsu.spec.ts` |
| 評価（「筋が通っている」「考えが変わった」） | `/houan/[id]/shitsugi?/evaluate` | `evaluation-day`・`evaluation-burst`・`evaluation-ip` | `src/lib/domain/evaluations.test.ts`（判定の関数） |
| 「わたしも聞きたい」 | `/toben/[id]?/want` | `want-day`・`want-burst`・`want-ip` | `src/lib/db/toben-questions.test.ts` |
| 法案の賛同 | `/houan/[id]?/support` | `bill-support-day`・`bill-support-burst`・`bill-support-ip` | `sandou.spec.ts` |
| 修正案の賛同（本案より先に採決するため） | `/houan/[id]/shusei?/support` | `amendment-support-day`・`amendment-support-burst`・`amendment-support-ip` | `src/lib/domain/amendments.test.ts` |
| 共同提出者の申し出 | `/houan/[id]?/cosponsor` | `bill-cosponsor-day` | `src/lib/db/cosponsors.test.ts` |
| 出し直し、統合案を作る | `/houan/[id]?/resubmit`・`?/merge` | `bill-draft-account`・`bill-draft-ip` | — |
| 立場 | `/houan/[id]/shitsugi?/stance` | 1つの法案で変えられる回数（`STANCE_CHANGES`） | `src/lib/db/posts.test.ts` |
| 通報（課題・解決策・質疑・修正案・解説・答弁イベント） | 各画面の `?/report…` | `report-day` | `tsuho.spec.ts`、`kaiketsu-tsuho.spec.ts` |

運営の画面（`/kanri`、`/unei`）は運営だけの操作です。テスト用のログインと取り込み、Cron の入口は、本番にはありません。公開ミラーはトークンで守ります。

## 残っていること

- **ログインのレート制限**：いまは国の確認と Turnstile だけです。β では招待コード（#199）で新規登録を絞っています。一般公開（v0.7）の前に、Cloudflare の WAF で回線ごとの上限をかけるかを決めます。
- **上限を確かめるテストがないもの**：出し直しと統合案を作るときの `bill-draft-*`。下書きを作るときの `bill-draft-*` は `houan.spec.ts` で確かめていて、同じ判定を使います。
