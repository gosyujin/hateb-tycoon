# launchdへの登録手順(hateb-tycoon-dispatch)

`hotentry-sync.yml`を15分おきに`workflow_dispatch`で起動する仕組みをlaunchdに登録する手順。背景はルートの`README.md`「cronの定期取得が不安定な問題への対処」を参照。

`com.gosyujin.hateb-tycoon-dispatch.plist`内のパスは`/Users/kk/github/hateb-tycoon`固定。ユーザー名やリポジトリの置き場所が違う環境では書き換えること。launchdはリポジトリ内の`scripts/hateb-tycoon-dispatch.sh`を直接実行する(コピー不要)。

リポジトリはDropboxなどTCC保護のフォルダ(`~/Library/CloudStorage/`配下、`~/Documents`など)に置かないこと。置くとlaunchdから`Operation not permitted`になる。

## 前提

- Keychainにサービス名`hateb-tycoon-dispatch-for-local-token`でFine-grained PAT(Actions: Read and write)を登録済み。未登録なら:

  ```bash
  security add-generic-password -a "$USER" -s hateb-tycoon-dispatch-for-local-token -w
  ```

  (`-w`だけ指定するとトークンをプロンプトで入力でき、シェル履歴に残らない)

## 手順

1. スクリプトに実行権限があることを確認する(gitで`100755`として管理済み)。

   ```bash
   ls -l scripts/hateb-tycoon-dispatch.sh   # -rwxr-xr-x ならOK
   ```

2. plistを`~/Library/LaunchAgents/`へコピーする。

   ```bash
   cp scripts/com.gosyujin.hateb-tycoon-dispatch.plist ~/Library/LaunchAgents/
   ```

3. launchdへ登録する。

   ```bash
   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gosyujin.hateb-tycoon-dispatch.plist
   ```

4. 登録を確認し、すぐ1回実行して動作確認する。

   ```bash
   launchctl list | grep hateb-tycoon-dispatch
   launchctl kickstart gui/$(id -u)/com.gosyujin.hateb-tycoon-dispatch
   tail ~/Library/Logs/hateb-tycoon-dispatch.log   # "OK (HTTP 204)" ならOK
   ```

## 変更・再登録

plistを変更したときは登録し直す。

```bash
launchctl bootout gui/$(id -u)/com.gosyujin.hateb-tycoon-dispatch
cp scripts/com.gosyujin.hateb-tycoon-dispatch.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gosyujin.hateb-tycoon-dispatch.plist
```

`scripts/hateb-tycoon-dispatch.sh`を変更しても再登録は不要(次の実行から反映される)。ただしlaunchdはこのリポジトリの作業ツリーを直接読むので、スクリプトが無いブランチをチェックアウトしている間は実行に失敗する。

## 解除

```bash
launchctl bootout gui/$(id -u)/com.gosyujin.hateb-tycoon-dispatch
rm ~/Library/LaunchAgents/com.gosyujin.hateb-tycoon-dispatch.plist
```

## ログ

- `~/Library/Logs/hateb-tycoon-dispatch.log`(スクリプトの成否)
- `~/Library/Logs/hateb-tycoon-dispatch-launchd.log`(launchdの標準出力/エラー)
