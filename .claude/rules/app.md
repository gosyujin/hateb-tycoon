---
paths:
  - "js/app.js"
  - "js/my-bookmarks.js"
  - "index.html"
---
# 一覧・記事ページ(js/app.js ほか)

- 無限スクロール: `renderNextPage()` 後の sentinel の `unobserve` → `observe` の再監視を外さない。[docs/technical-notes.md](../../docs/technical-notes.md)
- 自動リフレッシュ(`refreshListIfStale()`): 取得成功かつ内容が変わったときだけ差し替える。失敗時は表示中の一覧を消さない。[docs/features.md](../../docs/features.md)
- 自分のブックマーク(`js/my-bookmarks.js`・`#/me`): はてな id は Worker secret にだけ置き、コード・localStorage・URL・Worker のレスポンスに出さない。[docs/decisions/my-bookmarks-worker-proxy.md](../../docs/decisions/my-bookmarks-worker-proxy.md)
- ブックマーク投稿(記事ページの `bookmark-form`): POST は既存を上書きするので、既存の取得に成功するまで送信させない作りを外さない。投稿後に記事ページを再読み込みしない(jsonlite に自分のコメントがまだ載らないため)。[docs/decisions/bookmark-post-via-worker.md](../../docs/decisions/bookmark-post-via-worker.md)
- 新規 JS を足したら `service-worker.js` の `SHELL_FILES` に追加する。
