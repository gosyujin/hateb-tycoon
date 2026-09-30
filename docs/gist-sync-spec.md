# フィルタのGist同期 仕様(hateb-tycoon実装 → feed-tycoon移行用)

hateb-tycoon コミット `ac1f206` で導入した仕様。feed-tycoon も同じ方式へ移行するための引き継ぎ資料。
実装の正本は hateb-tycoon の `js/gist.js` / `js/filter-sync.js` / `js/app.js`(「フィルタの同期」節)。

## 1. 概要

- フィルタルール(hateb-tycoonは mute / unmute / forceMute の3種)を、**シークレットGist**経由で端末間共有する。
- 設定するのは **Gist ID だけ**(GistのURLを貼ってもIDを抽出する)。ルールの保存形式は従来どおりCSV(`type,value`)。
- 既読の同期(hateb-tycoon `js/sync.js`)と同じ操作感・同じトークン。
- **旧仕様(種類ごとにGist rawURLを登録して取り込む)は廃止**。移行処理は入れていない。

## 2. Gistの構成

- 1つのGistに、ルールの「種類(kind)」ごとに1ファイル。ファイル名は `tycoon-filter-<kind>.csv`(**アプリ名を含めない**。プロジェクト間で同じGist・同じファイルを共有する)
  - `tycoon-filter-mute.csv` / `tycoon-filter-unmute.csv` / `tycoon-filter-forceMute.csv`
  - feed-tycoon も**同じファイル名**を使う。kindはhateb-tycoonと同じ3種(mute/unmute/forceMute)を前提とする(feed-tycoon側に他のkindがあれば別途協議)。
- CSV形式: 1行目ヘッダー `type,value`、改行 `\r\n`、`,` `"` 改行を含む値は `"` で囲み `""` でエスケープ。出力は `type asc, value asc` ソート済み。
- 説明(description): `hateb-tycoon filters`。`public: false`(シークレット)。

### type の扱い(feed-tycoon固有の注意)
- 取り込み時、自アプリが扱わない type の行はエラーにせず無視して件数を数える(結果に「未対応の種別N件は無視」)。
  hateb-tycoon が扱うのは `title`/`domain`/`user`/`comment`/`url`。feed-tycoon は加えて `source`/`tag`/`description` も扱うので、それらは取り込む(逆に feed-tycoon が扱わない type があれば無視)。
- **ファイルを共有するため、上書き時は「リモートCSVにあった未対応typeの行」をそのまま残して書き出す**(相手アプリのルールを消さない)。実装: パーサーが無視した行を `ignoredRules` として返し、push時にローカルルールと合わせてソートして出力する。**feed-tycoon側でも必ず同じ保持処理を入れること**(入れないと hateb-tycoon 専用type の行を上書きで消す)。

## 3. トークン(両同期で共通)

- classic PAT の `gist` スコープ(fine-grained PATはGist非対応)。
- **独立した入力欄**「GitHubトークン(Gist用)」に分離。既読同期・フィルタ同期の両方がこれを使う。
- 保存先: `localStorage['hateb-tycoon:gistToken']`(feed-tycoonは自アプリのキー名にする)。
  - 入力欄の `change` イベントで保存。各「保存して同期」「Gistを作成」ボタンでも押下時に最新値を保存してから処理する。
  - 旧仕様で既読同期の設定(`hateb-tycoon:sync`)内に同居していたトークンは、新キーが未設定の時のみ自動で引き継ぐ(空文字を保存済みなら再移行しない)。
- **読み取りにトークンは不要**(シークレットGistはIDを知っていれば読める)。トークン空の端末は読み取り専用。

## 4. UI

インポート・エクスポート設定セクションの下部に「フィルタの同期(Gist・全種まとめて)」:

1. Gist ID 入力欄(placeholder「Gist ID または URL」)+ 「↗」リンク
2. ボタン: 「保存して同期」「Gistを作成」
3. ステータス行(`filter-sync-status`): 未設定 / 「読み書き|読み取り専用 / 最終同期 <日時> [/ エラー: …]」
4. 結果詳細は既存のインポート結果欄(`import-status`)に表示

- 「↗」: `https://gist.github.com/<ID>`(**アカウント名不要**。IDだけで持ち主のGistページへリダイレクトされる)。IDが空なら非表示。入力欄の `input` イベントでも更新。既読同期側にも同じ「↗」を付けた。
- 種類タブ(「対象: ミュート」)とは**連動しない**。同期は全種まとめて。CSVコピー/エクスポート/ファイルインポートは従来どおり選択中の種類のみ。
- 旧「Gistから取得」URLフォームと「↗」(rawURL用)は削除。

## 5. 動作仕様

### 「Gistを作成」
1. Gist IDをクリアして設定 → 全kindのローカルCSV(ヘッダーのみでも可)で `POST /gists`(トークン必須、無ければ「先にトークンを入力してください」)。
2. 返ったIDを保存 → 続けて「保存して同期」と同じ処理を実行。

### 「保存して同期」(`FilterSync.sync`)
1. 入力欄のIDを保存(ETagはクリア)。ID空ならエラー「Gist IDを入力してください」。
2. `GET /gists/<id>`(ETagなしで全量取得)。
3. 各kindについて、リモートCSVを **取り込み(マージ)**:
   - ファイル無し/空/ヘッダーのみ(`type,value`だけ)→ 「リモートにルール無し」(スキップ。※パーサーは空データをエラーにするので先に除外する)
   - 解析エラーが1行でもある → **その種類は取り込まず、上書きもしない**(手編集途中の壊れたCSVをローカルで潰さないため)。エラーは結果に表示。
   - それ以外 → 既存ルールと重複(`type` + `value` の大文字小文字無視一致)しない分だけ追加(`Filters.importRules`)。
4. トークンがあれば **上書き(push)**: 不正CSVでない各kindについて、ローカルルール(ソート済みCSV)とリモートCSVを改行正規化・trimして比較し、**差分のあるファイルだけ** `PATCH /gists/<id>` で更新。
   - ローカル0件かつリモートファイル無し/空のkindは作らない。
   - 差分が無ければPATCHしない。書き込んだ場合はETagをクリア(自分の書き込みでETagが変わるため)。
5. 最終同期時刻を保存。結果表示: 「N件を取り込み、Gistへ Nファイルを書き込み|トークン未設定のため書き込みなし、未対応の種別N件は無視 / 不正なCSVは取り込まず上書きもしていません(kind: エラー…)」
6. 取り込み後はルール一覧と一覧画面を再描画。失敗時は `lastError` を保存して「失敗: <理由>」。

**積み上げ方式**: 同期 = リモートとローカルの和集合。**削除は同期されない**。消したい時はGist側のCSVを直接編集する(ただし他端末のローカルに残っていれば次の同期で復活する)。

### 起動時(`FilterSync.syncOnStartup`)
- Gist ID設定済みなら、最初の描画前に **取り込みのみ**(書き込みなし)。
- 保存済みETagで `If-None-Match` 付きGET。304なら何もしない(レート制限にも数えられない)。200なら上記マージを実行しETagを保存。
- 待つのは最大3秒(`STARTUP_IMPORT_TIMEOUT_MS`)。失敗・タイムアウトは無視して通常起動(`lastError`は保存、コンソールにwarn)。
- 既読同期の起動時pullと並列実行(`Promise.all`)してから初回描画。

### エラー文言(`Gist.describeHttpError`)
401 トークンが無効です(失効の可能性) / 403 アクセス拒否またはレート制限です / 404 Gistが見つかりません(IDまたはトークンの権限を確認) / その他 `HTTP <status>`

## 6. モジュール構成(hateb-tycoon)

| ファイル | 役割 |
|---|---|
| `js/gist.js`(新規) | `Gist`: トークン get/set(旧設定からの移行込み)、`parseGistId`、`pageUrl`、`get(id, etag)`(304→null)、`fileText`(truncated時はraw_url取得)、`update`(PATCH)、`create`(POST, public:false)、`describeHttpError` |
| `js/filter-sync.js`(新規) | `FilterSync`: `init({parseCsv,toCsv})`、`sync`、`syncOnStartup`、`createGist`、`configure`、`getConfig`。状態は `localStorage['hateb-tycoon:filterSync']` = `{gistId, etag, lastSyncAt, lastError}` |
| `js/sync.js`(改修) | 既読同期。トークンを `Gist` 共通管理へ移し、API呼び出しも `Gist` 経由に |
| `js/app.js` | CSV解析/生成(`parseImportCsv`/`rulesToCsv`)を `FilterSync.init` に注入、UI配線、起動時同期 |
| `index.html` / `css/style.css` | トークン欄・同期欄のUI、`.gist-row` スタイル |
| `service-worker.js` | `SHELL_FILES` に `js/gist.js` `js/filter-sync.js` を追加(**忘れるとオフライン起動で読み込めない**) |

スクリプト読み込み順: `filters.js` → `visited.js` → `gist.js` → `sync.js` → `filter-sync.js` → … → `app.js`。

## 7. feed-tycoon移行時のチェックリスト

- [ ] ファイル名は `tycoon-filter-<kind>.csv`(共通)、localStorageキーはfeed-tycoon専用にする
- [ ] 未対応type行を取り込まずに保持し、上書き時にそのまま書き戻す
- [ ] `source`/`tag`/`description` を含むtypeを対象に取り込む(それ以外は無視カウント)
- [ ] トークン欄を独立させ、既読同期など他のGist利用と共有、旧設定からの移行
- [ ] 旧「インポート用URL」UI・起動時rawURL自動取り込みを削除
- [ ] Service Workerのキャッシュ対象に新規JSを追加
- [ ] 検証: トークン無し=取り込みのみ / トークン有り=書き込み / 差分なしはPATCHなし / 作成はprivateで全ファイル / 不正CSVは取り込まず上書きもしない / 起動時は304で軽い
- [ ] 既存の手持ちルールが消えないこと(旧URL登録の内容は新Gistへ積み上げ直し)
