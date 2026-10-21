# CSP (meta) を追加し、同一オリジンの他アプリ経由でトークンを読まれないようにする

## 背景

`https://note.gosyujin.com/` には複数の個人アプリ(scrapbox-tycoon / hateb-tycoon / feed-tycoon /
gyazo-tycoon-viewer / fog-tycoon-viewer)が**同一オリジン**で同居し、`localStorage`を共有する。
このアプリは Gist 用の classic PAT と中継 Worker のアクセストークン(`hateb-tycoon:myBookmarks:token`)を
`localStorage`に持つ。**同居アプリのどれか1つでXSSや外部スクリプトの改ざんが起きると、ここのトークンも
読み取られる**(scrapbox-tycoon のPATも同様)。

## 対策

`index.html`にCSPをmetaで入れた(GitHub Pagesはレスポンスヘッダを付けられないためmeta)。

```
default-src 'none';
script-src 'self' https://b.hatena.ne.jp/entry/jsonlite/;
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
connect-src 'self' https://api.github.com https://gist.githubusercontent.com https://s.hatena.ne.jp/entries.json https://hateb-tycoon-proxy.kk-ataka.workers.dev;
manifest-src 'self';
worker-src 'self';
base-uri 'none';
form-action 'none';
object-src 'none'
```

- `script-src 'self'`: インラインscript・`on*=`・`eval`・他ホストのscriptを実行させない。このアプリはインラインscriptを持たない。
- **JSONP**(`entry/jsonlite`)のため `https://b.hatena.ne.jp/entry/jsonlite/` だけを**パス限定**で許可している(はてなのAPI全体は許可しない)。
- `connect-src`: 自サイト、GitHub API(Gist)、Gist raw(`gist.githubusercontent.com`)、はてなスターAPI(`entries.json`)、自前の中継Worker。
  **中継WorkerのホストはCSPに直書き**している(公開リポジトリにCloudflareアカウントのサブドメインが載る。
  Workerはトークン認証+`ALLOWED_ORIGINS`でCORS制限のため許容した)。`*.workers.dev`にすると第三者のworkers.devへも
  送れてしまい持ち出し防止にならないので避ける。
- `img-src https:`: 記事のスクリーンショット・アイコンは任意の https ホストから来るため広く許可(画像URLを使った持ち出しは理論上残る)。
- `style-src 'unsafe-inline'`: 互換性のため。

## 検証

- ローカルで配信し、一覧・コメント表示が通常どおり動くこと、JSONPの許可、許可パス以外のscript・任意ドメインへのfetch・インラインscriptの遮断を確認。
- **未確認(実機)**: Gist同期、ブクマ連携(中継Worker)、Service Worker経由の動作。

## 今後の注意

新しい外部通信(別API・CDN・フォント・別のWorkerホスト)を足す/変える時は**CSPも同時に更新する**。
忘れるとブラウザにブロックされる(コンソールに`Refused to ...`)。中継WorkerのURLを変えたら`connect-src`のホストも変える。
