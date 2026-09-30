# launchdへの登録手順(hateb-tycoon-dispatch)

`hotentry-sync.yml`を15分おきに`workflow_dispatch`で起動する仕組みをlaunchdに登録する手順。背景はルートの`README.md`「cronの定期取得が不安定な問題への対処」を参照。

`com.gosyujin.hateb-tycoon-dispatch.plist`内のパスは`/Users/kk`固定。ユーザー名が違う環境では書き換えること。

## 前提

- Keychainにサービス名`hateb-tycoon-dispatch-for-local-token`でFine-grained PAT(Actions: Read and write)を登録済み。未登録なら:

  ```bash
  security add-generic-password -a "$USER" -s hateb-tycoon-dispatch-for-local-token -w
  ```

  (`-w`だけ指定するとトークンをプロンプトで入力でき、シェル履歴に残らない)

## 手順

1. スクリプトをTCC非保護のパスへコピーする(Dropbox配下だとlaunchdから`Operation not permitted`になるため)。

   ```bash
   mkdir -p ~/scripts
   cp scripts/hateb-tycoon-dispatch.sh ~/scripts/
   chmod +x ~/scripts/hateb-tycoon-dispatch.sh
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

`scripts/hateb-tycoon-dispatch.sh`を変更したときは`~/scripts/`へコピーし直す(再登録は不要)。

## 解除

```bash
launchctl bootout gui/$(id -u)/com.gosyujin.hateb-tycoon-dispatch
rm ~/Library/LaunchAgents/com.gosyujin.hateb-tycoon-dispatch.plist
```

## ログ

- `~/Library/Logs/hateb-tycoon-dispatch.log`(スクリプトの成否)
- `~/Library/Logs/hateb-tycoon-dispatch-launchd.log`(launchdの標準出力/エラー)
