/**
 * ストリーム表示(#/stream)。
 *
 * 一覧データ(data/hotentry-*.json)のうちフィルタに引っかからない記事を、
 * 古い順に一定間隔でひとつずつ末尾へ追加していく。かつてのTwitterのStreamのように
 * 「次々と流れてくる」見え方にするためのもので、描画する記事の見た目は
 * renderItem(item) で呼び出し側(app.js)から受け取る。
 *
 * - 開いた時点の一覧のうち新しい側INITIAL_COUNT件を流し、残りは「既出」として流さない。
 * - POLL_INTERVAL_MS ごとに一覧を再取得し、既出でない記事だけを待ち行列に足す。
 * - 末尾付近を見ている間だけ追従スクロールする(遡って読んでいる時は動かさない)。
 */
(function (global) {
  const INITIAL_COUNT = 30;
  const MAX_ITEMS = 150; // DOMに残す上限。追従中だけ古い方から間引く
  const POLL_INTERVAL_MS = 2 * 60 * 1000;
  const FOLLOW_MARGIN_PX = 160;

  const INTERVAL_KEY = 'hateb-tycoon:streamInterval';
  const DEFAULT_INTERVAL_MS = 3000;

  function loadInterval() {
    try {
      const v = Number(localStorage.getItem(INTERVAL_KEY));
      return Number.isFinite(v) && v >= 500 ? v : DEFAULT_INTERVAL_MS;
    } catch (e) {
      return DEFAULT_INTERVAL_MS;
    }
  }

  function saveInterval(ms) {
    try {
      localStorage.setItem(INTERVAL_KEY, String(ms));
    } catch (e) {
      // localStorageが使えない環境では記憶をあきらめる
    }
  }

  // 古い順(流す順)。hatenaDateが無いものはfirstSeenAtで代用する。
  function byAge(a, b) {
    const ka = a.hatenaDate || a.firstSeenAt || '';
    const kb = b.hatenaDate || b.firstSeenAt || '';
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }

  function create(opts) {
    const { list, statusEl, pauseBtn, intervalSelect, renderItem, fetchEntries, isHidden } = opts;

    let category = null;
    let running = false;
    let paused = false;
    let intervalMs = loadInterval();
    let seq = 0; // 開始し直した後に古い取得結果で上書きしないための世代番号
    let seen = new Set();
    let queue = [];
    let shownCount = 0;
    let loadError = '';
    let tickTimer = null;
    let pollTimer = null;

    function isNearBottom() {
      const el = document.documentElement;
      return window.innerHeight + window.scrollY >= el.scrollHeight - FOLLOW_MARGIN_PX;
    }

    function updateStatus() {
      if (loadError && shownCount === 0) {
        statusEl.textContent = loadError;
        return;
      }
      const parts = [`表示 ${shownCount} 件`, `待機 ${queue.length} 件`];
      parts.push(paused ? '一時停止中' : `${intervalMs / 1000}秒ごと`);
      statusEl.textContent = parts.join(' / ');
    }

    function updatePauseBtn() {
      pauseBtn.textContent = paused ? '▶️ 再開' : '⏸️ 一時停止';
      pauseBtn.setAttribute('aria-pressed', String(paused));
    }

    function enqueueNew(entries) {
      const fresh = entries.filter((item) => !seen.has(item.url));
      fresh.forEach((item) => seen.add(item.url));
      const visible = fresh.filter((item) => !isHidden(item)).sort(byAge);
      queue = queue.concat(visible);
    }

    function appendNext() {
      // 待機中にミュートされた記事は流さない
      let item = queue.shift();
      while (item && isHidden(item)) item = queue.shift();
      if (!item) return;

      const follow = isNearBottom();
      list.insertAdjacentHTML('beforeend', renderItem(item));
      shownCount++;
      if (follow) {
        while (list.children.length > MAX_ITEMS) list.removeChild(list.firstElementChild);
        // smoothだと次の追加までに追いつけず、遅れた分だけ「末尾を見ていない」と判定されて追従が外れるため即時に送る
        window.scrollTo(0, document.documentElement.scrollHeight);
      }
    }

    function scheduleTick() {
      clearTimeout(tickTimer);
      tickTimer = null;
      if (!running || paused || document.hidden) return;
      tickTimer = setTimeout(() => {
        appendNext();
        updateStatus();
        scheduleTick();
      }, intervalMs);
    }

    async function load(first) {
      const mySeq = seq;
      try {
        const entries = await fetchEntries(category);
        if (mySeq !== seq) return;
        loadError = '';
        if (first) {
          // 新しい側のINITIAL_COUNT件だけ流し、それ以前は既出扱いにする
          const sorted = entries.filter((item) => !isHidden(item)).sort(byAge);
          const initial = sorted.slice(-INITIAL_COUNT);
          entries.forEach((item) => seen.add(item.url));
          queue = initial;
          appendNext();
        } else {
          enqueueNew(entries);
        }
      } catch (err) {
        if (mySeq !== seq) return;
        console.warn('[stream] load failed', err);
        loadError = `取得に失敗しました: ${err.message}`;
      }
      updateStatus();
    }

    function schedulePoll() {
      clearTimeout(pollTimer);
      pollTimer = null;
      if (!running) return;
      pollTimer = setTimeout(async () => {
        if (!document.hidden) await load(false);
        schedulePoll();
      }, POLL_INTERVAL_MS);
    }

    function onVisibilityChange() {
      if (!running) return;
      scheduleTick();
      // 裏にいた間に溜まった更新を拾う
      if (!document.hidden) load(false);
    }

    function start(cat) {
      stop();
      category = cat;
      running = true;
      paused = false;
      seq++;
      seen = new Set();
      queue = [];
      shownCount = 0;
      loadError = '';
      list.innerHTML = '';
      intervalSelect.value = String(intervalMs);
      updatePauseBtn();
      statusEl.textContent = '読み込み中…';
      load(true).then(() => {
        scheduleTick();
        schedulePoll();
      });
    }

    function stop() {
      running = false;
      seq++;
      clearTimeout(tickTimer);
      clearTimeout(pollTimer);
      tickTimer = null;
      pollTimer = null;
    }

    pauseBtn.addEventListener('click', () => {
      paused = !paused;
      updatePauseBtn();
      updateStatus();
      scheduleTick();
    });

    intervalSelect.addEventListener('change', () => {
      const v = Number(intervalSelect.value);
      if (!Number.isFinite(v) || v < 500) return;
      intervalMs = v;
      saveInterval(v);
      updateStatus();
      scheduleTick();
    });

    document.addEventListener('visibilitychange', onVisibilityChange);

    return { start, stop };
  }

  global.Stream = { create };
})(window);
