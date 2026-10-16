/**
 * 自前の中継Worker(worker/hateb-proxy.js)経由で使う、自分のブックマーク関連のモジュール。
 *   - 「自分のブックマーク」ページ用の一覧取得(fetchPage)
 *   - ブックマークの取得・投稿(getBookmark / postBookmark。OAuth署名はWorker側)
 *
 * はてなのAPIはブラウザから直接使えない(CORS・OAuth 1.0a)ため、Workerに中継させる。
 * 取得対象のはてなid・OAuthの鍵はWorker側のsecretにだけあり、このアプリ(コード・localStorage・
 * 通信)は一切扱わない。保存するのはWorkerのURLとアクセストークンだけ。どちらもこの端末の
 * localStorageのみに置き、Gist同期の対象にしない。
 */
(function (global) {
  const ENDPOINT_KEY = 'hateb-tycoon:myBookmarks:endpoint';
  const TOKEN_KEY = 'hateb-tycoon:myBookmarks:token';
  const CACHE_KEY = 'hateb-tycoon:myBookmarks:cache';
  const FETCH_TIMEOUT_MS = 15000;

  function read(key) {
    try {
      return localStorage.getItem(key) || '';
    } catch (e) {
      return '';
    }
  }

  function write(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (e) {
      // localStorageが使えない環境では保存をあきらめる
    }
  }

  function getConfig() {
    return { endpoint: read(ENDPOINT_KEY), token: read(TOKEN_KEY) };
  }

  function setConfig({ endpoint, token }) {
    write(ENDPOINT_KEY, (endpoint || '').trim());
    write(TOKEN_KEY, (token || '').trim());
  }

  function isConfigured() {
    const c = getConfig();
    return !!(c.endpoint && c.token);
  }

  function safeHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  function normalizeItem(raw) {
    const url = raw.url || '';
    return {
      url,
      title: raw.title || url || '(タイトル不明)',
      domain: safeHostname(url),
      comment: raw.comment || '',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      created: raw.created || '',
      count: raw.count != null ? Number(raw.count) || 0 : 0,
      image: raw.image || '',
    };
  }

  // Workerを呼んでJSONを返す。失敗は利用者向けの文言のErrorにする。
  async function callWorker(path, { method = 'GET', query, body } = {}) {
    const { endpoint, token } = getConfig();
    if (!endpoint || !token) throw new Error('Worker URL とアクセストークンが未設定です');
    let url;
    try {
      url = new URL(endpoint);
    } catch (e) {
      throw new Error('Worker URL の形式が正しくありません');
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
    for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, String(v));

    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url.toString(), {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'リクエストがタイムアウトしました' : '通信に失敗しました');
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) throw new Error('アクセストークンが正しくありません');
    if (res.status === 400) throw new Error('はてなに受け付けられませんでした(コメントやタグを確認してください)');
    if (res.status === 409) {
      throw new Error('一覧のアカウントと、投稿に使うOAuthのアカウントが違うため中止しました(Workerの設定を確認してください)');
    }
    if (!res.ok) throw new Error(`取得に失敗しました(HTTP ${res.status})`);
    return res.json();
  }

  // 1ページ分(約20件)を取得する。戻り値: { items, nextPage(次が無ければnull) }
  async function fetchPage(page) {
    const data = await callWorker('bookmarks', { query: { page } });
    const items = Array.isArray(data.items) ? data.items.map(normalizeItem) : [];
    const nextPage = Number.isInteger(data.nextPage) ? data.nextPage : null;
    return { items, nextPage };
  }

  // 自分のそのURLのブックマーク。未ブックマークなら { exists: false }。
  async function getBookmark(url) {
    const data = await callWorker('bookmark', { query: { url } });
    return data.exists
      ? { exists: true, comment: data.comment || '', tags: Array.isArray(data.tags) ? data.tags : [] }
      : { exists: false, comment: '', tags: [] };
  }

  // Workerの設定確認。一覧とOAuthのアカウントが同じか('same' | 'different' | 'unknown')。idは返ってこない。
  async function checkConfig() {
    const data = await callWorker('check');
    return {
      listConfigured: !!data.listConfigured,
      oauthConfigured: !!data.oauthConfigured,
      accounts: ['same', 'different'].includes(data.accounts) ? data.accounts : 'unknown',
    };
  }

  // ブックマークの追加・更新(既存なら上書き)。
  async function postBookmark({ url, comment, tags }) {
    const data = await callWorker('bookmark', { method: 'POST', body: { url, comment, tags } });
    return { comment: data.comment || '', tags: Array.isArray(data.tags) ? data.tags : [] };
  }

  // オフライン時に最後に見た内容を出すため、取得に成功した1ページ目だけ保存しておく。
  function saveCache(items) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), items }));
    } catch (e) {
      // 容量超過等でも致命的ではない
    }
  }

  function loadCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      return parsed && Array.isArray(parsed.items) ? parsed.items : null;
    } catch (e) {
      return null;
    }
  }

  global.MyBookmarks = { getConfig, setConfig, isConfigured, fetchPage, getBookmark, postBookmark, checkConfig, saveCache, loadCache };
})(window);
