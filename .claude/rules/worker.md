---
paths:
  - "worker/**"
  - "scripts/hatena-oauth-setup.mjs"
---
# Cloudflare Worker(worker/)

- はてな id と OAuth の鍵は Worker secret にだけ置く。コード・レスポンス・ログに出さない。
- 一覧のアカウント(`HATENA_USER_ID`)と OAuth の持ち主が食い違うと別人に投稿される(実際に起きた)。Worker が 409 で拒否する作りを外さない。
- Worker のコードを変えたら、デプロイ(`npx wrangler deploy`)はユーザーが行う。Claude は実行しない。
- 詳細: [docs/decisions/bookmark-post-via-worker.md](../../docs/decisions/bookmark-post-via-worker.md)、[docs/decisions/my-bookmarks-worker-proxy.md](../../docs/decisions/my-bookmarks-worker-proxy.md)
