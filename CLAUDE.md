# CLAUDE.md

このリポジトリで作業を始める前に、必ず `README.md` を読むこと(特に「技術的な注意点」以降)。過去の設計判断・既知の制約が書かれており、それを知らずに変更すると過去に直した不具合を再発させることがある。

## 開発フロー

- ビルド工程は無い静的サイト。ローカル確認は `python3 -m http.server` 等で行う。
- ローカルの`http.server`は静的ファイルを積極的にキャッシュすることがあり、サーバー再起動・新規タブでも古い内容が返ることがある。検証時は`?bust=<値>`のようなクエリでキャッシュを回避する(本番は`deploy-pages.yml`が`?v=<sha>`を自動付与するため影響なし)。
- UI変更は必ずブラウザで実際に操作して確認してから完了報告する。

## 変更前に必ず確認すること

- `js/hatena-api.js`の`jsonp()`のコールバック名は**呼び出しごとにランダムでなければならない**。固定名にすると実際のはてなAPI(`b.hatena.ne.jp/entry/jsonlite/`)がハング/タイムアウトすることを実験で確認済み(README「コメント表示」参照)。
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

`hotentry-sync.yml`のcron scheduleが不定期にしか発火しない問題への緩和策として、gosyujin個人のMacから15分おきに`workflow_dispatch`を叩く仕組みがある。詳細はREADMEの「cronの定期取得が不安定な問題への対処」を参照。要点:

- 正本: `scripts/hateb-tycoon-dispatch.sh`(リポジトリ内、トークンは含まない)
- 実行実体: `~/scripts/hateb-tycoon-dispatch.sh`(TCC制約によりDropbox配下のパスではlaunchdから実行できないため、非保護パスにコピーしたもの)。**正本を変更したらこちらにも手動でコピーし直す必要がある**。
- 起動設定: `~/Library/LaunchAgents/com.gosyujin.hateb-tycoon-dispatch.plist`(再登録は`launchctl bootout gui/$(id -u)/com.gosyujin.hateb-tycoon-dispatch` → `launchctl bootstrap gui/$(id -u) <plist>`)
- 認証: macOS Keychainのサービス名`hateb-tycoon-dispatch-for-local-token`に保存されたFine-grained PAT(権限は対象リポジトリの**Actions: Read and write**のみで良い。Contents権限は不要かつ403の原因になった実績あり)。有効期限2026-12-25、更新が必要。
- ログ: `~/Library/Logs/hateb-tycoon-dispatch.log`
- この仕組みはgosyujinのローカル環境固有の話であり、リポジトリの一般的な動作には影響しない。
