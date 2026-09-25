/**
 * 「コメントページを開いたか(既読)」を localStorage に記録するモジュール。
 *
 * 既読にした時点のブックマーク数も一緒に記録し、その後ブックマーク数が
 * 閾値以上増えた記事は「実質的には未読(再度見たい)」とみなして、
 * グレーアウトや既読非表示の対象から外す。閾値は 件数(絶対数) または
 * パーセント(既読時からの増加率)のどちらかで設定できる。
 */
(function (global) {
  const STORAGE_KEY = 'hateb-tycoon:visited';
  const THRESHOLD_KEY = 'hateb-tycoon:visitedThreshold';
  const MAX_ENTRIES = 2000;

  const DEFAULT_THRESHOLD = { type: 'percent', value: 20 };

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

  function markVisited(url, count) {
    if (!url) return;
    const map = load();
    map[url] = { time: Date.now(), count: typeof count === 'number' ? count : 0 };
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => map[a].time - map[b].time);
      const excess = keys.length - MAX_ENTRIES;
      for (let i = 0; i < excess; i++) delete map[keys[i]];
    }
    save(map);
  }

  function loadThreshold() {
    try {
      const raw = localStorage.getItem(THRESHOLD_KEY);
      if (!raw) return { ...DEFAULT_THRESHOLD };
      const parsed = JSON.parse(raw);
      const type = parsed && (parsed.type === 'count' || parsed.type === 'percent') ? parsed.type : DEFAULT_THRESHOLD.type;
      const value = parsed && Number.isFinite(parsed.value) && parsed.value >= 0 ? parsed.value : DEFAULT_THRESHOLD.value;
      return { type, value };
    } catch (e) {
      return { ...DEFAULT_THRESHOLD };
    }
  }

  function saveThreshold(type, value) {
    if (type !== 'count' && type !== 'percent') return;
    if (!Number.isFinite(value) || value < 0) return;
    try {
      localStorage.setItem(THRESHOLD_KEY, JSON.stringify({ type, value }));
    } catch (e) {
      // localStorageが使えない環境では既定値のまま動作する
    }
  }

  // 既読時から現在までのブックマーク数の増加が閾値未満なら「まだ既読のまま」
  // とみなす(true)。閾値以上増えていれば実質未読扱い(false)。
  // 既読記録が無ければ最初から未読なので false。
  function isStillRead(item) {
    if (!item || !item.url) return false;
    const rec = load()[item.url];
    if (!rec) return false;

    const prevCount = typeof rec.count === 'number' ? rec.count : 0;
    const currentCount = typeof item.count === 'number' ? item.count : 0;
    const increase = currentCount - prevCount;
    if (increase <= 0) return true;

    const threshold = loadThreshold();
    if (threshold.type === 'count') {
      return increase < threshold.value;
    }
    // percent: 既読時が0件なら、少しでも増えたら再表示扱いにする
    if (prevCount <= 0) return false;
    return (increase / prevCount) * 100 < threshold.value;
  }

  global.Visited = { markVisited, loadThreshold, saveThreshold, isStillRead };
})(window);
