# 「自分のブックマーク」ページ: 中継Workerでidを秘匿して取得する

## 背景・調査

特定のはてなユーザーのブックマーク一覧(`#/me`)を、コメントビューと同じplain/rich表示・フィルタ・検索で見たい。ただし**取得対象のはてなidは秘匿したい**(リポジトリ・公開サイト・ブラウザのURLや通信に出さない)。2026-10-14に実エンドポイントを調べた結果:

- `https://b.hatena.ne.jp/api/users/{id}/bookmarks?page=N`(JSON。コメント・タグ・日時・記事のタイトル/画像/ブックマーク数を含み、`pager.next`でページング可)が使える。RSS(`/{id}/bookmark.rss`)やユーザーページのHTMLも取れるが、情報はJSONで足りるためHTMLの解析は不要。
- いずれも `Access-Control-Allow-Origin: https://b.hatena.ne.jp` 固定(Originを変えても同じ)で、ブラウザの`fetch`では読めない。`callback`パラメータは無視されJSONPも使えない(`<iframe>`も中身を読めない)。
- そのため**サーバー側の中継**が必須。候補は(A)Cloudflare Worker / (B)GitHub Actionsで静的JSON化 / (C)`b.hatena.ne.jp`上で動かすブックマークレット。

## 判断

**(A) Cloudflare Worker(`worker/hateb-proxy.js`)を採用。**

- (B)は不可: 取得結果は公開サイトの`data/`に載り、各ブックマークの`user`からidが分かってしまう(hotentryと違いIDの秘匿が要件)。
- (C)も秘匿はできるが、更新のたびに手動実行が必要なため見送り。
- idはWorkerのsecret(`HATENA_USER_ID`)にだけ置く。アプリ側が持つのはWorkerのURLとアクセストークン(Worker側secret `ACCESS_TOKEN`と照合)だけで、どちらもこの端末のlocalStorageのみ(Gist同期の対象外)。
- Workerのレスポンスはidを含む項目(`user`オブジェクト等)を落とし、`{items:[{url,title,comment,tags,created,count,image}], nextPage}`に整形して返す。richの画像はアイコンではなく記事のサムネイル(`entry.image`)にしているのも、idを含むアイコンURLを組み立てないため。
- CORSは`ALLOWED_ORIGINS`(wrangler.tomlの`[vars]`)に列挙したオリジンのみ許可。トークン比較はSHA-256ダイジェスト同士の定時間比較。

## 結果・教訓

- 既存のコメントビュー(`commentLayout`)のplain/richを共有し、ミュート(`Filters.isHidden`のtitle/domain/url/comment)・ドメインボタン・×ボタン・選択文字クイックフィルタ・検索欄が効く。
- 取得は無限スクロール(sentinel)で、検索中と失敗後は自動継ぎ足しせずボタンにする(ヒットが少ない検索で全ページを読み続けたり、失敗を連打したりしないため)。
- 記事ページへのリンクに`from=me`を付け、「一覧に戻る」で`#/me`へ戻す。
- 取得失敗時は、成功した1ページ目をlocalStorageに保存した分を代わりに表示する。
- このWorkerには後からブックマーク投稿(OAuth署名)も載せた([bookmark-post-via-worker.md](bookmark-post-via-worker.md))。ルートは `GET /bookmarks`(一覧)のほか `GET/POST /bookmark`。デプロイ手順(secretの一覧を含む)は同docの「導入手順」。一覧だけ使うなら `ACCESS_TOKEN` と `HATENA_USER_ID` のsecretだけで動く。
