/**
 * hateb-tycoon用の中継Worker(Cloudflare Workers)。ブラウザから直接使えないはてなのAPIを中継する。
 *
 *   GET  /bookmarks?page=N   自分のブックマーク一覧(認証なしの公開API /api/users/{id}/bookmarks)
 *   GET  /bookmark?url=...   自分のそのURLのブックマーク(コメント・タグ)。無ければ { exists: false }
 *   POST /bookmark           ブックマークの追加・更新。JSON { url, comment, tags[] }(OAuth 1.0aで署名して転送)
 *   POST /stars              コメントのスター数。JSON { items: [{ eid, created }] }(最大50件)→ { stars: { <eid>: n } }
 *   GET  /check              設定の確認。一覧(HATENA_USER_ID)とOAuthのアカウントが同じか(idは返さない)
 *
 * /starsのスターAPI(s.hatena.ne.jp/entries.json)は、ブックマークのパーマリンク
 * https://b.hatena.ne.jp/{id}/{yyyymmdd}#bookmark-{eid} をURIとして引く。URIにはidが入るため、
 * ブラウザには組ませずWorkerが組む(ブラウザは記事のeidと日時だけ渡す=idが外に出ない)。
 *
 * 一覧のアカウント(HATENA_USER_ID)と、投稿に使うOAuthのアカウント(許可した時にログインしていた人)は
 * 別々に設定する値で、食い違うと「一覧はAだが投稿はB」になる。そこでOAuthの持ち主を
 * https://n.hatena.com/applications/my.json で調べ、**食い違っていれば投稿・既存取得を拒否(409)**する。
 *
 * 理由: はてなのAPIはCORSがb.hatena.ne.jp限定(一覧)/非対応(投稿のbookmark.hatenaapis.com)で
 * ブラウザから直接呼べず、投稿はOAuth 1.0a(コンシューマ/アクセストークンのシークレットで署名)が要る。
 * はてなid・OAuthの鍵はすべてこのWorkerのsecretにだけ置き、リポジトリ・公開サイト・ブラウザには出さない。
 * レスポンスはidを含む項目(userオブジェクト等)を落として整形して返す。
 *
 * 認証: すべて Authorization: Bearer <ACCESS_TOKEN>(アプリのlocalStorageに持つトークン)。
 * ACCESS_TOKENが漏れるとあなたのアカウントでブックマークを投稿されるため、長いランダム文字列にすること。
 *
 * secret(wrangler secret put):
 *   ACCESS_TOKEN                     アプリからのアクセスを許可するトークン
 *   HATENA_USER_ID                   一覧の取得対象のはてなid
 *   HATENA_CONSUMER_KEY / HATENA_CONSUMER_SECRET
 *   HATENA_ACCESS_TOKEN / HATENA_ACCESS_TOKEN_SECRET   (scripts/hatena-oauth-setup.mjs で取得。投稿・取得に必要)
 * vars(wrangler.toml): ALLOWED_ORIGINS  CORSを許可するオリジン(カンマ区切り)
 */
import { authorizationHeader, rfc3986 } from './oauth1.js';

const USERS_API = 'https://b.hatena.ne.jp/api/users';
const BOOKMARK_API = 'https://bookmark.hatenaapis.com/rest/1/my/bookmark';
const ACCOUNT_API = 'https://n.hatena.com/applications/my.json'; // OAuthの持ち主(url_name)。read_publicで足りる
const ACCOUNT_CACHE_MS = 10 * 60 * 1000;
const STAR_API = 'https://s.hatena.ne.jp/entries.json';
const MAX_STAR_ITEMS = 50; // 1リクエストのURI数(URLが長くなりすぎない上限。コメントビューと同じ)
const USER_AGENT = 'hateb-tycoon-proxy';
const MAX_PAGE = 200;
const MAX_TAGS = 10; // はてなの上限
const MAX_URL_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 1000; // 明らかな異常値だけ弾く(実際の上限判定ははてな側)

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

// トークン比較でタイミング差から長さ・内容が漏れないよう、ハッシュ同士を固定長で比べる。
async function tokenMatches(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const va = new Uint8Array(a);
  const vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

function pickItem(b) {
  const entry = b.entry || {};
  return {
    url: b.url || '',
    eid: b.location_id != null ? String(b.location_id) : '', // 記事のid(コメントビューのeidと同じ。公開情報)
    title: entry.title || '',
    // comment_expanded は本文中のURLを <a href=… target="_blank" rel="noopener nofollow"> に展開したHTMLなので使わない
    // (表示側はHTMLとして解釈せず文字として出すため、タグがそのまま見えてしまう)。URLのリンク化は表示側(linkifyComment)が行う。
    comment: b.comment || '',
    tags: Array.isArray(b.tags) ? b.tags : [],
    created: b.created || '',
    count: entry.total_bookmarks != null ? entry.total_bookmarks : 0,
    image: entry.image || '',
  };
}

// ---- GET /bookmarks ----
async function listBookmarks(request, env, cors) {
  if (!env.HATENA_USER_ID) return json({ error: 'worker is not configured' }, 500, cors);
  const page = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('page'), 10) || 1, 1), MAX_PAGE);
  let upstream;
  try {
    upstream = await fetch(`${USERS_API}/${encodeURIComponent(env.HATENA_USER_ID)}/bookmarks?page=${page}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
  } catch (e) {
    return json({ error: 'upstream unreachable' }, 502, cors);
  }
  if (!upstream.ok) return json({ error: `upstream status ${upstream.status}` }, 502, cors);

  let data;
  try {
    data = await upstream.json();
  } catch (e) {
    return json({ error: 'upstream returned invalid json' }, 502, cors);
  }
  const bookmarks = data && data.item && Array.isArray(data.item.bookmarks) ? data.item.bookmarks : [];
  const hasNext = !!(data && data.pager && data.pager.next) && bookmarks.length > 0;
  return json(
    {
      items: bookmarks.filter((b) => !b.status || b.status === 'public').map(pickItem),
      nextPage: hasNext ? page + 1 : null,
    },
    200,
    cors
  );
}

// ---- OAuth署名つきでbookmark.hatenaapis.comを呼ぶ ----
function oauthConfigured(env) {
  return !!(
    env.HATENA_CONSUMER_KEY &&
    env.HATENA_CONSUMER_SECRET &&
    env.HATENA_ACCESS_TOKEN &&
    env.HATENA_ACCESS_TOKEN_SECRET
  );
}

const formEncode = (params) =>
  Object.entries(params)
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(String(v))}`)
    .join('&');

// OAuth署名つきで呼ぶ。GETはparamsをクエリに、POSTはapplication/x-www-form-urlencodedのボディに入れる。
async function signedFetch(env, method, url, params = {}) {
  const auth = await authorizationHeader({
    method,
    url,
    params,
    consumerKey: env.HATENA_CONSUMER_KEY,
    consumerSecret: env.HATENA_CONSUMER_SECRET,
    token: env.HATENA_ACCESS_TOKEN,
    tokenSecret: env.HATENA_ACCESS_TOKEN_SECRET,
  });
  const headers = { Authorization: auth, 'User-Agent': USER_AGENT, Accept: 'application/json' };
  const query = formEncode(params);
  if (method === 'GET') return fetch(query ? `${url}?${query}` : url, { method, headers });
  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  return fetch(url, { method, headers, body: query });
}

const callBookmarkApi = (env, method, params) => signedFetch(env, method, BOOKMARK_API, params);

// OAuthトークンの持ち主のid(url_name)。取れなければnull。同じトークンの間は結果を使い回す。
let accountCache = null;
async function oauthAccountId(env) {
  const key = env.HATENA_ACCESS_TOKEN;
  if (accountCache && accountCache.key === key && Date.now() - accountCache.at < ACCOUNT_CACHE_MS) return accountCache.id;
  let id = null;
  try {
    const res = await signedFetch(env, 'GET', ACCOUNT_API);
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.url_name === 'string' && data.url_name) id = data.url_name;
    }
  } catch (e) {
    // 確認できなかった扱い(下のunknown)にする
  }
  if (id) accountCache = { key, id, at: Date.now() };
  return id;
}

// 一覧のアカウントとOAuthのアカウントが同じか: 'same' | 'different' | 'unknown'(確認できない)
async function accountMatch(env) {
  if (!env.HATENA_USER_ID) return 'unknown';
  const id = await oauthAccountId(env);
  if (!id) return 'unknown';
  return id.toLowerCase() === env.HATENA_USER_ID.trim().toLowerCase() ? 'same' : 'different';
}

const MISMATCH = { error: 'account mismatch' };

function validUrl(value) {
  return typeof value === 'string' && value.length <= MAX_URL_LENGTH && /^https?:\/\/\S+$/i.test(value);
}

// idを含み得る生のレスポンスは返さず、コメントとタグだけにして返す。
function pickMyBookmark(raw) {
  return {
    comment: raw && typeof raw.comment === 'string' ? raw.comment : '',
    tags: raw && Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
  };
}

// ---- GET /bookmark?url=... ----
async function getMyBookmark(request, env, cors) {
  if (!oauthConfigured(env)) return json({ error: 'oauth is not configured' }, 500, cors);
  const target = new URL(request.url).searchParams.get('url');
  if (!validUrl(target)) return json({ error: 'invalid url' }, 400, cors);
  if ((await accountMatch(env)) === 'different') return json(MISMATCH, 409, cors);
  let upstream;
  try {
    upstream = await callBookmarkApi(env, 'GET', { url: target });
  } catch (e) {
    return json({ error: 'upstream unreachable' }, 502, cors);
  }
  if (upstream.status === 404) return json({ exists: false }, 200, cors);
  if (!upstream.ok) return json({ error: `upstream status ${upstream.status}` }, 502, cors);
  try {
    return json({ exists: true, ...pickMyBookmark(await upstream.json()) }, 200, cors);
  } catch (e) {
    return json({ error: 'upstream returned invalid json' }, 502, cors);
  }
}

// ---- POST /bookmark ----
async function postMyBookmark(request, env, cors) {
  if (!oauthConfigured(env)) return json({ error: 'oauth is not configured' }, 500, cors);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid json' }, 400, cors);
  }
  const comment = body && body.comment != null ? body.comment : '';
  const tags = body && body.tags != null ? body.tags : [];
  if (!body || !validUrl(body.url)) return json({ error: 'invalid url' }, 400, cors);
  if (typeof comment !== 'string' || comment.length > MAX_COMMENT_LENGTH) {
    return json({ error: 'invalid comment' }, 400, cors);
  }
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || tags.some((t) => typeof t !== 'string' || !t || /\s/.test(t))) {
    return json({ error: `invalid tags (max ${MAX_TAGS}, no spaces)` }, 400, cors);
  }

  // 一覧のアカウントと違う人のブックマークに書き込まないよう、食い違いは投稿前に止める。
  if ((await accountMatch(env)) === 'different') return json(MISMATCH, 409, cors);
  const params = { url: body.url, comment };
  if (tags.length > 0) params.tags = tags;
  let upstream;
  try {
    upstream = await callBookmarkApi(env, 'POST', params);
  } catch (e) {
    return json({ error: 'upstream unreachable' }, 502, cors);
  }
  // 400はコメント・タグの不正など、利用者が直せる内容。それ以外(401=署名/トークン不良など)は中継側の問題として502にする。
  if (upstream.status === 400) return json({ error: 'rejected by hatena (comment/tags may be invalid)' }, 400, cors);
  if (!upstream.ok) return json({ error: `upstream status ${upstream.status}` }, 502, cors);
  let saved = { comment, tags };
  try {
    saved = pickMyBookmark(await upstream.json());
  } catch (e) {
    // 保存自体は成功しているため、応答が読めなくても送った内容を返す
  }
  return json({ ok: true, ...saved }, 200, cors);
}

// ---- POST /stars ----
const jstDate = (iso) => {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const j = new Date(t.getTime() + 9 * 60 * 60 * 1000); // パーマリンクの日付は日本時間
  const pad = (n) => String(n).padStart(2, '0');
  return `${j.getUTCFullYear()}${pad(j.getUTCMonth() + 1)}${pad(j.getUTCDate())}`;
};

// 通常のスター+色付きスターの合計。多い時は途中が { count: N } にまとめられて返る。
function countStars(entry) {
  const sum = (stars) =>
    (Array.isArray(stars) ? stars : []).reduce((n, x) => n + (x && x.count != null ? Number(x.count) || 0 : 1), 0);
  let total = sum(entry.stars);
  for (const c of Array.isArray(entry.colored_stars) ? entry.colored_stars : []) total += sum(c && c.stars);
  return total;
}

async function getStars(request, env, cors) {
  if (!env.HATENA_USER_ID) return json({ error: 'worker is not configured' }, 500, cors);
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: 'invalid json' }, 400, cors);
  }
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items || items.length === 0 || items.length > MAX_STAR_ITEMS) {
    return json({ error: `invalid items (1..${MAX_STAR_ITEMS})` }, 400, cors);
  }
  const uriToEid = new Map();
  for (const it of items) {
    const eid = it && typeof it.eid === 'string' ? it.eid : '';
    const date = it && typeof it.created === 'string' ? jstDate(it.created) : null;
    if (!/^\d{1,24}$/.test(eid) || !date) return json({ error: 'invalid item' }, 400, cors);
    uriToEid.set(`https://b.hatena.ne.jp/${env.HATENA_USER_ID}/${date}#bookmark-${eid}`, eid);
  }
  const query = [...uriToEid.keys()].map((u) => `uri=${rfc3986(u)}`).join('&');
  let upstream;
  try {
    upstream = await fetch(`${STAR_API}?${query}`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } });
  } catch (e) {
    return json({ error: 'upstream unreachable' }, 502, cors);
  }
  if (!upstream.ok) return json({ error: `upstream status ${upstream.status}` }, 502, cors);
  let data;
  try {
    data = await upstream.json();
  } catch (e) {
    return json({ error: 'upstream returned invalid json' }, 502, cors);
  }
  // 0件のURIは応答に含まれない。URI(=idを含む)は返さず、eid→件数だけ返す。
  const stars = {};
  for (const e of Array.isArray(data.entries) ? data.entries : []) {
    const eid = uriToEid.get(e.uri);
    const n = countStars(e);
    if (eid && n > 0) stars[eid] = n;
  }
  return json({ stars }, 200, cors);
}

// ---- GET /check ---- 設定の確認用。idは返さず、一致するかだけ返す。
async function checkConfig(env, cors) {
  const oauth = oauthConfigured(env);
  return json(
    {
      listConfigured: !!env.HATENA_USER_ID,
      oauthConfigured: oauth,
      accounts: oauth ? await accountMatch(env) : 'unknown',
    },
    200,
    cors
  );
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    // ブラウザ(Originあり)からは許可リストにあるオリジンのみ受け付ける。
    if (origin && !cors) return json({ error: 'forbidden origin' }, 403);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors || {} });
    if (!env.ACCESS_TOKEN) return json({ error: 'worker is not configured' }, 500, cors);

    const auth = request.headers.get('Authorization') || '';
    const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!given || !(await tokenMatches(given, env.ACCESS_TOKEN))) {
      return json({ error: 'unauthorized' }, 401, cors);
    }

    const { pathname } = new URL(request.url);
    const route = `${request.method} ${pathname.replace(/\/+$/, '') || '/'}`;
    switch (route) {
      case 'GET /bookmarks':
        return listBookmarks(request, env, cors);
      case 'GET /bookmark':
        return getMyBookmark(request, env, cors);
      case 'POST /bookmark':
        return postMyBookmark(request, env, cors);
      case 'POST /stars':
        return getStars(request, env, cors);
      case 'GET /check':
        return checkConfig(env, cors);
      default:
        return json({ error: 'not found' }, 404, cors);
    }
  },
};
