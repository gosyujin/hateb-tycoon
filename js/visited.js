/**
 * 「コメントページを開いたか(既読)」を localStorage に記録するモジュール。
 * キーはURL、値は既読になった時刻(ms)。件数が上限を超えたら古いものから削除する。
 */
(function (global) {
  const STORAGE_KEY = 'hateb-tycoon:visited';
  const MAX_ENTRIES = 2000;

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function save(map) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
      // localStorageが使えない環境では既読管理をあきらめる
    }
  }

  function markVisited(url) {
    if (!url) return;
    const map = load();
    map[url] = Date.now();
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => map[a] - map[b]);
      const excess = keys.length - MAX_ENTRIES;
      for (let i = 0; i < excess; i++) delete map[keys[i]];
    }
    save(map);
  }

  // 一覧の一括判定用に、現在既読のURL集合を返す。
  function loadSet() {
    return new Set(Object.keys(load()));
  }

  global.Visited = { markVisited, loadSet };
})(window);
