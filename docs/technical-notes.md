# 技術的な注意点・不変条件・既知の制限

触ると壊れる箇所と、その理由。経緯の長いものは [decisions/](decisions/) に1件1ファイルで置いている。

## 技術的な注意点

- **コメント表示(entry/jsonlite)**: こちらは現在もCORSなしで `<script>` タグ挿入によるJSONP方式で正常に取得できることを確認済みのため、ブラウザから直接・リアルタイムに取得しています(プロキシ不要)。**コールバック名は呼び出しごとにランダムに生成する実装になっており、これは意図的です**。Service Workerでキャッシュ可能にする目的で固定のコールバック名に変更する実験を行ったところ、実際のはてなAPIがハング/タイムアウトして正常に応答しなくなることを確認しました。そのため固定名には変更していません(オフライン対応は下記の通り別方式で実現しています)。
- **一覧の蓄積(遡り)について**: RSSの `?page=` / `?of=` パラメータは実機検証の結果ページングとして機能せず、常に現在の上位30件前後しか返さないことを確認済みです。そのため `scripts/fetch_hotentry.py` は取得結果を「上書き」ではなく「蓄積」する方式にしています。記事ごとに `firstSeenAt`(初出日時)/ `lastSeenAt`(最終確認日時)をJSTで記録し、1カテゴリあたり最大300件・14日分を保持します(それを超える分は自動的に削除)。したがって**運用直後は30〜40件程度ですが、時間が経つほど遡れる件数が増えていきます**。過去分を遡って一括取得する手段は無いため、即座に大量の過去データが手に入るわけではない点にご注意ください。
- **無限スクロールの再判定**: 一覧の継ぎ足しは`IntersectionObserver`(rootMargin 600px)で末尾のsentinelを監視していますが、これは「交差状態が変わった時」しか発火しません。縦長ディスプレイ(1080x1920等)×plain表示のように、20件追加してもsentinelがrootMargin内に残る場合、二度と発火せず継ぎ足しが止まっていました(件数表示は全件なのに実表示が40件で止まる)。そのため`renderNextPage()`の後にsentinelを`unobserve`→`observe`し直して現在の状態で再判定させています。この再監視を外さないでください。
- **PWAの古いバージョン固定**: SPAは画面遷移がハッシュ変更だけなのでリロードが走らず、PWAがタスクに残っている間は起動時のJS/HTMLが動き続ける(Service Workerが新版に更新されても実行中のページは入れ替わらない)。前面復帰時に`codeVersion`を確認して再読み込みする`reloadIfNewVersionDeployed()`(`js/app.js`)を外さないこと。比較は`sha`ではなく`codeVersion`で行う(`sha`はデータ更新コミットでも変わるため、使うと復帰のたびにリロードされる)。`js/build-info.js`の`codeVersion: '...'`という書式はこの関数が正規表現で読むため、`deploy-pages.yml`の書き出し形式を変える時は合わせて直す。`git log`で求めるため`actions/checkout`は`fetch-depth: 0`が必要。
- **長い文字列の折り返し**: タイトルがURLそのままの記事(未ブックマークのURL等)・長いドメイン・エラー文言中のURLなど、途中で区切れない長い文字列は、スマホ幅で横スクロールを起こさないよう`overflow-wrap: anywhere`で折り返す(`.entry-header` / `.status` / `.card-domain` / コメント一覧など)。新しく文字列を表示する要素を足す時は、同様に折り返し指定を付けること。
- 完全なはてなブックマークUIの再現は行っておらず、記事一覧・コメント一覧の表示に必要最低限のリンク(元記事リンク・はてなブックマークページへのリンク・ユーザーページへのリンク)のみを組み込んでいます。

## 経緯が長い不変条件(decisions/へのリンク)

- **ナビゲーションの固定キー**: `handleNavigate()`は実URLではなく固定キー`'index.html'`で読み書きする。詳細: [sw-navigate-fixed-key.md](decisions/sw-navigate-fixed-key.md)
- **通信不安定時の一覧取得**: `copyFromOldDataCaches` / `networkFirstThenCache`の8秒フォールバック / `fetchCategoryJson`の15秒タイムアウト+`caches.match` / `retryListIfNotLoaded`はいずれも外さない。詳細: [sw-unstable-network-list-fetch.md](decisions/sw-unstable-network-list-fetch.md)
- **RSS+Actionsによる一覧取得**: [hotentry-rss-via-actions.md](decisions/hotentry-rss-via-actions.md)
- **cronの不安定対策(ローカルdispatch)**: [cron-local-dispatch.md](decisions/cron-local-dispatch.md)

## 「自分のブックマーク」のid秘匿(変更前に読む)

- 取得対象のはてなidは`worker/`のWorker secret(`HATENA_USER_ID`)にだけ置く。コード・設定ファイル・ドキュメント・localStorage・URL・Workerのレスポンスにidを入れない(`user`オブジェクトや`profile.png`のアイコンURLにidが含まれるため、Workerは落として返し、richの画像は記事サムネイルにしている)。テストには公開アカウント(`hatenabookmark`)を使う。経緯は[decisions/my-bookmarks-worker-proxy.md](decisions/my-bookmarks-worker-proxy.md)。
- ブックマーク投稿は上書き(POST=追加または更新。コメントもタグも置き換わる)のため、入力欄は既存の取得に成功するまで「ブクマ」を押せない。この取得を外す/失敗時も送れるようにすると、知らずに既存コメントを消す。また、タグ入力欄が無くても**既存のタグを取得して送り直している**(`bookmarkTags`)。送らないとコメントの更新で既存のタグが消える。Worker応答には、はてなの生レスポンス(ユーザー情報=idを含む)を返さず`{comment,tags}`だけにしている。OAuthのシークレット・アクセストークンはWorker secretにだけ置く(経緯は[decisions/bookmark-post-via-worker.md](decisions/bookmark-post-via-worker.md))。
- 一覧(`HATENA_USER_ID`)と投稿(OAuthの持ち主=許可時にログインしていたアカウント)は別々の設定。食い違うと別人に書き込まれるため、Workerは不一致を409で拒否する(`accountMatch`。`applications/my.json`の`url_name`と比較。外すと、一覧と別のアカウントに投稿され得る)。経緯は[decisions/bookmark-post-via-worker.md](decisions/bookmark-post-via-worker.md)。
- ローカル確認で`localhost:8000`に他プロジェクトの古いService Worker(scrapbox-tycoon等)が残っていると、JSが読み込めず`Cannot use import statement outside a module`のようなエラーになる。devtoolsでunregisterとCache Storage削除をしてから確認する。

## 検証上の注意

- **Service Workerの動作確認について**: サンドボックス化されたブラウザ環境(Claude Codeの検証用ブラウザ等)では`navigator.serviceWorker.register()`自体が原因不明のエラーで失敗し、動作確認ができません。Service Worker関連の変更を検証する際は、本番オリジン(https://note.gosyujin.com/hateb-tycoon/)に対して`caches.keys()` / `caches.open()` / `cache.match()`等をブラウザのコンソールから直接実行して確認してください。

## 未検証

- 設定モーダルのキーボード対応(`.modal--short`で固定ヘッダーを外す・`scroll-padding-top`・末尾の余白`.modal-kbd-spacer`・フォーカスした欄を中央へ寄せる`centerFocusedField`。余白が無いと末尾の欄=GitHubトークンを持ち上げられず、キーボード直上の入力補助バー・貼り付けメニューにかぶる。センタリングはsmoothにしない=キーボードのアニメーションと競合/検証ブラウザでは動かない)は、実機のiOS/Androidキーボードでの確認が未了。ブラウザの高さ340px/700pxのエミュレーションでのみ確認済み(`visualViewport`の高さ500px未満で`.modal--short`が付く)。

- ブックマーク投稿: 本物のはてなOAuthでの取得・投稿は未確認(特に既存タグの送り直し=`tags`の繰り返し、コメント文字数上限、投稿直後の再読み込みに自分のコメントが反映されているか=jsonliteの反映遅れ)。署名はX公式サンプルのテストベクトルと独立実装で検証済み、Workerと画面は上流をモックして確認済み([詳細](decisions/bookmark-post-via-worker.md))。
- 「自分のブックマーク」の本番Cloudflare Workerへのデプロイと、本番オリジン(https://note.gosyujin.com/hateb-tycoon/)からの接続は未確認。ローカルでは同じWorkerコードをNodeで動かし、公開アカウントで認証・CORS・表示・検索・フィルタ・失敗時フォールバックまで確認済み。

- 通信が不安定な時の一覧取得不具合(Load failed)は実機でしか再現せず原因は推定のまま([詳細](decisions/sw-unstable-network-list-fetch.md))。対処が効いたかは実機での確認が必要。
- PWAの新バージョン自動検知(`reloadIfNewVersionDeployed()`)は、実機で「旧版のPWAをタスクに残したままコード変更を含むデプロイ→前面復帰」して新版に入れ替わること、およびデータ更新だけのデプロイでは再読み込みされないことの確認が必要(この修正を含む版が入った後のデプロイから有効。修正前の版が動いているPWAは一度タスクキルが必要)。
