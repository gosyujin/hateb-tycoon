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
 *   <script> タグ挿入方式でリアルタイムに取得する。
 */
(function (global) {
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
      })),
    };
  }

  const CATEGORIES = [
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

  async function getHotEntries(category) {
    const slug = category || 'all';
    const dataUrl = `data/hotentry-${encodeURIComponent(slug)}.json`;
    const res = await fetch(dataUrl, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`データの取得に失敗しました(HTTP ${res.status}): ${dataUrl}`);
    }
    const entries = await res.json();
    return Array.isArray(entries) ? entries : [];
  }

  async function getEntryInfo(pageUrl) {
    const data = await jsonp('https://b.hatena.ne.jp/entry/jsonlite/', { url: pageUrl });
    return normalizeEntryInfo(data, pageUrl);
  }

  global.HatenaAPI = {
    CATEGORIES,
    getHotEntries,
    getEntryInfo,
  };
})(window);
