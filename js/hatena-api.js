/**
 * はてなブックマーク公開JSON APIをJSONP経由で取得するモジュール。
 *
 * fetch() でも取得できる場合があるが、b.hatena.ne.jp が CORS ヘッダを
 * 返さない環境でも動作するように <script> タグ挿入によるJSONP方式を採用する。
 *
 * 使用エンドポイント:
 *   - 人気/新着エントリー一覧: https://b.hatena.ne.jp/hotentry/{category}.json
 *   - 個別記事のブックマーク情報(コメント一覧含む): https://b.hatena.ne.jp/entry/jsonlite/?url=...
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

  function normalizeHotEntry(raw) {
    const url = raw.url || '';
    return {
      title: raw.title || '(タイトル不明)',
      url,
      domain: safeHostname(url),
      count: raw.count != null ? raw.count : 0,
      entryUrl:
        raw.entry_url ||
        (raw.eid ? `https://b.hatena.ne.jp/entry/${raw.eid}` : null),
      screenshot: raw.screenshot || raw.image_url || null,
      users: Array.isArray(raw.users) ? raw.users : [],
    };
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
        tags: Array.isArray(b.tags) ? b.tags : [],
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
    { key: 'book', label: '本' },
  ];

  async function getHotEntries(category) {
    const slug = category || 'all';
    const base = `https://b.hatena.ne.jp/hotentry/${encodeURIComponent(slug)}.json`;
    const data = await jsonp(base);
    return Array.isArray(data) ? data.map(normalizeHotEntry) : [];
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
