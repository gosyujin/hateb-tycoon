/**
 * はてなブックマークの公開データ取得モジュール。
 *
 * - 人気/新着エントリー一覧: 昔ながらの https://b.hatena.ne.jp/hotentry/{category}.json は
 *   廃止済み(2026-09時点で404)のため、今も生きている RSS(RDF)フィード
 *   https://b.hatena.ne.jp/hotentry/{category}.rss を使用する。RSSはCORSヘッダを
 *   返さないため、無料のCORSプロキシ(api.allorigins.win)経由でfetch()する。
 * - 個別記事のブックマーク情報(コメント一覧含む): https://b.hatena.ne.jp/entry/jsonlite/?url=...
 *   はCORSなしでもJSONPで取得できるため、そのまま <script> タグ挿入方式を使う。
 */
(function (global) {
  const RSS_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
  ];
  const RSS_NS = {
    rss: 'http://purl.org/rss/1.0/',
    hatena: 'http://www.hatena.ne.jp/info/xmlns#',
  };

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

  function textOf(el, ns, tag) {
    const nodes = el.getElementsByTagNameNS(ns, tag);
    return nodes.length ? nodes[0].textContent.trim() : '';
  }

  function parseHotEntryRss(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('RSSの解析に失敗しました');
    }
    const items = Array.from(doc.getElementsByTagNameNS(RSS_NS.rss, 'item'));
    return items.map((item) => {
      const url = textOf(item, RSS_NS.rss, 'link');
      const countText = textOf(item, RSS_NS.hatena, 'bookmarkcount');
      return {
        title: textOf(item, RSS_NS.rss, 'title') || '(タイトル不明)',
        url,
        domain: safeHostname(url),
        count: countText ? Number(countText) || 0 : 0,
        entryUrl: textOf(item, RSS_NS.hatena, 'bookmarkCommentListPageUrl') || null,
        screenshot: textOf(item, RSS_NS.hatena, 'imageurl') || null,
        users: [],
      };
    });
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

  async function fetchViaProxies(targetUrl) {
    const failures = [];
    for (const buildProxyUrl of RSS_PROXIES) {
      const proxyUrl = buildProxyUrl(targetUrl);
      try {
        const res = await fetch(proxyUrl);
        if (!res.ok) {
          failures.push(`${proxyUrl} -> HTTP ${res.status}`);
          continue;
        }
        return await res.text();
      } catch (e) {
        failures.push(`${proxyUrl} -> ${e.message}`);
      }
    }
    throw new Error(`データの取得に失敗しました(全プロキシ失敗): ${failures.join(' / ')}`);
  }

  async function getHotEntries(category) {
    const slug = category || 'all';
    const rssUrl = `https://b.hatena.ne.jp/hotentry/${encodeURIComponent(slug)}.rss`;
    const xmlText = await fetchViaProxies(rssUrl);
    return parseHotEntryRss(xmlText);
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
