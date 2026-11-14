---
paths:
  - "scripts/hateb-tycoon-dispatch.sh"
  - "scripts/com.gosyujin.hateb-tycoon-dispatch.plist"
  - "scripts/LAUNCHD.md"
---
# ローカル dispatch(gosyujin の Mac 固有)

- launchd はリポジトリ内の `scripts/hateb-tycoon-dispatch.sh` を直接実行する。main チェックアウト(`~/github/hateb-tycoon`)が別ブランチだとスクリプトが無くて失敗することがある。Dropbox など TCC 保護のフォルダに置くと `Operation not permitted` になる。
- PAT は Keychain の `hateb-tycoon-dispatch-for-local-token`。権限は対象リポジトリの **Actions: Read and write** だけ(Contents 権限は不要で、403 の原因になった)。
- 登録・再登録・ログの場所: [scripts/LAUNCHD.md](../../scripts/LAUNCHD.md)。経緯: [docs/decisions/cron-local-dispatch.md](../../docs/decisions/cron-local-dispatch.md)
