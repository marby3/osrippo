# 公開ミラーの設定の手順

会期が確定するたびに、IF世界の法令を GitHub の公開リポジトリへ書き出す仕組み（Issue #155）の、最初に一度だけする設定です。決めたことは [docs/spec/155.md](spec/155.md) にあります。

流れは次のとおりです。

1. 会期の処理が終わると、Worker の書き出しの入口（`/mirror`）が、確定した会期の IF世界の法令を返すようになる
2. 自宅サーバー（MS-R1）のバッチが、毎日その入口を読み、まだ書き出していない会期を古い順に、会期ごとに1コミットする
3. バッチがコミットを GitHub の公開リポジトリへ押す

## 1. 公開リポジトリを作る

1. GitHub で、空の公開リポジトリを作る（名前の案：`osrippo-if-laws`）。README・ライセンス・.gitignore は付けない（バッチが書く）
2. 説明の欄に「オープンソース立法府の IF世界の法令（架空の法令。CC BY 4.0）」と書く

## 2. 押すための鍵を作る

自宅サーバーで、このリポジトリにだけ押せる鍵（デプロイキー）を作ります。

1. 自宅サーバーで鍵を作る

   ```sh
   ssh-keygen -t ed25519 -N '' -C osrippo-mirror -f ~/.ssh/osrippo-mirror
   ```

2. GitHub の公開リポジトリの Settings → Deploy keys → Add deploy key で、`~/.ssh/osrippo-mirror.pub` の中身を貼り、**Allow write access に印を付けて**保存する
3. 自宅サーバーの `~/.ssh/config` に、この鍵を使う名前を足す

   ```
   Host github-osrippo-mirror
     HostName github.com
     User git
     IdentityFile ~/.ssh/osrippo-mirror
     IdentitiesOnly yes
   ```

4. 公開リポジトリを自宅サーバーに置く（`<アカウント>` は GitHub のアカウント名）

   ```sh
   git clone github-osrippo-mirror:<アカウント>/osrippo-if-laws.git ~/osrippo-if-laws
   ```

   空のリポジトリなので「empty repository」と出ますが、そのままで構いません。

## 3. MIRROR_TOKEN を入れる

書き出しの入口のトークンです。Worker と自宅サーバーに同じ値を入れます。

1. 長いランダムな値を作る

   ```sh
   openssl rand -hex 32
   ```

2. Worker に入れる（本番は `--env staging` を外す）

   ```sh
   npx wrangler secret put MIRROR_TOKEN --env staging
   ```

3. 自宅サーバーでは、本人だけが読めるファイルに置く。値はシェルの履歴に残らないよう、画面に出さずに入力する（`read` のあとで値を貼り、Enter を押す）

   ```sh
   install -m 600 /dev/null ~/.osrippo-mirror.env
   read -rs token && printf 'MIRROR_TOKEN=%s\n' "$token" > ~/.osrippo-mirror.env && unset token
   ```

`MIRROR_TOKEN` を入れていない Worker では、入口はいつも 401 を返します（書き出しを使わない環境では入れなくて構いません）。

## 4. 一度、押さずに流す

このリポジトリ（osrippo）を置いた場所で、押さない指定を付けて流し、中身を確かめます。

```sh
set -a; . ~/.osrippo-mirror.env; set +a
pnpm mirror --repo ~/osrippo-if-laws --url https://<Worker の URL> --no-push
git -C ~/osrippo-if-laws log --oneline
```

- 確定した会期がまだなければ「新しく確定した会期はありません」と出て、何もしません
- コミットができていれば、`--no-push` を外してもう一度流すと押します（続きの会期がなくても、押していないコミットは押します）

## 5. 毎日流す

会期の処理（Cron）は日本時間の 0時1分に走ります。そのあと、たとえば 3時に流します。`crontab -e` に次の2行を足します（パスは自宅サーバーの置き場所に合わせる）。cron の PATH にはふつう `node` と `pnpm` がないので、1行目で足します（`which node pnpm` で出たフォルダを書く）。

```
PATH=/home/<ユーザー>/.local/share/pnpm:/usr/local/bin:/usr/bin:/bin
0 3 * * * cd ~/osrippo && set -a && . ~/.osrippo-mirror.env && set +a && pnpm mirror --repo ~/osrippo-if-laws --url https://<Worker の URL> >> ~/osrippo-mirror.log 2>&1
```

Docker Compose で動かす場合も、中身は同じです（`MIRROR_TOKEN` を環境変数で渡し、鍵とリポジトリを読めるようにする）。

## 困ったとき

- **401 で止まる**：Worker と自宅サーバーの `MIRROR_TOKEN` が違う
- **会期が進まない**：確認中の法案がある会期で止まります。運営の画面で確定か無効にすると、次の日に進みます。現実の改正の取り込みに失敗した法令がある会期でも止まります（次の日の Cron でやり直します）
- **押せない**：デプロイキーに Allow write access の印があるか、`ssh -T github-osrippo-mirror` で確かめる。押せなかったコミットは、次に流したときに押します
- **やり直したい**：`~/osrippo-if-laws/.osrippo-mirror` に最後に書き出した会期が入っています。公開したコミットは消さず、続きから進めてください
