# CLAUDE.md

このリポジトリで作業を始める前に、`README.md` の概要を読むこと。詳細は下記「ドキュメント運用ルール」「触る前に読む」に従い、該当作業のときだけ `docs/` を読む。過去の設計判断・既知の制約が書かれており、それを知らずに変更すると過去に直した不具合を再発させることがある。

## 開発フロー

- ビルド工程は無い静的サイト。ローカル確認は `python3 -m http.server` 等で行う。
- ローカルの`http.server`は静的ファイルを積極的にキャッシュすることがあり、サーバー再起動・新規タブでも古い内容が返ることがある。検証時は`?bust=<値>`のようなクエリでキャッシュを回避する(本番は`deploy-pages.yml`が`?v=<sha>`を自動付与するため影響なし)。
- UI変更は必ずブラウザで実際に操作して確認してから完了報告する。

## 変更前に必ず確認すること

- `js/hatena-api.js`の`jsonp()`のコールバック名は**呼び出しごとにランダムでなければならない**。固定名にすると実際のはてなAPI(`b.hatena.ne.jp/entry/jsonlite/`)がハング/タイムアウトすることを実験で確認済み([docs/technical-notes.md](docs/technical-notes.md)参照)。
- `service-worker.js`の`handleNavigate()`は実URLではなく固定キー`'index.html'`でキャッシュを読み書きする実装になっている。実URLでのマッチングに戻すと、プロセスを完全終了してから機内モードで新規起動した場合にアプリ全体がクラッシュする(サスペンド復帰では再現しないため見落としやすい)。
- Service Workerはサンドボックス化されたブラウザ検証環境では`register()`自体が失敗し動作確認できない。SW関連の変更は本番オリジン(https://note.gosyujin.com/hateb-tycoon/)に対して`caches`APIを直接叩いて検証する。
- はてなの一覧データはRSS由来でページング不可なため「蓄積」方式(`firstSeenAt`/`lastSeenAt`)になっている。JSON API復活やページング機能を前提にした変更は提案しない。

## Git運用

- `hotentry-sync.yml`が高頻度で「Update hotentry data」を自動コミットする。pushの前に必ず`git fetch origin main`し、`git merge-base --is-ancestor origin/main HEAD`で確認、必要なら`git rebase origin/main`してからpushする。
- 変更内容を実装・検証したら、ユーザーから明示的な承認(「ok」「おk」等)を得るまでコミット・pushしない。
- push後は`gh run list --workflow=deploy-pages.yml`と`gh run watch <id> --exit-status`でデプロイ成功を確認してから完了報告する。
- コミットメッセージ・PR説明には、その時点でシステムから指示されているattribution行を必ず付与する(過去に付け忘れた実績があるため要注意)。メッセージは「何を」より「なぜ」を書く。

## 提案の範囲について

- ユーザーが明示的に保留・不要と言った事項(例: カテゴリータブのヘッダー移動、オフライン監視の自動化)は、次に本人から話題が出るまで再提案・実装しない。
- 定期実行・監視の類を新たに自動化する提案は、明示的に依頼されない限り行わない。

## ローカル自動実行インフラ(gosyujin個人のMac環境)

`hotentry-sync.yml`のcron scheduleが不定期にしか発火しない問題への緩和策として、gosyujin個人のMacから15分おきに`workflow_dispatch`を叩く仕組みがある。詳細は[docs/decisions/cron-local-dispatch.md](docs/decisions/cron-local-dispatch.md)を参照。要点:

- 正本: `scripts/hateb-tycoon-dispatch.sh`(リポジトリ内、トークンは含まない)
- 実行実体: `~/scripts/hateb-tycoon-dispatch.sh`(TCC制約によりDropbox配下のパスではlaunchdから実行できないため、非保護パスにコピーしたもの)。**正本を変更したらこちらにも手動でコピーし直す必要がある**。
- 起動設定: `~/Library/LaunchAgents/com.gosyujin.hateb-tycoon-dispatch.plist`(再登録は`launchctl bootout gui/$(id -u)/com.gosyujin.hateb-tycoon-dispatch` → `launchctl bootstrap gui/$(id -u) <plist>`)
- 認証: macOS Keychainのサービス名`hateb-tycoon-dispatch-for-local-token`に保存されたFine-grained PAT(権限は対象リポジトリの**Actions: Read and write**のみで良い。Contents権限は不要かつ403の原因になった実績あり)。有効期限2026-12-25、更新が必要。
- ログ: `~/Library/Logs/hateb-tycoon-dispatch.log`
- この仕組みはgosyujinのローカル環境固有の話であり、リポジトリの一般的な動作には影響しない。

## ドキュメント運用ルール

- 作業開始時は CLAUDE.md と README の概要だけ読む。docs/ は「触る前に読む」に従い、該当作業のときだけ読む。CHANGELOG は全文を読まず直近のエントリだけ見る。
- README に経緯・実装ログ・機能の詳細を書かない。機能を追加したら README には一行、詳細は docs/features.md に書く。
- 実装完了時は CHANGELOG に1〜3行で追記する。調査や判断に経緯がある場合は docs/decisions/ に書き、CHANGELOG からリンクする。
- 触ると壊れる箇所・変更禁止の理由は docs/technical-notes.md に書き、CLAUDE.md の「触る前に読む」に1行で要約する。
- 実機確認が必要で未確認の項目は technical-notes.md の「未検証」に書く。確認できたら削除し、CHANGELOG に「確認済み」と1行残す。
- README が150行、CLAUDE.md が200行を超えたら、追記せず分割を提案する。

## 触る前に読む

- ミュート判定・フィルタ・Gist同期(`js/filters.js` `js/filter-sync.js` `js/gist.js` `js/sync.js`): [docs/features.md](docs/features.md)。判定は forceMute → mute(unmuteで例外)の順。Gist同期は積み上げ方式で削除は同期されず、不正CSVの種類は取り込まず上書きもしない。
- コメント取得(`js/hatena-api.js`): [docs/technical-notes.md](docs/technical-notes.md)。JSONPのコールバック名は呼び出しごとにランダム固定禁止(固定名にするとはてなAPIがハングする)。
- 一覧の無限スクロール(`js/app.js`): [docs/technical-notes.md](docs/technical-notes.md)。`renderNextPage()`後のsentinelの`unobserve`→`observe`再監視を外さない。
- 一覧の自動リフレッシュ(`refreshListIfStale()`): [docs/features.md](docs/features.md)。取得成功かつ内容変化時のみ差し替え、失敗時は表示中の一覧を消さない。
- 長い文字列を表示する要素: [docs/technical-notes.md](docs/technical-notes.md)。`overflow-wrap: anywhere`の折り返し指定を付ける。
- Service Worker(`service-worker.js`)のナビゲーション: [docs/decisions/sw-navigate-fixed-key.md](docs/decisions/sw-navigate-fixed-key.md)。`handleNavigate()`は固定キー`'index.html'`で読み書きし、実URLマッチングに戻さない。
- Service Workerの一覧取得フォールバック: [docs/decisions/sw-unstable-network-list-fetch.md](docs/decisions/sw-unstable-network-list-fetch.md)。`copyFromOldDataCaches` / 8秒フォールバック / 15秒タイムアウト+`caches.match` / `retryListIfNotLoaded`は外さない。
- SW関連の動作確認: [docs/technical-notes.md](docs/technical-notes.md)。サンドボックス環境では`register()`が失敗するため、本番オリジンで`caches`APIを直接叩く。
- 一覧データの取得(`scripts/fetch_hotentry.py` `hotentry-sync.yml`): [docs/decisions/hotentry-rss-via-actions.md](docs/decisions/hotentry-rss-via-actions.md)。RSSはページング不可のため蓄積方式(300件・14日)、JSON API復活前提にしない。
- ローカルdispatch(`scripts/hateb-tycoon-dispatch.sh`): [docs/decisions/cron-local-dispatch.md](docs/decisions/cron-local-dispatch.md)。正本変更時は`~/scripts/`へ手動コピー、PATはActions権限のみ。
- 新規JSを足す時: [docs/features.md](docs/features.md)。`service-worker.js`の`SHELL_FILES`に追加しないとオフライン起動で読み込めない。
