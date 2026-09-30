/**
 * 既読(js/visited.js)をシークレットGist経由で端末間同期するモジュール。
 *
 * 方針:
 * - localStorageが常に正。既読の判定・記録はGistに一切触れない(画面遷移や記事を開くたびに
 *   通信は発生しない)。Gistは「時々同期する置き場」。
 * - 読み込み(pull): 起動時と、タブ復帰時(前回から PULL_INTERVAL_MS 以上経過)のみ。
 *   認証不要(シークレットGistはURL=IDを知っていれば読める)で、ETagの条件付きリクエストにより
 *   変更が無ければ304(レート制限にも数えられない)。
 * - 書き込み(push): トークン設定済みの端末のみ。既読が増えたら PUSH_DEBOUNCE_MS 後にまとめて1回、
 *   またはタブを隠す/閉じる時に即時。書く直前にpull+マージするので他端末の更新を上書きしない。
 * - トークンが無い端末(GitHubにログインできない端末など)は読み取り専用として動作する。
 * - マージは URL ごとに time が新しい方を採用(Visited.mergeRemote)。
 */
(function (global) {
  const STORAGE_KEY = 'hateb-tycoon:sync';
  const FILE_NAME = 'hateb-tycoon-visited.json';
  const API = 'https://api.github.com/gists';
  const PUSH_DEBOUNCE_MS = 45 * 1000;
  const PULL_INTERVAL_MS = 5 * 60 * 1000;

  // { gistId, token, etag, dirty, lastSyncAt, lastError }
  let state = loadState();
  let pushTimer = null;
  let busy = null; // 実行中の同期Promise(重複実行を避ける)
  let lastPullAt = 0;
  let onMerged = null;
  let onStatus = null;

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      // localStorageが使えない環境では同期をあきらめる
    }
  }

  function setState(patch) {
    state = { ...state, ...patch };
    saveState();
    if (onStatus) onStatus();
  }

  // Gist URL(https://gist.github.com/user/<id> 等)を貼られても ID を取り出せるようにする
  function parseGistId(input) {
    const m = /([0-9a-f]{20,40})(?![0-9a-f])/i.exec(String(input || ''));
    return m ? m[1].toLowerCase() : '';
  }

  function isConfigured() {
    return !!state.gistId;
  }

  function canPush() {
    return !!(state.gistId && state.token);
  }

  function describeHttpError(status) {
    if (status === 401) return 'トークンが無効です(失効の可能性)';
    if (status === 403) return 'アクセス拒否またはレート制限です';
    if (status === 404) return 'Gistが見つかりません(IDまたはトークンの権限を確認)';
    return `HTTP ${status}`;
  }

  // Gistから既読を取得する。変更なし(304)なら null。
  async function fetchRemote() {
    const headers = { Accept: 'application/vnd.github+json' };
    if (state.etag) headers['If-None-Match'] = state.etag;
    const res = await fetch(`${API}/${state.gistId}`, { headers, cache: 'no-store' });
    if (res.status === 304) return null;
    if (!res.ok) throw new Error(describeHttpError(res.status));
    const etag = res.headers.get('ETag');
    const json = await res.json();
    const file = json.files && json.files[FILE_NAME];
    let text = '';
    if (file) {
      text = file.truncated && file.raw_url ? await (await fetch(file.raw_url)).text() : file.content || '';
    }
    let visited = {};
    try {
      const parsed = JSON.parse(text);
      if (parsed && parsed.visited && typeof parsed.visited === 'object') visited = parsed.visited;
    } catch (e) {
      // 空や壊れたファイルは「リモートに既読なし」として扱う(次回pushで作り直される)
    }
    return { visited, etag };
  }

  // ローカルにあってリモートに無い(または新しい)既読があるか
  function hasLocalNewer(remoteVisited) {
    const local = Visited.getAll();
    return Object.keys(local).some((url) => {
      const r = remoteVisited[url];
      return !r || typeof r.time !== 'number' || local[url].time > r.time;
    });
  }

  async function writeRemote() {
    const body = { files: { [FILE_NAME]: { content: JSON.stringify({ version: 1, visited: Visited.getAll() }) } } };
    const res = await fetch(`${API}/${state.gistId}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${state.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(describeHttpError(res.status));
  }

  // pull(+マージ) → 必要ならpush。トークン無しなら pull のみ。
  async function runSync() {
    let remote = await fetchRemote();
    lastPullAt = Date.now();
    let changed = false;
    if (remote) {
      changed = Visited.mergeRemote(remote.visited);
      setState({ etag: remote.etag || '' });
    }
    if (canPush() && (state.dirty || (remote && hasLocalNewer(remote.visited)))) {
      // 送信中に増えた既読を取りこぼさないよう、送信前にフラグを下ろし、失敗したら戻す
      setState({ dirty: false });
      try {
        await writeRemote();
      } catch (e) {
        setState({ dirty: true });
        throw e;
      }
      // 自分の書き込みでETagが変わるため、次回は全量取得させる
      setState({ etag: '' });
    }
    setState({ lastSyncAt: Date.now(), lastError: '' });
    if (changed && onMerged) onMerged();
  }

  function sync() {
    if (!isConfigured()) return Promise.resolve();
    if (busy) return busy;
    busy = runSync()
      .catch((err) => {
        setState({ lastError: err && err.message ? err.message : String(err) });
        console.warn('[sync] failed', err);
      })
      .finally(() => {
        busy = null;
      });
    return busy;
  }

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(sync, PUSH_DEBOUNCE_MS);
  }

  // Visited.markVisited から呼ばれる。通信はせず、フラグとタイマーだけ。
  function markDirty() {
    if (!canPush()) return;
    setState({ dirty: true });
    schedulePush();
  }

  // 新しいシークレットGistを作成してIDを保存する(トークン必須)
  async function createGist() {
    if (!state.token) throw new Error('先にトークンを入力してください');
    const res = await fetch(API, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${state.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: 'hateb-tycoon visited sync',
        public: false,
        files: { [FILE_NAME]: { content: JSON.stringify({ version: 1, visited: Visited.getAll() }) } },
      }),
    });
    if (!res.ok) throw new Error(describeHttpError(res.status));
    const json = await res.json();
    setState({ gistId: json.id, etag: '', dirty: false, lastError: '' });
    return json.id;
  }

  function configure({ gistId, token }) {
    setState({
      gistId: parseGistId(gistId),
      token: (token || '').trim(),
      etag: '',
      lastError: '',
    });
  }

  function getConfig() {
    return { gistId: state.gistId || '', token: state.token || '', lastSyncAt: state.lastSyncAt || 0, lastError: state.lastError || '' };
  }

  // 起動時:最大 timeoutMs だけ待ってpullする(描画前に既読を反映するため)。
  // タイムアウトしても同期自体は裏で続き、マージされれば onMerged で再描画される。
  async function syncOnStartup(timeoutMs) {
    const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
    await Promise.race([sync(), timeout]);
  }

  function init(opts) {
    onMerged = opts && opts.onMerged;
    onStatus = opts && opts.onStatus;
    Visited.setMarkListener(markDirty);
    document.addEventListener('visibilitychange', () => {
      if (!isConfigured()) return;
      if (document.visibilityState === 'hidden') {
        // 未送信があれば取りこぼさないよう即時に送る
        if (state.dirty && canPush()) {
          clearTimeout(pushTimer);
          sync();
        }
      } else if (Date.now() - lastPullAt >= PULL_INTERVAL_MS) {
        sync();
      }
    });
  }

  global.Sync = { init, syncOnStartup, sync, configure, getConfig, createGist, isConfigured, canPush };
})(window);
