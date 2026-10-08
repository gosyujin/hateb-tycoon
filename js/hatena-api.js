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
      eid: raw.eid != null ? String(raw.eid) : null,
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
  function mergeEverything(lists) {
    const [allEntries, ...restEntries] = lists;
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

  async function getEverythingEntries() {
    // 1カテゴリーの失敗で「全て」全体が失敗しないよう、取れたものだけでマージする
    // (全滅した場合のみエラー)。欠けた分は次の自動リフレッシュで補われる。
    const settled = await Promise.allSettled(REAL_CATEGORY_KEYS.map(fetchCategoryJson));
    const ok = settled.filter((r) => r.status === 'fulfilled');
    if (ok.length === 0) throw settled[0].reason;
    return mergeEverything(settled.map((r) => (r.status === 'fulfilled' ? r.value : [])));
  }

  async function getHotEntries(category) {
    const slug = category || 'all';
    if (slug === EVERYTHING_KEY) return getEverythingEntries();
    return fetchCategoryJson(slug);
  }

  // 前回取得分(Cache Storage)だけで一覧を作る。ネットワークを待たずに先に表示するための
  // もの。何も無ければnull。「全て」は取れたカテゴリーだけでマージする。
  async function getCachedHotEntries(category) {
    const slug = category || 'all';
    const read = (key) => readListFromCacheStorage(`data/hotentry-${encodeURIComponent(key)}.json`);
    if (slug !== EVERYTHING_KEY) {
      const entries = await read(slug);
      return Array.isArray(entries) ? entries : null;
    }
    const lists = await Promise.all(REAL_CATEGORY_KEYS.map(read));
    if (lists.every((l) => !Array.isArray(l))) return null;
    return mergeEverything(lists.map((l) => (Array.isArray(l) ? l : [])));
  }

  // JSONP取得+整形+localStorage保存までをひとまとめにした「生の取得」。
  async function fetchEntryInfoRaw(pageUrl) {
    const data = await jsonp('https://b.hatena.ne.jp/entry/jsonlite/', { url: pageUrl });
    // まだ誰もブックマークしていないURLは、jsonliteがnullを返す(エラーではない)。
    // コメント内のリンクやURL直接入力では普通に起こり得るため、「未ブックマーク」として
    // 扱う。存在しない/未取得のURLなので、オフライン用キャッシュには保存しない。
    if (data == null) {
      // eidが無いため、URLから直接ブックマークページのURLを組み立てる
      // (httpsは /entry/s/host/path、httpは /entry/host/path)。
      const m = /^(https?):\/\/(.+)$/.exec(pageUrl);
      const entryUrl = m
        ? `https://b.hatena.ne.jp/entry/${m[1] === 'https' ? 's/' : ''}${m[2]}`
        : null;
      return { ...normalizeEntryInfo({}, pageUrl), title: pageUrl, entryUrl, notBookmarked: true };
    }
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

  // ---- はてなスター(コメントごとのスター数) ----
  // スターAPI(entries.json)は、ブックマークのパーマリンク
  // https://b.hatena.ne.jp/{user}/{yyyymmdd}#bookmark-{eid} をURIとして、複数件まとめて
  // 問い合わせられる(uriを繰り返す)。entry.json(単数)はCORSヘッダが無く使えないが、
  // entries.json は Access-Control-Allow-Origin を返すため fetch() で直接取得できる。
  // 0件のURIは応答に含まれない。誰が付けたかは使わず、数だけ数える。
  const STAR_API_URL = 'https://s.hatena.ne.jp/entries.json';
  // URLが長くなりすぎないよう、1リクエストあたりのURI数を制限する(1件あたり約90文字)。
  const STAR_BATCH_SIZE = 50;
  const STAR_FETCH_TIMEOUT_MS = 10000;

  function bookmarkPermalink(eid, b) {
    const date = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(b.timestamp || '');
    if (!eid || !date) return null;
    const pad = (n) => String(n).padStart(2, '0');
    return `https://b.hatena.ne.jp/${encodeURIComponent(b.user)}/${date[1]}${pad(date[2])}${pad(date[3])}#bookmark-${eid}`;
  }

  // 通常のスター+色付きスターの合計。多い時は途中が {count: N} にまとめられて返る。
  function countStars(entry) {
    const sum = (stars) =>
      (Array.isArray(stars) ? stars : []).reduce((n, s) => n + (s && s.count != null ? Number(s.count) || 0 : 1), 0);
    let total = sum(entry.stars);
    for (const c of Array.isArray(entry.colored_stars) ? entry.colored_stars : []) total += sum(c && c.stars);
    return total;
  }

  async function fetchStarBatch(uris) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), STAR_FETCH_TIMEOUT_MS);
    try {
      const query = new URLSearchParams();
      for (const u of uris) query.append('uri', u);
      const res = await fetch(`${STAR_API_URL}?${query.toString()}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return Array.isArray(data.entries) ? data.entries : [];
    } finally {
      clearTimeout(timer);
    }
  }

  // bookmarks(コメント付きなど表示対象)のスター数を取得し、Map(コメントのキー -> 数)で返す。
  // キーは starKey(b)。リクエスト数は ceil(件数 / STAR_BATCH_SIZE) 本(並列)。
  // 一部のバッチが失敗しても取れた分だけ返す(スターは付加情報のため、失敗は黙って無視)。
  async function getStarCounts(eid, bookmarks) {
    const uriToKey = new Map();
    for (const b of bookmarks) {
      const uri = bookmarkPermalink(eid, b);
      if (uri) uriToKey.set(uri, starKey(b));
    }
    const uris = [...uriToKey.keys()];
    const batches = [];
    for (let i = 0; i < uris.length; i += STAR_BATCH_SIZE) batches.push(uris.slice(i, i + STAR_BATCH_SIZE));
    const settled = await Promise.allSettled(batches.map(fetchStarBatch));
    const counts = new Map();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const e of r.value) {
        const key = uriToKey.get(e.uri);
        const n = countStars(e);
        if (key != null && n > 0) counts.set(key, n);
      }
    }
    return counts;
  }

  function starKey(b) {
    return `${b.user}\n${b.timestamp}`;
  }

  global.HatenaAPI = {
    CATEGORIES,
    getStarCounts,
    starKey,
    getHotEntries,
    getCachedHotEntries,
    getEntryInfo,
    prefetchEntryInfo,
  };
})(window);
