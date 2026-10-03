/**
 * localStorage に保存するフィルタルール(mute / unmute / forceMute)の管理と、
 * ブックマーク項目に対するマッチング判定を行うモジュール。
 *
 * ルールは { id, type, value } の配列。
 *   type: 'title' | 'domain' | 'user' | 'comment' | 'url' | 'urlprefix'
 *   value: 部分一致(大文字小文字を区別しない)させる文字列。ただしurlのみ完全一致
 *   (このページ単独を消す用途のため、部分一致だと他ページを巻き込む恐れがある)
 *   urlprefixは前方一致(ブログ単位・ユーザー単位でまとめて消す用途。末尾は'/'で終える)
 *
 * 判定ロジック:
 *   1. forceMute に一致 -> 強制的に非表示 (unmute でも解除不可)
 *   2. mute に一致し、unmute に一致しない -> 非表示
 *   3. それ以外 -> 表示
 */
(function (global) {
  const STORAGE_KEYS = {
    mute: 'hateb-tycoon:mute',
    unmute: 'hateb-tycoon:unmute',
    forceMute: 'hateb-tycoon:forceMute',
  };

  const KINDS = Object.keys(STORAGE_KEYS);
  const TYPES = ['title', 'domain', 'user', 'comment', 'url', 'urlprefix'];

  function assertKind(kind) {
    if (!KINDS.includes(kind)) {
      throw new Error(`unknown rule kind: ${kind}`);
    }
  }

  function loadRules(kind) {
    assertKind(kind);
    try {
      const raw = localStorage.getItem(STORAGE_KEYS[kind]);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('[filters] failed to load rules', kind, e);
      return [];
    }
  }

  function saveRules(kind, rules) {
    assertKind(kind);
    localStorage.setItem(STORAGE_KEYS[kind], JSON.stringify(rules));
  }

  function makeId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  // type asc, value asc でソートする(登録・インポート・エクスポートの各タイミングで適用)。
  function sortRules(rules) {
    return rules.slice().sort((a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value));
  }

  // 重複判定キー(type + valueの大文字小文字を無視した一致)
  function ruleKey(r) {
    return `${r.type}:${(r.value || '').trim().toLowerCase()}`;
  }

  // 重複を除いた配列を返す(先に出たものを残す)
  function uniqueRules(rules) {
    const seen = new Set();
    return rules.filter((r) => {
      const key = ruleKey(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // 保存済みルールから重複を取り除く。過去に重複登録されたデータの掃除用。
  function dedupeRules(kind) {
    assertKind(kind);
    const rules = loadRules(kind);
    const unique = uniqueRules(rules);
    if (unique.length !== rules.length) saveRules(kind, unique);
    return unique;
  }

  function addRule(kind, type, value) {
    assertKind(kind);
    if (!TYPES.includes(type)) throw new Error(`unknown rule type: ${type}`);
    const trimmed = value.trim();
    if (!trimmed) return loadRules(kind);
    const rules = loadRules(kind);
    if (rules.some((r) => ruleKey(r) === ruleKey({ type, value: trimmed }))) return rules;
    rules.push({ id: makeId(), type, value: trimmed });
    const sorted = sortRules(rules);
    saveRules(kind, sorted);
    return sorted;
  }

  function removeRule(kind, id) {
    assertKind(kind);
    const rules = loadRules(kind).filter((r) => r.id !== id);
    saveRules(kind, rules);
    return rules;
  }

  // 既存ルールとの重複(type + valueの大文字小文字を無視した一致)を避けて追加する。
  // 戻り値は実際に追加された件数。
  function importRules(kind, newRules) {
    assertKind(kind);
    const rules = loadRules(kind);
    const existingKeys = new Set(rules.map((r) => `${r.type}:${r.value.toLowerCase()}`));
    let added = 0;
    for (const r of newRules) {
      if (!TYPES.includes(r.type)) continue;
      const trimmed = (r.value || '').trim();
      if (!trimmed) continue;
      const key = `${r.type}:${trimmed.toLowerCase()}`;
      if (existingKeys.has(key)) continue;
      rules.push({ id: makeId(), type: r.type, value: trimmed });
      existingKeys.add(key);
      added++;
    }
    saveRules(kind, sortRules(rules));
    return added;
  }

  function matchRule(rule, item) {
    const needle = (rule.value || '').trim().toLowerCase();
    if (!needle) return false;
    switch (rule.type) {
      case 'title':
        return !!item.title && item.title.toLowerCase().includes(needle);
      case 'domain':
        return !!item.domain && item.domain.toLowerCase().includes(needle);
      case 'user': {
        if (item.user && item.user.toLowerCase().includes(needle)) return true;
        if (Array.isArray(item.users)) {
          return item.users.some((u) => (u || '').toLowerCase().includes(needle));
        }
        return false;
      }
      case 'comment':
        return !!item.comment && item.comment.toLowerCase().includes(needle);
      case 'url':
        return !!item.url && item.url.toLowerCase() === needle;
      case 'urlprefix':
        return !!item.url && item.url.toLowerCase().startsWith(needle);
      default:
        return false;
    }
  }

  // 「コメント一覧は非表示」設定はブログ/ユーザー単位でかかるため、同じ範囲をまとめて
  // 登録できるよう、URLから登録すべきルールを決める。ホスト全体を巻き込むと別ユーザーまで
  // 消えてしまうため、ユーザー単位だと分かっているホストだけ範囲を広げ、それ以外は
  // 従来どおりその記事単独(url)にとどめる(許可リスト方式)。
  const DEFAULT_SUBDOMAIN_PER_USER_SUFFIXES = [
    'hatenablog.com',
    'hatenablog.jp',
    'hatenablog.org',
    'hateblo.jp',
    'hatenadiary.com',
    'hatenadiary.jp',
  ];
  const DEFAULT_PATH_USER_HOSTS = ['zenn.dev'];

  // 上の初期値に加えて、Gistの tycoon-scope-hosts.csv(mode,host)から取り込んだホストを使う。
  // 取り込み結果はlocalStorageにキャッシュし、scopeRuleForUrlは同期関数のままキャッシュを読む。
  const SCOPE_HOSTS_KEY = 'hateb-tycoon:scopeHosts';
  const SCOPE_MODES = ['path', 'subdomain'];

  function loadExtraScopeHosts() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SCOPE_HOSTS_KEY) || '{}');
      const pick = (v) => (Array.isArray(v) ? v.filter((h) => typeof h === 'string' && h) : []);
      return { path: pick(parsed.path), subdomain: pick(parsed.subdomain) };
    } catch (e) {
      return { path: [], subdomain: [] };
    }
  }

  // CSV本文(mode,host)を解析してキャッシュする。不正な行は無視して取り込めた行だけ使う。
  // 空/ヘッダーのみの場合は追加ホスト無し(キャッシュを空にする)。
  function importScopeHosts(text) {
    const next = { path: [], subdomain: [] };
    for (const line of String(text || '').replace(/\r\n/g, '\n').split('\n')) {
      const [mode, host] = line.split(',').map((v) => (v || '').trim().toLowerCase());
      if (!SCOPE_MODES.includes(mode) || !host || host.includes('/')) continue;
      if (!next[mode].includes(host)) next[mode].push(host);
    }
    try {
      localStorage.setItem(SCOPE_HOSTS_KEY, JSON.stringify(next));
    } catch (e) {
      // localStorageが使えない環境では初期値のみで動く
    }
    return next.path.length + next.subdomain.length;
  }

  function scopeRuleForUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return { type: 'url', value: url };
    }
    const host = u.hostname.toLowerCase();
    const extra = loadExtraScopeHosts();
    const suffixes = [...DEFAULT_SUBDOMAIN_PER_USER_SUFFIXES, ...extra.subdomain];
    const pathHosts = [...DEFAULT_PATH_USER_HOSTS, ...extra.path];
    if (suffixes.some((s) => host.endsWith(`.${s}`))) {
      return { type: 'urlprefix', value: `${u.protocol}//${u.host}/` };
    }
    if (pathHosts.includes(host)) {
      const segs = u.pathname.split('/').filter(Boolean);
      // zenn.dev/p/{publication}/... はパブリケーション単位なので2セグメントまで
      const n = segs[0] === 'p' ? 2 : 1;
      if (segs.length > n) {
        return { type: 'urlprefix', value: `${u.protocol}//${u.host}/${segs.slice(0, n).join('/')}/` };
      }
    }
    return { type: 'url', value: url };
  }

  function isHidden(item) {
    const forceMute = loadRules('forceMute');
    if (forceMute.some((r) => matchRule(r, item))) return true;

    const mute = loadRules('mute');
    const hitMute = mute.some((r) => matchRule(r, item));
    if (!hitMute) return false;

    const unmute = loadRules('unmute');
    const hitUnmute = unmute.some((r) => matchRule(r, item));
    return !hitUnmute;
  }

  global.Filters = {
    KINDS,
    TYPES,
    loadRules,
    saveRules,
    addRule,
    removeRule,
    importRules,
    uniqueRules,
    dedupeRules,
    sortRules,
    isHidden,
    scopeRuleForUrl,
    importScopeHosts,
  };
})(window);
