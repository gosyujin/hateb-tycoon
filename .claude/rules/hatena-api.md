---
paths:
  - "js/hatena-api.js"
---
# はてな API(js/hatena-api.js)

- `jsonp()` のコールバック名は**呼び出しごとにランダム**にする。固定名にすると、はてなの `b.hatena.ne.jp/entry/jsonlite/` がハング/タイムアウトすることを実験で確認済み。[docs/technical-notes.md](../../docs/technical-notes.md)
