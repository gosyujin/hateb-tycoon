(function () {
  const listView = document.getElementById('view-list');
  const entryView = document.getElementById('view-entry');
  const categoryTabs = document.getElementById('category-tabs');
  const entryGrid = document.getElementById('entry-grid');
  const listStatus = document.getElementById('list-status');
  const refreshBtn = document.getElementById('refresh-btn');

  const entryBack = document.getElementById('entry-back');
  const entryHeader = document.getElementById('entry-header');
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

  let currentCategory = 'all';
  let currentSettingsKind = 'mute';

  const PAGE_SIZE = 20;
  let currentVisibleEntries = [];
  let renderedCount = 0;
  let scrollObserver = null;

  const KIND_LABEL = {
    mute: 'ミュートワード(該当したら非表示)',
    unmute: 'ミュート解除ワード(ミュートワードの例外として表示)',
    forceMute: '強制ミュートワード(ミュート解除ワードでも解除不可で非表示)',
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
      entryView.hidden = true;
      listView.hidden = false;
      currentCategory = params.get('cat') || 'all';
      renderCategoryTabs();
      renderListView();
    }
  }

  // ---- 一覧ビュー ----
  function renderCategoryTabs() {
    categoryTabs.innerHTML = HatenaAPI.CATEGORIES.map((c) => {
      const active = c.key === currentCategory ? ' active' : '';
      return `<button class="tab${active}" data-cat="${c.key}">${escapeHtml(c.label)}</button>`;
    }).join('');
  }

  categoryTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-cat]');
    if (!btn) return;
    const params = new URLSearchParams();
    params.set('cat', btn.dataset.cat);
    navigate('/', params);
  });

  refreshBtn.addEventListener('click', () => renderListView());

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
    const html = nextItems.map(renderEntryCard).join('');
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

  async function renderListView() {
    disconnectScrollObserver();
    entryGrid.innerHTML = '';
    currentVisibleEntries = [];
    renderedCount = 0;
    listStatus.textContent = '読み込み中…';
    try {
      const entries = await HatenaAPI.getHotEntries(currentCategory);
      const visible = entries.filter((item) => !Filters.isHidden(item));
      const hiddenCount = entries.length - visible.length;

      if (visible.length === 0) {
        listStatus.textContent =
          hiddenCount > 0
            ? `表示できる記事がありません(フィルタにより ${hiddenCount} 件を非表示にしました)`
            : '記事を取得できませんでした。';
        return;
      }

      listStatus.textContent =
        hiddenCount > 0 ? `${visible.length} 件を表示中(${hiddenCount} 件を非表示)` : `${visible.length} 件を表示中`;

      currentVisibleEntries = visible;
      renderNextPage();
      setupScrollObserver();
    } catch (err) {
      console.error(err);
      listStatus.textContent = `取得に失敗しました: ${err.message}`;
    }
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
      : '';
    return `
      <article class="card">
        ${thumb}
        <div class="card-body">
          <a class="card-title" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(item.title)}</a>
          <div class="card-meta">
            <span class="card-domain">${escapeHtml(item.domain)}</span>
            <span class="card-count">${item.count} users</span>
          </div>
          ${firstSeen}
          <a class="card-comments-link" href="${href}">ブックマークコメントを見る →</a>
        </div>
      </article>`;
  }

  // ---- 個別エントリー(コメント一覧)ビュー ----
  entryBack.addEventListener('click', () => history.back());

  async function renderEntryView(url) {
    commentList.innerHTML = '';
    entryHeader.innerHTML = '';
    if (!url) {
      entryStatus.textContent = 'URLが指定されていません。';
      return;
    }
    entryStatus.textContent = '読み込み中…';
    try {
      const info = await HatenaAPI.getEntryInfo(url);

      if (Filters.isHidden({ title: info.title, domain: info.domain })) {
        entryStatus.textContent = 'このエントリーはフィルタ条件により非表示になっています。';
        return;
      }

      entryHeader.innerHTML = `
        <a class="entry-title" href="${escapeHtml(info.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(info.title)}</a>
        <div class="entry-meta">
          <span>${escapeHtml(info.domain)}</span>
          <span>${info.count} users</span>
          ${info.entryUrl ? `<a href="${escapeHtml(info.entryUrl)}" target="_blank" rel="noopener noreferrer">はてなブックマークページ →</a>` : ''}
        </div>`;

      const visible = info.bookmarks.filter(
        (b) => !Filters.isHidden({ title: info.title, domain: info.domain, user: b.user, comment: b.comment })
      );
      const hiddenCount = info.bookmarks.length - visible.length;

      entryStatus.textContent =
        hiddenCount > 0
          ? `${visible.length} 件のブックマークを表示中(${hiddenCount} 件を非表示)`
          : `${visible.length} 件のブックマークを表示中`;

      commentList.innerHTML = visible.map(renderComment).join('') || '<p class="empty">コメント付きのブックマークはありません。</p>';
    } catch (err) {
      console.error(err);
      entryStatus.textContent = `取得に失敗しました: ${err.message}`;
    }
  }

  function renderComment(b) {
    const tags = b.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('');
    return `
      <li class="comment-item">
        <a class="comment-user" href="https://b.hatena.ne.jp/${encodeURIComponent(b.user)}/" target="_blank" rel="noopener noreferrer">${escapeHtml(b.user)}</a>
        ${b.comment ? `<p class="comment-text">${escapeHtml(b.comment)}</p>` : '<p class="comment-text comment-text--empty">(コメントなし)</p>'}
        <div class="comment-footer">
          ${tags}
          <span class="comment-timestamp">${escapeHtml(b.timestamp)}</span>
        </div>
      </li>`;
  }

  // ---- フィルタ設定モーダル ----
  function openSettings() {
    settingsModal.hidden = false;
    renderSettingsTabs();
    renderRuleList();
  }
  function closeSettings() {
    settingsModal.hidden = true;
  }
  settingsBtn.addEventListener('click', openSettings);
  settingsClose.addEventListener('click', closeSettings);
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) closeSettings();
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

  // ---- ビルド情報(デバッグ用) ----
  function renderBuildInfo() {
    const el = document.getElementById('build-info');
    if (!el || !window.BUILD_INFO) return;
    el.textContent = `build: ${window.BUILD_INFO.sha} (${window.BUILD_INFO.time})`;
  }

  async function renderDataMeta() {
    const el = document.getElementById('data-meta');
    if (!el) return;
    try {
      const res = await fetch('data/meta.json', { cache: 'no-store' });
      if (!res.ok) return;
      const meta = await res.json();
      el.textContent = `データ取得: ${meta.fetchedAt}時点 / 次回更新目安: ${meta.nextEstimate}頃`;
    } catch (e) {
      // メタ情報が無くても一覧表示自体は継続できるため、フッター欄は空のままにする
    }
  }

  // ---- 初期化 ----
  renderBuildInfo();
  renderDataMeta();
  render();
})();
