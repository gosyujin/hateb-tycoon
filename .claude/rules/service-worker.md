---
paths:
  - "service-worker.js"
---
# Service Worker(service-worker.js)

- `handleNavigate()` は実URLではなく固定キー `'index.html'` でキャッシュを読み書きする。実URLのマッチングに戻すと、完全終了→機内モードで新規起動したときにアプリ全体がクラッシュする(サスペンド復帰では再現しないので見落としやすい)。[docs/decisions/sw-navigate-fixed-key.md](../../docs/decisions/sw-navigate-fixed-key.md)
- 一覧取得のフォールバック(`copyFromOldDataCaches` / 8秒フォールバック / 15秒タイムアウト+`caches.match` / `retryListIfNotLoaded`)は外さない。[docs/decisions/sw-unstable-network-list-fetch.md](../../docs/decisions/sw-unstable-network-list-fetch.md)
- 新規 JS を足したら `SHELL_FILES` に追加する(忘れるとオフライン起動で読み込めない)。
- 動作確認: サンドボックス化されたブラウザでは `register()` 自体が失敗する。SW 関連は本番オリジン(https://gosyujin.com/hateb-tycoon/)で `caches` API を直接叩いて確かめる。[docs/technical-notes.md](../../docs/technical-notes.md)
