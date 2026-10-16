#!/usr/bin/env node
/**
 * はてなブックマークのOAuthアクセストークンを1回だけ取得するローカル用スクリプト。
 * 取得した値はWorkerのsecretに登録する(ファイルには保存しない。画面に表示するだけ)。
 *
 * 事前準備: https://www.hatena.ne.jp/oauth/develop でアプリを登録し、
 *   scopeに read_public / write_public を許可してコンシューマキー・シークレットを控える。
 * 実行:
 *   HATENA_CONSUMER_KEY=... HATENA_CONSUMER_SECRET=... node scripts/hatena-oauth-setup.mjs
 * 画面のURLをブラウザで開いて許可 → 表示された確認コード(oauth_verifier)を貼り付ける。
 */
import readline from 'node:readline/promises';
import { authorizationHeader, rfc3986 } from '../worker/oauth1.js';

const consumerKey = process.env.HATENA_CONSUMER_KEY;
const consumerSecret = process.env.HATENA_CONSUMER_SECRET;
if (!consumerKey || !consumerSecret) {
  console.error('HATENA_CONSUMER_KEY と HATENA_CONSUMER_SECRET を環境変数で指定してください');
  process.exit(1);
}

async function post(url, params, oauthOpts) {
  const body = Object.entries(params)
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&');
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: await authorizationHeader({ method: 'POST', url, params, consumerKey, consumerSecret, ...oauthOpts }),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'hateb-tycoon-oauth-setup',
    },
    body: body || undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return Object.fromEntries(new URLSearchParams(text));
}

const req = await post(
  'https://www.hatena.com/oauth/initiate',
  { scope: 'read_public,write_public' },
  { extraOauth: { oauth_callback: 'oob' } }
);
console.log('\n1. 次のURLをブラウザで開いて許可してください。');
console.log('   ※許可は「そのブラウザでログイン中のアカウント」で行われ、投稿はそのアカウントに書き込まれます。');
console.log('   使いたいアカウントでログインしているか確認(別アカウントなら、プライベートウィンドウで開く)。\n');
console.log(`   https://www.hatena.ne.jp/oauth/authorize?oauth_token=${encodeURIComponent(req.oauth_token)}\n`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const verifier = (await rl.question('2. 表示された確認コード(oauth_verifier): ')).trim();
rl.close();

const acc = await post(
  'https://www.hatena.com/oauth/token',
  {},
  { token: req.oauth_token, tokenSecret: req.oauth_token_secret, extraOauth: { oauth_verifier: verifier } }
);
// このトークンの持ち主(許可した時にログインしていたアカウント)。投稿はこのアカウントに書き込まれる。
const me = await fetch('https://n.hatena.com/applications/my.json', {
  headers: {
    Authorization: await authorizationHeader({
      method: 'GET',
      url: 'https://n.hatena.com/applications/my.json',
      consumerKey,
      consumerSecret,
      token: acc.oauth_token,
      tokenSecret: acc.oauth_token_secret,
    }),
    'User-Agent': 'hateb-tycoon-oauth-setup',
  },
}).then((r) => (r.ok ? r.json() : null), () => null);
const owner = (me && me.url_name) || acc.url_name || '';
console.log(`\n★ このトークンの持ち主(投稿が書き込まれるアカウント): ${owner || '(取得できませんでした)'}${me && me.display_name ? ` (${me.display_name})` : ''}`);
console.log('  意図したアカウントと違う場合は、登録せずにやり直してください(許可画面を開いたブラウザで、');
console.log('  別のはてなアカウントにログインしていたのが原因です。プライベートウィンドウで、');
console.log('  使いたいアカウントでログインしてから許可画面を開いてください)。\n');
console.log('取得できました。次のコマンドでWorkerのsecretに登録してください(値は他に保存しない):\n');
console.log('   cd worker');
console.log('   npx wrangler secret put HATENA_USER_ID            # 一覧もこのアカウントにそろえる場合は上の持ち主のid');
console.log('   npx wrangler secret put HATENA_CONSUMER_KEY');
console.log('   npx wrangler secret put HATENA_CONSUMER_SECRET');
console.log('   npx wrangler secret put HATENA_ACCESS_TOKEN');
console.log('   npx wrangler secret put HATENA_ACCESS_TOKEN_SECRET\n');
console.log(`HATENA_ACCESS_TOKEN        = ${acc.oauth_token}`);
console.log(`HATENA_ACCESS_TOKEN_SECRET = ${acc.oauth_token_secret}`);
