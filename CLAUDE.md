# CLAUDE.md

作業を始める前に `README.md` の概要を読むこと。ファイル別の「触ると壊れる箇所」は `.claude/rules/` にあり、Read / Edit ツールで該当ファイルを開くと自動で読み込まれる。Bash(`cat` / `sed` / `grep` など)で読み書きするときは自動では読み込まれないので、先に該当する `.claude/rules/*.md` を読む。詳細は該当作業のときだけ `docs/` を読む。過去の設計判断・既知の制約を知らずに変えると、直した不具合を再発させることがある。

## 開発フロー

- ビルド工程は無い静的サイト。ローカル確認は `python3 -m http.server` 等で行う。
- ローカルの`http.server`は静的ファイルを積極的にキャッシュすることがあり、サーバー再起動・新規タブでも古い内容が返ることがある。検証時は`?bust=<値>`のようなクエリでキャッシュを回避する(本番は`deploy-pages.yml`が`?v=<sha>`を自動付与するため影響なし)。
- UI変更は必ずブラウザで実際に操作して確認してから完了報告する。
- push前に構文チェックする(`node --check js/*.js`、Python は `python3 -m py_compile scripts/*.py`)。ビルド工程が無いので、構文エラーがそのまま本番に出る。
- 新規 JS ファイルを足すときは `service-worker.js` の `SHELL_FILES` にも追加する(忘れるとオフライン起動で読み込めない)。

## Git運用

- `hotentry-sync.yml`が高頻度で「Update hotentry data」を自動コミットする。pushの前に必ず`git fetch origin main`し、`git merge-base --is-ancestor origin/main HEAD`で確認、必要なら`git rebase origin/main`してからpushする。
- 変更内容を実装・検証したら、ユーザーから明示的な承認(「ok」「おk」等)を得るまでコミット・pushしない。
- push後は`gh run list --workflow=deploy-pages.yml`と`gh run watch <id> --exit-status`でデプロイ成功を確認してから完了報告する。
- コミットメッセージ・PR説明には、その時点でシステムから指示されているattribution行を必ず付与する(過去に付け忘れた実績があるため要注意)。メッセージは「何を」より「なぜ」を書く。

## 提案の範囲について

- ユーザーが明示的に保留・不要と言った事項(例: カテゴリータブのヘッダー移動、オフライン監視の自動化、記事ページの localStorage キャッシュ先出し、一覧から最初に開く記事を速くする3案=タップ時先読み・先頭数件の先読み・「読み込み中」表示の改善、一覧データから description を外す案)は、次に本人から話題が出るまで再提案・実装しない。
- 定期実行・監視の類を新たに自動化する提案は、明示的に依頼されない限り行わない。
- はてなの一覧データは RSS 由来でページングできないため「蓄積」方式になっている。JSON API の復活やページングを前提にした変更は提案しない。

## ローカル自動実行(gosyujin の Mac 固有)

- cron の不定期発火の緩和策として、Mac の launchd が15分おきに `hotentry-sync.yml` を `workflow_dispatch` している。手順と場所は [scripts/LAUNCHD.md](scripts/LAUNCHD.md)、経緯は [docs/decisions/cron-local-dispatch.md](docs/decisions/cron-local-dispatch.md)。
- 使っている PAT の有効期限は 2026-12-25。更新が必要。

## ドキュメント運用ルール

- 作業開始時は CLAUDE.md と README の概要だけ読む。docs/ は `.claude/rules/` の指示に従い、該当作業のときだけ読む。CHANGELOG は全文を読まず直近のエントリだけ見る。
- README に経緯・実装ログ・機能の詳細を書かない。機能を追加したら README には一行、詳細は docs/features.md に書く。
- 実装完了時は CHANGELOG に1〜3行で追記する。調査や判断に経緯がある場合は docs/decisions/ に書き、CHANGELOG からリンクする。
- 触ると壊れる箇所・変更禁止の理由は docs/technical-notes.md に書き、`.claude/rules/` の該当ファイル(`paths` に対象ファイルを書く)に1行で要約する。特定のファイルに結びつかない注意だけ CLAUDE.md に書く。
- 実機確認が必要で未確認の項目は technical-notes.md の「未検証」に書く。確認できたら削除し、CHANGELOG に「確認済み」と1行残す。
- README が150行、CLAUDE.md が200行を超えたら、追記せず分割を提案する。
