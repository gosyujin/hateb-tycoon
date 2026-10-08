# CHANGELOG

1エントリ1〜3行。バージョン番号は採番しておらず、日付とコミットhashで管理する(新しい順)。調査・判断に経緯があるものは [docs/decisions/](docs/decisions/) にあり、該当エントリからリンクする。自動コミット「Update hotentry data」は除く。

## 2026-10-09

- `243a353` Added: ファビコン(`icons/favicon-48.png`)とiOSホーム画面用アイコン(`icons/apple-touch-icon.png`)を追加

## 2026-10-08

- `26f4c95` Changed: 起動時、一覧ページはGist取り込み(最大3秒)を待たずに描画し、フィルタが変わった時だけ絞り直す
- `312f315` Changed: 「全て」タブ用にマージ済みデータを事前生成し、10リクエストを1本に削減(旧方式はフォールバックに温存)
- `4015b66` Changed: 一覧をCache Storageの前回分で先出しし、裏で更新して差し替える(「読み込み中…」で何も見れない時間を削減)
- `95e9c81` Changed: READMEの詳細をdocs/配下へ複写し、gist-sync-specをfeatures.mdへ統合

## 2026-10-07

- `8d55dbc` Added: 文字選択からミュートを直接登録できるポップアップを追加
- `65ae047` Added: ミュート設定に「タイトルとブックマークコメント」を追加しデフォルトにする
- `b8d7c3a` Changed: スワイプのリスナーをdocumentに付け、コメント無し記事の下部でも効くようにする

## 2026-10-06

- `58a0499` Added: スマホで一覧の操作列を一行に収め、ヘッダーに一括既読ボタンを追加する

## 2026-10-03

- `992cf6e` Added: Gist作成時にtycoon-scope-hosts.csvの初期ファイルも作る
- `a5279f1` Added: ユーザー単位で絞るホストをGistから追加できるようにする
- `9ab46f2` Changed: ブックマークページのドメインをクリックでミュート設定に渡せるようにする
- `719bba9` Added: richコメント表示にはてなスターの数を出す
- `80f10ea` Added: ブックマーク0件のURLでもはてなブックマークページへのリンクを出す
- `2fefc55` Added: 記事ページでも左右スワイプで前後の記事へ移動できるようにする
- `e150113` Changed: 記事ページの前後移動ボタンを画面下部に固定し一行に並べる
- `ec8680f` Added: 時間帯でライト/ダークを自動切替できるようにする
- `38b69e6` Changed: コメント非表示設定の自動登録を、ブログ/ユーザー単位の前方一致に拡張
- `99862f0` Fixed: スマホで設定ポップアップが画面上にはみ出る問題を修正
- `345c6ed` Added: 設定画面をメイン/表示/同期の3タブに分割し、メインに同期ボタンを追加

## 2026-10-02

- `08540ca` Changed: 自動スクロールの速度を設定可能にし、設定画面の表示中は止める
- `b858bc3` Added: ヘッダーに自動スクロールのON/OFFボタンを追加する
- `c802b54` Changed: 長いURLやドメインがスマホ幅で横スクロールを起こさないよう折り返す
- `c0af2c6` Fixed: 未ブックマークのURLを開いた時のnull例外を、専用の表示に直す
- `eb7ad21` Changed: コメント本文中のURLを個別記事ページへのリンクにする
- `32a1202` Changed: plain表示の「更新」を、行の流れに入れず左端の線だけで示す
- `28f339f` Changed: READMEに「更新」バッジの文言を決めた経緯を追記する
- `a57fc63` Changed: 一覧のplain表示でタイトルもブックマークページへのリンクにし、既読バッジを「更新」に変える
- `c3c5339` Fixed: 通信が不安定なスマホPWAで一覧が「Load failed」のまま復帰しない不具合に備える([経緯](docs/decisions/sw-unstable-network-list-fetch.md))
- `0b25bdd` Changed: コメント一覧が非表示設定の記事を検出し、表示を分けてミュートに自動登録する
- `b6d3181` Changed: 前後の記事移動と先読みで、既読かつ更新なしの記事を読み飛ばす
- `371a847` Changed: 個別記事ページの検索欄からもURL入力で別のブックマーク一覧へ移れるようにする
- `c4fac55` Changed: 一覧の検索欄にURLを入力してEnterで、そのURLのブックマーク一覧を開けるようにする

## 2026-10-01

- `5b03bd6` Fixed: 前後の記事を先読みして、記事移動時の取得待ちをなくす
- `86ed3e1` Changed: perf=1 をハッシュ内に付けても計測ログが出るようにする
- `bf214e3` Changed: 記事ページの体感速度を計測可能にし、ヘッダーを一覧データで先出しする
- `2860d07` Changed: 一覧を前面復帰時に自動リフレッシュする(feed-tycoonと同方式)

## 2026-09-30

- `aedec9e` Changed: モーダル内の見出し(h3・.sub-heading)のmarginを0にする
- `15d8e7b` Changed: .sub-headingの上下marginをモーダル内の他要素と同じ8pxに揃える
- `5525c91` Fixed: フィルタ同期で重複行がGistに書かれる不具合の修正と、設定画面の並び替え
- `0f84e15` Changed: フィルタGistのファイル名からアプリ名を外し、他アプリ専用の行を上書きで消さないようにする
- `ac1f206` Added: フィルタ設定もGist IDだけで端末間同期できるようにする
- `b8031df` Added: 既読をシークレットGist経由で端末間同期できるようにする
- `32b5624` Changed: 設定モーダルの説明を「?」開閉式にし、項目順とレイアウトを整理
- `2c52332` Changed: 既読トグルのラベルを「既読なら非表示」に統一
- `591d3c1` Added: launchd登録用plistを追加
- `4bb995c` Changed: フィルタCSVの未対応typeを無視してfeed-tycoonとGistを共有可能にする
- `9064a4b` Added: launchd登録手順のドキュメントを追加
- `0d58fe0` Changed: スマホ幅でヘッダーのタイトルを1行に収める
- `af842a0` Changed: はてブページへのリンクをボタン化してiOS Safariで表示されるようにする
- `a59dd2f` Changed: 起動時に登録済みGistのフィルタを自動インポートする

## 2026-09-29

- `a6f30c0` Fixed: 縦長ディスプレイ×plain表示で一覧の継ぎ足しが止まる不具合を修正
- `e03a13d` Changed: コメントページの既読/新着の見た目を一覧ページの表現に揃える
- `66483e6` Added: コメントページで前回訪問後に付いたコメントにNEWバッジを付ける

## 2026-09-28

- `d8c89d4` Changed: 記事詳細ページのコメント表示切替(rich/plain)の並び順をトップページの一覧レイアウト切替と揃える
- `acf248a` Added: スマホ幅でplain表示のタイトル+カウントを1つのタップ領域に統合し、一覧の横スワイプでカテゴリー切替できるようにする
- `627d5ee` Changed: 既読+更新バッジの文言を「既読」に簡略化

## 2026-09-27

- `1aa290f` Changed: 既読状態を「未読/既読/既読+更新」の3種類に分離
- `d935ea9` Changed: hateb-tycoonリンクの強制リロードをオフライン時は素の再読み込みに留める
- `19332a3` Fixed: hateb-tycoonリンクのリロードでService Worker/キャッシュも強制的に作り直す
- `21e1c25` Changed: ヘッダーの「hateb-tycoon」リンクを「一覧に戻る」と役割分離
- `ea3576b` Changed: 一覧ページplain表示の既読グレーアウトを背景色付きで強調
- `19923a3` Changed: ブックマーク画面下部の「一覧に戻る」ボタンを前後記事ボタンと同じ幅いっぱいに拡大
- `1f9fe8b` Fixed: 前後記事ボタンでのスクロール先頭リセットが効かないことがある不具合を修正
- `c09dba2` Added: オフライン用キャッシュのデフォルト件数を100件にし、ヘッダーから即時実行できるボタンを追加
- `7f91504` Fixed: スマホ幅で一覧のplain/rich切替追加により発生した横スクロールを修正
- `f9bb4d1` Changed: 一覧plain表示の時刻・ドメイン列を固定幅にしてタイトルの開始位置を揃える
- `2f81a25` Added: 一覧ページにplain/rich表示切替を追加

## 2026-09-26

- `be2eea0` Changed: フィルタ設定の登録ルール一覧をアコーディオン化
- `6f17c12` Changed: フィルタ設定のURLインポートでgist.github.com形式のRaw URLにも対応
- `d25d0b9` Changed: カード日付表示を「更新 yyyy-mm-dd」から「更新 yyyy/m/d H:m」に変更
- `ba9566a` Changed: README/CLAUDE.mdに今回のセッションで実装した機能の経緯と運用上の注意を追記
- `07a6e9e` Added: hotentry-sync手動起動用のローカルスクリプトを追加
- `9724056` Changed: 並び替えセレクトの表示幅を縮める
- `42f033f` Added: ヘッダー検索ボックスを追加、カードの日付表示をはてな更新日時に統一
- `635c6fe` Fixed: フッターのリンクがクリックできない不具合を修正
- `9aec76f` Changed: 「次回更新」をhotentry-sync.ymlのActionsページへのリンクにする
- `12e2a67` Fixed: 機内モードでアプリを新規起動するとエラーになる不具合を修正
- `03d177a` Fixed: フィルタ追加フォームがスマホ幅ではみ出す不具合を修正
- `6ef95b0` Changed: 記事概要(blockquote)を視覚的にも引用とわかるスタイルに
- `0681296` Changed: 記事概要(entry-description)をpからblockquoteに変更
- `4674757` Changed: デフォルトカテゴリーを「全て」に変更
- `5311bfe` Fixed: 記事間移動時にスクロール位置が引き継がれてしまう不具合を修正
- `c062014` Added: オフライン一括キャッシュ機能と前後記事ボタンを追加
- `65ebfed` Changed: オフライン(機内モード)でも取得済みの内容を見られるようにする

## 2026-09-25

- `00050e5` Changed: 一覧に戻るボタンをhistory.back()から直接遷移に変更
- `769c8a2` Added: ブックマークページに「このページをフィルタに登録する」ボタンを追加
- `6d6e5b3` Added: キーボードショートカット(矢印キー)で記事間を移動できるようにする
- `392d0d7` Changed: ブックマーク数の強調表示閾値を20/50/100/200に変更
- `87a26ff` Added: カード右上に×ボタンを追加、このページ単独をURL完全一致でミュート
- `d0d3a22` Added: コメント一覧にplain/rich表示切替を追加、選択を記憶
- `44fc57c` Changed: CSV/テキストエクスポートのBlobにcharset=utf-8を明示
- `3f12e85` Changed: 歯車アイコンからのフィルタ設定オープン時、種別選択をタイトルにリセット
- `1b2a9fc` Added: カテゴリーに「全て」を追加(総合+他カテゴリー限定記事をマージ)
- `5734cff` Changed: URLから取得がGist rawの場合、逆引きしたGistページへのリンクを表示
- `bf3a0c7` Added: フィルタエクスポートにクリップボードコピー/テキスト表示を追加
- `500057d` Changed: 既読カードのbrightnessを0.85に変更(動作確認用)
- `a4cdfff` Changed: 定期実行ワークフローのファイル名を変更(schedule未発火の切り分け)
- `77346b0` Changed: コメント無し表示を「矢印形状の変更」から「N users →全体の取り消し線」に変更
- `82c6152` Changed: 既読グレーアウト時でもコメント無し表示を判別できるよう矢印の形状を変える
- `d8e9337` Changed: 歯車アイコン化・更新ボタン削除・戻り時のスクロール位置復元を実装
- `8b733c2` Changed: コメントが無い/取得できない記事のN usersをグレー表示にする
- `f20666f` Fixed: 設定モーダルのタブ(mute/unmute/forceMute)が表示領域に収まらない問題を修正
- `b56ba88` Added: 既読判定にブックマーク数の増加閾値を導入し、設定可能にする
- `84a0f1c` Changed: 既読カードのグレーアウトを濃くする
- `254927b` Changed: 既読の記事カードを常にグレーアウト表示する
- `1b650fb` Added: コメントページの既読状態を管理し、一覧で既読を非表示にできるようにする
- `87f5793` Added: 一覧のソート機能を追加(取り込み順/ブックマーク数順/はてな更新日時順/タイトル順)
- `271f326` Changed: Replace even flex-shrink truncation with measured min-2-char fitting
- `bbe299e` Changed: Keep category tabs + refresh button on one row on desktop too
- `7a8837b` Changed: Fix footer to bottom-right, matching scrapbox-tycoon's .status-bar
- `ea48f32` Changed: Match header/footer spacing and content width to scrapbox-tycoon
- `7ea79ab` Changed: Set form inputs to 16px to stop iOS Safari auto-zoom on focus
- `12bf12c` Changed: Sort mute-word lists by type asc, value asc
- `984938c` Changed: Re-add fetch-hotentry.yml (identical content)
- `3e45958` Changed: Temporarily remove fetch-hotentry.yml to force GitHub to re-register it
- `f3bd600` Changed: Nudge cron minute (7,37 -> 12,42) to see if a fresh push re-registers it
- `c3db812` Changed: Add bottom back-to-list button and weight cards by bookmark count
- `ecebabc` Changed: Retry the data push on conflict from overlapping runs
- `13eb18e` Changed: Force-wrap long unbroken strings in comments/titles/descriptions
- `6d4fc18` Changed: Add dividers between comments and show article description
- `2b92c97` Changed: Move fetch-hotentry cron off :00/:30 to reduce delay/skips
- `b377510` Changed: Add CSV export/import for mute/unmute/forceMute word lists
- `e372e4b` Changed: Clicking a comment's user opens settings pre-filled for muting them
- `a48ffae` Changed: Clicking a card's domain opens settings pre-filled for muting it
- `ac2f503` Changed: Keep sha/build time in footer, just drop the "build:" label
- `a1f5598` Changed: Drop build info from footer, hide comment-less bookmarks, mute dates
- `e7231c5` Changed: Simplify comment list to plain one-line ul/li entries
- `e75f4f1` Changed: Reorder card layout: (初出 / users link) row, domain, untruncated title
- `fe48370` Changed: Simplify footer to a single "build: sha (time) / 次回更新: HH:MM頃" line
- `9a4888f` Changed: Backfill firstSeenAt/lastSeenAt for entries that drop out of the RSS
- `6fa6ea3` Changed: Fix KeyError when migrating pre-accumulation data files
- `b2f9e2e` Changed: Accumulate hotentry history and add infinite scroll
- `03792ed` Changed: Mobile layout fixes, JST build time, and data freshness footer
- `8ba5b36` Changed: Drop the book category: hotentry/book.rss 404s
- `0d40892` Changed: Explicitly trigger Pages redeploy after the data-fetch commit
- `86214e2` Changed: Replace public CORS proxies with a scheduled data snapshot in-repo
- `db9ef75` Changed: Show build hash/time in footer and cache-bust deployed assets
- `2962d0b` Changed: Fall back across multiple CORS proxies for the RSS fetch
- `a45f63a` Changed: Switch hot-entry list from the dead hotentry.json API to RSS

## 2026-09-24

- `8ad3d9e` Changed: Fix settings modal close and hot-entry URL for the 総合 category
- `717cf18` Changed: Rename blacklist/whitelist/forceBlock to mute/unmute/forceMute
- `47888e8` Changed: Auto-enable GitHub Pages in the deploy workflow
- `7a18941` Changed: Add GitHub Actions workflow to deploy to GitHub Pages
- `96969a3` Changed: Add hateb-tycoon: filtered Hatena Bookmark viewer
