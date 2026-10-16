/**
 * OAuth 1.0a(HMAC-SHA1)の署名ヘルパー。はてなのAPI(bookmark.hatenaapis.com)用。
 * WorkerとNode(scripts/hatena-oauth-setup.mjs)の両方から使う。Web Crypto(crypto.subtle)のみに依存する。
 */

// RFC 3986のパーセントエンコード(encodeURIComponentが残す !'()* も変換する)
export function rfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function hmacSha1Base64(key, data) {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(data)));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return btoa(bin);
}

function randomNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Authorizationヘッダーの値を作る。
 *   method / url   : urlはクエリを含めない(クエリ・フォームのパラメータはparamsに渡す)
 *   params         : 署名対象のoauth_*以外のパラメータ(クエリ+application/x-www-form-urlencodedのボディ)
 *   token/tokenSecret: リクエストトークン取得時は空
 *   extraOauth     : oauth_callback / oauth_verifier など追加のoauth_*パラメータ
 *   nonce/timestamp: テスト用の固定値(通常は省略)
 */
export async function authorizationHeader({
  method,
  url,
  params = {},
  consumerKey,
  consumerSecret,
  token = '',
  tokenSecret = '',
  extraOauth = {},
  nonce,
  timestamp,
}) {
  const oauth = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || randomNonce(),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_version: '1.0',
    ...extraOauth,
  };
  if (token) oauth.oauth_token = token;

  const pairs = Object.entries({ ...params, ...oauth })
    .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
    .map(([k, v]) => [rfc3986(k), rfc3986(String(v))])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join('&');
  const base = [method.toUpperCase(), rfc3986(url), rfc3986(paramString)].join('&');
  oauth.oauth_signature = await hmacSha1Base64(`${rfc3986(consumerSecret)}&${rfc3986(tokenSecret)}`, base);

  return `OAuth realm="", ${Object.entries(oauth)
    .map(([k, v]) => `${rfc3986(k)}="${rfc3986(String(v))}"`)
    .join(', ')}`;
}
