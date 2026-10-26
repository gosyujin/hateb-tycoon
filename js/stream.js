/**
 * ストリーム表示(#/stream)。
 *
 * 一覧データ(data/hotentry-*.json)のうちフィルタに引っかからない記事を、
 * 古い順に一定間隔でひとつずつ先頭(ページ上部)へ追加していく(新しいものほど上=降順)。かつてのTwitterのStreamのように
 * 「次々と流れてくる」見え方にするためのもので、描画する記事の見た目は
 * renderItem(item) で呼び出し側(app.js)から受け取る。
 *
 * - 開いた時点の一覧のうち新しい側INITIAL_COUNT件を流し、残りは「既出」として流さない。
 * - POLL_INTERVAL_MS ごとに一覧を再取得し、既出でない記事だけを待ち行列に足す。
 * - 先頭付近を見ている間は先頭に張り付いて新着を見せる。下へ読み進めている間は、追加で
 *   押し下げられた分だけスクロール位置を補正し、読んでいる場所を動かさない。
 * - 記事ごとにブックマークコメント(コメント付きのもののみ)を記事の下に出す。追加した時に取得し、
 *   以降はCOMMENT_REFRESH_MSごとに表示中の記事(新しい側MAX_COMMENT_WATCH件)を取り直して、
 *   新しく付いたコメントだけを記事のコメント欄の先頭へ足す(コメントも新しいものが上)。
 */
(function (global) {
  const INITIAL_COUNT = 30;
  const MAX_ITEMS = 150; // DOMに残す上限。先頭に張り付いている間だけ古い(下の)方から間引く
  const POLL_INTERVAL_MS = 2 * 60 * 1000;
  const FOLLOW_MARGIN_PX = 160;
  const COMMENT_REFRESH_MS = 3 * 60 * 1000;
  const MAX_COMMENT_WATCH = 20; // コメントを取り直す記事の上限(JSONPを連打しない)
  const COMMENT_FETCH_GAP_MS = 300;
  const INITIAL_COMMENTS = 10; // 最初に出すコメント数(新しい側)。それ以前は件数だけ出す

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

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const commentKey = (b) => `${b.user}\t${b.timestamp}`;

  // 古い順(流す順)。hatenaDateが無いものはfirstSeenAtで代用する。
  function byAge(a, b) {
    const ka = a.hatenaDate || a.firstSeenAt || '';
    const kb = b.hatenaDate || b.firstSeenAt || '';
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  }

  function create(opts) {
    const { list, statusEl, pauseBtn, intervalSelect, renderItem, renderComment, fetchComments, fetchEntries, isHidden } = opts;

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
    let commentTimer = null;
    const commentState = new WeakMap(); // 記事の要素 -> { loaded, seen:Set }

    // containerの先頭にhtmlを挿入する。挿入位置が画面の上端より上にある時は、押し下げられた分だけ
    // スクロール位置を補正して、読んでいる場所が動かないようにする(ブラウザ任せのscroll anchoringは
    // Safariに無いので使わず、css側でoverflow-anchor:noneにして自前で補正する)。
    // pinToTop が真で先頭付近を見ている時は、補正せず先頭へ戻して新着を見せる。
    // 挿入位置の判定は呼び出し側から渡す(中身が空のコメント欄はdisplay:noneで位置が取れないため)。
    function prependHtml(container, html, pinToTop, above) {
      const nearTop = window.scrollY < FOLLOW_MARGIN_PX;
      const before = document.documentElement.scrollHeight;
      container.insertAdjacentHTML('afterbegin', html);
      if (pinToTop && nearTop) window.scrollTo(0, 0);
      else if (above) window.scrollBy(0, document.documentElement.scrollHeight - before);
      return pinToTop && nearTop;
    }

    function updateStatus() {
      if (loadError && shownCount === 0) {
        statusEl.textContent = loadError;
        return;
      }
      const parts = [`表示 ${shownCount} 件`, `待機 ${queue.length} 件`];
      parts.push(paused ? '一時停止中' : `${intervalMs >= 60000 ? `${intervalMs / 60000}分` : `${intervalMs / 1000}秒`}ごと`);
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

    async function loadComments(el) {
      const url = el.dataset.url;
      if (!url) return;
      let state = commentState.get(el);
      if (!state) {
        state = { loaded: false, seen: new Set() };
        commentState.set(el, state);
      }
      const mySeq = seq;
      let comments;
      try {
        comments = await fetchComments(url);
      } catch (err) {
        return; // 取れなかった記事は次の取り直しでもう一度試す
      }
      if (mySeq !== seq || !el.isConnected) return;
      const first = !state.loaded;
      state.loaded = true;
      const fresh = comments.filter((b) => !state.seen.has(commentKey(b)));
      if (fresh.length === 0) return;
      fresh.forEach((b) => state.seen.add(commentKey(b)));
      fresh.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0)); // 新しい順
      let shown = fresh;
      let omitted = 0;
      if (first && fresh.length > INITIAL_COMMENTS) {
        omitted = fresh.length - INITIAL_COMMENTS;
        shown = fresh.slice(0, INITIAL_COMMENTS);
      }
      // 省略した古い分の件数は、新しい順の一番下に出す
      const more = omitted > 0 ? `<li class="stream-comments-more">他 ${omitted} 件のコメント</li>` : '';
      const ul = el.querySelector('.stream-comments');
      // 挿入位置はコメント欄の直前の要素(タイトル・概要)の下端。それが画面の上端より上なら押し下げが見えている側に及ぶ
      const above = ul.previousElementSibling.getBoundingClientRect().bottom < 0;
      prependHtml(ul, shown.map(renderComment).join('') + more, false, above);
    }

    function scheduleCommentRefresh() {
      clearTimeout(commentTimer);
      commentTimer = null;
      if (!running) return;
      commentTimer = setTimeout(async () => {
        if (!document.hidden && !paused) {
          const mySeq = seq;
          for (const el of Array.from(list.children).slice(0, MAX_COMMENT_WATCH)) {
            if (mySeq !== seq) return;
            await loadComments(el);
            await sleep(COMMENT_FETCH_GAP_MS);
          }
        }
        scheduleCommentRefresh();
      }, COMMENT_REFRESH_MS);
    }

    function appendNext() {
      // 待機中にミュートされた記事は流さない
      let item = queue.shift();
      while (item && isHidden(item)) item = queue.shift();
      if (!item) return;

      const pinned = prependHtml(list, renderItem(item), true, list.getBoundingClientRect().top < 0);
      shownCount++;
      loadComments(list.firstElementChild);
      if (pinned) {
        while (list.children.length > MAX_ITEMS) list.removeChild(list.lastElementChild);
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
        scheduleCommentRefresh();
      });
    }

    function stop() {
      running = false;
      seq++;
      clearTimeout(tickTimer);
      clearTimeout(pollTimer);
      clearTimeout(commentTimer);
      tickTimer = null;
      pollTimer = null;
      commentTimer = null;
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
