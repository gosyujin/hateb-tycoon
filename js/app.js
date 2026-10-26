(function () {
  const listView = document.getElementById('view-list');
  const entryView = document.getElementById('view-entry');
  const entryNavBar = document.getElementById('entry-nav-bar');
  const bottomBar = document.getElementById('app-bottom-bar');
  const footerSearch = document.getElementById('footer-search');
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
  const bookmarkForm = document.getElementById('bookmark-form');
  const bookmarkComment = document.getElementById('bookmark-comment');
  const bookmarkSubmit = document.getElementById('bookmark-submit');
  const bookmarkStatus = document.getElementById('bookmark-status');
  const entryPrevBtn = document.getElementById('entry-prev-btn');
  const entryNextBtn = document.getElementById('entry-next-btn');
  const entryNavNote = document.getElementById('entry-nav-note');
  const entryHeader = document.getElementById('entry-header');
  const entryDescription = document.getElementById('entry-description');
  const commentList = document.getElementById('comment-list');
  const entryStatus = document.getElementById('entry-status');
  const commentLayoutToggle = document.getElementById('comment-layout-toggle');
  const meView = document.getElementById('view-me');
  const meBack = document.getElementById('me-back');
  const meStatus = document.getElementById('me-status');
  const meList = document.getElementById('me-list');
  const meLayoutToggle = document.getElementById('me-layout-toggle');
  const meOpenSettings = document.getElementById('me-open-settings');
  const streamView = document.getElementById('view-stream');
  const streamList = document.getElementById('stream-list');

  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const mySettingsBtn = document.getElementById('my-settings-btn');
  const mySettingsModal = document.getElementById('my-settings-modal');
  const mySettingsClose = document.getElementById('my-settings-close');
  // どちらかのモーダルが開いている間は、背面のスワイプ・キー操作・自動スクロールを止める
  const isModalOpen = () => !settingsModal.hidden || !mySettingsModal.hidden;
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
  function resetFooterSearch(isEntry) {
    searchQuery = '';
    footerSearch.value = '';
    footerSearch.placeholder = isEntry ? ENTRY_SEARCH_PLACEHOLDER : LIST_SEARCH_PLACEHOLDER;
  }

  footerSearch.addEventListener('input', () => {
    searchQuery = footerSearch.value.trim().toLowerCase();
    if (!listView.hidden) {
      updateListView();
    } else if (!entryView.hidden) {
      applyEntrySearchAndRender();
    } else if (!meView.hidden) {
      renderMeList();
    }
  });

  // 一覧・個別記事どちらの画面でも、検索欄にURLを入力してEnterすると、そのURLのブックマークページへ遷移する。
  // 一覧に載っていないURLでも個別記事ビューはjsonlite経由で取得できるため、そのまま渡す。
  // IME変換確定のEnterでは遷移しない。
  footerSearch.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing) return;
    const value = footerSearch.value.trim();
    if (!/^https?:\/\/\S+$/i.test(value)) return;
    e.preventDefault();
    const params = new URLSearchParams();
    params.set('url', value);
    navigate('/entry', params);
  });

  // 下部固定フッターの高さをCSS変数に反映し、コンテンツが隠れないよう本文の下余白に使う。
  // (記事ページのナビ表示有無・safe-area・フォントサイズで高さが変わるため実測する)
  function syncBottomBarHeight() {
    document.documentElement.style.setProperty('--bottom-bar-h', `${bottomBar.offsetHeight}px`);
  }
  syncBottomBarHeight();
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(syncBottomBarHeight).observe(bottomBar);
  } else {
    window.addEventListener('resize', syncBottomBarHeight);
  }

  // 幅に応じて固定フッターの中身を減らす(gyazo-tycoonと同じ考え方)。
  //   〜640px: そのまま(検索欄・前後ナビ・投稿行を下部に固定)
  //   641px〜: 前後ナビ(前の記事へ・一覧へ戻る・次の記事へ)を本文末尾に置き、固定しない
  //   900px〜: さらに検索欄をヘッダーに移す(下部に固定するのは投稿行のみ)
  // 要素ごと付け替えるだけなので、id・イベントリスナーはそのまま効く。
  const entryNavRow = document.getElementById('entry-nav-row');
  const footerSearchBar = document.querySelector('.footer-search-bar');
  const appHeader = document.querySelector('.app-header');
  function placeNavRow(inBody) {
    if (inBody) entryView.appendChild(entryNavRow);
    else entryNavBar.appendChild(entryNavRow);
  }
  // 検索欄をヘッダーに移すとDOM順で投稿行より先にTabが当たるため、投稿行(コメント欄・🔖・⚙・B!)を先に回す。
  // tabindexが同じ正の値の要素はDOM順に回るので、行内の順序は変わらない。自動フォーカスはしない
  // (入力欄にフォーカスがあると、矢印キーでの記事移動のたびに外す必要が出るため)。
  function placeSearchBar(inHeader) {
    bookmarkForm.querySelectorAll('input, a, button').forEach((el) => {
      if (inHeader) el.tabIndex = 1;
      else el.removeAttribute('tabindex');
    });
    if (inHeader) appHeader.insertBefore(footerSearchBar, appHeader.querySelector('#offline-cache-quick'));
    else bottomBar.appendChild(footerSearchBar);
  }
  if (typeof window.matchMedia === 'function') {
    const navMq = window.matchMedia('(min-width: 641px)');
    const searchMq = window.matchMedia('(min-width: 900px)');
    placeNavRow(navMq.matches);
    placeSearchBar(searchMq.matches);
    navMq.addEventListener('change', (e) => placeNavRow(e.matches));
    searchMq.addEventListener('change', (e) => placeSearchBar(e.matches));
  }

  function render() {
    const { path, params } = parseRoute();
    resetFooterSearch(path === '/entry');
    streamView.hidden = path !== '/stream';
    if (path !== '/stream') stream.stop();
    if (path === '/stream') {
      listView.hidden = true;
      entryView.hidden = true;
      entryNavBar.hidden = true;
      meView.hidden = true;
      footerSearch.placeholder = STREAM_SEARCH_PLACEHOLDER;
      stream.start(params.get('cat') || currentCategory);
    } else if (path === '/me') {
      listView.hidden = true;
      entryView.hidden = true;
      entryNavBar.hidden = true;
      meView.hidden = false;
      footerSearch.placeholder = ME_SEARCH_PLACEHOLDER;
      renderMeView();
    } else if (path === '/entry') {
      listView.hidden = true;
      meView.hidden = true;
      entryView.hidden = false;
      entryNavBar.hidden = false;
      const url = params.get('url');
      renderEntryView(url);
    } else {
      const newCategory = params.get('cat') || 'everything';
      // 同じカテゴリーのまま戻ってきた(=コメントページから「一覧に戻る」)場合のみ、
      // 離れる直前のスクロール位置を復元する。カテゴリーを切り替えた場合は復元しない。
      const restoreScrollY = newCategory === currentCategory && pendingScrollY !== null ? pendingScrollY : null;
      entryView.hidden = true;
      meView.hidden = true;
      entryNavBar.hidden = true;
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

  // 横スワイプを検出してonSwipe(deltaX)を呼ぶ。touchイベントはタッチ対応デバイスでのみ
  // 発火するため、マウス操作のデスクトップ表示には影響しない。縦スクロールを妨げないよう
  // preventDefaultはせず、指を離した時点で「横方向優先」かつ「一定距離以上」動いていた
  // 場合のみジャッジする(タップやスクロールを誤ってスワイプ扱いしないため)。
  function addSwipeListener(el, onSwipe) {
    const SWIPE_MIN_X = 60;
    const SWIPE_MAX_OFF_AXIS_Y = 60;
    let startX = 0;
    let startY = 0;
    let tracking = false;

    el.addEventListener(
      'touchstart',
      (e) => {
        tracking = e.touches.length === 1;
        if (!tracking) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      },
      { passive: true }
    );

    el.addEventListener(
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
        onSwipe(deltaX);
      },
      { passive: true }
    );
  }

  // 一覧ページの横スワイプでカテゴリータブを前後に移動する。
  // 左スワイプ(指を左へ)で次のカテゴリー、右スワイプで前のカテゴリー。
  // 端のカテゴリーではそれ以上折り返さない。
  function swipeCategory(deltaX) {
    const categories = HatenaAPI.CATEGORIES;
    const index = categories.findIndex((c) => c.key === currentCategory);
    if (index === -1) return;
    const nextIndex = deltaX < 0 ? index + 1 : index - 1;
    if (nextIndex < 0 || nextIndex >= categories.length) return;
    const params = new URLSearchParams();
    params.set('cat', categories[nextIndex].key);
    navigate('/', params);
  }

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

  // カテゴリー切替・再描画で古い取得結果が新しい一覧を上書きしないための世代番号。
  let listRenderSeq = 0;

  // 前回取得分(Cache Storage)があれば先に描画し、裏でネットワーク取得して内容が変わった
  // 時だけ差し替える。キャッシュが無い時だけ従来どおり「読み込み中…」で待つ。
  async function renderListView(restoreScrollY) {
    const seq = ++listRenderSeq;
    disconnectScrollObserver();
    entryGrid.innerHTML = '';
    baseEntries = [];
    hiddenByFilterCount = 0;
    hasLoadedList = false;
    currentVisibleEntries = [];
    renderedCount = 0;
    listStatus.textContent = '読み込み中…';
    listLoading = true;
    const category = currentCategory;
    try {
      const cached = await HatenaAPI.getCachedHotEntries(category).catch(() => null);
      if (seq !== listRenderSeq) return;
      let shownFromCache = false;
      if (cached && cached.length > 0) {
        applyLoadedEntries(cached);
        updateListView(restoreScrollY);
        shownFromCache = true;
      }
      const entries = await HatenaAPI.getHotEntries(category);
      if (seq !== listRenderSeq) return;
      if (shownFromCache && JSON.stringify(entries) === listSignature) {
        listLoadedAt = Date.now();
        return;
      }
      const scrollY = window.scrollY;
      applyLoadedEntries(entries);
      updateListView(shownFromCache ? (scrollY > 0 ? scrollY : null) : restoreScrollY);
    } catch (err) {
      if (seq !== listRenderSeq) return;
      console.error(err);
      // 先出しした一覧が見えている間は消さない(オフライン等)
      if (!hasLoadedList) {
        listStatus.textContent = `取得に失敗しました: ${err.message}(アプリに戻る/オンラインになると再取得します)`;
      }
    } finally {
      if (seq === listRenderSeq) listLoading = false;
    }
  }

  // 初回読み込みに失敗したままだと、自動リフレッシュ(hasLoadedList前提)も働かず、
  // タスクキルするまで一覧が見られなくなる。前面復帰・オンライン復帰の時に再取得する。
  function retryListIfNotLoaded() {
    if (listView.hidden || hasLoadedList || listLoading) return;
    renderListView();
  }
  window.addEventListener('online', retryListIfNotLoaded);

  let loadedRawEntries = [];

  function applyLoadedEntries(entries) {
    loadedRawEntries = entries;
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

  // ホーム画面追加のPWAはタスクに残ったままだと起動時に読み込んだJS/HTMLが
  // メモリに居続け、画面遷移もハッシュ変更だけでリロードが走らないため、
  // デプロイ後も古いバージョンのまま動き続ける(Service Workerが新版に更新
  // されても、実行中のページには反映されない)。前面復帰時にネットワークから
  // 最新のcodeVersionを取得し、起動時のものと違えば再読み込みして新版に入れ替える。
  // 比較に使うのはshaではなくcodeVersion(アプリ本体を最後に変更したコミット)。
  // shaは15分おきのデータ更新コミットでも変わるため、使うと復帰のたびに
  // 再読み込みしてスクロール位置などが飛ぶ。
  // 同じcodeVersionに対する再読み込みは1セッション1回までにして、HTTPキャッシュ等で
  // 古い内容が返り続けた場合でも無限に再読み込みしないようにする。
  const VERSION_CHECK_INTERVAL_MS = 60 * 1000;
  const VERSION_RELOAD_KEY = 'hateb-tycoon:reloadedForCodeVersion';
  let lastVersionCheckAt = 0;

  async function reloadIfNewVersionDeployed() {
    const current = window.BUILD_INFO && window.BUILD_INFO.codeVersion;
    if (!current || current === 'dev') return;
    if (Date.now() - lastVersionCheckAt < VERSION_CHECK_INTERVAL_MS) return;
    lastVersionCheckAt = Date.now();
    try {
      const res = await fetch('js/build-info.js', { cache: 'no-store' });
      if (!res || !res.ok) return;
      const m = /codeVersion:\s*'([^']+)'/.exec(await res.text());
      const latest = m && m[1];
      if (!latest || latest === current) return;
      try {
        if (sessionStorage.getItem(VERSION_RELOAD_KEY) === latest) return;
        sessionStorage.setItem(VERSION_RELOAD_KEY, latest);
      } catch (err) {
        // sessionStorageが使えない環境では上限なしで再読み込みするが、前面復帰時のみなので許容する
      }
      location.reload();
    } catch (err) {
      // オフライン・通信不安定時は何もしない(次回の前面復帰で再確認する)
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      reloadIfNewVersionDeployed();
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
          <button type="button" class="card-domain" data-domain="${escapeHtml(item.domain)}" data-url="${escapeHtml(item.url)}">${escapeHtml(item.domain)}</button>
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
        <button type="button" class="card-domain entry-row-domain" data-domain="${escapeHtml(item.domain)}" data-url="${escapeHtml(item.url)}">${escapeHtml(item.domain)}</button>
        <span class="entry-row-main">
          <a class="entry-row-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
          <a class="card-count-link entry-row-count${countTierClass(item.count)}${noCommentClass}" href="${href}"${countTitle}>${item.count} users →</a>
        </span>
      </li>`;
  }

  // ---- ストリーム表示(#/stream) ----
  // 一覧データのうちフィルタに掛からない記事を、古い順に少しずつ末尾へ足していく(js/stream.js)。
  const STREAM_SEARCH_PLACEHOLDER = 'URLを入力してEnterでブックマーク一覧';

  // 本文を取れなかった理由(scripts/fetch_hotentry.pyがbodyReasonに残すコード)の表示名
  const BODY_REASON_LABEL = {
    'robots-disallow': 'robots.txtで取得が許可されていません',
    'robots-unavailable': 'robots.txtを確認できませんでした',
    'crawl-delay-too-long': 'サイトが長い取得間隔を求めています',
    'host-blocked': 'サイトが混み合っていました',
    'bad-url': 'URLが不正です',
    'not-html': 'HTMLのページではありません',
    'hatena-bookmark-page': 'はてなブックマークのページです',
    'x-robots-tag': 'サイトが抜粋の利用を許可していません',
    nosnippet: 'サイトが抜粋の利用を許可していません',
    'no-text': '本文を抽出できませんでした',
    'parse-error': 'ページを解析できませんでした',
    'too-many-redirects': '転送が多すぎます',
    'redirect-without-location': '転送先が不明です',
    network: '通信に失敗しました',
    unknown: '理由は不明です',
    'http-401': 'HTTP 401 アクセスを拒否されました',
    'http-403': 'HTTP 403 アクセスを拒否されました',
    'http-404': 'HTTP 404 ページが見つかりません',
  };

  // 概要として出す文。本文の抜粋かRSSの概要があればそれ、無ければ取得できなかった理由。
  function descriptionOrMissing(item) {
    if (item.description) return { text: item.description, missing: false };
    let reason;
    if (item.bodyReason) {
      const m = /^http-(\d+)$/.exec(item.bodyReason);
      reason = BODY_REASON_LABEL[item.bodyReason] || (m ? `HTTP ${m[1]} サイトがエラーを返しました` : item.bodyReason);
    } else {
      reason = item.bodyStatus === 'skip' ? '理由は記録されていません' : 'まだ取得していません';
    }
    return { text: `記事が取得できませんでした(${reason})`, missing: true };
  }

  function renderStreamItem(item) {
    const params = new URLSearchParams();
    params.set('url', item.url);
    const href = `#/entry?${params.toString()}`;
    const thumb = item.screenshot
      ? `<img class="stream-thumb" src="${escapeHtml(item.screenshot)}" alt="" loading="lazy">`
      : '';
    const time = item.hatenaDate ? hatenaDateTime(item.hatenaDate) : '';
    // 概要が無い記事も、取得できなかった理由を概要の位置に出す(見え方を揃える)
    const d = descriptionOrMissing(item);
    const desc = `<p class="stream-desc stream-desc--collapsible${d.missing ? ' stream-desc--missing' : ''}">${escapeHtml(d.text)}</p><button type="button" class="stream-desc-toggle" aria-expanded="true">▲ 閉じる</button>`;
    return `
      <li class="stream-item" data-url="${escapeHtml(item.url)}">
        <div class="stream-main">
          <div class="stream-meta">
            <button type="button" class="card-domain stream-domain" data-domain="${escapeHtml(item.domain)}" data-url="${escapeHtml(item.url)}">${escapeHtml(item.domain)}</button>
            <span class="stream-time">${escapeHtml(time)}</span>
            <a class="card-count-link${countTierClass(item.count)}" href="${href}">${item.count} users →</a>
            <button type="button" class="card-close-btn stream-close" data-url="${escapeHtml(item.url)}" title="このページを非表示にする" aria-label="このページを非表示にする">×</button>
          </div>
          <a class="stream-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
          ${desc}
          <ul class="comment-list stream-comments"></ul>
        </div>
        ${thumb}
      </li>`;
  }

  function renderStreamComment(b) {
    return `<li><button type="button" class="comment-user" data-user="${escapeHtml(b.user)}">${escapeHtml(b.user)}</button> <span class="comment-date">${escapeHtml(b.timestamp)}</span> ${linkifyComment(b.comment)}</li>`;
  }

  // data/meta.json の nextEstimate("HH:MM"、JST)を、次回のデータ更新の目安(ms)にする。
  // 日付は持たないため、今日のその時刻とし、半日以上前になってしまう場合(日をまたぐ時)だけ翌日にする。
  // 取れない・読めない時はnull。
  async function fetchNextUpdateAt() {
    const res = await fetch('data/meta.json', { cache: 'no-store' });
    if (!res.ok) return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec((await res.json()).nextEstimate || '');
    if (!m) return null;
    const nowMs = Date.now();
    const jst = new Date(nowMs + 9 * 60 * 60 * 1000);
    let at = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), Number(m[1]) - 9, Number(m[2]));
    if (at < nowMs - 12 * 60 * 60 * 1000) at += 24 * 60 * 60 * 1000;
    return at;
  }

  // 概要(ストリーム・記事ページ共通)は全文を出し、「▲ 閉じる」で3行に畳める。
  // 短い概要でも「閉じる」を出す(畳んでも見た目は変わらず、表示の統一のため)。
  function toggleDesc(desc) {
    const collapsed = desc.classList.toggle('stream-desc--collapsed');
    const btn = desc.nextElementSibling;
    if (btn && btn.classList.contains('stream-desc-toggle')) {
      btn.textContent = collapsed ? '▼ 続きを読む' : '▲ 閉じる';
      btn.setAttribute('aria-expanded', String(!collapsed));
    }
  }

  // 記事ページ(#/entry)の概要も同じ。一覧データの概要は、本文の抜粋に差し替えられていればそれ、
  // 取れていなければRSS由来のもの、どちらも無ければ「取得できなかった理由」になる。
  const entryDescToggle = document.getElementById('entry-desc-toggle');
  function setEntryDescription(text, missing) {
    entryDescription.classList.remove('stream-desc--collapsed', 'stream-desc--collapsible', 'stream-desc--missing');
    entryDescToggle.textContent = '▲ 閉じる';
    entryDescToggle.setAttribute('aria-expanded', 'true');
    entryDescription.textContent = text;
    if (text) entryDescription.classList.add('stream-desc--collapsible');
    if (text && missing) entryDescription.classList.add('stream-desc--missing');
  }
  entryDescription.addEventListener('click', () => {
    if (entryDescription.classList.contains('stream-desc--collapsible')) toggleDesc(entryDescription);
  });
  entryDescToggle.addEventListener('click', () => toggleDesc(entryDescription));

  const stream = Stream.create({
    list: streamList,
    statusEl: document.getElementById('stream-status'),
    pauseBtn: document.getElementById('stream-pause'),
    intervalSelect: document.getElementById('stream-interval'),
    renderItem: renderStreamItem,
    renderComment: renderStreamComment,
    // コメント付きのブックマークだけを、コメント表示と同じ判定でミュートしたうえで返す
    fetchComments: async (url) => {
      const info = await HatenaAPI.getEntryInfo(url);
      if (info.notBookmarked) return [];
      return info.bookmarks.filter(
        (b) => b.comment && !Filters.isHidden({ title: info.title, domain: info.domain, user: b.user, comment: b.comment })
      );
    },
    fetchEntries: (category) => HatenaAPI.getHotEntries(category),
    fetchNextUpdateAt,
    isHidden: (item) => Filters.isHidden(item),
  });

  document.getElementById('stream-back').addEventListener('click', () => {
    const params = new URLSearchParams();
    params.set('cat', currentCategory);
    navigate('/', params);
  });

  streamList.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.card-close-btn');
    if (closeBtn) {
      Filters.addRule('mute', 'url', closeBtn.dataset.url);
      closeBtn.closest('.stream-item').remove();
      return;
    }
    const userBtn = e.target.closest('.comment-user');
    if (userBtn) {
      openSettings({ kind: 'mute', type: 'user', value: userBtn.dataset.user });
      return;
    }
    const descToggle = e.target.closest('.stream-desc-toggle');
    const desc = descToggle ? descToggle.previousElementSibling : e.target.closest('.stream-desc--collapsible');
    if (desc) {
      toggleDesc(desc);
      return;
    }
    const domainBtn = e.target.closest('.card-domain');
    if (domainBtn) openSettings(domainMutePreset(domainBtn));
  });

  // ---- 個別エントリー(コメント一覧)ビュー ----
  // 矢印キーでの前後移動は都度履歴を積むため、history.back()だと矢印移動した回数分
  // 戻ってしまい一覧まで戻れない。常に現在のカテゴリー一覧へ直接遷移させる。
  function goToList() {
    // 「自分のブックマーク」から開いた記事は、そちらへ戻る。
    if (parseRoute().params.get('from') === 'me') {
      navigate('/me');
      return;
    }
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
  // richレイアウト時のみ取得するコメントごとのスター数(HatenaAPI.starKey -> 数、0件は含まない)。
  // 記事を開き直すたびにリセットし、取得は記事ごとに1回だけ(レイアウトを切り替えても再取得しない)。
  let entryStarCounts = new Map();
  let entryStarsInfo = null; // { eid } 取得に必要な情報。notBookmarked等ではnull
  let entryStarsRequested = false;
  let entryStarsSeq = 0; // 記事遷移後に古い応答で描画しないための世代番号

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
    [commentLayoutToggle, meLayoutToggle].forEach((toggle) => {
      toggle.querySelectorAll('button[data-layout]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.layout === commentLayout);
      });
    });
  }

  // richレイアウトの時だけ、表示中のコメントのスター数を(未取得なら)取得して描画し直す。
  async function ensureStarCounts() {
    if (commentLayout !== 'rich' || entryStarsRequested || !entryStarsInfo || !entryStarsInfo.eid) return;
    if (entryVisibleComments.length === 0) return;
    entryStarsRequested = true;
    const seq = entryStarsSeq;
    const counts = await HatenaAPI.getStarCounts(entryStarsInfo.eid, entryVisibleComments);
    if (seq !== entryStarsSeq || counts.size === 0) return;
    entryStarCounts = counts;
    if (commentLayout === 'rich') renderCommentList();
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
    ensureStarCounts();
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

  // ---- ブックマーク投稿(記事ページ下部のコメント入力+「B!」) ----
  // 中継Worker(OAuth署名はWorker側)経由で、自分のブックマークを追加・更新する。Worker未設定なら入力欄と「B!」は止める。
  // はてなのPOSTは既存を上書きする(コメントもタグも)ため、記事を開いたら自分の既存ブックマークを
  // 取得して入力欄に入れ、取得できるまで「B!」は押せない。タグは編集しないが、既存のタグは
  // 取得して保持し、そのまま送り直す(送らないとコメントの更新でタグが消える)。
  const BOOKMARK_LOAD_DELAY_MS = 400; // 前後の記事へ素早く移る時にWorkerを連打しない
  let bookmarkTarget = null; // 対象URL
  let bookmarkLoadedFor = null; // 既存ブックマークの取得済みURL
  let bookmarkTags = []; // 既存のタグ(編集不可・保持して再送)
  let bookmarkSeq = 0; // 記事遷移後に古い応答を反映しないための世代番号
  let bookmarkSending = false;
  let bookmarkLoadTimer = null;

  function resetBookmarkForm(url) {
    bookmarkSeq++;
    clearTimeout(bookmarkLoadTimer);
    bookmarkTarget = url || null;
    bookmarkLoadedFor = null;
    bookmarkTags = [];
    bookmarkSending = false;
    bookmarkComment.value = '';
    bookmarkStatus.textContent = '';
    bookmarkSubmit.disabled = true;
    // 未設定でもバーは出す(⚙から接続設定を開くため)。入力欄だけ止め、既存の取得もしない。
    const configured = MyBookmarks.isConfigured();
    bookmarkForm.hidden = !url;
    bookmarkComment.disabled = !configured;
    bookmarkComment.placeholder = configured ? 'コメント' : '⚙で中継Workerを設定';
    if (url && configured) bookmarkLoadTimer = setTimeout(loadExistingBookmark, BOOKMARK_LOAD_DELAY_MS);
  }

  async function loadExistingBookmark() {
    const seq = bookmarkSeq;
    const target = bookmarkTarget;
    if (!target) return;
    try {
      const mine = await MyBookmarks.getBookmark(target);
      if (seq !== bookmarkSeq) return;
      bookmarkLoadedFor = target;
      bookmarkTags = mine.tags;
      // 取得を待つ間に入力が始まっていたら、その入力を上書きしない
      if (mine.exists && !bookmarkComment.value) bookmarkComment.value = mine.comment;
      bookmarkSubmit.disabled = false;
    } catch (err) {
      if (seq !== bookmarkSeq) return;
      // 既存の状態が分からないまま送ると上書きの恐れがあるため、取得できなければ送信させない。
      console.error(err);
      bookmarkStatus.textContent = `自分のブックマークを確認できませんでした: ${err.message}`;
    }
  }

  // Enter(スマホのリターンキー)は、キーボードを畳んで投稿する(「B!」ボタンと同じ)。
  // 取得待ちなどでボタンが押せない間は、畳むだけで投稿しない。IMEの変換確定のEnterは何もしない。
  bookmarkComment.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    bookmarkComment.blur();
    if (!bookmarkSubmit.disabled) bookmarkForm.requestSubmit();
  });

  bookmarkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (bookmarkSending || !bookmarkTarget || bookmarkLoadedFor !== bookmarkTarget) return;
    const seq = bookmarkSeq;
    const target = bookmarkTarget;
    bookmarkSending = true;
    bookmarkSubmit.disabled = true;
    bookmarkStatus.textContent = '送信中…';
    let saved;
    try {
      saved = await MyBookmarks.postBookmark({ url: target, comment: bookmarkComment.value, tags: bookmarkTags });
    } catch (err) {
      if (seq !== bookmarkSeq) return;
      console.error(err);
      bookmarkStatus.textContent = `送信に失敗しました: ${err.message}`;
      bookmarkSending = false;
      bookmarkSubmit.disabled = false;
      return;
    }
    meFetchedAt = 0; // 「自分のブックマーク」ページは次に開いた時に取り直す
    if (seq !== bookmarkSeq) return;
    // 記事ページは再読み込みしない: 投稿直後ははてなのコメント一覧(jsonlite)にまだ反映されず、
    // 自分のコメントが出ないことがあったため。入力欄に保存された内容が残るので、それで確認できる。
    bookmarkComment.value = saved.comment;
    bookmarkTags = saved.tags;
    bookmarkStatus.textContent = 'ブクマしました。';
    bookmarkSending = false;
    bookmarkSubmit.disabled = false;
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
          <button type="button" class="card-domain entry-meta-domain" data-domain="${escapeHtml(info.domain)}" data-url="${escapeHtml(info.url)}">${escapeHtml(info.domain)}</button>
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
    entryStarCounts = new Map();
    entryStarsInfo = null;
    entryStarsRequested = false;
    entryStarsSeq++;
    entryHeader.innerHTML = '';
    setEntryDescription('');
    updateCommentLayoutToggleUI();
    resetEntryFilterBtn();
    resetBookmarkForm(url);
    updateEntryNavButtons(url);
    if (!url) {
      entryStatus.textContent = 'URLが指定されていません。';
      return;
    }
    // 一覧取得済みのデータに概要(RSSのdescription)があれば流用する。
    // 直接このURLへ遷移した場合など、一覧データが無ければ何も表示しない。
    const listedItem = currentVisibleEntries.find((item) => item.url === url);
    if (listedItem) {
      const d = descriptionOrMissing(listedItem);
      setEntryDescription(d.text, d.missing);
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
      setEntryFetchUnstable(!!info.fromOfflineCache, url);

      if (
        Filters.isHidden({
          title: info.title,
          domain: info.domain,
          url: info.url,
          description: (listedItem || loadedRawEntries.find((item) => item.url === url) || {}).description,
        })
      ) {
        setEntryDescription('');
        entryStatus.textContent = 'このエントリーはフィルタ条件により非表示になっています。';
        return;
      }

      // まだ誰もブックマークしていないURL(jsonliteがnullを返した)。コメント内のリンクや
      // URL直接入力では普通に起こり得る。元記事へのリンクだけ出し、既読記録もしない。
      if (info.notBookmarked) {
        setEntryDescription('');
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
      entryStarsInfo = { eid: info.eid || (/\/entry\/(\d+)$/.exec(info.entryUrl || '') || [])[1] || null };
      ensureStarCounts();
      if (info.fromPrefetch) perfMark('prefetch-hit');
      schedulePrefetchNeighbors(url);
      // オフライン時などデータ取得に時間がかかった場合、その間に上記の慣性
      // スクロール対策が先に終わってしまっていることがあるため、コメント
      // 描画後にもう一度先頭へ戻しておく。
      forceScrollTop();
    } catch (err) {
      console.error(err);
      perfMark('error');
      setEntryFetchUnstable(true, url);
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
    const stars = entryStarCounts.get(HatenaAPI.starKey(b));
    const starBadge = stars ? ` <span class="comment-stars" title="はてなスター">⭐️${stars}</span>` : '';
    return `
      <li class="comment--rich${commentStateClass(b)}">
        <img class="comment-icon" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" width="32" height="32">
        <div class="comment-rich-body">
          <div class="comment-rich-line1">${isNew ? NEW_COMMENT_BADGE : ''}${user} ${linkifyComment(b.comment)}${starBadge}</div>
          <div class="comment-rich-line2">
            <span class="comment-date">${escapeHtml(date)}</span>
            ${tags ? `<span class="comment-tags">${tags}</span>` : ''}
          </div>
        </div>
      </li>`;
  }

  // ---- 自分のブックマークビュー(#/me) ----
  // 取得はMyBookmarks(中継Worker経由)。表示はコメントビューと同じplain/rich(commentLayoutを共有)。
  // フィルタ(ミュート)は一覧・コメントと同じ判定(title/domain/url/comment)を取得済みの全件に適用する。
  const ME_FRESH_MS = 5 * 60 * 1000;
  const ME_SEARCH_PLACEHOLDER = 'タイトル・ドメイン・コメント・タグで絞り込み / URLを入力してEnterでブックマーク一覧';
  let meItems = [];
  let meNextPage = 1; // 次に取得するページ。nullなら末尾まで取得済み
  let meLoading = false;
  let meLoaded = false;
  let meFetchedAt = 0;
  let meError = '';
  let meOfflineNote = '';
  let meSeq = 0; // 再取得後に古い応答で描画しないための世代番号
  let meScrollY = null;
  let meObserver = null;
  // richの時だけ取得するコメントごとのスター数(eid -> 数。0件は含まない)と、取得を依頼済みのeid。
  // 依頼済みのものは失敗しても取り直さない(検索の入力のたびにWorkerを叩かないため)。
  let meStarCounts = new Map();
  let meStarsRequested = new Set();

  window.addEventListener('scroll', () => {
    if (!meView.hidden) meScrollY = window.scrollY;
  });

  meBack.addEventListener('click', () => navigate('/'));

  meLayoutToggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-layout]');
    if (!btn || btn.dataset.layout === commentLayout) return;
    commentLayout = btn.dataset.layout;
    saveCommentLayout(commentLayout);
    updateCommentLayoutToggleUI();
    renderMeList();
  });

  meOpenSettings.addEventListener('click', () => openMySettings());

  function resetMeState() {
    meSeq++;
    meItems = [];
    meNextPage = 1;
    meLoading = false;
    meLoaded = false;
    meError = '';
    meOfflineNote = '';
    meScrollY = null;
    meStarCounts = new Map();
    meStarsRequested = new Set();
  }

  function disconnectMeObserver() {
    if (meObserver) {
      meObserver.disconnect();
      meObserver = null;
    }
  }

  function renderMeView() {
    disconnectMeObserver();
    updateCommentLayoutToggleUI();
    if (!MyBookmarks.isConfigured()) {
      resetMeState();
      meList.innerHTML = '';
      meStatus.textContent = 'Worker URL とアクセストークンが未設定です。下のボタンから入力してください。';
      meOpenSettings.hidden = false;
      return;
    }
    meOpenSettings.hidden = true;
    // フィルタ変更後の再描画や記事ページからの戻りは、取得済みの内容をそのまま描き直す。
    if (meLoaded && Date.now() - meFetchedAt < ME_FRESH_MS) {
      renderMeList();
      if (meScrollY != null) window.scrollTo(0, meScrollY);
      return;
    }
    resetMeState();
    forceScrollTop();
    meList.innerHTML = '';
    loadMeNextPage();
  }

  async function loadMeNextPage() {
    if (meLoading || meNextPage == null) return;
    const seq = meSeq;
    const page = meNextPage;
    meLoading = true;
    meError = '';
    updateMeStatus(meVisibleItems());
    try {
      const { items, nextPage } = await MyBookmarks.fetchPage(page);
      if (seq !== meSeq) return;
      if (page === 1) MyBookmarks.saveCache(items);
      const seen = new Set(meItems.map((it) => it.url));
      meItems = meItems.concat(items.filter((it) => !seen.has(it.url)));
      meNextPage = nextPage;
      meLoaded = true;
      meFetchedAt = Date.now();
    } catch (err) {
      if (seq !== meSeq) return;
      console.error(err);
      meError = err.message;
      // 1ページ目すら取れなければ、前回取得した1ページ目を代わりに出す
      const cached = page === 1 && meItems.length === 0 ? MyBookmarks.loadCache() : null;
      if (cached) {
        meItems = cached;
        meNextPage = null;
        meLoaded = true;
        meFetchedAt = 0; // 次に開いた時は取り直す
        meOfflineNote = '(取得できないため前回取得分を表示中) ';
      }
    }
    meLoading = false;
    renderMeList();
  }

  // フィルタ(ミュート)と検索欄の絞り込みを適用した表示対象を返す。
  function meVisibleItems() {
    const q = searchQuery;
    let hidden = 0;
    const items = meItems.filter((it) => {
      if (Filters.isHidden({ title: it.title, domain: it.domain, url: it.url, comment: it.comment })) {
        hidden++;
        return false;
      }
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q) ||
        it.domain.toLowerCase().includes(q) ||
        it.comment.toLowerCase().includes(q) ||
        it.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
    return { items, hidden };
  }

  function updateMeStatus(visible) {
    const parts = [];
    // 初回の読み込み中(まだ1件も無い)は件数を出さず「読み込み中…」だけにする。
    if (!visible || (meItems.length === 0 && meLoading)) visible = null;
    if (visible) {
      parts.push(`${visible.items.length} 件を表示中`);
      if (visible.hidden > 0) parts.push(`(フィルタ${visible.hidden}件を非表示)`);
    }
    if (meLoading) parts.push(visible ? '・読み込み中…' : '読み込み中…');
    else if (visible && meLoaded && meNextPage == null) parts.push('・すべて取得済み');
    meStatus.textContent =
      meOfflineNote + parts.join('') + (meError ? `${parts.length ? ' / ' : ''}エラー: ${meError}` : '');
  }

  function renderMeList() {
    disconnectMeObserver();
    const visible = meVisibleItems();
    meList.className = `comment-list me-list${commentLayout === 'rich' ? ' comment-list--rich' : ''}`;
    let html = visible.items.map(renderMeItem).join('');
    if (!html && meLoaded && !meLoading) {
      html = '<li class="empty">ブックマークはありません。</li>';
    }
    if (meNextPage != null) {
      // エラー後は自動で再試行し続けないよう、ボタンで明示的にやり直してもらう。検索中も、
      // ヒットが少ないと全ページを読み込み続けてしまうため自動継ぎ足しはせずボタンにする。
      html +=
        meError || searchQuery
          ? `<li class="me-more"><button type="button" class="btn btn--small me-more-btn">${meError ? '続きを再読み込み' : '続きを読み込む'}</button></li>`
          : '<li id="me-sentinel" class="me-sentinel"></li>';
    }
    meList.innerHTML = html;
    updateMeStatus(visible);

    const sentinel = document.getElementById('me-sentinel');
    if (sentinel) {
      // 描画のたびに新しいsentinelを監視し直すため、追加後も画面内に残っていれば続けて発火する。
      meObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) loadMeNextPage();
        },
        { rootMargin: '600px' }
      );
      meObserver.observe(sentinel);
    }
    ensureMeStars();
  }

  // richの時だけ、コメント付きで未取得のブックマークのスター数を取得して描き直す(plainのままなら通信しない)。
  // スターAPIのURIにははてなidが入るため、Workerに組ませる(ブラウザはeidと日時だけ渡す)。
  // スターは付加情報のため、失敗しても黙って無視して一覧の表示には影響させない。
  async function ensureMeStars() {
    if (commentLayout !== 'rich') return;
    const targets = meItems.filter((it) => it.comment && it.eid && !meStarsRequested.has(it.eid));
    if (targets.length === 0) return;
    const seq = meSeq;
    targets.forEach((it) => meStarsRequested.add(it.eid));
    const counts = await MyBookmarks.fetchStars(targets);
    if (seq !== meSeq || counts.size === 0) return;
    for (const [eid, n] of counts) meStarCounts.set(eid, n);
    if (commentLayout === 'rich' && !meView.hidden) renderMeList();
  }

  function meEntryHref(item) {
    const params = new URLSearchParams();
    params.set('url', item.url);
    params.set('from', 'me');
    return `#/entry?${params.toString()}`;
  }

  function renderMeItem(item) {
    return commentLayout === 'rich' ? renderMeItemRich(item) : renderMeItemPlain(item);
  }

  const MY_CLOSE_BTN = (item) =>
    `<button type="button" class="card-close-btn entry-row-close" data-url="${escapeHtml(item.url)}" title="このページを非表示にする" aria-label="このページを非表示にする">×</button>`;

  function meTagsHtml(item) {
    const tags = item.tags.map((t) => `<span class="comment-tag">${escapeHtml(t)}</span>`).join('');
    return tags ? `<span class="comment-tags">${tags}</span>` : '';
  }

  function meCountLink(item) {
    return `<a class="card-count-link${countTierClass(item.count)}" href="${meEntryHref(item)}">${item.count} users →</a>`;
  }

  function meDomainBtn(item) {
    return `<button type="button" class="card-domain" data-domain="${escapeHtml(item.domain)}" data-url="${escapeHtml(item.url)}">${escapeHtml(item.domain)}</button>`;
  }

  function meDate(item) {
    return escapeHtml(hatenaDateTime(item.created));
  }

  function renderMeItemPlain(item) {
    const comment = item.comment ? ` ${linkifyComment(item.comment)}` : '';
    return `
      <li>
        ${MY_CLOSE_BTN(item)}
        <div class="me-item-body">
          <div><span class="comment-date">${meDate(item)}</span> ${meDomainBtn(item)} <a class="me-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a> ${meCountLink(item)}${comment}${meTagsHtml(item) ? ` ${meTagsHtml(item)}` : ''}</div>
        </div>
      </li>`;
  }

  function meStarBadge(item) {
    const n = meStarCounts.get(item.eid);
    return n ? ` <span class="comment-stars" title="はてなスター">⭐️${n}</span>` : '';
  }

  function renderMeItemRich(item) {
    const thumb = item.image
      ? `<img class="me-thumb" src="${escapeHtml(item.image)}" alt="" loading="lazy" width="64" height="64">`
      : '<span class="me-thumb me-thumb--empty"></span>';
    return `
      <li>
        <div class="me-thumb-wrap">
          ${thumb}
          ${MY_CLOSE_BTN(item)}
        </div>
        <div class="me-item-body">
          <a class="me-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
          <div class="me-meta">
            <span class="comment-date">${meDate(item)}</span>
            ${meDomainBtn(item)}
            ${meCountLink(item)}
            ${meTagsHtml(item)}
          </div>
          ${item.comment ? `<div class="me-comment">${linkifyComment(item.comment)}${meStarBadge(item)}</div>` : ''}
        </div>
      </li>`;
  }

  meList.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.card-close-btn');
    if (closeBtn) {
      Filters.addRule('mute', 'url', closeBtn.dataset.url);
      renderMeList();
      return;
    }
    const domainBtn = e.target.closest('.card-domain');
    if (domainBtn) {
      openSettings(domainMutePreset(domainBtn));
      return;
    }
    if (e.target.closest('.me-more-btn')) {
      meError = '';
      loadMeNextPage();
    }
  });

  // 接続設定(Worker URL・アクセストークン)。値はこの端末のlocalStorageにだけ保存する。
  const myEndpointInput = document.getElementById('my-endpoint-input');
  const myTokenInput = document.getElementById('my-token-input');
  const mySaveBtn = document.getElementById('my-save-btn');
  const myStatus = document.getElementById('my-status');

  // 入力欄の横のリンク。Worker URLが https://<名前>.<サブドメイン>.workers.dev なら、CloudflareダッシュボードのそのWorkerの
  // 画面へ(URLそのものは「unauthorized」が返るだけなので開かない)。`?to=/:account/…` はログイン中のアカウントに
  // 置き換えられるため、アカウントIDをコードに持たずに済む。名前が取れない(未入力・独自ドメイン等)時は
  // Workers & Pagesの一覧へ。はてなのOAuthアプリ画面はWorkerを設定済みの時だけ出す。
  // はてなidはどこにも持たない方針なので、idを含む /<id>/config/auth/develop ではなく、
  // ログイン済みなら自分の画面へ飛ぶ /oauth/develop を使う。
  const CLOUDFLARE_DASH = 'https://dash.cloudflare.com/?to=/:account/workers-and-pages';
  const myWorkerLink = document.getElementById('my-worker-link');
  const myHatenaLink = document.getElementById('my-hatena-link');

  // 入力中のWorker URLを { configured, name } にする。nameは *.workers.dev の先頭ラベル(Worker名)。
  function parseWorkerUrl(value) {
    try {
      const u = new URL(value.trim());
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { configured: false, name: '' }; // javascript: などは弾く
      const m = /^([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev$/i.exec(u.hostname);
      return { configured: true, name: m ? m[1] : '' };
    } catch (e) {
      return { configured: false, name: '' };
    }
  }

  function refreshMyLinks() {
    const { configured, name } = parseWorkerUrl(myEndpointInput.value);
    myWorkerLink.href = name
      ? `https://dash.cloudflare.com/?to=/:account/workers/services/view/${encodeURIComponent(name)}/production`
      : CLOUDFLARE_DASH;
    const label = name ? `CloudflareのWorker「${name}」の画面を開く` : 'CloudflareのWorkers & Pagesを開く';
    myWorkerLink.title = label;
    myWorkerLink.setAttribute('aria-label', label);
    myHatenaLink.hidden = !(configured && myTokenInput.value.trim());
  }
  myEndpointInput.addEventListener('input', refreshMyLinks);
  myTokenInput.addEventListener('input', refreshMyLinks);
  refreshMyLinks();

  function refreshMyBookmarksFields() {
    const cfg = MyBookmarks.getConfig();
    myEndpointInput.value = cfg.endpoint;
    myTokenInput.value = cfg.token;
    refreshMyLinks();
    myStatus.textContent = MyBookmarks.isConfigured() ? '設定済み' : '未設定';
  }

  mySaveBtn.addEventListener('click', async () => {
    MyBookmarks.setConfig({ endpoint: myEndpointInput.value, token: myTokenInput.value });
    resetMeState();
    if (!entryView.hidden) resetBookmarkForm(bookmarkTarget); // 設定を変えた直後も、フォームの出し分けと既存の取得をやり直す
    if (!MyBookmarks.isConfigured()) {
      myStatus.textContent = '未設定';
      return;
    }
    myStatus.textContent = '接続確認中…';
    try {
      const { items } = await MyBookmarks.fetchPage(1);
      myStatus.textContent = `接続できました(1ページ目 ${items.length} 件)`;
      // 一覧のアカウントと、投稿に使うOAuthのアカウントが同じかも確認する(食い違うと別人に投稿される)
      const c = await MyBookmarks.checkConfig();
      const note = !c.oauthConfigured
        ? '投稿用のOAuthはWorkerに未設定です(一覧だけ使えます)'
        : c.accounts === 'same'
          ? '一覧と投稿は同じアカウントです'
          : c.accounts === 'different'
            ? '⚠ 一覧と投稿のアカウントが違います。投稿は中止されます(Workerの設定を確認してください)'
            : '一覧と投稿のアカウントが同じかは確認できませんでした';
      myStatus.textContent += `。${note}`;
    } catch (err) {
      myStatus.textContent = `接続失敗: ${err.message}`;
    }
  });

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

  const settingsModalTop = settingsModal.querySelector('.modal-top');
  const SHORT_VIEWPORT_PX = 500;

  // モーダルをvisualViewport(キーボードを除いた見えている領域)に追従させる
  function syncModalToViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    // 小さい接続設定モーダルも、キーボード表示時に上端がはみ出さないよう同じ位置・高さに追従させる
    if (!mySettingsModal.hidden) {
      mySettingsModal.style.setProperty('--vv-top', `${vv.offsetTop}px`);
      mySettingsModal.style.setProperty('--vv-height', `${vv.height}px`);
    }
    if (settingsModal.hidden) return;
    settingsModal.style.setProperty('--vv-top', `${vv.offsetTop}px`);
    settingsModal.style.setProperty('--vv-height', `${vv.height}px`);
    // キーボードで見える領域が短い時は、固定ヘッダーがスクロール領域を食うため固定を外す(CSS側)。
    settingsModal.classList.toggle('modal--short', vv.height < SHORT_VIEWPORT_PX);
    // フォーカスした入力欄が固定ヘッダーの裏に潜らないよう、その高さをscroll-paddingに使う。
    settingsModal.style.setProperty('--modal-top-h', `${settingsModalTop.offsetHeight}px`);
  }
  // フォーカスした入力欄を、モーダルの見える領域の中央へスクロールする。キーボードの表示アニメーションと
  // visualViewportの更新が終わってからでないと位置が定まらないため、少し待って実行する。
  // scrollIntoViewは背面のページまで動かし得るので使わず、パネル自身のscrollTopだけを動かす。
  const settingsModalPanel = settingsModal.querySelector('.modal-panel');
  let centerTimer = null;
  function centerFocusedField() {
    clearTimeout(centerTimer);
    centerTimer = setTimeout(() => {
      const el = document.activeElement;
      if (settingsModal.hidden || !el || !settingsModalPanel.contains(el) || !el.matches('input, textarea, select')) return;
      if (!settingsModal.classList.contains('modal--short')) return; // キーボードが出ていない時は動かさない
      const p = settingsModalPanel.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const delta = r.top + r.height / 2 - (p.top + p.height / 2);
      // アニメーション(smooth)にしない: キーボードの表示アニメーションと競合して途中で止まり得るため。
      settingsModalPanel.scrollTop = Math.max(0, settingsModalPanel.scrollTop + delta);
    }, 350);
  }
  settingsModal.addEventListener('focusin', centerFocusedField);

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      syncModalToViewport();
      centerFocusedField(); // キーボードが出た/形が変わった時に、入力中の欄を見える位置へ
    });
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
      // 開き直した際に選択が残ってしまわないよう、都度デフォルト(タイトルとブックマークコメント)に戻す。
      ruleTypeSelect.value = 'titlecomment';
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

  // 状態行を書く。トークンの作り直しで直りうるエラーなら、再発行画面へのリンクを末尾に付ける
  function setGistStatus(el, text, lastError) {
    el.textContent = text;
    // トークン未設定の端末(読み取り専用)は作り直す対象が無いので出さない
    if (!Gist.getToken() || !Gist.isTokenError(lastError)) return;
    const a = document.createElement('a');
    a.href = Gist.TOKEN_ISSUE_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = 'トークンを再発行';
    el.append(' / ', a);
  }

  // 同期の状態行(既読・フィルタ共通): 「モード / 最終同期 / エラー: …(再発行リンク)」。
  // error は保存済みのlastErrorに無い今回の失敗(Gist ID未入力など)を出したい時に渡す。
  function renderGistStatus(el, cfg, error, extra) {
    if (!cfg.gistId) {
      setGistStatus(el, error ? `エラー: ${error}` : '未設定', error);
      return;
    }
    const mode = Gist.getToken() ? '読み書き' : '読み取り専用';
    const at = cfg.lastSyncAt ? `最終同期 ${new Date(cfg.lastSyncAt).toLocaleString()}` : '未同期';
    const err = error || cfg.lastError;
    let text = err ? `${mode} / ${at} / エラー: ${err}` : `${mode} / ${at}`;
    if (extra) text += ` / ${extra}`;
    setGistStatus(el, text, err);
  }

  function renderSyncStatus() {
    renderGistStatus(syncStatus, Sync.getConfig());
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
      renderGistStatus(syncStatus, Sync.getConfig(), err.message);
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

  // ブクマ連携の設定(中継Workerの接続)。記事ページ下部のバーの⚙と、「自分のブックマーク」の未設定案内から開く。
  function openMySettings() {
    refreshMyBookmarksFields();
    mySettingsModal.hidden = false;
    syncModalToViewport();
  }
  function closeMySettings() {
    mySettingsModal.hidden = true;
  }
  mySettingsBtn.addEventListener('click', openMySettings);
  mySettingsClose.addEventListener('click', closeMySettings);
  mySettingsModal.addEventListener('click', (e) => {
    if (e.target === mySettingsModal) closeMySettings();
  });

  // 一括既読: 一覧に表示中(検索・フィルタ適用後)の未読/更新ありの記事をすべて既読にする。
  const markAllReadBtn = document.getElementById('mark-all-read-btn');
  markAllReadBtn.addEventListener('click', () => {
    if (listView.hidden || !hasLoadedList) return;
    const targets = currentVisibleEntries.filter((item) => Visited.getReadState(item) !== 'read');
    if (targets.length === 0) {
      window.alert('未読の記事はありません');
      return;
    }
    if (!window.confirm(`表示中の未読${targets.length}件をすべて既読にしますか?`)) return;
    Visited.markManyVisited(targets);
    updateListView(window.scrollY > 0 ? window.scrollY : null);
  });
  settingsClose.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  // ドメイン全体を巻き込むと困るホスト(zenn.dev等)は、記事URLからユーザー単位の
  // 前方一致ルールに絞る。該当しないホストは従来どおりドメインでミュートする。
  function domainMutePreset(btn) {
    const scope = btn.dataset.url ? Filters.scopeRuleForUrl(btn.dataset.url) : null;
    if (scope && scope.type === 'urlprefix') {
      return { kind: 'mute', type: 'urlprefix', value: scope.value };
    }
    return { kind: 'mute', type: 'domain', value: btn.dataset.domain };
  }

  entryGrid.addEventListener('click', (e) => {
    const closeBtn = e.target.closest('.card-close-btn');
    if (closeBtn) {
      Filters.addRule('mute', 'url', closeBtn.dataset.url);
      render();
      return;
    }
    const domainBtn = e.target.closest('.card-domain');
    if (!domainBtn) return;
    openSettings(domainMutePreset(domainBtn));
  });

  entryHeader.addEventListener('click', (e) => {
    const domainBtn = e.target.closest('.card-domain');
    if (!domainBtn) return;
    openSettings(domainMutePreset(domainBtn));
  });

  commentList.addEventListener('click', (e) => {
    const userBtn = e.target.closest('.comment-user');
    if (!userBtn) return;
    openSettings({ kind: 'mute', type: 'user', value: userBtn.dataset.user });
  });

  // ---- 選択文字からのクイックフィルタ ----
  // 一覧・個別記事ページで文字を選択すると、選択範囲の近くにポップアップを出し、
  // 選んだ対象(タイトルとコメント/タイトル/コメント/URL)でミュートに直接登録する。
  const selectionPopup = document.createElement('div');
  selectionPopup.id = 'selection-popup';
  selectionPopup.hidden = true;
  selectionPopup.innerHTML = [
    ['titlecomment', 'タイトルとコメント'],
    ['title', 'タイトル'],
    ['comment', 'コメント'],
    ['url', 'URL'],
  ]
    .map(([t, label]) => `<button type="button" class="btn btn--small" data-type="${t}">${label}</button>`)
    .join('');
  document.body.appendChild(selectionPopup);
  let selectionText = '';
  let selectionTimer = null;

  function hideSelectionPopup() {
    selectionPopup.hidden = true;
    selectionText = '';
  }

  function updateSelectionPopup() {
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!sel || sel.rangeCount === 0 || !text || isModalOpen()) {
      hideSelectionPopup();
      return;
    }
    const range = sel.getRangeAt(0);
    const node = range.commonAncestorContainer;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || selectionPopup.contains(el) || el.closest('input, textarea, select')) {
      if (!el || !selectionPopup.contains(el)) hideSelectionPopup();
      return;
    }
    const inView = (v) => !v.hidden && v.contains(el);
    if (!inView(listView) && !inView(entryView) && !inView(meView)) {
      hideSelectionPopup();
      return;
    }
    selectionText = text;
    const rects = range.getClientRects();
    const last = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
    selectionPopup.hidden = false;
    const w = selectionPopup.offsetWidth;
    const h = selectionPopup.offsetHeight;
    const margin = 8;
    let x = last.right - w / 2;
    let y = last.bottom + margin;
    if (y + h > window.innerHeight - margin) y = Math.max(margin, last.top - h - margin);
    x = Math.min(Math.max(margin, x), window.innerWidth - w - margin);
    selectionPopup.style.left = `${x}px`;
    selectionPopup.style.top = `${y}px`;
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    // ドラッグ中・ハンドル操作中は選択が確定するまで待つ
    selectionTimer = setTimeout(updateSelectionPopup, 300);
  });
  // ボタン押下でテキスト選択が外れないようにする
  selectionPopup.addEventListener('mousedown', (e) => e.preventDefault());
  window.addEventListener('scroll', hideSelectionPopup, { passive: true });

  selectionPopup.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-type]');
    if (!btn || !selectionText) return;
    const value = selectionText;
    const types = btn.dataset.type === 'titlecomment' ? ['title', 'comment'] : [btn.dataset.type];
    for (const t of types) Filters.addRule('mute', t, value);
    window.getSelection().removeAllRanges();
    hideSelectionPopup();
    if (!listView.hidden) {
      render();
    } else if (!meView.hidden) {
      renderMeList();
    } else {
      // 個別記事ページ: 保持済みのコメントにも即時反映する(再取得はしない)
      const before = entryVisibleComments.length;
      entryVisibleComments = entryVisibleComments.filter(
        (b) => !Filters.isHidden({ title: '', domain: '', user: b.user, comment: b.comment })
      );
      entryHiddenByFilterCount += before - entryVisibleComments.length;
      applyEntrySearchAndRender();
    }
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
    // 「タイトルとブックマークコメント」はUI上の擬似種別で、実体はtitleとcommentの2ルール
    const types = type === 'titlecomment' ? ['title', 'comment'] : [type];
    for (const t of types) Filters.addRule(currentSettingsKind, t, value);
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

  // extra: 直前の同期結果など、状態行に続けて出す補足 / error: 保存されていない今回の失敗
  function renderFilterSyncStatus(extra, error) {
    renderGistStatus(filterSyncStatus, FilterSync.getConfig(), error, extra);
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
      renderFilterSyncStatus(undefined, err.message);
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
      // 状態行のトークン再発行リンクも含め、子ノードごとメインタブへ写す
      quickSyncStatus.textContent = `${label}: `;
      statusEl.childNodes.forEach((n) => quickSyncStatus.append(n.cloneNode(true)));
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

    // 表示は「アプリの版」(codeVersion=アプリ本体を最後に変更したコミットとその日時)。
    // 不具合報告でこの値だけでコードの版が特定できるようにするため、データ更新だけの
    // デプロイで変わるsha(デプロイ元コミット)は表示しない。
    const buildText = window.BUILD_INFO ? `${window.BUILD_INFO.codeVersion} (${window.BUILD_INFO.time})` : '';
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

  // 機内モードはnavigator.onLineで分かるが、電波が弱いだけの時はonLineが真のまま取得に失敗する。
  // 記事の取得がキャッシュ頼みになった/失敗した時点で「実質オフライン」とみなし、取得に
  // 成功するか、onlineイベントが来るまで続ける。
  let entryFetchUnstable = false;

  function isOfflineMode() {
    return !navigator.onLine || entryFetchUnstable;
  }

  function setEntryFetchUnstable(value, url) {
    if (entryFetchUnstable === value) return;
    entryFetchUnstable = value;
    if (!entryView.hidden) updateEntryNavButtons(url);
  }

  // その場でフィルタに登録した記事はcurrentVisibleEntries自体からは即座に
  // 取り除かれないため、移動先を探す際は都度Filters.isHiddenで生きた判定をし、
  // 該当すればスルーして次(前)を見る。既読かつ更新なしの記事も同様に飛ばす。
  // オフライン時は逆に、既読の読み飛ばしをやめて、コメントをキャッシュ済みの記事だけを
  // 辿る(読み飛ばすと事前キャッシュした記事を大きく飛び越え、未取得の記事ばかりに当たるため)。
  function findRelativeEntryIndex(currentUrl, delta) {
    if (!currentUrl || currentVisibleEntries.length === 0) return -1;
    ensureEntryNavSnapshot();
    const index = currentVisibleEntries.findIndex((item) => item.url === currentUrl);
    if (index === -1) return -1;
    const cachedUrls = isOfflineMode() ? HatenaAPI.getCachedEntryUrlSet() : null;
    const isSkipped = (item) =>
      Filters.isHidden(item) || (cachedUrls ? !cachedUrls.has(item.url) : isSkippedByReadState(item));
    let nextIndex = index + delta;
    while (nextIndex >= 0 && nextIndex < currentVisibleEntries.length && isSkipped(currentVisibleEntries[nextIndex])) {
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
    // 前後移動の仕様が通常と違うことを、理由つきで案内する。
    if (isOfflineMode()) {
      entryNavNote.textContent = `${navigator.onLine ? '電波が弱いため' : 'オフラインのため'}、コメント取得済みの記事だけを前後に移動します(既読の読み飛ばしなし)`;
      entryNavNote.hidden = false;
    } else {
      entryNavNote.hidden = true;
    }
  }

  // 機内モードの切り替えで移動先の決め方が変わるため、ボタンの有効/無効を更新し直す。
  const refreshEntryNavOnConnectivityChange = () => {
    if (entryView.hidden) return;
    updateEntryNavButtons(parseRoute().params.get('url'));
  };
  window.addEventListener('online', () => {
    entryFetchUnstable = false;
    refreshEntryNavOnConnectivityChange();
  });
  window.addEventListener('offline', refreshEntryNavOnConnectivityChange);

  entryPrevBtn.addEventListener('click', () => goToRelativeEntry(-1));
  entryNextBtn.addEventListener('click', () => goToRelativeEntry(1));

  // 記事ページも一覧と同じ向き: 左スワイプで次の記事、右スワイプで前の記事。
  // 端の記事では何もしない(goToRelativeEntryがfalseを返す)。
  function swipeEntry(deltaX) {
    goToRelativeEntry(deltaX < 0 ? 1 : -1);
  }

  // リスナーはセクション要素ではなくdocumentに付ける。セクションは中身の高さしか
  // 持たないため、記事が少ない/読み込み中などで画面下部やmainの余白がスワイプ不能になっていた。
  addSwipeListener(document, (deltaX) => {
    if (isModalOpen()) return;
    if (!listView.hidden) swipeCategory(deltaX);
    else if (!entryView.hidden) swipeEntry(deltaX);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (isTypingTarget(document.activeElement)) return;
    if (isModalOpen()) return;

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
  // 記事ページは既読の判定が取り込み結果に依存するため、従来どおり最初の描画前に
  // 取り込む(待つのは最大でタイムアウトまで)。一覧ページは待たずに先に描画し、
  // 取り込みでフィルタが変わった時だけ表示中の一覧を絞り直す。
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
    if (ts < autoScrollPausedUntil || isModalOpen()) return;
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
  const startupSync = Promise.all([
    FilterSync.syncOnStartup(STARTUP_IMPORT_TIMEOUT_MS),
    Sync.syncOnStartup(STARTUP_IMPORT_TIMEOUT_MS),
  ]);
  if (parseRoute().path === '/entry') {
    startupSync.then(render);
  } else if (parseRoute().path === '/me') {
    // 取得済みを描き直すだけ(再取得はしない)。起動時同期でフィルタが変わった分を反映する。
    render();
    startupSync.then(() => {
      if (!meView.hidden && meLoaded) renderMeList();
    });
  } else {
    render();
    startupSync.then(() => {
      if (!hasLoadedList || listView.hidden) return;
      const visibleCount = loadedRawEntries.filter((item) => !Filters.isHidden(item)).length;
      if (visibleCount !== baseEntries.length) {
        const scrollY = window.scrollY;
        applyLoadedEntries(loadedRawEntries);
        updateListView(scrollY > 0 ? scrollY : null);
      }
    });
  }
})();
