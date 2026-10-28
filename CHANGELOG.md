# CHANGELOG

1エントリ1〜3行。バージョン番号は採番しておらず、日付とコミットhashで管理する(新しい順)。調査・判断に経緯があるものは [docs/decisions/](docs/decisions/) にあり、該当エントリからリンクする。自動コミット「Update hotentry data」は除く。

## 2026-10-28

- Added: ストリーム表示にもrich/plainの切替を付けた(記事ページ・自分のブックマークと`commentLayout`を共有)。サムネイルはrichだけに出し、richではコメントにユーザーアイコン・タグ・はてなスター数も出す(スターはrichの間だけ取得)。詳細は[docs/features.md](docs/features.md)のストリーム表示。
- Changed: ストリーム表示で、先頭(=最新)の記事だけ背景を淡い青にして「これが最新」と分かるようにした(CSSの`:first-child`のみ。新着が入ると青が移る。ダークテーマ用に`--color-latest-bg`も用意)。確認済み: ライトテーマで先頭だけ青くなること(ローカル)。未確認: ダークテーマの見え方、実機

## 2026-10-26

- Changed: スマホ幅(640px以下。サムネを隠す境界と同じ)では、ストリームと記事ページの概要を最初から畳んだ状態(3行、「▼ 続きを読む」)で出す。それより広い幅は従来どおり全文。幅は表示(描画)時点で判定し、開いたまま幅を変えても再判定しない。確認済み: 375pxで畳んだ状態から始まり、押すと開くこと(ストリーム・記事ページ)、1000pxでは全文で始まること(ローカル)
- Changed: ストリーム表示の自動間隔の添え書きを「(57秒ごと)」から「(57秒間隔で更新)」「(5分間隔で更新)」にした(何の秒数か分かりにくかったため)。狭い幅で1行に収まるよう、文字を小さく・余白を詰めた。確認済み: 375pxで秒・分の表記とも省略されず1行(ローカル)
- Fixed: `meta.json`の次回更新の目安(フッターの「次回更新」・ストリーム表示の自動間隔の元)を「実行時刻+30分」から「+15分」にした。実際のデータ更新はローカルからのdispatchで15分おきなのに、30分後と出ていたため自動の間隔が約2倍遅くなっていた。Macが止まっている間(cronの30分間隔)は目安を過ぎることがあるが、その間は「更新待ち」扱いで流す
- Fixed: ストリーム表示のカウントダウンを、データ更新まで(「更新まで/残り N秒」)から、次の記事を1件流すまで(「次まで N秒」)に直した。データ更新までを数えていると、どの更新の秒数か分かりにくかったため。自動の間隔の計算にはこれまでどおり次回更新の目安を使う。確認済み: 自動・手動・一時停止・待機が空の時の表示(ローカル)
- Changed: ストリームと記事ページの概要の見え方を揃えた。概要が3行以内でも「▲ 閉じる」を出す(短い概要は畳んでもラベルが「▼ 続きを読む」に替わるだけ)。概要が無い記事は「記事が取得できませんでした(理由)」を出す。理由は取得時に`bodyReason`へ記録する(`scripts/fetch_hotentry.py`。理由を残す前にskipにした記事は1回だけ取り直す)。畳めるかを行数で測る処理と、画面幅変更時の再判定は不要になり削除。確認済み: 概要なし(HTTP 403・robots・503・理由なし・未取得)・短い概要・長い概要の表示と、閉じる・続きを読むの切り替え(ローカル)。未確認: 実際のデータに理由が入った後の表示
- Changed: 記事ページ(`#/entry`)の概要も、ストリームと同じく全文を出し、3行を超える時だけ「▲ 閉じる」/「▼ 続きを読む」で畳めるようにした(本文を取れなかった記事はRSS由来の概要のまま)。確認済み: 本文の抜粋(300字)の記事で畳む・開く・開き直しで全文に戻ること、短い概要には目印が出ないこと(ローカル)
- Changed: ストリーム表示の概要を、初期状態で全文を出す形にした(以前は5行で切って押すと開く形)。3行を超える時だけ押して3行に畳め、畳める目印として「▲ 閉じる」/「▼ 続きを読む」を出す。畳めるかは表示時と画面幅の変更時に、実際の行数で判定する。確認済み: 375px・デスクトップで、長い概要にだけ目印が出ること、畳む・開くの切り替えとaria-expanded(ローカル)
- Fixed: はてなブックマーク自身のページ(`b.hatena.ne.jp`=ブックマークページへのブックマーク、いわゆる「二階建て」)は本文を取りに行かないようにした。取ると、タイトルの繰り返しと他人のコメントの寄せ集めがdescriptionになっていた(1件)。差し替え済みの分は次の実行で取り消す。確認済み: 現在のデータで3件とも元のRSSの概要に戻ること(ローカル)
- Added: 記事本文の抜粋(300字)で`description`を差し替える。GitHub Actionsが新しい記事から1回40件ずつ、robots.txtを守り直列・ホスト間隔3秒以上で取りに行く(`scripts/article_body.py`、標準ライブラリのみ)。取れない・元より長くならない記事はRSSのまま。ミュートの「コメント」フィルタも本文で判定する。ストリーム表示では概要を全文で出す。確認済み: 抽出と取得の作法(ローカルサーバー)、実サイトで40件中40件取得(約2分)・ミュート判定が本文に効くこと([経緯](docs/decisions/article-body-description.md))。未確認: Actionsのランナーからの実行
- Added: ストリーム表示で、リロードや開き直しの時に前回の続きから表示するようにした(表示中の記事・コメント・既出URLをカテゴリーごとにlocalStorageへ保存し、取得を待たずに並べ直す。待機分は続きから流れる)。確認済み: リロード後に重複なく同じ順で復元、コメントも同数で復元、省略済みの古いコメントが湧かないこと(ローカル)
- Added: ストリーム表示を開いている間は画面をスリープさせない(Screen Wake Lock)。確認済み: 取得・解放・再取得の呼び出し順(代用のwakeLockで)。未確認: 実機(このブラウザは許可が出ず実際のロックは取れない。iOS SafariはiOS 16.4以降、ホーム画面追加のPWAは18.4以降)。バッテリーは減りやすくなる
- Added: ストリーム表示の追加間隔に「自動」を追加。次回データ更新の目安時刻(`meta.json`の`nextEstimate`)までの残り時間を待機件数で割った間隔で流し、更新までに待機分をほぼ流し切る。状態表示には次の記事を流すまでの残り秒数(「次まで N秒」。データ更新までではない)を常に出す(1秒ごと。狭い幅は「次」と短縮)。確認済み: 残り546秒・待機29件で18.8秒(=計算どおり)、目安超過時は「更新待ち」+60秒で割る、カウントダウンが進むこと、375pxで1行に収まること(ローカル)。未確認: 実際に更新時刻をまたいだ時の挙動。目安は「実行時刻+30分」だが実際のデータ更新は15分おきのため、自動は実際より長めの間隔になる
- Changed: ストリーム表示で、640px以下ではサムネイルを出さないようにした(本文・コメントの幅を確保するため)。確認済み: 375pxで非表示・記事の幅343pxいっぱいに本文が出ること、800pxでは表示(ローカル)
- Changed: ストリーム表示の操作行(戻る・一時停止・間隔・状態表示)を、640px・スマホ幅でも1行に並べるようにした。状態表示を「表示N / 待機N / 3分ごと」と短くし、480px以下はボタンを絵文字だけにする。確認済み: 640px・375pxで1行・横スクロール無し・一時停止の表示切替(ローカル)
- Changed: ストリーム表示の追加間隔に1分・3分・5分を追加(従来は最大30秒)。確認済み: 選択で状態表示が「3分ごと」等に変わること(ローカル)
- Changed: ストリーム表示を、ページ上部へ追加する降順(記事もコメントも新しいものが上)にした。先頭付近を見ている間は先頭に張り付き、下へ読み進めている間は追加で押し下げられた分だけスクロール位置を補正する。確認済み: 降順の並び、6件追加後も読んでいる記事の位置が動かないこと、先頭への張り付き(ローカル)。修正済み: 空のコメント欄は`display:none`で位置が取れず、補正が効かずに表示位置がずれていた
- Added: ストリーム表示の各記事の下に、ブックマークコメント(コメント付きのみ)を表示。初回は新しい側10件、以降は3分ごとに表示中の新しい側20記事を取り直して新しいコメントだけを末尾へ追記する。確認済み: コメントの表示と、3分の周期を5秒に縮めた追記(重複なし・コメント0件の記事への追記も可)(ローカル)。未確認: 実際の3分間隔での長時間運用、実機
- Added: ストリーム表示(`#/stream`、ヘッダーの📡)。一覧データのうちフィルタに掛からない記事を、古い順に一定間隔でひとつずつ末尾へ追加していく(開いた時点の新しい側30件から。以降は2分ごとの再取得で増えた分を足す)。追従スクロール・一時停止・間隔(1〜30秒)つき。新規JS(`js/stream.js`)を`SHELL_FILES`に追加。確認済み: 追加・一時停止/再開・遡り中は追従しない・×で除去・一覧へ戻ると停止・375px幅(ローカル)。未確認: 実際にデータが更新された時の追加(2分ポーリングの実更新)、実機
- Changed: 幅に応じてレイアウトを3段階にした。〜640pxは従来どおり、641px〜は前後ナビを記事ページ本文の末尾へ(固定は検索欄+投稿行のみ)、900px〜はさらに検索欄をヘッダーへ(固定は投稿行のみ)。gyazo-tycoonの方式を参考に、要素をJSで付け替える。確認済み: 375/768/1100pxとリサイズでの切替(ローカル)
- Changed: 検索欄をヘッダーに移した幅(900px〜)では、Tab順を投稿行(コメント欄・🔖・⚙・B!)が先になるよう`tabindex`で入れ替えた。自動フォーカスはしない(入力欄にフォーカスがあると、矢印キーでの記事移動のたびに外す必要が出るため)。確認済み: 最初のTabでコメント欄に当たる(ローカル)

## 2026-10-22

- Changed: ブックマークコメント(`comment`)フィルタの対象を、記事のdescription(RSS由来の概要)にも広げた。一致した記事は一覧から外れ、個別記事ページでもURLフィルタ時と同じ「フィルタ条件により非表示」表示になる。確認済み: 一覧からの除外と、一覧経由で開いた個別記事ページの非表示メッセージ(ローカル)。URL直接入力で開いた時は一覧データが無いためdescriptionを判定できず従来どおり表示される
- Fixed: 機内モードで「次の記事へ」「スワイプ」を使うと、既読の読み飛ばしで事前キャッシュした記事を大きく飛び越え、コメント未取得の記事ばかりに当たっていた。オフライン時は既読の読み飛ばしをやめ、キャッシュ済みの記事だけを前後に辿るようにした(オンライン/オフライン切替でボタンの有効/無効も更新)。未確認: 実機の機内モード(`navigator.onLine`を偽装して確認済み)
- Added: 上記の仕様に切り替わっていることを、記事ページ下部ナビの上に「オフラインのため/電波が弱いため、コメント取得済みの記事だけを前後に移動します」と表示。電波が弱いだけで`navigator.onLine`が真のままでも、記事の取得がキャッシュ頼みになる/失敗した時点で同じ仕様に切り替える(取得に成功するか`online`イベントで解除)。未確認: 実機の弱電波(取得処理の差し替えで確認済み)

## 2026-10-18

- Added: ブクマ連携の設定(中継Worker)の入力欄の横に「↗」リンク。Worker URLが `https://<名前>.<サブドメイン>.workers.dev` なら、CloudflareダッシュボードのそのWorkerの画面(`dash.cloudflare.com/?to=/:account/workers/services/view/<名前>/production`。アカウントIDはコードに持たず、`:account`でログイン中のアカウントに解決させる)へ、名前が取れない(未入力・独自ドメイン)時はWorkers & Pagesへ飛ぶ。Workerを設定済みの時だけ「はてな ↗」(はてなのOAuthアプリ設定 `/oauth/develop`)も出す。はてなidを持たない方針のため、idを含む `/<id>/config/auth/develop` は使わない
- Changed: 「自分のブックマーク」のrich表示で、×ボタンをサムネイルの左上に重ねた(サムネイル無しの灰色の枠にも同様)。×のぶんの横幅がなくなり、タイトル・コメントの表示幅が広がる
- Fixed: フィルタ同期の失敗表示だけ「失敗: …」で、既読同期の「読み書き / 最終同期 … / エラー: …」と書式が違っていた。状態行の組み立てを共通化し、失敗時もどちらも同じ書式にした(Gist ID未入力などの保存されないエラーも「エラー: …」で出る)
- Added: Gist同期(既読・フィルタ)の状態行に「トークンが無効です(失効の可能性)」(401)と「Gistが見つかりません」(404。権限の無いトークンでも出る)が出た時、トークン設定済みの端末の末尾に「トークンを再発行」リンク(`gist`スコープ・説明入力済みのclassic PAT作成画面)を付けた。メインタブのクイック同期の状態行にも写る
- Added: ミュート設定を開く時のドメインボタンで、`speakerdeck.com`もドメイン全体ではなく`speakerdeck.com/{ユーザー}/`単位(`urlprefix`)で入力済みになるようにした(`DEFAULT_PATH_USER_HOSTS`に追加。コメント非表示の自動登録にも同じ判定が効く)
- Changed: ユーザー登録(中継Worker)が前提の機能を、記事ページ下部のバーに「コメント入力・🔖・⚙・B!」の順で集約した。ヘッダーの🔖は削除し、設定モーダル「同期」タブの「中継Worker」は専用の「ブクマ連携の設定」モーダル(バーの⚙から開く)へ移動。ボタン文言は「ブクマ」から「B!」に変更。Worker未設定でも⚙から設定できるようバーは常に出し、入力欄とB!だけ止める。一覧ページからは🔖(自分のブックマーク)へ直接入れなくなった

## 2026-10-17

- Fixed: 「自分のブックマーク」で、コメントに入れたURLが `<a href="…" target="_blank" rel="noopener nofollow">…</a>` という文字として見えていた。Workerが、URLをHTMLのリンクに展開済みの `comment_expanded` をコメントとして返していたため(はてなの公開APIで確認)。Workerは素の `comment` を返すようにし、表示側(`stripAnchors`)でも `<a>` を外す(Workerを再デプロイするまでと、端末に保存済みの一覧の分)。URLのリンク化は従来どおり `linkifyComment`。他のコメント表示(記事ページ)は素の `comment` を使っており影響なし。Workerの再デプロイが必要
- Verified: 本番Workerの再デプロイ後に、「自分のブックマーク」のrich表示でスター数(⭐️n)が出ること、コメント欄でEnterを押すとキーボードが畳まれることを確認済み。あわせて、Workerのデプロイと本番からの接続・OAuth署名でのPOSTも動作確認済み(未確認は既存タグの送り直し=作者がタグを使わないため確認予定なし)
- Added: 「自分のブックマーク」のrich表示で、コメント付きのブックマークのスター数を「⭐️n」で表示。スターAPIのURIにはてなidが入るため、Workerに`POST /stars`を追加してWorkerが組む(idをブラウザの通信に出さない)。Workerの再デプロイが必要([経緯](docs/decisions/my-bookmarks-worker-proxy.md))
- Changed: ブックマークのコメント欄でEnter(スマホのリターンキー)を押すと、キーボードを畳んで投稿するようにした(「ブクマ」ボタンと同じ。取得待ちでボタンが押せない間は畳むだけ。IMEの変換確定のEnterは無視)
- Changed: ブックマーク投稿後の記事ページの再読み込みをやめた。投稿直後ははてなのコメント一覧(jsonlite)に自分のコメントが反映されないことがあり、待ち時間の調整では確実にならなかったため。入力欄に保存された内容が残る
- Changed: ブックマーク投稿のUIを、画面下部の「前の記事へ・一覧へ戻る・次の記事へ」の行の上に置く「コメント入力+ブクマ」だけにした(「ブックマークする」ボタンとタグ入力欄は廃止)。既存タグは保持して送り直す(未確認: 本物のはてなでの既存タグの送り直し)
- Fixed: 一覧と投稿が別のアカウントになる問題(一覧は`HATENA_USER_ID`、投稿はOAuth許可時にログインしていたアカウントで、別々に設定する値のため)。WorkerがOAuthの持ち主を調べ、一覧と違えば投稿・既存取得を409で拒否する。`GET /check`と設定の「保存して接続確認」でアカウントの一致を確認でき、セットアップスクリプトはトークンの持ち主を表示する([経緯](docs/decisions/bookmark-post-via-worker.md)。未確認: 実アカウントでの`applications/my.json`)
- Fixed: 上の修正だけでは、モーダル末尾のGitHubトークン欄が下端(キーボード直上)に張り付いて貼り付けできなかった。キーボード表示中はパネル末尾に余白を足し、フォーカスした入力欄を見える領域の中央へスクロールするようにした(余白が無いと最後の欄は持ち上げられない。未確認: 実機のキーボード。高さ340pxのエミュレーションで、全入力欄が中央に来ることは確認済み)
- Fixed: スマホでキーボードを出すと設定モーダルのスクロール領域が足りず、入力欄にコピペできない問題。見える領域が500px未満の間は固定ヘッダーを外してスクロール領域を広げ、フォーカスした入力欄が固定ヘッダーの裏に入らないよう`scroll-padding`を付けた。あわせて「中継Worker」を同期タブの先頭へ移動(未確認: 実機のキーボードでの挙動。高さ340pxのエミュレーションでは確認済み)

## 2026-10-16

- Added: 記事ページのブックマーク投稿(コメント・タグ)。同じ中継WorkerにOAuth 1.0a署名つきの `GET/POST /bookmark` を追加し、既存の上書き事故を避けるため既存取得に成功するまで送信不可にした([経緯](docs/decisions/bookmark-post-via-worker.md)。本物のはてなでの投稿は未確認)。Workerを `hateb-proxy.js` に改名、一覧のパスは `/bookmarks`

## 2026-10-14

- Added: 「自分のブックマーク」ページ(`#/me`、ヘッダー🔖)。はてなidはWorkerのsecretにだけ置く中継Worker経由で取得し、コメントビューと同じplain/rich・フィルタ・検索で表示([経緯](docs/decisions/my-bookmarks-worker-proxy.md)。本番Workerのデプロイは未確認)
- Fixed: タスクに残したPWAが古いバージョン(旧ビルドSHA)のまま動き続ける不具合。前面復帰時に`codeVersion`(アプリ本体を最後に変更したコミット)を確認し、新版がデプロイされていれば再読み込みする。データ更新だけのデプロイでは再読み込みしない(未確認: 実機での入れ替わり)
- Changed: フッターのビルド表示を`sha`(デプロイ元コミット)から`codeVersion`とそのコミット日時に変更。表示値だけでコードの版が特定でき、データ更新では変わらない

## 2026-10-11

- Changed: 検索欄をヘッダーから画面下部の固定フッター最下段へ移動し、記事ページの前後ナビをその直上に積む(スマホで親指が届く位置に統一。他の *-tycoon リポジトリと共通レイアウト)

## 2026-10-09

- `6697967` Added: ファビコン(`icons/favicon-48.png`)とiOSホーム画面用アイコン(`icons/apple-touch-icon.png`)を追加

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
