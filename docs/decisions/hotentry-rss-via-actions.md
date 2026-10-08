# 一覧データの取得経路: RSS+GitHub Actionsによる静的JSON化

## 背景・原因・判断

- **一覧表示(hotentry)の取得経路**: かつて存在した `https://b.hatena.ne.jp/hotentry/{category}.json` という昔ながらのJSON APIは、2026年9月時点で廃止(404)されています。代わりに今も配信されているRSS1.0(RDF)フィード `https://b.hatena.ne.jp/hotentry/{category}.rss` を使いますが、これはCORSヘッダーを返さずブラウザから直接 `fetch()` できません。無料の公開CORSプロキシ(allorigins.win / corsproxy.io / api.codetabs.com)を試しましたが、認証必須化・レート制限・不安定で実運用に耐えないことを確認したため、**GitHub Actions(`hotentry-sync.yml`)が定期的にRSSを取得・パースして `data/hotentry-{category}.json` としてリポジトリにコミットし、ブラウザ側はこの同一オリジンの静的JSONを読むだけ**という構成に変更しました。クロスオリジン通信・第三者プロキシへの依存は完全に無くなっています。

## 結果・教訓

運用上の要点(構成の詳細は [architecture.md](../architecture.md))。

  - `scripts/fetch_hotentry.py` はPython標準ライブラリのみで動作します(追加パッケージ不要)。
  - RSSの要素名・名前空間に変更があった場合は `scripts/fetch_hotentry.py` を調整してください。
  - `hotentry-sync.yml` は手動実行(workflow_dispatch)も可能です。
