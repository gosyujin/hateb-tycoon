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
 * - 追加間隔に「自動」がある。次回のデータ更新の目安時刻までの残り時間を待機中の件数で割り、
 *   更新までに待機分をほぼ流し切る間隔にする(目安時刻は大まかなので、正確さは求めない)。
 *   更新までの残り秒数は状態表示に常に出す。
 * - 表示中の記事・コメントと既出URLをカテゴリーごとにlocalStorageへ保存し、リロードや開き直しの
 *   時は前回の続きから表示する(保存に失敗しても、いちから流すだけで動作は変わらない)。
 * - 表示している間は画面をスリープさせない(Screen Wake Lock。非対応の環境では何もしない)。
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
  const AUTO = 'auto';
  // 自動の時の間隔の範囲(手動で選べる最短・最長に合わせる)
  const AUTO_MIN_MS = 1000;
  const AUTO_MAX_MS = 5 * 60 * 1000;
  // 目安時刻を過ぎている/分からない時でも、最低これだけの時間をかけて流す
  const AUTO_MIN_SPAN_MS = 60 * 1000;
  const AUTO_UNKNOWN_SPAN_MS = 10 * 60 * 1000;
  const IDLE_CHECK_MS = 5000; // 待機が空の間、新しい記事が入っていないかを見る間隔

  // 前回の続きから表示するための保存(カテゴリーごと)。localStorageの容量を食いすぎないよう上限を持つ
  const STATE_KEY_PREFIX = 'hateb-tycoon:streamState:';
  const STATE_MAX_ITEMS = 60;
  const STATE_MAX_COMMENTS = 15;
  const STATE_TTL_MS = 3 * 24 * 60 * 60 * 1000; // これより古い保存は使わず、いちから流す
  const STATE_SAVE_DELAY_MS = 1000;

  function readState(category) {
    try {
      const raw = localStorage.getItem(STATE_KEY_PREFIX + category);
      const s = raw ? JSON.parse(raw) : null;
      if (!s || !Array.isArray(s.items) || !Array.isArray(s.seen)) return null;
      if (!(Date.now() - s.savedAt < STATE_TTL_MS)) return null;
      return s;
    } catch (e) {
      return null;
    }
  }

  // 一覧データの1件から、描画と判定に使う項目だけを残す(保存量を抑える)
  function slimItem(item) {
    return {
      title: item.title,
      url: item.url,
      domain: item.domain,
      count: item.count,
      screenshot: item.screenshot,
      description: item.description,
      hatenaDate: item.hatenaDate,
    };
  }

  // 手動の間隔(ms)または AUTO
  function loadInterval() {
    try {
      const raw = localStorage.getItem(INTERVAL_KEY);
      if (raw === AUTO) return AUTO;
      const v = Number(raw);
      return Number.isFinite(v) && v >= 500 ? v : DEFAULT_INTERVAL_MS;
    } catch (e) {
      return DEFAULT_INTERVAL_MS;
    }
  }

  function saveInterval(value) {
    try {
      localStorage.setItem(INTERVAL_KEY, String(value));
    } catch (e) {
      // localStorageが使えない環境では記憶をあきらめる
    }
  }

  function formatInterval(ms) {
    if (ms >= 60000) return `${Math.round(ms / 6000) / 10}分`;
    const sec = ms / 1000;
    return `${sec >= 10 ? Math.round(sec) : Math.round(sec * 10) / 10}秒`;
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
    const { list, statusEl, pauseBtn, intervalSelect, renderItem, renderComment, fetchComments, fetchEntries, fetchNextUpdateAt, isHidden } = opts;

    let category = null;
    let running = false;
    let paused = false;
    let intervalSetting = loadInterval(); // 手動の間隔(ms)または AUTO
    let nextUpdateAt = null; // 次回のデータ更新の目安(ms)。分からなければnull
    let countdownTimer = null;
    let saveTimer = null;
    let wakeLock = null;
    let knownUrls = new Set(); // 直近に取得した一覧にあるURL(保存する既出URLをこれに絞って膨らみを防ぐ)
    const itemData = new WeakMap(); // 記事の要素 -> 保存用の記事データ
    let seq = 0; // 開始し直した後に古い取得結果で上書きしないための世代番号
    let seen = new Set();
    let queue = [];
    let shownCount = 0;
    let loadError = '';
    let tickTimer = null;
    let pollTimer = null;
    let commentTimer = null;
    // 記事の要素 -> { loaded, seen:Set, comments:[表示済みのコメント(新しい順)], omitted, floor }
    // floor: これより古いコメントは省略済みとして扱う(初回に出さなかった古い分や、保存で切った分が後から湧かないように)
    const commentState = new WeakMap();

    function saveStateNow() {
      clearTimeout(saveTimer);
      saveTimer = null;
      if (!category) return;
      try {
        const items = [];
        for (const el of Array.from(list.children).slice(0, STATE_MAX_ITEMS)) {
          const item = itemData.get(el);
          if (!item) continue;
          const st = commentState.get(el);
          const rec = { item, loaded: false, comments: [], omitted: 0, floor: '' };
          if (st && st.loaded) {
            rec.loaded = true;
            rec.comments = st.comments.slice(0, STATE_MAX_COMMENTS);
            rec.omitted = st.omitted + (st.comments.length - rec.comments.length);
            rec.floor = rec.omitted > 0 && rec.comments.length > 0 ? rec.comments[rec.comments.length - 1].timestamp : st.floor;
          }
          items.push(rec);
        }
        // 待機中の記事は「まだ流していない」ので既出に含めない(次回の続きで流す)
        const queued = new Set(queue.map((i) => i.url));
        const shownUrls = new Set(items.map((r) => r.item.url));
        const seenArr = Array.from(seen).filter((u) => !queued.has(u) && (knownUrls.has(u) || shownUrls.has(u)));
        localStorage.setItem(STATE_KEY_PREFIX + category, JSON.stringify({ savedAt: Date.now(), seen: seenArr, items }));
      } catch (e) {
        // 容量超過等でも致命的ではない(次回いちから流すだけ)ため無視する
      }
    }

    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveStateNow, STATE_SAVE_DELAY_MS);
    }

    // 保存済みの記事・コメントを、一覧(新しい順)へそのまま並べ直す。並べた件数を返す
    function restoreItems(saved) {
      let n = 0;
      for (const rec of saved.items) {
        if (!rec || !rec.item || isHidden(rec.item)) continue; // 保存後にミュートされた記事は出さない
        list.insertAdjacentHTML('beforeend', renderItem(rec.item));
        const el = list.lastElementChild;
        itemData.set(el, rec.item);
        const comments = Array.isArray(rec.comments) ? rec.comments : [];
        const state = {
          loaded: !!rec.loaded,
          seen: new Set(comments.map(commentKey)),
          comments: comments.slice(),
          omitted: rec.omitted || 0,
          floor: rec.floor || '',
        };
        commentState.set(el, state);
        const more = state.omitted > 0 ? `<li class="stream-comments-more">他 ${state.omitted} 件のコメント</li>` : '';
        el.querySelector('.stream-comments').innerHTML = comments.map(renderComment).join('') + more;
        n++;
      }
      return n;
    }

    // 表示している間は画面をスリープさせない。裏に回ると自動で解放されるため、前面に戻った時に取り直す
    async function requestWakeLock() {
      if (!running || document.hidden || wakeLock || !navigator.wakeLock) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!running) {
          lock.release().catch(() => {});
          return;
        }
        wakeLock = lock;
        lock.addEventListener('release', () => {
          if (wakeLock === lock) wakeLock = null;
        });
      } catch (err) {
        // 非対応・省電力モード等で取れなくても、流すこと自体は続けられる
      }
    }

    function releaseWakeLock() {
      if (wakeLock) wakeLock.release().catch(() => {});
      wakeLock = null;
    }

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

    // 状態表示は1行に収めるため、はみ出す分は省略記号にし、全文はtitleで見られるようにする
    function setStatus(text) {
      statusEl.textContent = text;
      statusEl.title = text;
    }

    // 今の間隔(ms)。自動の時は「更新までの残り時間 ÷ 待機件数」
    function currentIntervalMs() {
      if (intervalSetting !== AUTO) return intervalSetting;
      let span = nextUpdateAt == null ? AUTO_UNKNOWN_SPAN_MS : Math.max(nextUpdateAt - Date.now(), AUTO_MIN_SPAN_MS);
      const ms = span / Math.max(queue.length, 1);
      return Math.min(Math.max(ms, AUTO_MIN_MS), AUTO_MAX_MS);
    }

    function updateStatus() {
      if (loadError && shownCount === 0) {
        setStatus(loadError);
        return;
      }
      // 狭い幅では1行に収めるため、.stream-st-wide(表示件数・「ごと」・「更新まで」)を隠して
      // .stream-st-narrow(「残り」)に替える(css側)。手動の間隔は選択欄に出ているので繰り返さない
      const parts = [`<span class="stream-st-wide">表示 ${shownCount} / </span>待機 ${queue.length}`];
      if (paused) parts.push('一時停止中');
      else if (intervalSetting === AUTO) parts.push(`${formatInterval(currentIntervalMs())}<span class="stream-st-wide">ごと</span>`);
      if (nextUpdateAt != null) {
        const sec = Math.round((nextUpdateAt - Date.now()) / 1000);
        parts.push(
          sec > 0
            ? `<span class="stream-st-wide">更新まで</span><span class="stream-st-narrow">残り</span> ${sec}秒`
            : '更新待ち'
        );
      }
      statusEl.innerHTML = parts.join(' / ');
      statusEl.title = statusEl.textContent;
    }

    async function refreshNextUpdateAt() {
      if (!fetchNextUpdateAt) return;
      try {
        const at = await fetchNextUpdateAt();
        if (at != null) nextUpdateAt = at;
      } catch (err) {
        // 目安が取れなくても流すこと自体は続けられるため、前回の値のままにする
      }
    }

    function updatePauseBtn() {
      const label = paused ? '再開' : '一時停止';
      // 狭い幅では絵文字だけにする(css側で.stream-btn-labelを隠す)
      pauseBtn.innerHTML = `${paused ? '▶️' : '⏸️'}<span class="stream-btn-label"> ${label}</span>`;
      pauseBtn.setAttribute('aria-label', label);
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
        state = { loaded: false, seen: new Set(), comments: [], omitted: 0, floor: '' };
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
      const fresh = comments.filter((b) => !state.seen.has(commentKey(b)) && b.timestamp >= state.floor);
      if (fresh.length === 0) return;
      fresh.forEach((b) => state.seen.add(commentKey(b)));
      fresh.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0)); // 新しい順
      let shown = fresh;
      let omitted = 0;
      if (first && fresh.length > INITIAL_COMMENTS) {
        omitted = fresh.length - INITIAL_COMMENTS;
        shown = fresh.slice(0, INITIAL_COMMENTS);
        state.omitted = omitted;
        state.floor = shown[shown.length - 1].timestamp;
      }
      state.comments = shown.concat(state.comments);
      // 省略した古い分の件数は、新しい順の一番下に出す
      const more = omitted > 0 ? `<li class="stream-comments-more">他 ${omitted} 件のコメント</li>` : '';
      const ul = el.querySelector('.stream-comments');
      // 挿入位置はコメント欄の直前の要素(タイトル・概要)の下端。それが画面の上端より上なら押し下げが見えている側に及ぶ
      const above = ul.previousElementSibling.getBoundingClientRect().bottom < 0;
      prependHtml(ul, shown.map(renderComment).join('') + more, false, above);
      scheduleSave();
    }

    async function refreshComments() {
      const mySeq = seq;
      for (const el of Array.from(list.children).slice(0, MAX_COMMENT_WATCH)) {
        if (mySeq !== seq) return;
        await loadComments(el);
        await sleep(COMMENT_FETCH_GAP_MS);
      }
    }

    function scheduleCommentRefresh() {
      clearTimeout(commentTimer);
      commentTimer = null;
      if (!running) return;
      commentTimer = setTimeout(async () => {
        if (!document.hidden && !paused) await refreshComments();
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
      itemData.set(list.firstElementChild, slimItem(item));
      loadComments(list.firstElementChild);
      scheduleSave();
      if (pinned) {
        while (list.children.length > MAX_ITEMS) list.removeChild(list.lastElementChild);
      }
    }

    function scheduleTick() {
      clearTimeout(tickTimer);
      tickTimer = null;
      if (!running || paused || document.hidden) return;
      // 待機が空の間は、間隔を待たずに新着が入っていないかを短い周期で見る
      const delay = queue.length === 0 ? IDLE_CHECK_MS : currentIntervalMs();
      tickTimer = setTimeout(() => {
        appendNext();
        updateStatus();
        scheduleTick();
      }, delay);
    }

    async function load(first) {
      const mySeq = seq;
      try {
        const [entries] = await Promise.all([fetchEntries(category), refreshNextUpdateAt()]);
        if (mySeq !== seq) return;
        loadError = '';
        knownUrls = new Set(entries.map((item) => item.url));
        if (first) {
          // 新しい側のINITIAL_COUNT件だけ流し、それ以前は既出扱いにする。
          // 前回の続きの時は、前回までに既出でないもの(前回の待機分+その後の新着)から数える
          const sorted = entries.filter((item) => !isHidden(item) && !seen.has(item.url)).sort(byAge);
          const initial = sorted.slice(-INITIAL_COUNT);
          const initialUrls = new Set(initial.map((item) => item.url));
          entries.forEach((item) => {
            if (!initialUrls.has(item.url)) seen.add(item.url);
          });
          initial.forEach((item) => seen.add(item.url));
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
      if (document.hidden) saveStateNow();
      else requestWakeLock();
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
      knownUrls = new Set();
      // 前回の続きがあれば、取得を待たずにまず並べ直す(オフラインでも前回の分は見られる)
      const saved = readState(category);
      if (saved) {
        shownCount = restoreItems(saved);
        saved.seen.forEach((u) => seen.add(u));
        Array.from(list.children).forEach((el) => {
          const item = itemData.get(el);
          if (item) seen.add(item.url);
        });
      }
      intervalSelect.value = String(intervalSetting);
      updatePauseBtn();
      setStatus('読み込み中…');
      load(true).then(() => {
        scheduleTick();
        schedulePoll();
        scheduleCommentRefresh();
        // 続きから開いた時は、保存後に付いたコメントもすぐ拾う
        if (saved) refreshComments();
      });
      requestWakeLock();
      // 更新までの残り秒数を1秒ごとに進める
      countdownTimer = setInterval(() => {
        if (!document.hidden) updateStatus();
      }, 1000);
    }

    function stop() {
      if (running) saveStateNow();
      running = false;
      releaseWakeLock();
      seq++;
      clearTimeout(tickTimer);
      clearTimeout(pollTimer);
      clearTimeout(commentTimer);
      clearInterval(countdownTimer);
      countdownTimer = null;
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
      const v = intervalSelect.value === AUTO ? AUTO : Number(intervalSelect.value);
      if (v !== AUTO && (!Number.isFinite(v) || v < 500)) return;
      intervalSetting = v;
      saveInterval(v);
      updateStatus();
      scheduleTick();
    });

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', () => {
      if (running) saveStateNow();
    });

    return { start, stop };
  }

  global.Stream = { create };
})(window);
