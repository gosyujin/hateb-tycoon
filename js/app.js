(function () {
  const listView = document.getElementById('view-list');
  const entryView = document.getElementById('view-entry');
  const categoryTabs = document.getElementById('category-tabs');
  const entryGrid = document.getElementById('entry-grid');
  const listStatus = document.getElementById('list-status');
  const sortSelect = document.getElementById('sort-select');
  const hideVisitedCheckbox = document.getElementById('hide-visited-checkbox');

  const entryBack = document.getElementById('entry-back');
  const entryBackBottom = document.getElementById('entry-back-bottom');
  const entryHeader = document.getElementById('entry-header');
  const entryDescription = document.getElementById('entry-description');
  const commentList = document.getElementById('comment-list');
  const entryStatus = document.getElementById('entry-status');

  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-close');
  const settingsTabs = document.getElementById('settings-tabs');
  const settingsForm = document.getElementById('settings-form');
  const ruleTypeSelect = document.getElementById('rule-type');
  const ruleValueInput = document.getElementById('rule-value');
  const ruleList = document.getElementById('rule-list');
  const exportBtn = document.getElementById('export-btn');
  const importFileInput = document.getElementById('import-file-input');
  const importUrlForm = document.getElementById('import-url-form');
  const importUrlInput = document.getElementById('import-url-input');
  const importStatus = document.getElementById('import-status');
  const visitedThresholdValueInput = document.getElementById('visited-threshold-value');
  const visitedThresholdTypeSelect = document.getElementById('visited-threshold-type');

  let currentCategory = 'all';
  let currentSettingsKind = 'mute';

  const PAGE_SIZE = 20;
  let baseEntries = []; // フィルタ適用後、取り込み順(APIの返却順)のまま保持する基準データ
  let hiddenByFilterCount = 0;
  let hasLoadedList = false;
  let currentVisibleEntries = [];
  let renderedCount = 0;
  let scrollObserver = null;
  let currentSortMode = 'acquired';
  let hideVisited = false; // デフォルトは非表示にしない(チェックなし)

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
  };

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
  function parseImportCsv(text) {
    const rows = parseCsv(text);
    if (rows.length === 0) return { rules: [], errors: ['データが空です'] };

    let dataRows = rows;
    if ((dataRows[0][0] || '').trim().toLowerCase() === 'type') {
      dataRows = dataRows.slice(1);
    }
    if (dataRows.length === 0) return { rules: [], errors: ['データが空です'] };

    const errors = [];
    const rules = [];
    dataRows.forEach((cols, idx) => {
      const lineNo = idx + 1;
      if (cols.length < 2) {
        errors.push(`${lineNo}行目: 列数が不正です(type,valueの2列が必要)`);
        return;
      }
      const type = (cols[0] || '').trim();
      const value = (cols[1] || '').trim();
      if (!Filters.TYPES.includes(type)) {
        errors.push(`${lineNo}行目: 不正な形式「${type}」(title/domain/user/commentのいずれか)`);
        return;
      }
      if (!value) {
        errors.push(`${lineNo}行目: 値が空です`);
        return;
      }
      rules.push({ type, value });
    });
    return { rules: errors.length > 0 ? [] : rules, errors };
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

  function render() {
    const { path, params } = parseRoute();
    if (path === '/entry') {
      listView.hidden = true;
      entryView.hidden = false;
      const url = params.get('url');
      renderEntryView(url);
    } else {
      const newCategory = params.get('cat') || 'all';
      // 同じカテゴリーのまま戻ってきた(=コメントページから「一覧に戻る」)場合のみ、
      // 離れる直前のスクロール位置を復元する。カテゴリーを切り替えた場合は復元しない。
      const restoreScrollY = newCategory === currentCategory && pendingScrollY !== null ? pendingScrollY : null;
      entryView.hidden = true;
      listView.hidden = false;
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
      entryGrid.insertAdjacentHTML('beforeend', html);
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
    entryGrid.insertAdjacentHTML('beforeend', html);
    renderedCount = currentVisibleEntries.length;
  }

  function setupScrollObserver() {
    disconnectScrollObserver();
    if (renderedCount >= currentVisibleEntries.length) return;
    const sentinel = document.createElement('div');
    sentinel.id = 'scroll-sentinel';
    entryGrid.appendChild(sentinel);
    scrollObserver = new IntersectionObserver(
      (observerEntries) => {
        if (observerEntries.some((e) => e.isIntersecting)) {
          renderNextPage();
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
    try {
      const entries = await HatenaAPI.getHotEntries(currentCategory);
      const visible = entries.filter((item) => !Filters.isHidden(item));
      hiddenByFilterCount = entries.length - visible.length;
      baseEntries = visible;
      hasLoadedList = true;
      updateListView(restoreScrollY);
    } catch (err) {
      console.error(err);
      listStatus.textContent = `取得に失敗しました: ${err.message}`;
    }
  }

  // 並び順・既読フィルタの切り替え時、再取得はせずbaseEntriesから再構築する。
  // restoreScrollYを渡した場合は全件を一度に描画してから指定位置へスクロールする。
  function updateListView(restoreScrollY) {
    if (!hasLoadedList) return;
    disconnectScrollObserver();
    entryGrid.innerHTML = '';
    renderedCount = 0;

    let working = baseEntries;
    let hiddenByVisitedCount = 0;
    if (hideVisited) {
      const filtered = working.filter((item) => !Visited.isStillRead(item));
      hiddenByVisitedCount = working.length - filtered.length;
      working = filtered;
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
    if (count >= 500) return ' card-count-link--tier4';
    if (count >= 300) return ' card-count-link--tier3';
    if (count >= 100) return ' card-count-link--tier2';
    if (count >= 50) return ' card-count-link--tier1';
    return '';
  }

  function renderEntryCard(item) {
    const params = new URLSearchParams();
    params.set('url', item.url);
    const href = `#/entry?${params.toString()}`;
    const thumb = item.screenshot
      ? `<img class="card-thumb" src="${escapeHtml(item.screenshot)}" alt="" loading="lazy">`
      : `<div class="card-thumb card-thumb--empty"></div>`;
    const firstSeen = item.firstSeenAt
      ? `<span class="card-first-seen">初出 ${escapeHtml(item.firstSeenAt.slice(0, 10))}</span>`
      : '<span></span>';
    const visitedClass = Visited.isStillRead(item) ? ' card--visited' : '';
    // 既読グレーアウト(grayscale+brightness)はカード全体にかかるため、色や太さだけの
    // 違いは既読カード上でほぼ判別できなくなる。そのため「N users →」全体に取り消し線を
    // 引いて、グレースケール化されても形状で読み取れる違いにする。
    const noComment = Visited.hasNoComments(item.url);
    const noCommentClass = noComment ? ' card-count-link--no-comment' : '';
    const countTitle = noComment ? ' title="前回訪問時、コメント付きブックマークがありませんでした"' : '';
    return `
      <article class="card${visitedClass}">
        ${thumb}
        <div class="card-body">
          <div class="card-top-row">
            ${firstSeen}
            <a class="card-count-link${countTierClass(item.count)}${noCommentClass}" href="${href}"${countTitle}>${item.count} users →</a>
          </div>
          <button type="button" class="card-domain" data-domain="${escapeHtml(item.domain)}">${escapeHtml(item.domain)}</button>
          <a class="card-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
        </div>
      </article>`;
  }

  // ---- 個別エントリー(コメント一覧)ビュー ----
  entryBack.addEventListener('click', () => history.back());
  entryBackBottom.addEventListener('click', () => history.back());

  async function renderEntryView(url) {
    commentList.innerHTML = '';
    entryHeader.innerHTML = '';
    entryDescription.textContent = '';
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
    entryStatus.textContent = '読み込み中…';
    try {
      const info = await HatenaAPI.getEntryInfo(url);

      if (Filters.isHidden({ title: info.title, domain: info.domain })) {
        entryDescription.textContent = '';
        entryStatus.textContent = 'このエントリーはフィルタ条件により非表示になっています。';
        return;
      }

      const commented = info.bookmarks.filter((b) => b.comment);
      Visited.markVisited(url, info.count, commented.length > 0);

      entryHeader.innerHTML = `
        <a class="entry-title" href="${escapeHtml(info.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.title)}</a>
        <div class="entry-meta">
          <span>${escapeHtml(info.domain)}</span>
          <span>${info.count} users</span>
          ${info.entryUrl ? `<a href="${escapeHtml(info.entryUrl)}" target="_blank" rel="noopener noreferrer">はてなブックマークページ →</a>` : ''}
        </div>`;

      const visible = commented.filter(
        (b) => !Filters.isHidden({ title: info.title, domain: info.domain, user: b.user, comment: b.comment })
      );
      const hiddenCount = commented.length - visible.length;

      entryStatus.textContent =
        hiddenCount > 0
          ? `${visible.length} 件のコメントを表示中(${hiddenCount} 件を非表示)`
          : `${visible.length} 件のコメントを表示中`;

      commentList.innerHTML = visible.map(renderComment).join('') || '<p class="empty">コメントはありません。</p>';
    } catch (err) {
      console.error(err);
      entryStatus.textContent = `取得に失敗しました: ${err.message}`;
    }
  }

  function renderComment(b) {
    const date = (b.timestamp || '').split(' ')[0];
    const user = `<button type="button" class="comment-user" data-user="${escapeHtml(b.user)}">${escapeHtml(b.user)}</button>`;
    return `<li>${user} <span class="comment-date">${escapeHtml(date)}</span> ${escapeHtml(b.comment)}</li>`;
  }

  // ---- フィルタ設定モーダル ----
  function openSettings(preset) {
    if (preset) currentSettingsKind = preset.kind;
    settingsModal.hidden = false;
    renderSettingsTabs();
    renderRuleList();
    refreshImportUrlField();
    refreshVisitedThresholdFields();
    if (preset) {
      ruleTypeSelect.value = preset.type;
      ruleValueInput.value = preset.value;
      ruleValueInput.focus();
    }
  }

  // ---- 既読の再表示閾値 ----
  function refreshVisitedThresholdFields() {
    const threshold = Visited.loadThreshold();
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
  function closeSettings() {
    settingsModal.hidden = true;
  }
  settingsBtn.addEventListener('click', () => openSettings());
  settingsClose.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
  });

  entryGrid.addEventListener('click', (e) => {
    const domainBtn = e.target.closest('.card-domain');
    if (!domainBtn) return;
    openSettings({ kind: 'mute', type: 'domain', value: domainBtn.dataset.domain });
  });

  commentList.addEventListener('click', (e) => {
    const userBtn = e.target.closest('.comment-user');
    if (!userBtn) return;
    openSettings({ kind: 'mute', type: 'user', value: userBtn.dataset.user });
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
    refreshImportUrlField();
  });

  function renderRuleList() {
    const rules = Filters.loadRules(currentSettingsKind);
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
  const IMPORT_URL_PREFIX = 'hateb-tycoon:importUrl:';

  function getImportUrl(kind) {
    try {
      return localStorage.getItem(IMPORT_URL_PREFIX + kind) || '';
    } catch (e) {
      return '';
    }
  }

  function setImportUrl(kind, url) {
    try {
      localStorage.setItem(IMPORT_URL_PREFIX + kind, url);
    } catch (e) {
      // localStorageが使えない環境では記憶をあきらめる
    }
  }

  function refreshImportUrlField() {
    importUrlInput.value = getImportUrl(currentSettingsKind);
    importStatus.textContent = '';
  }

  function applyImportedCsv(text) {
    const { rules, errors } = parseImportCsv(text);
    if (errors.length > 0) {
      const shown = errors.slice(0, 5).join(' / ');
      const rest = errors.length > 5 ? ` 他${errors.length - 5}件` : '';
      importStatus.textContent = `インポート失敗: ${shown}${rest}`;
      return;
    }
    const added = Filters.importRules(currentSettingsKind, rules);
    const skipped = rules.length - added;
    importStatus.textContent =
      skipped > 0
        ? `${rules.length}件中${added}件を追加しました(重複${skipped}件はスキップ)`
        : `${added}件を追加しました`;
    renderRuleList();
    render();
  }

  exportBtn.addEventListener('click', () => {
    const csv = rulesToCsv(Filters.sortRules(Filters.loadRules(currentSettingsKind)));
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentSettingsKind}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

  importUrlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = importUrlInput.value.trim();
    if (!url) return;
    setImportUrl(currentSettingsKind, url);
    importStatus.textContent = '取得中…';
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        importStatus.textContent = `取得に失敗しました(HTTP ${res.status})`;
        return;
      }
      const text = await res.text();
      applyImportedCsv(text);
    } catch (err) {
      importStatus.textContent = `取得に失敗しました: ${err.message}`;
    }
  });

  // ---- ビルド情報 + 次回データ更新目安(1行にまとめる) ----
  async function renderFooter() {
    const el = document.getElementById('next-update-info');
    if (!el) return;

    let text = window.BUILD_INFO ? `${window.BUILD_INFO.sha} (${window.BUILD_INFO.time})` : '';

    try {
      const res = await fetch('data/meta.json', { cache: 'no-store' });
      if (res.ok) {
        const meta = await res.json();
        text += (text ? ' / ' : '') + `次回更新: ${meta.nextEstimate}頃`;
      }
    } catch (e) {
      // メタ情報が無くても一覧表示自体は継続できるため、無視する
    }

    el.textContent = text;
  }

  // ---- 初期化 ----
  renderFooter();
  render();
})();
