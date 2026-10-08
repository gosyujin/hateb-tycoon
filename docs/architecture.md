# アーキテクチャ

旧READMEの「ディレクトリ構成」「技術的な注意点」「オフライン対応の仕組み」のうち、構成・データの流れに関する部分を、文言を変えずに移したもの。

## ディレクトリ構成

```
hateb-tycoon/
├── index.html          # 画面全体のHTML(一覧ビュー / コメントビュー / 設定モーダル)
├── css/
│   └── style.css        # スタイル
├── js/
│   ├── build-info.js    # デプロイ時にビルドhash/日時が書き込まれる(フッター表示用)
│   ├── filters.js       # localStorageのミュートワード管理と判定ロジック
│   ├── visited.js        # 既読管理(既読フラグ・再表示しきい値)
│   ├── gist.js           # Gist APIの共通部分(トークン管理・取得/作成/更新)
│   ├── sync.js           # 既読のGist同期(pull/push・マージ)
│   ├── filter-sync.js    # フィルタ(3種)のGist同期(取り込み+和集合で上書き)
│   ├── hatena-api.js     # はてなブックマークデータの取得・正規化・JSONPと、
│   │                     #   オフライン用の個別記事情報のlocalStorageキャッシュ
│   └── app.js             # ルーティング・画面描画・検索・キーボード操作・Service Worker登録
├── service-worker.js    # アプリ本体+一覧データのオフラインキャッシュ(下記参照)
├── data/
│   └── hotentry-*.json  # GitHub Actionsが定期生成するカテゴリ別ホットエントリーデータ
├── scripts/
│   ├── fetch_hotentry.py         # はてなのRSSを取得しdata/*.jsonを生成するスクリプト
│   └── hateb-tycoon-dispatch.sh  # hotentry-sync.ymlをローカルから手動起動するスクリプト(正本。
│                                 #   実運用コピーの配置場所については下記「cronの定期取得が
│                                 #   不安定な問題への対処」を参照)
├── .github/workflows/
│   ├── hotentry-sync.yml  # 定期的にdata/*.jsonを更新してmainにコミット(旧fetch-hotentry.yml)
│   └── deploy-pages.yml   # mainへのpushでGitHub Pagesへデプロイ
└── README.md
```

## データの流れ(旧README「技術的な注意点」より)

- **一覧表示(hotentry)の取得経路**: RSSをGitHub Actionsで取得・静的JSON化する構成。経緯は [decisions/hotentry-rss-via-actions.md](decisions/hotentry-rss-via-actions.md)。
  - `scripts/fetch_hotentry.py` はPython標準ライブラリのみで動作します(追加パッケージ不要)。
  - RSSの要素名・名前空間に変更があった場合は `scripts/fetch_hotentry.py` を調整してください。
  - `hotentry-sync.yml` は手動実行(workflow_dispatch)も可能です。
- カテゴリのRSSパス(`general` / `social` / `economics` / `life` / `knowledge` / `it` / `fun` / `entertainment` / `game`)は、はてなブックマークの公開カテゴリ構成に基づいています。当初含めていた `book`(本)は `hotentry/book.rss` が404だったため削除しました。

## オフライン対応の仕組み

Service Worker(`service-worker.js`)により以下を実現しています。

- `install`時にアプリ本体一式(HTML/CSS/JS)と、全カテゴリーの一覧データ(`data/hotentry-*.json`)をまとめて先読みキャッシュします。一覧データは小さいため、開いたことのないカテゴリーでもオフラインで一覧だけは閲覧できます。
- 同一オリジンへの通常リクエストは「まずネットワーク、失敗したらキャッシュ」方式(`networkFirstThenCache`)です。オンライン中は常に最新を優先し、オフライン時のみキャッシュにフォールバックします。
- 個別記事のコメント(JSONP)は上記の理由でService Workerからキャッシュできないため、代わりに `js/hatena-api.js` が取得成功時に解析済みデータを`localStorage`へ保存し、オフライン時(JSONP失敗時)はそちらから復元します(`fromOfflineCache`フラグ付きで表示)。設定画面の「オフライン用キャッシュ」から、「全て」カテゴリーの上位n件を明示的に事前取得しておくこともできます。
- **ナビゲーションリクエストの扱いには注意が必要です**: 経緯と理由は [decisions/sw-navigate-fixed-key.md](decisions/sw-navigate-fixed-key.md)。`handleNavigate()`は常に固定キー`'index.html'`で読み書きする。
- `CACHE_VERSION`はデプロイ時(`deploy-pages.yml`)に`__BUILD_SHA__`が実SHAへ置換される仕組みで、デプロイのたびにService Workerが更新されたと認識されます。
