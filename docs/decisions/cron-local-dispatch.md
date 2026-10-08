# cronの定期取得が不安定な問題への対処(ローカルMacからのworkflow_dispatch)

## 背景

`hotentry-sync.yml`の`schedule`トリガー(cron)は導入当初から発火が不定期(長時間発火しない、間隔が安定しない)という問題を抱えています。ワークフローファイル名の変更で一時的に改善したように見えたこともありますが、根本解決には至っていません。

## 判断

この問題を緩和するため、**リポジトリ所有者(gosyujin)のローカルMacから15分おき(毎時00・15・30・45分)にGitHub APIの`workflow_dispatch`エンドポイントを叩いて`hotentry-sync.yml`を強制的に手動起動する仕組み**を導入しています(あくまで補助策で、cronの根本修正ではありません)。

## 結果・制約・教訓

- スクリプト本体(バージョン管理対象): `scripts/hateb-tycoon-dispatch.sh`
- 認証: GitHubのFine-grained Personal Access Token。**リポジトリには一切含めず**、ローカルMacのKeychainに保存し、スクリプトが実行時に`security find-generic-password`で読み出します。トークンに必要な権限は対象リポジトリの **Actions: Read and write** のみです(Contents権限は不要。誤ってContents権限を付与すると`403 Resource not accessible by personal access token`になります)。
- 定期実行: macOSのlaunchd(`~/Library/LaunchAgents/`配下にplistを配置)。cronではなくlaunchdを採用しているのは、macOSではlaunchdが標準的な仕組みのためです。
- **重要な制約**: `scripts/hateb-tycoon-dispatch.sh`をリポジトリ内のパス(Dropbox経由の`~/Library/CloudStorage/Dropbox/...`配下)からlaunchdに直接実行させようとすると、macOSのプライバシー保護(TCC)により`Operation not permitted`で失敗します。DropboxのようなクラウドストレージプロバイダのフォルダはTCCの保護対象で、GUIを持たないバックグラウンドプロセス(launchd経由の実行)には権限プロンプトを出せず、黙って拒否されるためです。そのため、**実際にlaunchdが実行する実体は`~/scripts/hateb-tycoon-dispatch.sh`(TCC非保護のホーム直下)に置き、リポジトリ内のファイルはあくまで正本(バージョン管理・レビュー用)としています**。`scripts/hateb-tycoon-dispatch.sh`を変更した場合は、`~/scripts/hateb-tycoon-dispatch.sh`にも同じ内容を手動でコピーする必要があります。
- 実行ログ: `~/Library/Logs/hateb-tycoon-dispatch.log`

このローカル自動実行の仕組みはgosyujin個人のMac環境に依存するため、リポジトリをフォークしたり他の環境で動かす場合は関係ありません(cronのschedule自体は`hotentry-sync.yml`単体でも動作します。発火が不安定であるという制約が残るだけです)。
