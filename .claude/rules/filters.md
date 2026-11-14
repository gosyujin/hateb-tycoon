---
paths:
  - "js/filters.js"
  - "js/filter-sync.js"
  - "js/gist.js"
  - "js/sync.js"
---
# ミュート判定・フィルタ・Gist 同期

- 判定は forceMute → mute(unmute で例外)の順。
- Gist 同期は積み上げ方式で、削除は同期されない。不正な CSV の種類は取り込まず、上書きもしない。
- 詳細: [docs/features.md](../../docs/features.md)
