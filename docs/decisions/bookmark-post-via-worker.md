# ブックマーク投稿: 同じ中継Workerに追加し、OAuth署名をWorker側で行う

## 背景

2026-10-07に「記事ページからはてブへ投稿する機能」を、CORS非対応・OAuth 1.0a必須が静的サイトの設計と衝突するとして見送った。その後「自分のブックマーク」ページ用に中継Worker([my-bookmarks-worker-proxy.md](my-bookmarks-worker-proxy.md))を作ることになり、2026-10-16にユーザーの発案で、**同じWorkerに投稿も載せる**形で再開した。

## 確認した事実(公式ドキュメント)

- `POST https://bookmark.hatenaapis.com/rest/1/my/bookmark`(追加・更新は同じ。既存なら**上書き**)。パラメータは `url` / `comment` / `tags`(最大10個)。他に `post_twitter` `post_mixi` `post_evernote` `private` があるが使わない(scopeも `write_public` のみに絞る)。`GET`(`url`をクエリで指定)は無ければ404。DELETEもあるが未実装。
- 認証はOAuth 1.0a(HMAC-SHA1)。リクエストトークン取得 `https://www.hatena.com/oauth/initiate`(`scope`をボディ、`oauth_callback=oob`)→ 認可 `https://www.hatena.ne.jp/oauth/authorize?oauth_token=` → アクセストークン `https://www.hatena.com/oauth/token`(`oauth_verifier`)。コンシューマキーは https://www.hatena.ne.jp/oauth/develop で審査なしに登録できる。
- POSTは `application/x-www-form-urlencoded`(UTF-8)。`User-Agent`の指定が無いと制限される場合がある。

## 判断

- **アプリ内にOAuthの画面フローは作らない。** 単一ユーザー用なので、アクセストークンを1回だけ取得(`scripts/hatena-oauth-setup.mjs`をローカルで実行)してWorkerのsecretに入れ、Workerが署名して呼ぶ。コンシューマ/アクセストークンのシークレットはブラウザに一切出ない。
- 署名は`worker/oauth1.js`(Web Cryptoのみ)。WorkerとNodeスクリプトで共有する。
- 既存ブックマークの**上書き事故を避ける**ため、記事を開いた時にGETで既存のコメント・タグを取得して入力欄に入れ、取得できるまで送信させない。UIは画面下部の「コメント入力+ブクマ」だけで、タグは編集しない(当初はボタンで開くフォームにタグ欄もあったが、2026-10-17に不要として削除)。ただしPOSTは既存のタグも置き換えるため、**既存のタグは取得して保持し、そのまま送り直す**。
- 投稿に成功しても記事ページは**再読み込みしない**(2026-10-17)。当初は0.8秒待って取り直していたが、実機で投稿直後のjsonliteに自分のコメントが載らないことがあり(はてな側の反映遅れと思われる)、待ち時間の調整では確実にならない。自分のidはアプリに無い(秘匿)ので「載ったか」を判定して再試行することもできない。そこで入力欄に保存された内容を残して確認できるようにした。
- Workerの応答は`{ok, comment, tags}`だけに絞る(はてなの応答に含まれるユーザー情報=idを返さない)。
- 認証は一覧と同じ`ACCESS_TOKEN`。**漏れるとあなたのアカウントで投稿される**点が一覧(公開情報の読み取り)より重い。長いランダム文字列にし、CORSも`ALLOWED_ORIGINS`で限定する。

## 一覧と投稿のアカウント不一致(2026-10-17に実害)

一覧は`HATENA_USER_ID`(secret)のアカウント、投稿は**OAuthの許可画面を開いたブラウザでログインしていたアカウント**に書き込まれる。この2つは別々に設定する値のため、許可を別アカウントのログイン状態で行うと「一覧はB(0件)、投稿はA」と食い違った(実際に起きた)。

- 対策: Workerが`https://n.hatena.com/applications/my.json`(`read_public`で足りる。`url_name`がトークンの持ち主)でOAuthの持ち主を調べ、`HATENA_USER_ID`と(大文字小文字を無視して)比べる。**食い違っていれば`GET/POST /bookmark`を409で拒否**し、はてなには投稿しない。持ち主を取れない時(通信失敗等)は止めずに通す(my.jsonの形が想定と違っても投稿できなくならないよう。実アカウントでの`url_name`は未確認)。結果は10分キャッシュ。
- `GET /check`でアカウントの一致を返す(idは返さず`same`/`different`/`unknown`だけ)。設定の「保存して接続確認」がこれを表示する。
- `scripts/hatena-oauth-setup.mjs`が、取得したトークンの持ち主を表示する(許可前に「使いたいアカウントでログインしているか」の注意も出す)。
- 直し方: ①意図したアカウントでログインしたプライベートウィンドウで許可し直し、`HATENA_ACCESS_TOKEN`/`HATENA_ACCESS_TOKEN_SECRET`を再登録、または②`HATENA_USER_ID`をOAuthの持ち主に合わせる。どちらも`wrangler secret put`後に再デプロイ不要(secretは即時反映。Workerコードの更新だけデプロイが要る)。

## 検証

- 署名: X(旧Twitter)の公式サンプルのテストベクトルと同じ入力で、実装とPythonの独立実装が同じ署名になることを確認。
- Worker: 上流(bookmark.hatenaapis.com)をモックし、署名を別実装で再計算して、GET/POST計5件(記号・日本語・複数タグ含む)がすべて一致。認証/CORS/入力検証/idを含まない応答も確認。画面(フォームの事前入力・更新・失敗時・未設定時)もモックWorkerで確認。
- OAuthの署名とPOSTは、実際にはてなへ書き込まれたことを確認済み(アカウント不一致のとき別アカウントに書き込まれた)。未検証は下記。

## 未検証・注意

- **既存タグの送り直し**(`tags=a&tags=b`の繰り返しで送っている)が実際に受理されるか。作者がタグを使っておらず確認できないため、確認の予定は無い(タグ付きのブックマークを更新する時にだけ関係する)。コメントの文字数上限の扱い。
- 失敗時の見え方: はてなが400を返すとアプリには「コメントを確認してください」と出る(文言は「コメントやタグ」)。401(署名/トークン不良)は中継側の問題として502になり「取得に失敗しました(HTTP 502)」と出る。

## 導入手順

1. https://www.hatena.ne.jp/oauth/develop でアプリを登録し、scopeに `read_public` `write_public` を許可。コンシューマキー・シークレットを控える。
2. `HATENA_CONSUMER_KEY=... HATENA_CONSUMER_SECRET=... node scripts/hatena-oauth-setup.mjs` を実行し、案内に従ってアクセストークンを取得。
3. `cd worker` で次のsecretを登録し、`npx wrangler deploy`。
   `ACCESS_TOKEN`(長いランダム文字列)/ `HATENA_USER_ID` / `HATENA_CONSUMER_KEY` / `HATENA_CONSUMER_SECRET` / `HATENA_ACCESS_TOKEN` / `HATENA_ACCESS_TOKEN_SECRET`
4. アプリの設定「同期」タブの「中継Worker」にWorker URLと`ACCESS_TOKEN`を入力。
