---
paths:
  - "scripts/fetch_hotentry.py"
  - "scripts/article_body.py"
  - ".github/workflows/hotentry-sync.yml"
---
# 一覧データの取得(Actions 側)

- はてなの一覧は RSS 由来でページングできないので「蓄積」方式(`firstSeenAt` / `lastSeenAt`、300件・14日)。JSON API の復活やページングを前提にしない。[docs/decisions/hotentry-rss-via-actions.md](../../docs/decisions/hotentry-rss-via-actions.md)
- 記事本文での description 差し替え(`article_body.py`): robots.txt 遵守・直列・ホスト間隔・1回40件/240秒の上限など「迷惑をかけない」決まりを外さない。抜粋(300字)以外は保存しない。[docs/decisions/article-body-description.md](../../docs/decisions/article-body-description.md)
