/**
 * はてなブックマークの公開データ取得モジュール。
 *
 * - 人気/新着エントリー一覧: ブラウザから直接 https://b.hatena.ne.jp/hotentry/*.rss を
 *   取得しようとすると、RSSがCORSヘッダを返さないため fetch() が失敗し、無料の公開
 *   CORSプロキシも認証必須化・レート制限・不安定で信頼できなかった(実運用で確認済み)。
 *   そのため GitHub Actions (.github/workflows/fetch-hotentry.yml) が30分ごとに
 *   RSSを取得・パースし、data/hotentry-{category}.json として同一オリジンに
 *   コミットする方式に変更した。ブラウザ側はこの静的JSONを読むだけで、
 *   クロスオリジン通信は発生しない(scripts/fetch_hotentry.py が実データ取得元)。
 * - 個別記事のブックマーク情報(コメント一覧含む): https://b.hatena.ne.jp/entry/jsonlite/?url=...
 *   はCORSなしでもJSONPで取得できることを確認済みのため、そのまま
 *   <script> タグ挿入方式でリアルタイムに取得する。JSONPはcallback名が
 *   呼び出しごとに変わる作りのため(固定名にすると実際のAPI側で無応答になる
 *   ことを確認済み)、Service Workerでのネットワークレベルのキャッシュは
 *   効かない。そのため取得に成功するたびアプリ側(localStorage)で解析済み
 *   データをキャッシュしておき、オフライン時など取得に失敗した場合は
 *   最後に見た内容へフォールバックする。
 */
(function (global) {
  const ENTRY_CACHE_KEY = 'hateb-tycoon:entryCache';
  // コメント本文込みで1件あたりのデータ量が既読記録より大きいため、上限は少なめにする。
  const ENTRY_CACHE_MAX = 300;

  function loadEntryCache() {
    try {
      const raw = localStorage.getItem(ENTRY_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveEntryCache(map) {
    try {
      localStorage.setItem(ENTRY_CACHE_KEY, JSON.stringify(map));
    } catch (e) {
      // 容量超過等でも致命的ではない(オフライン復元をあきらめるだけ)ため無視する
    }
  }

  function cacheEntryInfo(pageUrl, info) {
    const map = loadEntryCache();
    map[pageUrl] = { time: Date.now(), info };
    const keys = Object.keys(map);
    if (keys.length > ENTRY_CACHE_MAX) {
      keys.sort((a, b) => map[a].time - map[b].time);
      const excess = keys.length - ENTRY_CACHE_MAX;
      for (let i = 0; i < excess; i++) delete map[keys[i]];
    }
    saveEntryCache(map);
  }

  function getCachedEntryInfo(pageUrl) {
    const rec = loadEntryCache()[pageUrl];
    return rec ? rec.info : null;
  }

  function jsonp(url, params, timeoutMs) {
    params = params || {};
    timeoutMs = timeoutMs || 10000;
    return new Promise((resolve, reject) => {
      const callbackName = `hatebTycoonCb_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
      const query = new URLSearchParams(params);
      query.set('callback', callbackName);

      const script = document.createElement('script');
      let settled = false;
      let timer = null;

      const cleanup = () => {
        delete global[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
        if (timer) clearTimeout(timer);
      };

      global[callbackName] = (data) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(data);
      };

      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('リクエストがタイムアウトしました'));
      }, timeoutMs);

      const src = `${url}?${query.toString()}`;

      script.onerror = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`データの取得に失敗しました(ネットワークエラー): ${src}`));
      };

      script.src = src;
      document.head.appendChild(script);
    });
  }

  function safeHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  function normalizeEntryInfo(raw, pageUrl) {
    const url = raw.url || pageUrl || '';
    const bookmarks = Array.isArray(raw.bookmarks) ? raw.bookmarks : [];
    return {
      title: raw.title || '(タイトル不明)',
      url,
      domain: safeHostname(url),
      count: raw.count != null ? raw.count : 0,
      entryUrl: raw.eid ? `https://b.hatena.ne.jp/entry/${raw.eid}` : null,
      bookmarks: bookmarks.map((b) => ({
        user: b.user || '(不明なユーザー)',
        comment: b.comment || '',
        timestamp: b.timestamp || '',
        tags: Array.isArray(b.tags) ? b.tags : [],
      })),
    };
  }

  const EVERYTHING_KEY = 'everything';

  const CATEGORIES = [
    { key: EVERYTHING_KEY, label: '全て' },
    { key: 'all', label: '総合' },
    { key: 'general', label: '一般' },
    { key: 'social', label: '世の中' },
    { key: 'economics', label: '政治と経済' },
    { key: 'life', label: '暮らし' },
    { key: 'knowledge', label: '学び' },
    { key: 'it', label: 'テクノロジー' },
    { key: 'fun', label: 'おもしろ' },
    { key: 'entertainment', label: 'エンタメ' },
    { key: 'game', label: 'アニメとゲーム' },
  ];

  const REAL_CATEGORY_KEYS = CATEGORIES.filter((c) => c.key !== EVERYTHING_KEY).map((c) => c.key);

  // 電波が不安定だとfetchが失敗も成功もせずハングすることがあるため、タイムアウトを設ける。
  const LIST_FETCH_TIMEOUT_MS = 15000;

  async function fetchCategoryJsonFromNetwork(dataUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LIST_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(dataUrl, { cache: 'no-store', signal: controller.signal });
      if (!res.ok) {
        throw new Error(`データの取得に失敗しました(HTTP ${res.status}): ${dataUrl}`);
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ネットワークで取れなかった時の最後の砦。Service Worker側のフォールバックが効かなかった
  // 場合(SW未起動・キャッシュ引き継ぎ漏れ等)に備え、ページからもCache Storageを直接探す
  // (どのバージョンのキャッシュでも、クエリ違いも無視して一致させる)。
  async function readListFromCacheStorage(dataUrl) {
    try {
      if (!('caches' in window)) return null;
      const res = await caches.match(dataUrl, { ignoreSearch: true });
      return res ? await res.json() : null;
    } catch (e) {
      return null;
    }
  }

  async function fetchCategoryJson(slug) {
    const dataUrl = `data/hotentry-${encodeURIComponent(slug)}.json`;
    let entries;
    try {
      entries = await fetchCategoryJsonFromNetwork(dataUrl);
    } catch (err) {
      entries = await readListFromCacheStorage(dataUrl);
      if (!entries) throw err;
    }
    return Array.isArray(entries) ? entries : [];
  }

  // 「全て」は実データファイルを持たない仮想カテゴリー。「総合」を土台に、
  // 総合には無いがそれ以外のカテゴリーには存在する記事(url基準で判定)を
  // 追加してマージする。
  async function getEverythingEntries() {
    // 1カテゴリーの失敗で「全て」全体が失敗しないよう、取れたものだけでマージする
    // (全滅した場合のみエラー)。欠けた分は次の自動リフレッシュで補われる。
    const settled = await Promise.allSettled(REAL_CATEGORY_KEYS.map(fetchCategoryJson));
    const ok = settled.filter((r) => r.status === 'fulfilled');
    if (ok.length === 0) throw settled[0].reason;
    const [allEntries, ...restEntries] = settled.map((r) => (r.status === 'fulfilled' ? r.value : []));
    const merged = [...allEntries];
    const seenUrls = new Set(allEntries.map((e) => e.url));
    for (const entries of restEntries) {
      for (const entry of entries) {
        if (seenUrls.has(entry.url)) continue;
        seenUrls.add(entry.url);
        merged.push(entry);
      }
    }
    return merged;
  }

  async function getHotEntries(category) {
    const slug = category || 'all';
    if (slug === EVERYTHING_KEY) return getEverythingEntries();
    return fetchCategoryJson(slug);
  }

  // JSONP取得+整形+localStorage保存までをひとまとめにした「生の取得」。
  async function fetchEntryInfoRaw(pageUrl) {
    const data = await jsonp('https://b.hatena.ne.jp/entry/jsonlite/', { url: pageUrl });
    const info = normalizeEntryInfo(data, pageUrl);
    cacheEntryInfo(pageUrl, info);
    return info;
  }

  // 先読み結果(メモリのみ)。前後の記事への移動を速くするため、隣の記事を
  // 裏で取得しておく。古い内容を出し続けないよう短いTTLで捨てる。
  const PREFETCH_TTL_MS = 3 * 60 * 1000;
  const prefetched = new Map(); // pageUrl -> { promise, at }

  function prefetchEntryInfo(pageUrl) {
    if (!pageUrl) return;
    const existing = prefetched.get(pageUrl);
    if (existing && Date.now() - existing.at < PREFETCH_TTL_MS) return;
    const promise = fetchEntryInfoRaw(pageUrl);
    const rec = { promise, at: Date.now() };
    prefetched.set(pageUrl, rec);
    // 失敗は黙って捨てる(本番の取得時に通常のエラー処理・オフラインキャッシュが働く)。
    promise.catch(() => {
      if (prefetched.get(pageUrl) === rec) prefetched.delete(pageUrl);
    });
    return promise.then(() => undefined, () => undefined);
  }

  async function getEntryInfo(pageUrl) {
    const rec = prefetched.get(pageUrl);
    if (rec) {
      prefetched.delete(pageUrl); // 1回使い切り。再訪時は常に最新を取り直す。
      if (Date.now() - rec.at < PREFETCH_TTL_MS) {
        try {
          return { ...(await rec.promise), fromPrefetch: true };
        } catch (e) {
          // 先読みが失敗していたら通常の取得にフォールバックする
        }
      }
    }
    try {
      return await fetchEntryInfoRaw(pageUrl);
    } catch (err) {
      const cached = getCachedEntryInfo(pageUrl);
      if (cached) return { ...cached, fromOfflineCache: true };
      throw err;
    }
  }

  global.HatenaAPI = {
    CATEGORIES,
    getHotEntries,
    getEntryInfo,
    prefetchEntryInfo,
  };
})(window);
