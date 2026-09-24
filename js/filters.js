/**
 * localStorage に保存するフィルタルール(blacklist / whitelist / forceBlock)の管理と、
 * ブックマーク項目に対するマッチング判定を行うモジュール。
 *
 * ルールは { id, type, value } の配列。
 *   type: 'title' | 'domain' | 'user' | 'comment'
 *   value: 部分一致(大文字小文字を区別しない)させる文字列
 *
 * 判定ロジック:
 *   1. forceBlock に一致 -> 強制的に非表示 (whitelist でも解除不可)
 *   2. blacklist に一致し、whitelist に一致しない -> 非表示
 *   3. それ以外 -> 表示
 */
(function (global) {
  const STORAGE_KEYS = {
    blacklist: 'hateb-tycoon:blacklist',
    whitelist: 'hateb-tycoon:whitelist',
    forceBlock: 'hateb-tycoon:forceBlock',
  };

  const KINDS = Object.keys(STORAGE_KEYS);
  const TYPES = ['title', 'domain', 'user', 'comment'];

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

  function addRule(kind, type, value) {
    assertKind(kind);
    if (!TYPES.includes(type)) throw new Error(`unknown rule type: ${type}`);
    const trimmed = value.trim();
    if (!trimmed) return loadRules(kind);
    const rules = loadRules(kind);
    rules.push({ id: makeId(), type, value: trimmed });
    saveRules(kind, rules);
    return rules;
  }

  function removeRule(kind, id) {
    assertKind(kind);
    const rules = loadRules(kind).filter((r) => r.id !== id);
    saveRules(kind, rules);
    return rules;
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
      default:
        return false;
    }
  }

  function isHidden(item) {
    const forceBlock = loadRules('forceBlock');
    if (forceBlock.some((r) => matchRule(r, item))) return true;

    const blacklist = loadRules('blacklist');
    const hitBlack = blacklist.some((r) => matchRule(r, item));
    if (!hitBlack) return false;

    const whitelist = loadRules('whitelist');
    const hitWhite = whitelist.some((r) => matchRule(r, item));
    return !hitWhite;
  }

  global.Filters = {
    KINDS,
    TYPES,
    loadRules,
    saveRules,
    addRule,
    removeRule,
    isHidden,
  };
})(window);
