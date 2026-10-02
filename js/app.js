(function () {
  const listView = document.getElementById('view-list');
  const entryView = document.getElementById('view-entry');
  const headerSearch = document.getElementById('header-search');
  const categoryTabs = document.getElementById('category-tabs');
  const entryGrid = document.getElementById('entry-grid');
  const listStatus = document.getElementById('list-status');
  const sortSelect = document.getElementById('sort-select');
  const hideVisitedCheckbox = document.getElementById('hide-visited-checkbox');
  const listLayoutToggle = document.getElementById('list-layout-toggle');

  const appTitleLink = document.getElementById('app-title-link');
  const entryBack = document.getElementById('entry-back');
  const entryBackBottom = document.getElementById('entry-back-bottom');
  const entryFilterBtn = document.getElementById('entry-filter-btn');
  const entryPrevBtn = document.getElementById('entry-prev-btn');
  const entryNextBtn = document.getElementById('entry-next-btn');
  const entryHeader = document.getElementById('entry-header');
  const entryDescription = document.getElementById('entry-description');
  const commentList = document.getElementById('comment-list');
  const entryStatus = document.getElementById('entry-status');
  const commentLayoutToggle = document.getElementById('comment-layout-toggle');

  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-close');
  const settingsTabs = document.getElementById('settings-tabs');
  const settingsForm = document.getElementById('settings-form');
  const ruleTypeSelect = document.getElementById('rule-type');
  const ruleValueInput = document.getElementById('rule-value');
  const ruleList = document.getElementById('rule-list');
  const ruleCount = document.getElementById('rule-count');
  const exportBtn = document.getElementById('export-btn');
  const copyBtn = document.getElementById('copy-btn');
  const exportTextBtn = document.getElementById('export-text-btn');
  const importFileInput = document.getElementById('import-file-input');
  const importStatus = document.getElementById('import-status');
  const importKindSelect = document.getElementById('import-kind-select');
  const visitedThresholdValueInput = document.getElementById('visited-threshold-value');
  const visitedThresholdTypeSelect = document.getElementById('visited-threshold-type');
  const offlineCacheCountInput = document.getElementById('offline-cache-count');
  const offlineCacheBtn = document.getElementById('offline-cache-btn');
  const offlineCacheStatus = document.getElementById('offline-cache-status');
  const offlineCacheQuick = document.getElementById('offline-cache-quick');
  const offlineCacheQuickBtn = document.getElementById('offline-cache-quick-btn');
  const offlineCachePopover = document.getElementById('offline-cache-popover');
  const offlineCachePopoverStatus = document.getElementById('offline-cache-popover-status');

  let currentCategory = 'everything';
  let currentSettingsKind = 'mute';

  const PAGE_SIZE = 20;
  let baseEntries = []; // フィルタ適用後、取り込み順(APIの返却順)のまま保持する基準データ
  let hiddenByFilterCount = 0;
  let hasLoadedList = false;
  let listLoading = false;
  let currentVisibleEntries = [];
  let renderedCount = 0;
  let scrollObserver = null;
  let currentSortMode = 'hatenaDate';
  let hideVisited = false; // デフォルトは非表示にしない(チェックなし)

  // 一覧ページの表示方法(plain/rich)。ブックマークページのコメント表示の
  // plain/rich(COMMENT_LAYOUT_KEY)とは別軸の設定のため、独立したキーで保存する。
  const LIST_LAYOUT_KEY = 'hateb-tycoon:listLayout';
  let listLayout = loadListLayout();
  let listRoot = entryGrid; // rich時はentryGrid自身、plain時はentryGrid内の<ul>

  function loadListLayout() {
    try {
      return localStorage.getItem(LIST_LAYOUT_KEY) === 'plain' ? 'plain' : 'rich';
    } catch (e) {
      return 'rich';
    }
  }

  function saveListLayout(mode) {
    try {
      localStorage.setItem(LIST_LAYOUT_KEY, mode);
    } catch (e) {
      // localStorageが使えない環境では記憶をあきらめる
    }
  }

  function updateListLayoutToggleUI() {
    listLayoutToggle.querySelectorAll('button[data-layout]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === listLayout);
    });
  }

  listLayoutToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-layout]');
    if (!btn || btn.dataset.layout === listLayout) return;
    listLayout = btn.dataset.layout;
    saveListLayout(listLayout);
    updateListLayoutToggleUI();
    updateListView();
  });

  // ヘッダーの検索欄。検索結果画面には遷移せず、その場で絞り込むだけ。
  // 一覧ページ: タイトル・ドメイン / ブックマークページ: ユーザーid・コメント本文が対象。
  let searchQuery = '';
  const LIST_SEARCH_PLACEHOLDER = 'タイトル・ドメインで絞り込み / URLを入力してEnterでブックマーク一覧';
  const ENTRY_SEARCH_PLACEHOLDER = 'ユーザー・コメントで絞り込み / URLを入力してEnterで別のブックマーク一覧';

  // コメントページから「← 一覧に戻る」で戻った時にスクロール位置を復元するため、
  // 一覧表示中のスクロール位置を随時記録しておく。
  let pendingScrollY = null;
  window.addEventListener('scroll', () => {
    if (!listView.hidden) {
      pendingScrollY = window.scrollY;
    }
  });

  // 取り込み順(acquired)は無並び替え(APIが firstSeenAt 新しい順で返す順序をそのまま使う)。
  // hatenaDate は RSSの dc:date(はてな側が記事に付与する日時)で、取得のたびに
  // 更新されるため、自前のfirstSeenAt/lastSeenAtとは異なる「はてな視点の新しさ」になる。
  const SORT_MODES = {
    acquired: null,
    count: (a, b) => (b.count || 0) - (a.count || 0),
    hatenaDate: (a, b) => (b.hatenaDate || '').localeCompare(a.hatenaDate || ''),
    title: (a, b) => (a.title || '').localeCompare(b.title || '', 'ja'),
  };

  function applySort(items, mode) {
    const cmp = SORT_MODES[mode];
    return cmp ? items.slice().sort(cmp) : items;
  }

  // 各kindの詳しい説明は settings-tabs 直下の .hint に集約しているため、
  // タブ自体のラベルは(表示領域に収まるよう)短くしている。
  const KIND_LABEL = {
    mute: 'ミュート',
    unmute: 'ミュート解除',
    forceMute: '強制ミュート',
  };
  const TYPE_LABEL = {
    title: 'タイトル',
    domain: 'ドメイン',
    user: 'はてなユーザー',
    comment: 'ブックマークコメント',
    url: 'URL',
    urlprefix: 'URL前方一致',
  };

  // hatenaDateはUTC(...Z)で保存されているため、単純にslice(0,10)すると日本時間の
  // 日付とズレることがある(例: 深夜のUTC時刻は翌日扱いになるべきなのに前日と表示される)。
  // +9時間してからUTC表記の各要素を取り出すことでJST基準の日時にする。
  function hatenaDateTime(iso, withSeconds) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
    const y = jst.getUTCFullYear();
    const mo = jst.getUTCMonth() + 1;
    const da = jst.getUTCDate();
    const h = jst.getUTCHours();
    const mi = String(jst.getUTCMinutes()).padStart(2, '0');
    if (!withSeconds) return `${y}/${mo}/${da} ${h}:${mi}`;
    const s = String(jst.getUTCSeconds()).padStart(2, '0');
    return `${y}/${mo}/${da} ${h}:${mi}:${s}`;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---- CSV(エクスポート/インポート用、type,value の2列) ----
  function csvField(value) {
    const s = String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function rulesToCsv(rules) {
    const lines = ['type,value'];
    for (const r of rules) lines.push(`${csvField(r.type)},${csvField(r.value)}`);
    return lines.join('\r\n');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
        continue;
      }
      if (c === '"') inQuotes = true;
      else if (c === ',') {
        row.push(field);
        field = '';
      } else if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (c === '\r') {
        // 改行の一部として無視(\r\n)
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
  }

  // CSVテキストを検証しつつ { type, value } の配列に変換する。
  // 不正な行が1つでもあればエラー一覧を返し、rulesは空にする(全体を中断)。
  // 未対応の種別(feed-tycoonのsource/tag/description等)はエラーにせず、ignoredに件数を数え、
  // 行自体はignoredRulesに残す。
  function parseImportCsv(text) {
    const rows = parseCsv(text);
    if (rows.length === 0) return { rules: [], errors: ['データが空です'], ignored: 0, ignoredRules: [] };

    let dataRows = rows;
    if ((dataRows[0][0] || '').trim().toLowerCase() === 'type') {
      dataRows = dataRows.slice(1);
    }
    if (dataRows.length === 0) return { rules: [], errors: ['データが空です'], ignored: 0, ignoredRules: [] };

    const errors = [];
    const rules = [];
    let ignored = 0;
    const ignoredRules = []; // 未対応種別の行(Gist同期の上書き時に消さず残すため保持する)
    dataRows.forEach((cols, idx) => {
      const lineNo = idx + 1;
      if (cols.length < 2) {
        errors.push(`${lineNo}行目: 列数が不正です(type,valueの2列が必要)`);
        return;
      }
      const type = (cols[0] || '').trim();
      const value = (cols[1] || '').trim();
      if (!type) {
        errors.push(`${lineNo}行目: 種別が空です`);
        return;
      }
      // feed-tycoon と CSV を共有するため、未対応の種別は無視する
      if (!Filters.TYPES.includes(type)) {
        ignored++;
        ignoredRules.push({ type, value });
        return;
      }
      if (!value) {
        errors.push(`${lineNo}行目: 値が空です`);
        return;
      }
      rules.push({ type, value });
    });
    return { rules: errors.length > 0 ? [] : rules, errors, ignored, ignoredRules };
  }

  // ---- ルーティング ----
  function parseRoute() {
    const hash = location.hash.replace(/^#/, '') || '/';
    const [path, queryStr] = hash.split('?');
    return { path, params: new URLSearchParams(queryStr || '') };
  }

  function navigate(path, params) {
    const qs = params ? `?${params.toString()}` : '';
    location.hash = `${path}${qs}`;
  }

  window.addEventListener('hashchange', render);

  // ヘッダーの「hateb-tycoon」リンクは「一覧に戻る」(現在のカテゴリー・
  // スクロール位置を維持したまま戻る)とは役割を分け、常にトップから
  // 開き直す用途にする。単純なlocation.reload()だとService Workerの
  // networkFirstが機能していてもホーム画面追加時のPWAでは反映が遅れる/
  // 反映されないことがあるため、Service Workerを一旦unregisterしCache
  // Storageも消してから再読み込みし、この1回の読み込みをSWが一切介在
  // しない素のネットワーク取得にする(SWは読み込み後にapp.js側で自動的に
  // 再登録される)。ただし機内モード等オフライン時にこれをやると、
  // SW/キャッシュというオフライン用の逃げ場を再読み込み前に消してしまい、
  // アプリ自体が真っ白になって復旧できなくなる。そのため実際にネットワーク
  // から新しいデータが取れるか確認できた場合のみSW/キャッシュを破棄し、
  // 取れない場合は何も壊さず普通に再読み込みするだけにして、既存の
  // Service Workerのオフラインフォールバックに任せる。
  appTitleLink.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    forceReloadFromTop();
  });

  async function canReachNetwork() {
    if (!navigator.onLine) return false;
    try {
      const res = await fetch('data/meta.json', { cache: 'no-store' });
      return !!(res && res.ok);
    } catch (err) {
      return false;
    }
  }

  async function forceReloadFromTop() {
    if (await canReachNetwork()) {
      try {
        if ('serviceWorker' in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        }
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
      } catch (err) {
        // 消せなくても再読み込み自体は続行する(消えていなければ従来のnetworkFirstが効く)
      }
    }
    if (location.hash !== '#/') {
      location.hash = '/';
    }
    location.reload();
  }

  // ページ遷移のたびに検索欄をリセットする(前の画面の絞り込みを引き継がない)。
  function resetHeaderSearch(isEntry) {
    searchQuery = '';
    headerSearch.value = '';
    headerSearch.placeholder = isEntry ? ENTRY_SEARCH_PLACEHOLDER : LIST_SEARCH_PLACEHOLDER;
  }

  headerSearch.addEventListener('input', () => {
    searchQuery = headerSearch.value.trim().toLowerCase();
    if (!listView.hidden) {
      updateListView();
    } else if (!entryView.hidden) {
      applyEntrySearchAndRender();
    }
  });

  // 一覧・個別記事どちらの画面でも、検索欄にURLを入力してEnterすると、そのURLのブックマークページへ遷移する。
  // 一覧に載っていないURLでも個別記事ビューはjsonlite経由で取得できるため、そのまま渡す。
  // IME変換確定のEnterでは遷移しない。
  headerSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const value = headerSearch.value.trim();
    if (!/^https?:\/\/\S+$/i.test(value)) return;
    e.preventDefault();
    const params = new URLSearchParams();
    params.set('url', value);
    navigate('/entry', params);
  });

  function render() {
    const { path, params } = parseRoute();
    resetHeaderSearch(path === '/entry');
    if (path === '/entry') {
      listView.hidden = true;
      entryView.hidden = false;
      const url = params.get('url');
      renderEntryView(url);
    } else {
      const newCategory = params.get('cat') || 'everything';
      // 同じカテゴリーのまま戻ってきた(=コメントページから「一覧に戻る」)場合のみ、
      // 離れる直前のスクロール位置を復元する。カテゴリーを切り替えた場合は復元しない。
      const restoreScrollY = newCategory === currentCategory && pendingScrollY !== null ? pendingScrollY : null;
      entryView.hidden = true;
      listView.hidden = false;
      resetEntryNavSnapshot();
      currentCategory = newCategory;
      renderCategoryTabs();
      renderListView(restoreScrollY);
    }
  }

  // ---- 一覧ビュー ----
  function renderCategoryTabs() {
    categoryTabs.innerHTML = HatenaAPI.CATEGORIES.map((c) => {
      const active = c.key === currentCategory ? ' active' : '';
      return `<button class="tab${active}" data-cat="${c.key}" data-full-label="${escapeHtml(c.label)}">${escapeHtml(c.label)}</button>`;
    }).join('');
    fitCategoryTabs();
  }

  // タブは常に1行に収め、CSSのtext-overflow任せの均等縮小(短いラベルまで
  // 潰れる一方で長いラベルの方が余分に残る)ではなく、各タブの表示文字数を
  // 実測しながら「最低2文字は残し、はみ出す分だけ一番長いタブから1文字ずつ
  // 削る」方式で必要最小限に省略する。
  function fitCategoryTabs() {
    const buttons = Array.from(categoryTabs.querySelectorAll('.tab'));
    if (buttons.length === 0) return;

    buttons.forEach((btn) => {
      btn.textContent = btn.dataset.fullLabel;
    });

    const available = categoryTabs.clientWidth;
    if (!available) return;

    const GAP = 6;
    const MIN_CHARS = 2;

    const totalWidth = () =>
      buttons.reduce((sum, btn) => sum + btn.getBoundingClientRect().width, 0) + GAP * (buttons.length - 1);

    let guard = 300;
    while (totalWidth() > available && guard-- > 0) {
      let target = null;
      let maxLen = MIN_CHARS;
      for (const btn of buttons) {
        const text = btn.textContent;
        const len = text.endsWith('…') ? text.length - 1 : text.length;
        if (len > maxLen) {
          maxLen = len;
          target = btn;
        }
      }
      if (!target) break;
      const text = target.textContent;
      const base = text.endsWith('…') ? text.slice(0, -1) : text;
      target.textContent = `${base.slice(0, -1)}…`;
    }
  }

  let tabsResizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(tabsResizeTimer);
    tabsResizeTimer = setTimeout(fitCategoryTabs, 150);
  });

  categoryTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    const params = new URLSearchParams();
    params.set('cat', btn.dataset.cat);
    navigate('/', params);
  });

  // 一覧ページの横スワイプでカテゴリータブを前後に移動する。touchイベントは
  // タッチ対応デバイスでのみ発火するため、マウス操作のデスクトップ表示には
  // 影響しない。縦スクロールを妨げないようpreventDefaultはせず、指を離した
  // 時点で「横方向優先」かつ「一定距離以上」動いていた場合のみジャッジする
  // (タップやスクロールを誤ってスワイプ扱いしないため)。
  (function setupCategorySwipe() {
    const SWIPE_MIN_X = 60;
    const SWIPE_MAX_OFF_AXIS_Y = 60;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    listView.addEventListener(
      'touchstart',
      (e) => {
        tracking = e.touches.length === 1;
        if (!tracking) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      },
      { passive: true }
    );

    listView.addEventListener(
      'touchend',
      (e) => {
        if (!tracking) return;
        tracking = false;
        const touch = e.changedTouches[0];
        if (!touch) return;
        const deltaX = touch.clientX - startX;
        const deltaY = touch.clientY - startY;
        if (Math.abs(deltaX) < SWIPE_MIN_X || Math.abs(deltaY) > SWIPE_MAX_OFF_AXIS_Y) return;
        if (Math.abs(deltaX) <= Math.abs(deltaY)) return;

        const categories = HatenaAPI.CATEGORIES;
        const index = categories.findIndex((c) => c.key === currentCategory);
        if (index === -1) return;
        // 左スワイプ(指を左へ)で次のカテゴリー、右スワイプで前のカテゴリー。
        // 端のカテゴリーではそれ以上折り返さない。
        const nextIndex = deltaX < 0 ? index + 1 : index - 1;
        if (nextIndex < 0 || nextIndex >= categories.length) return;
        const params = new URLSearchParams();
        params.set('cat', categories[nextIndex].key);
        navigate('/', params);
      },
      { passive: true }
    );
  })();

  function disconnectScrollObserver() {
    if (scrollObserver) {
      scrollObserver.disconnect();
      scrollObserver = null;
    }
  }

  function renderNextPage() {
    const nextItems = currentVisibleEntries.slice(renderedCount, renderedCount + PAGE_SIZE);
    if (nextItems.length === 0) return;
    const sentinel = document.getElementById('scroll-sentinel');
    const html = nextItems.map((item) => renderEntryCard(item)).join('');
    if (sentinel) {
      sentinel.insertAdjacentHTML('beforebegin', html);
    } else {
      listRoot.insertAdjacentHTML('beforeend', html);
    }
    renderedCount += nextItems.length;

    if (renderedCount >= currentVisibleEntries.length) {
      disconnectScrollObserver();
      if (sentinel) sentinel.remove();
    }
  }

  // スクロール位置復元用: ページ単位ではなく残り全件を一度に描画する。
  // (無限スクロール任せだと、復元先の高さまでDOMが育っておらずscrollToが効かないため)
  function renderAllRemaining() {
    const remaining = currentVisibleEntries.slice(renderedCount);
    if (remaining.length === 0) return;
    const html = remaining.map((item) => renderEntryCard(item)).join('');
    listRoot.insertAdjacentHTML('beforeend', html);
    renderedCount = currentVisibleEntries.length;
  }

  // plain表示は<ul>の子として<li>を並べる必要があるため、entryGrid直下に
  // <ul>を1つ挟み、以降の描画はそちら(listRoot)を対象にする。rich表示では
  // 従来通りentryGrid自身に<article>を並べる。
  function setupEntryGridLayout() {
    entryGrid.classList.toggle('entry-grid--plain', listLayout === 'plain');
    if (listLayout === 'plain') {
      entryGrid.innerHTML = '<ul class="entry-list-plain"></ul>';
      listRoot = entryGrid.querySelector('.entry-list-plain');
    } else {
      entryGrid.innerHTML = '';
      listRoot = entryGrid;
    }
  }

  function setupScrollObserver() {
    disconnectScrollObserver();
    if (renderedCount >= currentVisibleEntries.length) return;
    // plain表示ではlistRootが<ul>のため、監視対象も<li>でなければならない。
    const sentinel = document.createElement(listLayout === 'plain' ? 'li' : 'div');
    sentinel.id = 'scroll-sentinel';
    listRoot.appendChild(sentinel);
    scrollObserver = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries.some((e) => e.isIntersecting)) {
          renderNextPage();
          // IntersectionObserverは「交差状態が変わった時」しか発火しない。追加した
          // 分だけではsentinelがrootMargin内に残る(画面が縦に長い・行が低い等)と
          // 二度と発火せず継ぎ足しが止まるため、監視し直して現在の状態で再判定させる。
          const sentinel = document.getElementById('scroll-sentinel');
          if (sentinel && scrollObserver) {
            scrollObserver.unobserve(sentinel);
            scrollObserver.observe(sentinel);
          }
        }
      },
      { rootMargin: '600px' }
    );
    scrollObserver.observe(sentinel);
  }

  async function renderListView(restoreScrollY) {
    disconnectScrollObserver();
    entryGrid.innerHTML = '';
    baseEntries = [];
    hiddenByFilterCount = 0;
    hasLoadedList = false;
    currentVisibleEntries = [];
    renderedCount = 0;
    listStatus.textContent = '読み込み中…';
    listLoading = true;
    try {
      const entries = await HatenaAPI.getHotEntries(currentCategory);
      applyLoadedEntries(entries);
      updateListView(restoreScrollY);
    } catch (err) {
      console.error(err);
      listStatus.textContent = `取得に失敗しました: ${err.message}(アプリに戻る/オンラインになると再取得します)`;
    } finally {
      listLoading = false;
    }
  }

  // 初回読み込みに失敗したままだと、自動リフレッシュ(hasLoadedList前提)も働かず、
  // タスクキルするまで一覧が見られなくなる。前面復帰・オンライン復帰の時に再取得する。
  function retryListIfNotLoaded() {
    if (listView.hidden || hasLoadedList || listLoading) return;
    renderListView();
  }
  window.addEventListener('online', retryListIfNotLoaded);

  function applyLoadedEntries(entries) {
    const visible = entries.filter((item) => !Filters.isHidden(item));
    hiddenByFilterCount = entries.length - visible.length;
    baseEntries = visible;
    hasLoadedList = true;
    listLoadedAt = Date.now();
    listSignature = JSON.stringify(entries);
  }

  // ---- 一覧の自動リフレッシュ ----
  // 一覧データは静的JSONでpushできないため、ページが前面に戻った時に一定時間経過していれば
  // 読み直す(feed-tycoonと同じ方式)。一覧を一度空にする通常の読み込みと違い、取得に成功して
  // 内容が変わっていた場合のみ差し替える(オフライン復帰で一覧が消えないように)。
  const REFRESH_AFTER_MS = 5 * 60 * 1000;
  let listLoadedAt = 0;
  let listSignature = '';
  let refreshing = false;

  async function refreshListIfStale() {
    if (refreshing || listView.hidden || !hasLoadedList) return;
    if (Date.now() - listLoadedAt <= REFRESH_AFTER_MS) return;
    refreshing = true;
    const category = currentCategory;
    try {
      const entries = await HatenaAPI.getHotEntries(category);
      // 取得中にカテゴリー切替や詳細ページへの遷移があった場合は捨てる(遷移側が読み込む)
      if (category !== currentCategory || listView.hidden) return;
      if (JSON.stringify(entries) === listSignature) {
        listLoadedAt = Date.now();
        return;
      }
      const scrollY = window.scrollY;
      applyLoadedEntries(entries);
      updateListView(scrollY > 0 ? scrollY : null);
    } catch (err) {
      console.warn('[auto-refresh] failed', err);
    } finally {
      refreshing = false;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      retryListIfNotLoaded();
      refreshListIfStale();
    }
  });

  // 並び順・既読フィルタの切り替え時、再取得はせずbaseEntriesから再構築する。
  // restoreScrollYを渡した場合は全件を一度に描画してから指定位置へスクロールする。
  function updateListView(restoreScrollY) {
    if (!hasLoadedList) return;
    disconnectScrollObserver();
    setupEntryGridLayout();
    renderedCount = 0;

    let working = baseEntries;
    let hiddenByVisitedCount = 0;
    if (hideVisited) {
      const filtered = working.filter((item) => Visited.getReadState(item) !== 'read');
      hiddenByVisitedCount = working.length - filtered.length;
      working = filtered;
    }

    if (searchQuery) {
      working = working.filter(
        (item) =>
          (item.title && item.title.toLowerCase().includes(searchQuery)) ||
          (item.domain && item.domain.toLowerCase().includes(searchQuery))
      );
    }

    currentVisibleEntries = applySort(working, currentSortMode);

    if (baseEntries.length === 0 && hiddenByFilterCount === 0) {
      listStatus.textContent = '記事を取得できませんでした。';
      return;
    }

    const hiddenParts = [];
    if (hiddenByFilterCount > 0) hiddenParts.push(`フィルタ${hiddenByFilterCount}件`);
    if (hiddenByVisitedCount > 0) hiddenParts.push(`既読${hiddenByVisitedCount}件`);

    if (currentVisibleEntries.length === 0) {
      listStatus.textContent = `表示できる記事がありません(${hiddenParts.join('・')}を非表示にしました)`;
      return;
    }

    listStatus.textContent =
      hiddenParts.length > 0
        ? `${currentVisibleEntries.length} 件を表示中(${hiddenParts.join('・')}を非表示)`
        : `${currentVisibleEntries.length} 件を表示中`;

    if (restoreScrollY != null) {
      renderAllRemaining();
      window.scrollTo(0, restoreScrollY);
    } else {
      renderNextPage();
      setupScrollObserver();
    }
  }

  sortSelect.addEventListener('change', () => {
    currentSortMode = sortSelect.value;
    updateListView();
  });

  hideVisitedCheckbox.addEventListener('change', () => {
    hideVisited = hideVisitedCheckbox.checked;
    updateListView();
  });

  // はてなブックマークのホットエントリー一覧同様、ブックマーク数が多いほど
  // 文字を強調する(完全再現ではなく近似の段階分け)。
  function countTierClass(count) {
    if (count >= 200) return ' card-count-link--tier4';
    if (count >= 100) return ' card-count-link--tier3';
    if (count >= 50) return ' card-count-link--tier2';
    if (count >= 20) return ' card-count-link--tier1';
    return '';
  }

  function renderEntryCard(item) {
    return listLayout === 'plain' ? renderEntryCardPlain(item) : renderEntryCardRich(item);
  }

  function renderEntryCardRich(item) {
    const params = new URLSearchParams();
    params.set('url', item.url);
    const href = `#/entry?${params.toString()}`;
    const thumb = item.screenshot
      ? `<img class="card-thumb" src="${escapeHtml(item.screenshot)}" alt="" loading="lazy">`
      : `<div class="card-thumb card-thumb--empty"></div>`;
    const firstSeen = item.hatenaDate
      ? `<span class="card-first-seen">更新 ${escapeHtml(hatenaDateTime(item.hatenaDate))}</span>`
      : '';
    const readState = Visited.getReadState(item);
    const visitedClass = readState === 'read' ? ' card--visited' : '';
    // 既読グレーアウト(grayscale+brightness)はカード全体にかかるため、色や太さだけの
    // 違いは既読カード上でほぼ判別できなくなる。そのため「N users →」全体に取り消し線を
    // 引いて、グレースケール化されても形状で読み取れる違いにする。
    const noComment = Visited.hasNoComments(item.url);
    const noCommentClass = noComment ? ' card-count-link--no-comment' : '';
    const countTitle = noComment ? ' title="前回訪問時、コメント付きブックマークがありませんでした"' : '';
    // 既読済みだがブックマーク数が閾値以上増えた記事は、グレーアウトは外して
    // 未読と同様に目立たせつつ、「更新」バッジで既読済みだったことを示す(日時の左)。
    // (plain表示は行の左端の線で示す。renderEntryCardPlain参照)
    const updatedBadge =
      readState === 'updated'
        ? '<span class="card-badge-updated" title="既読ですが、ブックマーク数が増えました">更新</span>'
        : '';
    return `
      <article class="card${visitedClass}">
        <button type="button" class="card-close-btn" data-url="${escapeHtml(item.url)}" title="このページを非表示にする" aria-label="このページを非表示にする">×</button>
        ${thumb}
        <div class="card-body">
          <div class="card-top-row">
            <span class="card-top-left">${updatedBadge}${firstSeen}</span>
            <span class="card-top-right">
              <a class="card-count-link${countTierClass(item.count)}${noCommentClass}" href="${href}"${countTitle}>${item.count} users →</a>
            </span>
          </div>
          <button type="button" class="card-domain" data-domain="${escapeHtml(item.domain)}">${escapeHtml(item.domain)}</button>
          <a class="card-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
        </div>
      </article>`;
  }

  // plain表示: 1記事1行(<li>)で「× 時刻 ドメイン タイトル N users →」の順に並べる。
  // ×・ドメインボタンはrich版のcard-close-btn/card-domainと同じクラスを付けて
  // 既存のentryGridクリック委譲(ミュート登録・フィルタ設定オープン)をそのまま使う。
  function renderEntryCardPlain(item) {
    const params = new URLSearchParams();
    params.set('url', item.url);
    const href = `#/entry?${params.toString()}`;
    const time = item.hatenaDate ? escapeHtml(hatenaDateTime(item.hatenaDate, true)) : '';
    const readState = Visited.getReadState(item);
    const visitedClass = readState === 'read' ? ' card--visited' : '';
    const noComment = Visited.hasNoComments(item.url);
    const noCommentClass = noComment ? ' card-count-link--no-comment' : '';
    const countTitle = noComment ? ' title="前回訪問時、コメント付きブックマークがありませんでした"' : '';
    // 「更新」は行の流れから外し(横幅も改行も増やさずタイトルの開始位置を揃えたまま)、
    // 行の左端のアクセント線(.entry-row--updated)だけで示す。
    const isUpdated = readState === 'updated';
    const updatedClass = isUpdated ? ' entry-row--updated' : '';
    // entry-row-main はタイトル・カウントをまとめて1つの視覚的な塊にするための
    // ラッパー。entry-row-count側の疑似要素をこの塊全体に重ねて、タイトルをクリック/
    // タップしてもブックマークページへ飛ぶ大きな領域にする(css/style.css参照。
    // デスクトップ・スマホ共通)。
    return `
      <li class="entry-row${visitedClass}${updatedClass}"${isUpdated ? ' title="既読ですが、ブックマーク数が増えました"' : ''}>
        <button type="button" class="card-close-btn entry-row-close" data-url="${escapeHtml(item.url)}" title="このページを非表示にする" aria-label="このページを非表示にする">×</button>
        <span class="entry-row-time">${time}</span>
        <button type="button" class="card-domain entry-row-domain" data-domain="${escapeHtml(item.domain)}">${escapeHtml(item.domain)}</button>
        <span class="entry-row-main">
          <a class="entry-row-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
          <a class="card-count-link entry-row-count${countTierClass(item.count)}${noCommentClass}" href="${href}"${countTitle}>${item.count} users →</a>
        </span>
      </li>`;
  }

  // ---- 個別エントリー(コメント一覧)ビュー ----
  // 矢印キーでの前後移動は都度履歴を積むため、history.back()だと矢印移動した回数分
  // 戻ってしまい一覧まで戻れない。常に現在のカテゴリー一覧へ直接遷移させる。
  function goToList() {
    const params = new URLSearchParams();
    params.set('cat', currentCategory);
    navigate('/', params);
  }
  entryBack.addEventListener('click', goToList);
  entryBackBottom.addEventListener('click', goToList);

  // コメント一覧の表示方法(plain/rich)。切替時は再取得せず保持済みのcurrentCommentsを
  // 描画し直すだけにする。
  const COMMENT_LAYOUT_KEY = 'hateb-tycoon:commentLayout';
  let commentLayout = loadCommentLayout();
  let currentComments = [];
  // ミュート等のフィルタ適用後・検索絞り込み適用前のコメント一覧と、
  // ステータス表示の再構築に必要な情報を保持する(検索欄の入力のたびに
  // 再取得せずここから再構築するため)。
  let entryVisibleComments = [];
  let entryHiddenByFilterCount = 0;
  let entryOfflineNote = '';
  // はてな側で「コメント一覧は非表示に設定」されている記事(count>0なのにbookmarksが空)
  let entryCommentsHiddenByOwner = false;
  // 前回このコメントページを開いた時刻(ms)。null(初訪問)なら新着判定はしない。
  let entryPrevVisitTime = null;

  // jsonliteのtimestamp("yyyy/MM/dd HH:mm"、JST)をmsに変換する。解釈できなければ null。
  function parseBookmarkTimestamp(ts) {
    const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(ts || '');
    if (!m) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const t = Date.parse(`${m[1]}-${pad(m[2])}-${pad(m[3])}T${pad(m[4])}:${m[5]}:${m[6] || '00'}+09:00`);
    return Number.isNaN(t) ? null : t;
  }

  // 前回訪問より後に付いたコメントか。timestampは分単位で秒が落ちているため、
  // 同じ分に付いたものを取りこぼさないよう1分の猶予を持たせて新着側に倒す。
  function isNewComment(b) {
    if (entryPrevVisitTime == null) return false;
    const t = parseBookmarkTimestamp(b.timestamp);
    return t != null && t + 60000 > entryPrevVisitTime;
  }

  // 前回訪問時点で既に付いていたコメント(=既読)。一覧のグレーアウトと同じ扱いにする。
  // 初訪問(比較対象なし)や時刻が解釈できないものはグレーアウトしない。
  function isReadComment(b) {
    return entryPrevVisitTime != null && parseBookmarkTimestamp(b.timestamp) != null && !isNewComment(b);
  }

  // 行に付けるクラス(新着はバッジのみで装飾なし、既読はグレーアウト)。
  function commentStateClass(b) {
    return isReadComment(b) ? ' comment--read' : '';
  }

  function loadCommentLayout() {
    try {
      return localStorage.getItem(COMMENT_LAYOUT_KEY) === 'rich' ? 'rich' : 'plain';
    } catch (e) {
      return 'plain';
    }
  }

  function saveCommentLayout(mode) {
    try {
      localStorage.setItem(COMMENT_LAYOUT_KEY, mode);
    } catch (e) {
      // localStorageが使えない環境では記憶をあきらめる
    }
  }

  function updateCommentLayoutToggleUI() {
    commentLayoutToggle.querySelectorAll('button[data-layout]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.layout === commentLayout);
    });
  }

  function renderCommentList() {
    commentList.className = commentLayout === 'rich' ? 'comment-list comment-list--rich' : 'comment-list';
    const emptyMessage = entryCommentsHiddenByOwner
      ? 'コメント一覧は非表示に設定されています。'
      : 'コメントはありません。';
    commentList.innerHTML = currentComments.map(renderComment).join('') || `<p class="empty">${emptyMessage}</p>`;
  }

  // 検索欄の入力のたびに再取得はせず、フィルタ適用後の一覧(entryVisibleComments)から
  // ユーザーid・コメント本文で絞り込んで再描画する。
  function applyEntrySearchAndRender() {
    currentComments = searchQuery
      ? entryVisibleComments.filter(
          (b) =>
            (b.user && b.user.toLowerCase().includes(searchQuery)) ||
            (b.comment && b.comment.toLowerCase().includes(searchQuery))
        )
      : entryVisibleComments;

    if (entryCommentsHiddenByOwner) {
      entryStatus.textContent = entryOfflineNote + 'コメント一覧は非表示に設定されています(はてなブックマーク側の設定)。';
      renderCommentList();
      return;
    }

    const hiddenParts = [];
    if (entryHiddenByFilterCount > 0) hiddenParts.push(`フィルタ${entryHiddenByFilterCount}件`);

    const newCount = currentComments.filter(isNewComment).length;
    const newNote = newCount > 0 ? `・前回訪問後の新着${newCount}件` : '';
    entryStatus.textContent =
      entryOfflineNote +
      (hiddenParts.length > 0
        ? `${currentComments.length} 件のコメントを表示中(${hiddenParts.join('・')}を非表示${newNote})`
        : `${currentComments.length} 件のコメントを表示中${newNote ? `(${newNote.slice(1)})` : ''}`);

    renderCommentList();
  }

  commentLayoutToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-layout]');
    if (!btn || btn.dataset.layout === commentLayout) return;
    commentLayout = btn.dataset.layout;
    saveCommentLayout(commentLayout);
    updateCommentLayoutToggleUI();
    renderCommentList();
  });

  const ENTRY_FILTER_BTN_DEFAULT_LABEL = 'このページをフィルタに登録する';

  function resetEntryFilterBtn() {
    entryFilterBtn.textContent = ENTRY_FILTER_BTN_DEFAULT_LABEL;
    entryFilterBtn.disabled = false;
  }

  entryFilterBtn.addEventListener('click', () => {
    const { params } = parseRoute();
    const url = params.get('url');
    if (!url) return;
    Filters.addRule('mute', 'url', url);
    entryFilterBtn.textContent = 'フィルタに登録しました';
    entryFilterBtn.disabled = true;
  });

  // 前後の記事へ移動した際、直前のスクロール位置(コメント欄の途中/末尾)が
  // そのまま残ってしまうことがあるため、新しい記事を開く際は必ず先頭へ戻す。
  // ページ下部にある「前の記事へ」「次の記事へ」ボタンをタップした直後は、
  // (特にモバイルでフリックスクロール中にタップした場合)慣性スクロールが
  // まだ収束しておらず、1回のscrollTo(0, 0)だけでは慣性側の描画に上書きされて
  // 先頭に戻らないことがある。数フレームにわたって再度先頭へ戻すことで対抗する。
  function forceScrollTop() {
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      window.scrollTo(0, 0);
      requestAnimationFrame(() => window.scrollTo(0, 0));
    });
  }

  // 体感速度の計測。区間はDevToolsのPerformance「Timings」に出る。
  // URLに perf=1 を付けるとコンソールにも一覧表示する(本番の通常利用では出力なし)。
  // ルーティングがハッシュ方式のため、?perf=1(検索部)でも #/...&perf=1(ハッシュ内)でも有効にする。
  const PERF_LOG =
    new URLSearchParams(location.search).has('perf') || parseRoute().params.has('perf');
  function afterPaint(cb) {
    requestAnimationFrame(() => requestAnimationFrame(cb));
  }
  function createEntryPerf(url) {
    const t0 = performance.now();
    const marks = {};
    return function mark(name) {
      const t = performance.now() - t0;
      marks[name] = Math.round(t);
      try {
        performance.measure(`entry:${name}`, { start: t0, end: t0 + t });
      } catch (e) { /* 計測失敗は無視 */ }
      if (PERF_LOG && (name === 'comments-painted' || name === 'error')) {
        console.table({ url, ...marks });
      }
    };
  }

  // 取得前は一覧データ(listedItem)から、取得後はAPIの結果(info)からヘッダーを描く。
  // 両者でtitle/url/domain/count/entryUrlを同じ形で扱えるため同じ関数で描画する。
  function renderEntryHeader(info) {
    entryHeader.innerHTML = `
        <a class="entry-title" href="${escapeHtml(info.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.title)}</a>
        <div class="entry-meta">
          <span>${escapeHtml(info.domain)}</span>
          <span>${info.count} users</span>
          ${info.entryUrl ? `<button type="button" class="entry-hatena-link">はてなブックマークページ →</button>` : ''}
        </div>`;
    // href付きの<a>だとiOS Safariのコンテンツブロッカーに隠されるため、ボタン+window.openにしている
    const hatenaBtn = entryHeader.querySelector('.entry-hatena-link');
    if (hatenaBtn) {
      hatenaBtn.addEventListener('click', () => window.open(info.entryUrl, '_blank', 'noopener,noreferrer'));
    }
  }

  // 描画完了後のアイドル時に、前後1件の記事を先読みする(次を優先し、完了後に前)。
  // 先読みは取得とlocalStorage保存だけを行い、既読化はしない(表示した時に初めて既読になる)。
  // 待っている間に別の記事へ移っていた場合や、オフラインの場合は何もしない。
  function schedulePrefetchNeighbors(url) {
    const run = async () => {
      if (!navigator.onLine) return;
      const current = parseRoute();
      if (current.path !== '/entry' || current.params.get('url') !== url) return;
      for (const delta of [1, -1]) {
        const idx = findRelativeEntryIndex(url, delta);
        if (idx === -1) continue;
        await HatenaAPI.prefetchEntryInfo(currentVisibleEntries[idx].url);
        if (parseRoute().params.get('url') !== url) return;
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 2000 });
    else setTimeout(run, 300);
  }

  async function renderEntryView(url) {
    const perfMark = createEntryPerf(url);
    ensureEntryNavSnapshot();
    if (url) entryNavOpened.add(url);
    forceScrollTop();
    commentList.innerHTML = '';
    currentComments = [];
    entryVisibleComments = [];
    entryHiddenByFilterCount = 0;
    entryOfflineNote = '';
    entryCommentsHiddenByOwner = false;
    entryPrevVisitTime = null;
    entryHeader.innerHTML = '';
    entryDescription.textContent = '';
    updateCommentLayoutToggleUI();
    resetEntryFilterBtn();
    updateEntryNavButtons(url);
    if (!url) {
      entryStatus.textContent = 'URLが指定されていません。';
      return;
    }
    // 一覧取得済みのデータに概要(RSSのdescription)があれば流用する。
    // 直接このURLへ遷移した場合など、一覧データが無ければ何も表示しない。
    const listedItem = currentVisibleEntries.find((item) => item.url === url);
    if (listedItem && listedItem.description) {
      entryDescription.textContent = listedItem.description;
    }
    // 取得完了を待たず、一覧データでヘッダーを先に描画する(取得後に同じ形で上書き)。
    if (listedItem) {
      renderEntryHeader({
        title: listedItem.title,
        url: listedItem.url,
        domain: listedItem.domain || '',
        count: listedItem.count != null ? listedItem.count : 0,
        entryUrl: listedItem.entryUrl || null,
      });
      afterPaint(() => perfMark('header-painted-provisional'));
    }
    entryStatus.textContent = '読み込み中…';
    try {
      perfMark('fetch-start');
      const info = await HatenaAPI.getEntryInfo(url);
      perfMark('fetch-end');

      if (Filters.isHidden({ title: info.title, domain: info.domain, url: info.url })) {
        entryDescription.textContent = '';
        entryStatus.textContent = 'このエントリーはフィルタ条件により非表示になっています。';
        return;
      }

      // まだ誰もブックマークしていないURL(jsonliteがnullを返した)。コメント内のリンクや
      // URL直接入力では普通に起こり得る。元記事へのリンクだけ出し、既読記録もしない。
      if (info.notBookmarked) {
        entryDescription.textContent = '';
        renderEntryHeader(info);
        entryStatus.textContent =
          'このURLはまだ誰もブックマークしていません(はてな側で別のURLに正規化されている場合は、そちらでブックマークされている可能性があります)。';
        return;
      }

      // jsonliteはコメント一覧非表示設定の記事だと、ブックマーク数があるのにbookmarksを
      // 空で返す(コメントが無いだけの記事ではbookmarksは空にならない)。この場合はコメントを
      // 見られないため、その時点でURLをミュートに登録して一覧から外す。
      entryCommentsHiddenByOwner = info.count > 0 && info.bookmarks.length === 0;
      if (entryCommentsHiddenByOwner) {
        const scope = Filters.scopeRuleForUrl(url);
        Filters.addRule('mute', scope.type, scope.value);
        entryFilterBtn.textContent = 'フィルタに登録しました';
        entryFilterBtn.disabled = true;
      }

      const commented = info.bookmarks.filter((b) => b.comment);
      // markVisitedが訪問時刻を上書きする前に、前回の訪問時刻を控えておく。
      entryPrevVisitTime = Visited.getLastVisitTime(url);
      Visited.markVisited(url, info.count, commented.length > 0);

      renderEntryHeader(info);
      afterPaint(() => perfMark('header-painted'));

      const visible = commented.filter(
        (b) => !Filters.isHidden({ title: info.title, domain: info.domain, user: b.user, comment: b.comment })
      );

      entryVisibleComments = visible;
      entryHiddenByFilterCount = commented.length - visible.length;
      entryOfflineNote = info.fromOfflineCache ? '(オフラインのため前回取得時点の内容を表示中) ' : '';
      applyEntrySearchAndRender();
      afterPaint(() => perfMark('comments-painted'));
      if (info.fromPrefetch) perfMark('prefetch-hit');
      schedulePrefetchNeighbors(url);
      // オフライン時などデータ取得に時間がかかった場合、その間に上記の慣性
      // スクロール対策が先に終わってしまっていることがあるため、コメント
      // 描画後にもう一度先頭へ戻しておく。
      forceScrollTop();
    } catch (err) {
      console.error(err);
      perfMark('error');
      entryStatus.textContent = `取得に失敗しました: ${err.message}`;
    }
  }

  const NEW_COMMENT_BADGE = '<span class="comment-badge-new" title="前回このページを開いた後に付いたコメントです">NEW</span> ';

  // コメント本文中のURLをhateb-tycoonの個別記事ページ(#/entry?url=...)へのリンクにする。
  // URL以外の部分はエスケープして出力する。URLの末尾に続きがちな句読点・閉じ括弧は
  // リンクに含めない(「(https://example.com)」のような書き方で括弧を巻き込まないため)。
  const COMMENT_URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/g;

  function splitTrailingPunct(url) {
    let end = url.length;
    while (end > 0) {
      const ch = url[end - 1];
      if ('.,;:!?\'*'.includes(ch)) end--;
      else if (ch === ')' && (url.slice(0, end).match(/\(/g) || []).length < (url.slice(0, end).match(/\)/g) || []).length) end--;
      else break;
    }
    return [url.slice(0, end), url.slice(end)];
  }

  function linkifyComment(text) {
    const src = String(text);
    let out = '';
    let last = 0;
    for (const m of src.matchAll(COMMENT_URL_RE)) {
      const [url, tail] = splitTrailingPunct(m[0]);
      out += escapeHtml(src.slice(last, m.index));
      if (url.length > 'https://'.length) {
        const params = new URLSearchParams();
        params.set('url', url);
        out += `<a class="comment-link" href="#/entry?${params.toString()}">${escapeHtml(url)}</a>${escapeHtml(tail)}`;
      } else {
        out += escapeHtml(m[0]);
      }
      last = m.index + m[0].length;
    }
    return out + escapeHtml(src.slice(last));
  }

  function renderComment(b) {
    return commentLayout === 'rich' ? renderCommentRich(b) : renderCommentPlain(b);
  }

  function renderCommentPlain(b) {
    const date = (b.timestamp || '').split(' ')[0];
    const user = `<button type="button" class="comment-user" data-user="${escapeHtml(b.user)}">${escapeHtml(b.user)}</button>`;
    const isNew = isNewComment(b);
    const stateClass = commentStateClass(b);
    return `<li${stateClass ? ` class="${stateClass.trim()}"` : ''}>${isNew ? NEW_COMMENT_BADGE : ''}${user} <span class="comment-date">${escapeHtml(date)}</span> ${linkifyComment(b.comment)}</li>`;
  }

  // 実際のはてなブックマークのコメント表示に寄せたレイアウト。
  // アイコンURLはAPIレスポンスに含まれないため、はてなの公開アイコン配信の
  // 命名規則(cdn.profile-image.st-hatena.com)から組み立てる。
  function renderCommentRich(b) {
    const date = (b.timestamp || '').split(' ')[0];
    const iconUrl = `https://cdn.profile-image.st-hatena.com/users/${encodeURIComponent(b.user)}/profile.png`;
    const user = `<button type="button" class="comment-user" data-user="${escapeHtml(b.user)}">${escapeHtml(b.user)}</button>`;
    const tags = (b.tags || [])
      .map((t) => `<span class="comment-tag">${escapeHtml(t)}</span>`)
      .join('');
    const isNew = isNewComment(b);
    return `
      <li class="comment--rich${commentStateClass(b)}">
        <img class="comment-icon" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" width="32" height="32">
        <div class="comment-rich-body">
          <div class="comment-rich-line1">${isNew ? NEW_COMMENT_BADGE : ''}${user} ${linkifyComment(b.comment)}</div>
          <div class="comment-rich-line2">
            <span class="comment-date">${escapeHtml(date)}</span>
            ${tags ? `<span class="comment-tags">${tags}</span>` : ''}
          </div>
        </div>
      </li>`;
  }

  // ---- フィルタ設定モーダル ----
  const settingsSections = document.getElementById('settings-sections');
  function showSettingsPane(key) {
    settingsSections.querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.pane === key);
    });
    settingsModal.querySelectorAll('.settings-pane').forEach((pane) => {
      pane.hidden = pane.dataset.pane !== key;
    });
  }
  settingsSections.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (btn) showSettingsPane(btn.dataset.pane);
  });

  // モーダルをvisualViewport(キーボードを除いた見えている領域)に追従させる
  function syncModalToViewport() {
    const vv = window.visualViewport;
    if (!vv || settingsModal.hidden) return;
    settingsModal.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    settingsModal.style.setProperty('--vv-height', `${vv.height}px`);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncModalToViewport);
    window.visualViewport.addEventListener('scroll', syncModalToViewport);
  }

  function openSettings(preset) {
    if (preset) currentSettingsKind = preset.kind;
    showSettingsPane('main');
    settingsModal.hidden = false;
    syncModalToViewport();
    renderSettingsTabs();
    renderRuleList();
    refreshImportTarget();
    refreshVisitedThresholdFields();
    refreshTokenField();
    refreshSyncFields();
    refreshFilterSyncFields();
    if (preset) {
      ruleTypeSelect.value = preset.type;
      ruleValueInput.value = preset.value;
      ruleValueInput.focus({ preventScroll: true });
    } else {
      // ドメイン/ユーザークリック経由でpresetを設定した後、歯車アイコンから
      // 開き直した際に選択が残ってしまわないよう、都度デフォルト(タイトル)に戻す。
      ruleTypeSelect.value = 'title';
      ruleValueInput.value = '';
    }
  }

  // ---- 既読の再表示閾値 ----
  function refreshVisitedThresholdFields() {
    const threshold = Visited.loadThreshold();
    autoScrollSpeedInput.value = autoScrollSpeed;
    visitedThresholdValueInput.value = threshold.value;
    visitedThresholdTypeSelect.value = threshold.type;
  }

  function saveVisitedThresholdFromFields() {
    const value = Number(visitedThresholdValueInput.value);
    if (!Number.isFinite(value) || value < 0) return;
    Visited.saveThreshold(visitedThresholdTypeSelect.value, value);
    updateListView();
  }

  visitedThresholdValueInput.addEventListener('change', saveVisitedThresholdFromFields);
  visitedThresholdTypeSelect.addEventListener('change', saveVisitedThresholdFromFields);

  // ---- GitHubトークン(既読の同期・フィルタの同期で共通) ----
  const gistTokenInput = document.getElementById('gist-token-input');

  function refreshTokenField() {
    gistTokenInput.value = Gist.getToken();
  }

  // 入力欄から離れた/Enterで確定した時に保存する(各同期の「保存して同期」は最新のトークンを都度読む)
  gistTokenInput.addEventListener('change', () => {
    Gist.setToken(gistTokenInput.value);
    renderSyncStatus();
    renderFilterSyncStatus();
  });

  // Gist IDの隣の「↗」: https://gist.github.com/<id> はユーザー名が無くても所有者のページへ飛べる
  function refreshGistLink(linkEl, gistId) {
    const url = Gist.pageUrl(gistId);
    linkEl.hidden = !url;
    if (url) linkEl.href = url;
    else linkEl.removeAttribute('href');
  }

  // ---- 既読の同期(Gist) ----
  const syncGistInput = document.getElementById('sync-gist-input');
  const syncGistLink = document.getElementById('sync-gist-link');
  const syncSaveBtn = document.getElementById('sync-save-btn');
  const syncCreateBtn = document.getElementById('sync-create-btn');
  const syncStatus = document.getElementById('sync-status');

  function renderSyncStatus() {
    const cfg = Sync.getConfig();
    if (!cfg.gistId) {
      syncStatus.textContent = '未設定';
      return;
    }
    const mode = Gist.getToken() ? '読み書き' : '読み取り専用';
    const at = cfg.lastSyncAt ? `最終同期 ${new Date(cfg.lastSyncAt).toLocaleString()}` : '未同期';
    syncStatus.textContent = cfg.lastError ? `${mode} / ${at} / エラー: ${cfg.lastError}` : `${mode} / ${at}`;
  }

  function refreshSyncFields() {
    const cfg = Sync.getConfig();
    syncGistInput.value = cfg.gistId;
    refreshGistLink(syncGistLink, cfg.gistId);
    renderSyncStatus();
  }

  syncGistInput.addEventListener('input', () => {
    refreshGistLink(syncGistLink, Gist.parseGistId(syncGistInput.value));
  });

  async function runSyncSave() {
    Gist.setToken(gistTokenInput.value);
    Sync.configure({ gistId: syncGistInput.value });
    syncStatus.textContent = '同期中…';
    await Sync.sync();
    refreshSyncFields();
  }
  syncSaveBtn.addEventListener('click', runSyncSave);

  syncCreateBtn.addEventListener('click', async () => {
    Gist.setToken(gistTokenInput.value);
    Sync.configure({ gistId: '' });
    syncStatus.textContent = '作成中…';
    try {
      await Sync.createGist();
      await Sync.sync();
    } catch (err) {
      syncStatus.textContent = `作成失敗: ${err.message}`;
      return;
    }
    refreshSyncFields();
  });

  Sync.init({
    onMerged: () => {
      // 一覧表示中のみ再描画する(記事表示中は一覧へ戻った時点で反映される)
      if (!document.getElementById('view-list').hidden) updateListView(window.scrollY);
    },
    onStatus: () => {
      if (!settingsModal.hidden) renderSyncStatus();
    },
  });

  // ---- オフライン用キャッシュ(「全て」上位n件のコメントを手動で今すぐ取得) ----
  // 設定モーダル内のボタンとヘッダーのクイックボタンの両方から呼ばれるため、
  // 進捗表示先(setStatus)だけを差し替えて共通処理にしている。
  let offlineCachingInProgress = false;

  async function runOfflineCache(setStatus) {
    const requested = Math.floor(Number(offlineCacheCountInput.value));
    const count = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 100;
    offlineCacheCountInput.value = count;

    offlineCachingInProgress = true;
    offlineCacheBtn.disabled = true;
    offlineCacheQuickBtn.disabled = true;
    setStatus('対象記事を取得中…');

    let targets;
    try {
      const entries = await HatenaAPI.getHotEntries('everything');
      targets = entries.filter((item) => !Filters.isHidden(item)).slice(0, count);
    } catch (err) {
      setStatus(`一覧の取得に失敗しました: ${err.message}`);
      offlineCacheBtn.disabled = false;
      offlineCacheQuickBtn.disabled = false;
      offlineCachingInProgress = false;
      return;
    }

    let success = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      setStatus(`${i + 1}/${targets.length}件処理中(成功${success}・失敗${failed})…`);
      try {
        await HatenaAPI.getEntryInfo(targets[i].url);
        success++;
      } catch (err) {
        failed++;
      }
    }

    setStatus(
      failed > 0
        ? `${targets.length}件中${success}件をキャッシュしました(失敗${failed}件)`
        : `${success}件をキャッシュしました`
    );
    offlineCacheBtn.disabled = false;
    offlineCacheQuickBtn.disabled = false;
    offlineCachingInProgress = false;
  }

  offlineCacheBtn.addEventListener('click', () => {
    if (offlineCachingInProgress) return;
    runOfflineCache((text) => {
      offlineCacheStatus.textContent = text;
    });
  });

  // ヘッダーのクイックボタンは、実行中でなく既にポップオーバーが開いている場合は
  // (=前回の結果を表示したまま)閉じるだけのトグルにする。
  offlineCacheQuickBtn.addEventListener('click', () => {
    if (!offlineCachingInProgress && !offlineCachePopover.hidden) {
      offlineCachePopover.hidden = true;
      return;
    }
    offlineCachePopover.hidden = false;
    if (offlineCachingInProgress) return;
    runOfflineCache((text) => {
      offlineCachePopoverStatus.textContent = text;
    });
  });

  document.addEventListener('click', (e) => {
    if (offlineCachePopover.hidden) return;
    if (offlineCacheQuick.contains(e.target)) return;
    offlineCachePopover.hidden = true;
  });

  function closeSettings() {
    settingsModal.hidden = true;
  }
  settingsBtn.addEventListener('click', () => openSettings());
  settingsClose.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  entryGrid.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.card-close-btn');
    if (closeBtn) {
      Filters.addRule('mute', 'url', closeBtn.dataset.url);
      render();
      return;
    }
    const domainBtn = e.target.closest('.card-domain');
    if (!domainBtn) return;
    openSettings({ kind: 'mute', type: 'domain', value: domainBtn.dataset.domain });
  });

  commentList.addEventListener('click', (e) => {
    const userBtn = e.target.closest('.comment-user');
    if (!userBtn) return;
    openSettings({ kind: 'mute', type: 'user', value: userBtn.dataset.user });
  });

  // ?ボタンで各セクションの説明(.hint)を開閉する(PC・タッチ共通)
  document.querySelectorAll('.help-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const hint = document.getElementById(btn.getAttribute('aria-controls'));
      const open = hint.hidden;
      hint.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
  });

  function renderSettingsTabs() {
    settingsTabs.innerHTML = Filters.KINDS.map((kind) => {
      const active = kind === currentSettingsKind ? ' active' : '';
      return `<button class="tab${active}" data-kind="${kind}">${escapeHtml(KIND_LABEL[kind])}</button>`;
    }).join('');
  }

  settingsTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-kind]');
    if (!btn) return;
    currentSettingsKind = btn.dataset.kind;
    renderSettingsTabs();
    renderRuleList();
    refreshImportTarget();
  });

  function renderRuleList() {
    const rules = Filters.loadRules(currentSettingsKind);
    ruleCount.textContent = String(rules.length);
    if (rules.length === 0) {
      ruleList.innerHTML = '<li class="empty">登録されているルールはありません。</li>';
      return;
    }
    ruleList.innerHTML = rules
      .map(
        (r) => `
        <li class="rule-item" data-id="${escapeHtml(r.id)}">
          <span class="rule-type">${escapeHtml(TYPE_LABEL[r.type] || r.type)}</span>
          <span class="rule-value">${escapeHtml(r.value)}</span>
          <button class="rule-remove" data-id="${escapeHtml(r.id)}" type="button">削除</button>
        </li>`
      )
      .join('');
  }

  ruleList.addEventListener('click', (e) => {
    const btn = e.target.closest('button.rule-remove');
    if (!btn) return;
    Filters.removeRule(currentSettingsKind, btn.dataset.id);
    renderRuleList();
    render();
  });

  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const type = ruleTypeSelect.value;
    const value = ruleValueInput.value;
    if (!value.trim()) return;
    Filters.addRule(currentSettingsKind, type, value);
    ruleValueInput.value = '';
    renderRuleList();
    render();
  });

  // ---- CSVエクスポート/インポート ----
  function refreshImportTarget() {
    importKindSelect.value = currentSettingsKind;
    importStatus.textContent = '';
  }

  // 「対象」の変更を、ミュート設定のタブ・ルール一覧にも反映する(タブ側の切り替えと同じ状態を共有)
  importKindSelect.addEventListener('change', () => {
    currentSettingsKind = importKindSelect.value;
    renderSettingsTabs();
    renderRuleList();
    refreshImportTarget();
  });

  function applyImportedCsv(text) {
    const { rules, errors, ignored } = parseImportCsv(text);
    if (errors.length > 0) {
      const shown = errors.slice(0, 5).join(' / ');
      const rest = errors.length > 5 ? ` 他${errors.length - 5}件` : '';
      importStatus.textContent = `インポート失敗: ${shown}${rest}`;
      return;
    }
    const added = Filters.importRules(currentSettingsKind, rules);
    const registered = rules.length - added;
    const notes = [];
    if (registered > 0) notes.push(`登録済み${registered}件`);
    if (ignored > 0) notes.push(`未対応の種別${ignored}件は無視`);
    importStatus.textContent =
      `${added}件を追加しました` + (notes.length > 0 ? `(${notes.join('、')})` : '');
    renderRuleList();
    render();
  }

  exportBtn.addEventListener('click', () => {
    const csv = rulesToCsv(Filters.sortRules(Filters.loadRules(currentSettingsKind)));
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSettingsKind}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // Clipboard APIは非セキュアコンテキスト(http経由のLAN内アクセス等)や権限ポリシーで
  // 使えないことがあるため、失敗時はexecCommandにフォールバックする。
  async function copyTextToClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (e) {
        // フォールバックへ続行
      }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    if (!ok) throw new Error('コピーコマンドが失敗しました');
  }

  copyBtn.addEventListener('click', async () => {
    const csv = rulesToCsv(Filters.sortRules(Filters.loadRules(currentSettingsKind)));
    try {
      await copyTextToClipboard(csv);
      importStatus.textContent = 'クリップボードにコピーしました';
    } catch (err) {
      importStatus.textContent = `コピーに失敗しました: ${err.message}`;
    }
  });

  exportTextBtn.addEventListener('click', () => {
    // window.open('', '_blank')は空ページへのポップアップとしてブロックされやすいため、
    // ダウンロード同様にBlob URLへのリンク遷移(target=_blank)でテキスト表示する。
    const csv = rulesToCsv(Filters.sortRules(Filters.loadRules(currentSettingsKind)));
    const blob = new Blob([csv], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });

  importFileInput.addEventListener('change', () => {
    const file = importFileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      applyImportedCsv(String(reader.result));
      importFileInput.value = '';
    };
    reader.onerror = () => {
      importStatus.textContent = 'ファイルの読み込みに失敗しました';
      importFileInput.value = '';
    };
    reader.readAsText(file, 'utf-8');
  });

  // ---- フィルタの同期(Gist) ----
  // ミュート・ミュート解除・強制ミュートの3種をまとめて1つのGistで同期する。
  const filterGistInput = document.getElementById('filter-gist-input');
  const filterGistLink = document.getElementById('filter-gist-link');
  const filterSyncSaveBtn = document.getElementById('filter-sync-save-btn');
  const filterSyncCreateBtn = document.getElementById('filter-sync-create-btn');
  const filterSyncStatus = document.getElementById('filter-sync-status');

  FilterSync.init({ parseCsv: parseImportCsv, toCsv: rulesToCsv });

  // extra: 直前の同期結果など、状態行に続けて出す補足
  function renderFilterSyncStatus(extra) {
    const cfg = FilterSync.getConfig();
    if (!cfg.gistId) {
      filterSyncStatus.textContent = '未設定';
      return;
    }
    const mode = Gist.getToken() ? '読み書き' : '読み取り専用';
    const at = cfg.lastSyncAt ? `最終同期 ${new Date(cfg.lastSyncAt).toLocaleString()}` : '未同期';
    const base = cfg.lastError ? `${mode} / ${at} / エラー: ${cfg.lastError}` : `${mode} / ${at}`;
    filterSyncStatus.textContent = extra ? `${base} / ${extra}` : base;
  }

  function refreshFilterSyncFields() {
    const cfg = FilterSync.getConfig();
    filterGistInput.value = cfg.gistId;
    refreshGistLink(filterGistLink, cfg.gistId);
    renderFilterSyncStatus();
  }

  filterGistInput.addEventListener('input', () => {
    refreshGistLink(filterGistLink, Gist.parseGistId(filterGistInput.value));
  });

  function describeFilterSyncResult(r) {
    const parts = [`${r.added}件を取り込み`];
    if (r.pushed > 0) parts.push(`Gistへ${r.pushed}ファイルを書き込み`);
    else if (!r.canPush) parts.push('トークン未設定のため書き込みなし');
    if (r.ignored > 0) parts.push(`未対応の種別${r.ignored}件は無視`);
    let text = parts.join('、');
    if (r.errors.length > 0) text += ` / 不正なCSVは取り込まず上書きもしていません(${r.errors.join(' / ')})`;
    return text;
  }

  async function runFilterSync(action) {
    Gist.setToken(gistTokenInput.value);
    try {
      const result = await action();
      renderRuleList();
      render();
      refreshFilterSyncFields();
      renderFilterSyncStatus(describeFilterSyncResult(result));
    } catch (err) {
      renderFilterSyncStatus();
      filterSyncStatus.textContent = `失敗: ${err.message}`;
    }
  }

  function runFilterSyncSave() {
    FilterSync.configure({ gistId: filterGistInput.value });
    filterSyncStatus.textContent = '同期中…';
    return runFilterSync(() => FilterSync.sync());
  }
  filterSyncSaveBtn.addEventListener('click', runFilterSyncSave);

  // メインタブのクイック同期ボタン。同期タブの「保存して同期」と同じ処理を呼び、
  // 結果の状態行を同期タブを開かなくても見えるようにここへ写す。
  const quickSyncStatus = document.getElementById('quick-sync-status');
  const quickSyncButtons = [
    document.getElementById('quick-sync-visited-btn'),
    document.getElementById('quick-sync-filter-btn'),
  ];
  async function runQuickSync(label, run, statusEl) {
    quickSyncButtons.forEach((b) => { b.disabled = true; });
    quickSyncStatus.textContent = `${label}: 同期中…`;
    try {
      await run();
      quickSyncStatus.textContent = `${label}: ${statusEl.textContent}`;
    } finally {
      quickSyncButtons.forEach((b) => { b.disabled = false; });
    }
  }
  quickSyncButtons[0].addEventListener('click', () => runQuickSync('既読同期', runSyncSave, syncStatus));
  quickSyncButtons[1].addEventListener('click', () => runQuickSync('フィルタ同期', runFilterSyncSave, filterSyncStatus));

  filterSyncCreateBtn.addEventListener('click', () => {
    FilterSync.configure({ gistId: '' });
    filterSyncStatus.textContent = '作成中…';
    return runFilterSync(async () => {
      await FilterSync.createGist();
      return FilterSync.sync();
    });
  });

  // ---- ビルド情報 + 次回データ更新目安(1行にまとめる) ----
  // 次回更新の取得元(hotentry-sync.yml)はビルド可能なのは自分だけであり、
  // ワークフロー自体も公開リポジトリの情報なのでリンクしても問題ない。
  const HOTENTRY_SYNC_WORKFLOW_URL = 'https://github.com/gosyujin/hateb-tycoon/actions/workflows/hotentry-sync.yml';

  async function renderFooter() {
    const el = document.getElementById('next-update-info');
    if (!el) return;

    const buildText = window.BUILD_INFO ? `${window.BUILD_INFO.sha} (${window.BUILD_INFO.time})` : '';
    let nextUpdateHtml = '';

    try {
      const res = await fetch('data/meta.json', { cache: 'no-store' });
      if (res.ok) {
        const meta = await res.json();
        nextUpdateHtml = `<a href="${escapeHtml(HOTENTRY_SYNC_WORKFLOW_URL)}" target="_blank" rel="noopener noreferrer">次回更新: ${escapeHtml(meta.nextEstimate)}頃</a>`;
      }
    } catch (e) {
      // メタ情報が無くても一覧表示自体は継続できるため、無視する
    }

    el.innerHTML = [escapeHtml(buildText), nextUpdateHtml].filter(Boolean).join(' / ');
  }

  // ---- キーボードショートカット ----
  // 一覧: 左右どちらでも「先頭から見て最初の未読」記事へ移動する(既読は読み飛ばす)。
  // ブックマークページ: 左右で現在のカテゴリー一覧上の前後の記事へ移動する(既読未読は問わない)。
  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function goToFirstUnread() {
    const target = currentVisibleEntries.find((item) => Visited.getReadState(item) !== 'read');
    if (!target) return false;
    const params = new URLSearchParams();
    params.set('url', target.url);
    navigate('/entry', params);
    return true;
  }

  // 前後移動で読み飛ばす「既読かつ更新なし」の判定は、一覧から記事ページに入った直後の
  // 状態(スナップショット)で行い、一覧に戻るまで使い回す。記事を開くたびに
  // markVisitedで状態が変わるため、毎回判定し直すと「前の記事へ」で今見てきたばかりの
  // 記事まで飛ばしてしまう。滞在中に隣の記事が更新された場合などは考慮しない。
  // 一方、このセッションで既に開いた記事は、スナップショット上で既読でも飛ばさない
  // (既読の記事Aを開き、次へ→前へで、Aに戻れるようにするため)。
  let entryNavReadSnapshot = null;
  let entryNavOpened = new Set();

  function resetEntryNavSnapshot() {
    entryNavReadSnapshot = null;
    entryNavOpened = new Set();
  }

  function ensureEntryNavSnapshot() {
    if (entryNavReadSnapshot) return;
    entryNavReadSnapshot = new Set(
      currentVisibleEntries.filter((item) => Visited.getReadState(item) === 'read').map((item) => item.url)
    );
  }

  function isSkippedByReadState(item) {
    ensureEntryNavSnapshot();
    return entryNavReadSnapshot.has(item.url) && !entryNavOpened.has(item.url);
  }

  // その場でフィルタに登録した記事はcurrentVisibleEntries自体からは即座に
  // 取り除かれないため、移動先を探す際は都度Filters.isHiddenで生きた判定をし、
  // 該当すればスルーして次(前)を見る。既読かつ更新なしの記事も同様に飛ばす。
  function findRelativeEntryIndex(currentUrl, delta) {
    if (!currentUrl || currentVisibleEntries.length === 0) return -1;
    ensureEntryNavSnapshot();
    const index = currentVisibleEntries.findIndex((item) => item.url === currentUrl);
    if (index === -1) return -1;
    let nextIndex = index + delta;
    while (
      nextIndex >= 0 &&
      nextIndex < currentVisibleEntries.length &&
      (Filters.isHidden(currentVisibleEntries[nextIndex]) || isSkippedByReadState(currentVisibleEntries[nextIndex]))
    ) {
      nextIndex += delta;
    }
    if (nextIndex < 0 || nextIndex >= currentVisibleEntries.length) return -1;
    return nextIndex;
  }

  function goToRelativeEntry(delta) {
    const { params } = parseRoute();
    const url = params.get('url');
    const nextIndex = findRelativeEntryIndex(url, delta);
    if (nextIndex === -1) return false;
    const nextParams = new URLSearchParams();
    nextParams.set('url', currentVisibleEntries[nextIndex].url);
    navigate('/entry', nextParams);
    return true;
  }

  function updateEntryNavButtons(url) {
    entryPrevBtn.disabled = findRelativeEntryIndex(url, -1) === -1;
    entryNextBtn.disabled = findRelativeEntryIndex(url, 1) === -1;
  }

  entryPrevBtn.addEventListener('click', () => goToRelativeEntry(-1));
  entryNextBtn.addEventListener('click', () => goToRelativeEntry(1));

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (isTypingTarget(document.activeElement)) return;
    if (!settingsModal.hidden) return;

    let handled = false;
    if (!listView.hidden) {
      handled = goToFirstUnread();
    } else if (!entryView.hidden) {
      handled = goToRelativeEntry(e.key === 'ArrowLeft' ? -1 : 1);
    }
    if (handled) e.preventDefault();
  });

  // ---- Service Worker登録(オフラインでも既に取得済みの分は見られるようにする) ----
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((err) => {
        console.error('[service-worker] registration failed', err);
      });
    });
  }

  // ---- 起動時のGist自動取り込み ----
  // フィルタ・既読のGistを最初の描画前に取り込み、最新の設定で一覧を出す。
  // オフライン等で応答が遅くても起動を待たせないよう、待つのは最大でタイムアウトまで。
  const STARTUP_IMPORT_TIMEOUT_MS = 3000;

  // ---- 自動スクロール ----
  // ヘッダーの▶️/⏸️で切り替える。ON/OFFはlocalStorageに保存し、ページ遷移(一覧⇔記事、
  // 前後の記事へ)をまたいで維持する。スクロール自体はwindowを一定速度で下へ送るだけなので、
  // ルート切替で先頭へ戻された後もそのまま続く。
  const AUTOSCROLL_KEY = 'hateb-tycoon:autoScroll';
  const AUTOSCROLL_SPEED_KEY = 'hateb-tycoon:autoScrollSpeed';
  const AUTOSCROLL_DEFAULT_SPEED = 20; // ゆっくり文章を目で追える程度の速さ(px/秒)
  const autoScrollSpeedInput = document.getElementById('autoscroll-speed-value');
  let autoScrollSpeed = loadAutoScrollSpeed();
  const AUTOSCROLL_PAUSE_AFTER_INPUT_MS = 1500; // 手動操作の直後は邪魔しない
  const autoScrollBtn = document.getElementById('autoscroll-btn');
  let autoScrollOn = loadAutoScroll();
  let autoScrollRaf = 0;
  let autoScrollLastTs = 0;
  let autoScrollRemainder = 0; // scrollByは整数に丸められることがあるため端数を持ち越す
  let autoScrollPausedUntil = 0;

  function loadAutoScroll() {
    try {
      return localStorage.getItem(AUTOSCROLL_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function loadAutoScrollSpeed() {
    try {
      const v = Number(localStorage.getItem(AUTOSCROLL_SPEED_KEY));
      return Number.isFinite(v) && v >= 1 ? v : AUTOSCROLL_DEFAULT_SPEED;
    } catch (e) {
      return AUTOSCROLL_DEFAULT_SPEED;
    }
  }

  function saveAutoScroll(on) {
    try {
      localStorage.setItem(AUTOSCROLL_KEY, on ? '1' : '0');
    } catch (e) {
      // localStorageが使えない環境では記憶をあきらめる
    }
  }

  function autoScrollStep(ts) {
    autoScrollRaf = requestAnimationFrame(autoScrollStep);
    const dt = Math.min(ts - autoScrollLastTs, 100); // タブ非表示後の巨大なdtで飛ばない
    autoScrollLastTs = ts;
    // 設定画面を開いている間は止める(背景が動くと気が散り、スマホでは入力欄の位置調整と競合する)。
    // ON/OFFの状態は変えないので、閉じればそのまま再開する。
    if (ts < autoScrollPausedUntil || !settingsModal.hidden) return;
    autoScrollRemainder += (autoScrollSpeed * dt) / 1000;
    const px = Math.floor(autoScrollRemainder);
    if (px >= 1) {
      autoScrollRemainder -= px;
      window.scrollBy(0, px);
    }
  }

  function applyAutoScroll() {
    autoScrollBtn.textContent = autoScrollOn ? '⏸️' : '▶️';
    autoScrollBtn.setAttribute('aria-pressed', String(autoScrollOn));
    const label = autoScrollOn ? '自動スクロールを停止' : '自動スクロールを開始';
    autoScrollBtn.setAttribute('aria-label', label);
    autoScrollBtn.title = label;
    cancelAnimationFrame(autoScrollRaf);
    autoScrollRaf = 0;
    if (autoScrollOn) {
      autoScrollLastTs = performance.now();
      autoScrollRemainder = 0;
      autoScrollRaf = requestAnimationFrame(autoScrollStep);
    }
  }

  autoScrollSpeedInput.addEventListener('change', () => {
    const v = Number(autoScrollSpeedInput.value);
    if (Number.isFinite(v) && v >= 1) {
      autoScrollSpeed = Math.min(v, 500);
      try {
        localStorage.setItem(AUTOSCROLL_SPEED_KEY, String(autoScrollSpeed));
      } catch (e) {
        // localStorageが使えない環境では記憶をあきらめる
      }
    }
    autoScrollSpeedInput.value = autoScrollSpeed;
  });

  autoScrollBtn.addEventListener('click', () => {
    autoScrollOn = !autoScrollOn;
    saveAutoScroll(autoScrollOn);
    applyAutoScroll();
  });
  ['wheel', 'touchstart', 'touchmove', 'keydown'].forEach((type) => {
    window.addEventListener(type, () => {
      autoScrollPausedUntil = performance.now() + AUTOSCROLL_PAUSE_AFTER_INPUT_MS;
    }, { passive: true });
  });

  // ---- 初期化 ----
  applyAutoScroll();
  updateListLayoutToggleUI();
  renderFooter();
  Promise.all([
    FilterSync.syncOnStartup(STARTUP_IMPORT_TIMEOUT_MS),
    Sync.syncOnStartup(STARTUP_IMPORT_TIMEOUT_MS),
  ]).then(render);
})();
