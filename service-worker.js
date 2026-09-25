/**
 * オフライン(機内モード)でも、少なくとも一度取得できたものは見られるようにする
 * ためのService Worker。
 *
 * - アプリ本体(HTML/CSS/JS)と、全カテゴリーの一覧データ(data/hotentry-*.json)は
 *   オンライン時にまとめて先読みキャッシュしておく。一覧データは10個程度と
 *   小さいため、今回開いていないカテゴリーでもオフラインで一覧だけは見られる。
 * - 個別記事のコメント(b.hatena.ne.jp/entry/jsonlite/)はJSONP(<script>タグ)
 *   経由かつcallback名が呼び出しごとに変わる作りのため、Service Workerでは
 *   意味のあるキャッシュができない(no-corsのopaqueレスポンスは中身を読めず、
 *   キャッシュキーを正規化することもできない)。そのため、こちらはjs/hatena-api.js
 *   側でlocalStorageに解析済みデータをキャッシュする方式にしている(このファイルの
 *   担当外)。
 * - 画像・スクリーンショット・ユーザーアイコン等はキャッシュ対象外(素通し)。
 *   オフラインで欠けても許容する方針のため。
 * - 全体を通して「まずネットワーク、失敗したら前回キャッシュ」方式にし、
 *   オンライン中は常に最新を優先しつつ、オフライン時だけキャッシュへ落ちる。
 *
 * CACHE_VERSIONはデプロイのたびにビルドSHAへ置換される(このファイル自体の
 * バイト列が変わることで、ブラウザのService Worker更新チェックに新バージョンとして
 * 検知させるため)。
 */
const CACHE_VERSION = '__BUILD_SHA__';
const SHELL_CACHE = `hateb-tycoon-shell-${CACHE_VERSION}`;
const DATA_CACHE = `hateb-tycoon-data-${CACHE_VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, DATA_CACHE];

const SHELL_FILES = [
  'index.html',
  'css/style.css',
  'js/build-info.js',
  'js/filters.js',
  'js/visited.js',
  'js/hatena-api.js',
  'js/app.js',
];

// js/hatena-api.js の CATEGORIES (仮想カテゴリーの「全て」を除く) と同期させること。
const REAL_CATEGORY_KEYS = [
  'all',
  'general',
  'social',
  'economics',
  'life',
  'knowledge',
  'it',
  'fun',
  'entertainment',
  'game',
];
const DATA_FILES = ['data/meta.json', ...REAL_CATEGORY_KEYS.map((k) => `data/hotentry-${k}.json`)];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await shellCache.addAll(SHELL_FILES);

      const dataCache = await caches.open(DATA_CACHE);
      await Promise.all(
        DATA_FILES.map(async (path) => {
          try {
            const res = await fetch(path, { cache: 'no-store' });
            if (res && res.ok) await dataCache.put(path, res.clone());
          } catch (e) {
            // オフライン等で先読みできなくても致命的ではないため無視する
          }
        })
      );

      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !CURRENT_CACHES.includes(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

// ネットワークを優先し、成功したらキャッシュを更新する。失敗時(オフライン)は
// クエリ文字列違い(?v=<sha>等)を無視してキャッシュから探す。
// 対象は常に同一オリジンの通常のfetchのみ(no-corsのopaqueレスポンスは
// 中身を検証できず、意味のあるキャッシュもできないためここでは扱わない)。
async function networkFirstThenCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

function isShellRequest(pathname) {
  return SHELL_FILES.some((f) => pathname.endsWith(`/${f}`) || pathname.endsWith(f));
}

function isDataJsonRequest(pathname) {
  return /\/data\/[^/]+\.json$/.test(pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // ナビゲーション(index.htmlの読み込み)は常にアプリ本体キャッシュへフォールバックする。
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstThenCache(request, SHELL_CACHE));
    return;
  }

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (isShellRequest(url.pathname)) {
      event.respondWith(networkFirstThenCache(request, SHELL_CACHE));
      return;
    }
    if (isDataJsonRequest(url.pathname)) {
      event.respondWith(networkFirstThenCache(request, DATA_CACHE));
      return;
    }
    // 画像・スクリーンショット等はキャッシュ対象外。ブラウザの通常処理に任せる。
    return;
  }

  // クロスオリジン(コメント取得のJSONP、サムネイル画像、ユーザーアイコン等)は
  // キャッシュ対象外。ブラウザの通常処理にそのまま任せる。
});
