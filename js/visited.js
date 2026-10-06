/**
 * 「コメントページを開いたか(既読)」を localStorage に記録するモジュール。
 *
 * 既読にした時点のブックマーク数も一緒に記録し、その後ブックマーク数が
 * 閾値以上増えた記事は「既読済みだが更新があった(updated)」状態として、
 * グレーアウトや既読非表示の対象からは外しつつ、未訪問の未読(unread)とは
 * 区別できるようにする。閾値は 件数(絶対数) または パーセント(既読時から
 * の増加率)のどちらかで設定できる。
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

  function markVisited(url, count, hasComments) {
    if (!url) return;
    const map = load();
    map[url] = {
      time: Date.now(),
      count: typeof count === 'number' ? count : 0,
      hasComments: typeof hasComments === 'boolean' ? hasComments : true,
    };
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => map[a].time - map[b].time);
      const excess = keys.length - MAX_ENTRIES;
      for (let i = 0; i < excess; i++) delete map[keys[i]];
    }
    save(map);
    if (typeof markListener === 'function') markListener();
  }

  // 一覧の記事をまとめて既読にする(一括既読)。コメントページは開いていないため
  // コメント有無は不明で、グレーアウト対象にならない hasComments:true として記録する。
  // 戻り値は既読にした件数。
  function markManyVisited(items) {
    const map = load();
    const now = Date.now();
    let n = 0;
    for (const item of items) {
      if (!item || !item.url) continue;
      map[item.url] = {
        time: now,
        count: typeof item.count === 'number' ? item.count : 0,
        hasComments: true,
      };
      n++;
    }
    if (n === 0) return 0;
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => map[a].time - map[b].time);
      const excess = keys.length - MAX_ENTRIES;
      for (let i = 0; i < excess; i++) delete map[keys[i]];
    }
    save(map);
    if (typeof markListener === 'function') markListener();
    return n;
  }

  // 既読が増えたことを js/sync.js に知らせるためのフック(sync.js側から登録する)
  let markListener = null;
  function setMarkListener(fn) {
    markListener = fn;
  }

  function getAll() {
    return load();
  }

  // 他端末の既読をマージする。同じURLは time が新しい方を採用する(既読は増える一方なので
  // 和集合+後勝ちで衝突しない)。ローカルが変わったら true を返す。
  function mergeRemote(remote) {
    if (!remote || typeof remote !== 'object' || Array.isArray(remote)) return false;
    const map = load();
    let changed = false;
    for (const url of Object.keys(remote)) {
      const r = remote[url];
      if (!r || typeof r.time !== 'number') continue;
      const l = map[url];
      if (!l || r.time > l.time) {
        map[url] = {
          time: r.time,
          count: typeof r.count === 'number' ? r.count : 0,
          hasComments: typeof r.hasComments === 'boolean' ? r.hasComments : true,
        };
        changed = true;
      }
    }
    if (!changed) return false;
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      keys.sort((a, b) => map[a].time - map[b].time);
      const excess = keys.length - MAX_ENTRIES;
      for (let i = 0; i < excess; i++) delete map[keys[i]];
    }
    save(map);
    return true;
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

  // 既読状態を3種類で判定する。
  // - 'unread': 未訪問(既読記録が無い)
  // - 'read': 既読で、既読時からのブックマーク数増加が閾値未満(そのまま既読表示)
  // - 'updated': 既読時からブックマーク数が閾値以上増えた。見た目は未読同様に
  //   グレーアウトを外して目立たせつつ、既読済みだったことは別途示す。
  function getReadState(item) {
    if (!item || !item.url) return 'unread';
    const rec = load()[item.url];
    if (!rec) return 'unread';

    const prevCount = typeof rec.count === 'number' ? rec.count : 0;
    const currentCount = typeof item.count === 'number' ? item.count : 0;
    const increase = currentCount - prevCount;
    if (increase <= 0) return 'read';

    const threshold = loadThreshold();
    let overThreshold;
    if (threshold.type === 'count') {
      overThreshold = increase >= threshold.value;
    } else if (prevCount <= 0) {
      // percent: 既読時が0件なら、少しでも増えたら閾値超えとみなす
      overThreshold = true;
    } else {
      overThreshold = (increase / prevCount) * 100 >= threshold.value;
    }
    return overThreshold ? 'updated' : 'read';
  }

  // 前回訪問時、コメント付きブックマークが1件も無かった(=コメントが無いか、
  // ドメイン側の設定等でコメントが取得できない)場合に true。
  // まだ訪問していないURLは判断材料が無いため false(グレーアウトしない)。
  function hasNoComments(url) {
    if (!url) return false;
    const rec = load()[url];
    return !!rec && rec.hasComments === false;
  }

  // 前回コメントページを開いた時刻(ms)。未訪問なら null。
  // markVisitedで上書きされるため、新着コメント判定には上書き前に取得しておくこと。
  function getLastVisitTime(url) {
    if (!url) return null;
    const rec = load()[url];
    return rec && typeof rec.time === 'number' ? rec.time : null;
  }

  global.Visited = { markVisited, markManyVisited, setMarkListener, getAll, mergeRemote, loadThreshold, saveThreshold, getReadState, hasNoComments, getLastVisitTime };
})(window);
