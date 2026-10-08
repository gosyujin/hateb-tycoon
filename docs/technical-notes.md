# 技術的な注意点・不変条件・既知の制限

旧READMEの「技術的な注意点」(architecture.md / features.md に移した項目を除く)、「オフライン対応の仕組み」の不具合対処・検証上の注意、「cronの定期取得が不安定な問題への対処」を、文言を変えずに移したもの。

## 技術的な注意点

- **コメント表示(entry/jsonlite)**: こちらは現在もCORSなしで `<script>` タグ挿入によるJSONP方式で正常に取得できることを確認済みのため、ブラウザから直接・リアルタイムに取得しています(プロキシ不要)。**コールバック名は呼び出しごとにランダムに生成する実装になっており、これは意図的です**。Service Workerでキャッシュ可能にする目的で固定のコールバック名に変更する実験を行ったところ、実際のはてなAPIがハング/タイムアウトして正常に応答しなくなることを確認しました。そのため固定名には変更していません(オフライン対応は下記の通り別方式で実現しています)。
- **一覧の蓄積(遡り)について**: RSSの `?page=` / `?of=` パラメータは実機検証の結果ページングとして機能せず、常に現在の上位30件前後しか返さないことを確認済みです。そのため `scripts/fetch_hotentry.py` は取得結果を「上書き」ではなく「蓄積」する方式にしています。記事ごとに `firstSeenAt`(初出日時)/ `lastSeenAt`(最終確認日時)をJSTで記録し、1カテゴリあたり最大300件・14日分を保持します(それを超える分は自動的に削除)。したがって**運用直後は30〜40件程度ですが、時間が経つほど遡れる件数が増えていきます**。過去分を遡って一括取得する手段は無いため、即座に大量の過去データが手に入るわけではない点にご注意ください。
- **無限スクロールの再判定**: 一覧の継ぎ足しは`IntersectionObserver`(rootMargin 600px)で末尾のsentinelを監視していますが、これは「交差状態が変わった時」しか発火しません。縦長ディスプレイ(1080x1920等)×plain表示のように、20件追加してもsentinelがrootMargin内に残る場合、二度と発火せず継ぎ足しが止まっていました(件数表示は全件なのに実表示が40件で止まる)。そのため`renderNextPage()`の後にsentinelを`unobserve`→`observe`し直して現在の状態で再判定させています。この再監視を外さないでください。
- **長い文字列の折り返し**: タイトルがURLそのままの記事(未ブックマークのURL等)・長いドメイン・エラー文言中のURLなど、途中で区切れない長い文字列は、スマホ幅で横スクロールを起こさないよう`overflow-wrap: anywhere`で折り返す(`.entry-header` / `.status` / `.card-domain` / コメント一覧など)。新しく文字列を表示する要素を足す時は、同様に折り返し指定を付けること。
- 完全なはてなブックマークUIの再現は行っておらず、記事一覧・コメント一覧の表示に必要最低限のリンク(元記事リンク・はてなブックマークページへのリンク・ユーザーページへのリンク)のみを組み込んでいます。

## オフライン対応: 通信が不安定な時の一覧取得・動作確認

- **通信が不安定な時の一覧取得(起動と終了を繰り返すスマホPWAで「Load failed」のまま一覧が見られなくなった不具合への対処)**: mainへのpushごと(データ更新コミットも含む)にデプロイされ`CACHE_VERSION`が変わるため、Service Workerは頻繁に更新される。通信が不安定な状態で`install`が走ると、データの先読みは失敗しても黙って無視されるので、データキャッシュが空のまま新版が有効になり、`activate`で旧キャッシュも消える。その状態で一覧の取得が失敗すると戻る先が無く、しかも初回読み込みに失敗すると自動リフレッシュ(`hasLoadedList`前提)も働かないため、タスクキルまで復帰しなかった。実機でしか再現しないため原因は推定。以下で多重に防いでいる(いずれも外さないこと)。
  - `install`でデータの先読みに失敗したファイルは、旧バージョンのデータキャッシュから引き継ぐ(`copyFromOldDataCaches`)。
  - `networkFirstThenCache`は、キャッシュ書き込みを`event.waitUntil`で包み(応答後にSWが終了しても途切れない)、8秒でネットワークが応答しなければキャッシュがある場合は先にそれを返す(ハング対策。キャッシュが無ければネットワークを待ち続ける)。
  - ページ側の`fetchCategoryJson`は15秒でタイムアウトし、失敗したら`caches.match`でCache Storageを直接探す(SWのフォールバックが効かない場合の最後の砦)。「全て」は`Promise.allSettled`で、1カテゴリーが失敗しても取れた分でマージする(全滅の時のみエラー)。
  - 一覧の初回読み込みに失敗した状態でも、前面復帰(`visibilitychange`)・オンライン復帰(`online`)で再取得する(`retryListIfNotLoaded`)。
- **Service Workerの動作確認について**: サンドボックス化されたブラウザ環境(Claude Codeの検証用ブラウザ等)では`navigator.serviceWorker.register()`自体が原因不明のエラーで失敗し、動作確認ができません。Service Worker関連の変更を検証する際は、本番オリジン(https://note.gosyujin.com/hateb-tycoon/)に対して`caches.keys()` / `caches.open()` / `cache.match()`等をブラウザのコンソールから直接実行して確認してください。

### cronの定期取得が不安定な問題への対処

`hotentry-sync.yml`の`schedule`トリガー(cron)は導入当初から発火が不定期(長時間発火しない、間隔が安定しない)という問題を抱えています。ワークフローファイル名の変更で一時的に改善したように見えたこともありますが、根本解決には至っていません。

この問題を緩和するため、**リポジトリ所有者(gosyujin)のローカルMacから15分おき(毎時00・15・30・45分)にGitHub APIの`workflow_dispatch`エンドポイントを叩いて`hotentry-sync.yml`を強制的に手動起動する仕組み**を導入しています(あくまで補助策で、cronの根本修正ではありません)。

- スクリプト本体(バージョン管理対象): `scripts/hateb-tycoon-dispatch.sh`
- 認証: GitHubのFine-grained Personal Access Token。**リポジトリには一切含めず**、ローカルMacのKeychainに保存し、スクリプトが実行時に`security find-generic-password`で読み出します。トークンに必要な権限は対象リポジトリの **Actions: Read and write** のみです(Contents権限は不要。誤ってContents権限を付与すると`403 Resource not accessible by personal access token`になります)。
- 定期実行: macOSのlaunchd(`~/Library/LaunchAgents/`配下にplistを配置)。cronではなくlaunchdを採用しているのは、macOSではlaunchdが標準的な仕組みのためです。
- **重要な制約**: `scripts/hateb-tycoon-dispatch.sh`をリポジトリ内のパス(Dropbox経由の`~/Library/CloudStorage/Dropbox/...`配下)からlaunchdに直接実行させようとすると、macOSのプライバシー保護(TCC)により`Operation not permitted`で失敗します。DropboxのようなクラウドストレージプロバイダのフォルダはTCCの保護対象で、GUIを持たないバックグラウンドプロセス(launchd経由の実行)には権限プロンプトを出せず、黙って拒否されるためです。そのため、**実際にlaunchdが実行する実体は`~/scripts/hateb-tycoon-dispatch.sh`(TCC非保護のホーム直下)に置き、リポジトリ内のファイルはあくまで正本(バージョン管理・レビュー用)としています**。`scripts/hateb-tycoon-dispatch.sh`を変更した場合は、`~/scripts/hateb-tycoon-dispatch.sh`にも同じ内容を手動でコピーする必要があります。
- 実行ログ: `~/Library/Logs/hateb-tycoon-dispatch.log`

このローカル自動実行の仕組みはgosyujin個人のMac環境に依存するため、リポジトリをフォークしたり他の環境で動かす場合は関係ありません(cronのschedule自体は`hotentry-sync.yml`単体でも動作します。発火が不安定であるという制約が残るだけです)。
