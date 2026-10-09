import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import worker from './worker.mjs';
const handle = worker.fetch;

const ENV = {
  SITE_ORIGIN: 'https://dorpsraad.example',
  WORKER_ORIGIN: 'https://login.example',
  GITHUB_REPO: 'dorpsraad/kwadendamme',
  GITHUB_APP_ID: '5252240',
  GITHUB_CLIENT_ID: 'test-client',
  GITHUB_CLIENT_SECRET: 'test-secret',
  SESSION_SECRET: 'only-a-test-key-with-at-least-32-characters'
};
const TOKEN = 'ghu_testtokenforlocaltests123456789';
const NOW = 1781000000000;
const start = (extra = '', env = ENV) => handle(new Request(`${env.WORKER_ORIGIN}/auth?provider=github&site_id=dorpsraad.example${extra}`), env, { now: () => NOW });

async function session() {
  const response = await start();
  const location = new URL(response.headers.get('Location'));
  return { state: location.searchParams.get('state'), cookie: response.headers.get('Set-Cookie').split(';')[0], location };
}

function callback(s, state = s.state) {
  return new Request(`https://login.example/callback?code=samplecode&state=${state}`, { headers: { Cookie: s.cookie } });
}

function github(push = true, calls = [], changes = {}) {
  return async (url, options) => {
    calls.push({ url, options });
    if (url === 'https://github.com/login/oauth/access_token') return Response.json({ access_token: TOKEN, expires_in: 28800, ...changes.token });
    if (url.startsWith('https://api.github.com/user/installations?')) return Response.json(changes.installations || { total_count: 1, installations: [{ id: 123, app_id: Number(ENV.GITHUB_APP_ID), account: { login: 'dorpsraad' }, repository_selection: 'selected', permissions: { contents: 'write' } }] });
    if (url === 'https://api.github.com/user/installations/123/repositories?per_page=100') return Response.json(changes.repositories || { total_count: 1, repositories: [{ full_name: ENV.GITHUB_REPO, permissions: { push } }] });
    throw new Error('Unexpected request');
  };
}

test('auth binds cookie, state, PKCE and fixed callback without broad OAuth scopes', async () => {
  const response = await start('&repo=attacker/other&redirect_uri=https://attacker.example&scope=repo');
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('Location'));
  assert.equal(location.origin, 'https://github.com');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://login.example/callback');
  assert.equal(location.searchParams.has('scope'), false);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(location.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(response.headers.get('Set-Cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('other site/provider/origin and bad configuration are refused', async () => {
  for (const [query, expected] of [['provider=gitlab&site_id=dorpsraad.example', 400], ['provider=github&site_id=attacker.example', 403]]) {
    assert.equal((await handle(new Request(`https://login.example/auth?${query}`), ENV)).status, expected);
  }
  assert.equal((await handle(new Request('https://login.example/auth?provider=github&site_id=dorpsraad.example', { headers: { Origin: 'https://attacker.example' } }), ENV)).status, 403);
  assert.equal((await handle(new Request('https://attacker.example/auth?provider=github&site_id=dorpsraad.example'), ENV)).status, 400);
  assert.equal((await handle(new Request('https://login.example/'), { ...ENV, SESSION_SECRET: 'short' })).status, 503);
  assert.equal((await handle(new Request('https://login.example/'), { ...ENV, GITHUB_APP_ID: '' })).status, 503);
  assert.equal((await handle(new Request('https://login.example/', { method: 'POST' }), ENV)).status, 405);
});

test('missing cookie, wrong state, expired cookie and modified cookie never contact GitHub', async () => {
  const s = await session();
  let calls = 0;
  const noFetch = async () => { calls++; throw new Error('Must not be called'); };
  const attempts = [
    [new Request(`https://login.example/callback?code=x&state=${s.state}`), NOW],
    [callback(s, 'wrong'), NOW],
    [callback(s), NOW + 601000],
    [callback({ ...s, cookie: s.cookie.slice(0, -3) + 'XYZ' }), NOW]
  ];
  for (const [request, instant] of attempts) {
    const response = await handle(request, ENV, { fetch: noFetch, now: () => instant });
    assert.equal(response.status, 400);
    assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  }
  assert.equal(calls, 0);
});

test('successful callback checks fixed repository and implements exact Decap handshake', async () => {
  const s = await session();
  const calls = [];
  const response = await handle(callback(s), ENV, { fetch: github(true, calls), now: () => NOW });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Security-Policy'), /script-src 'nonce-/);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.body.get('redirect_uri'), 'https://login.example/callback');
  assert.match(calls[0].options.body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(calls[1].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[2].url, 'https://api.github.com/user/installations/123/repositories?per_page=100');
  const messages = [];
  const opener = { postMessage: (...args) => messages.push(args) };
  let receive;
  let closed = false;
  const window = { opener, addEventListener: (_type, fn) => { receive = fn; }, removeEventListener: () => {}, close: () => { closed = true; } };
  vm.runInNewContext(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1], { window, document: { getElementById: () => ({ textContent: '' }) }, setTimeout: () => {} });
  assert.deepEqual(messages[0], ['authorizing:github', ENV.SITE_ORIGIN]);
  receive({ source: opener, origin: 'https://attacker.example', data: 'authorizing:github' });
  receive({ source: {}, origin: ENV.SITE_ORIGIN, data: 'authorizing:github' });
  receive({ source: opener, origin: ENV.SITE_ORIGIN, data: 'incorrect handshake' });
  assert.equal(messages.length, 1);
  receive({ source: opener, origin: ENV.SITE_ORIGIN, data: 'authorizing:github' });
  assert.deepEqual(messages[1], [`authorization:github:success:${JSON.stringify({ token: TOKEN, provider: 'github' })}`, ENV.SITE_ORIGIN]);
  assert.equal(closed, true);
});

test('wrong app, broad installation, read-only app, wrong or extra repositories fail closed', async () => {
  const s = await session();
  const installation = { id: 123, app_id: Number(ENV.GITHUB_APP_ID), account: { login: 'dorpsraad' }, repository_selection: 'selected', permissions: { contents: 'write' } };
  const fixtures = [
    { installations: { total_count: 0, installations: [] } },
    { installations: { total_count: 1, installations: [{ ...installation, app_id: 999 }] } },
    { installations: { total_count: 1, installations: [{ ...installation, repository_selection: 'all' }] } },
    { installations: { total_count: 1, installations: [{ ...installation, permissions: { contents: 'read' } }] } },
    { repositories: { total_count: 1, repositories: [{ full_name: 'dorpsraad/existing-site', permissions: { push: true } }] } },
    { repositories: { total_count: 2, repositories: [{ full_name: ENV.GITHUB_REPO, permissions: { push: true } }, { full_name: 'dorpsraad/existing-site', permissions: { push: true } }] } }
  ];
  for (const changes of fixtures) {
    const response = await handle(callback(s), ENV, { fetch: github(true, [], changes), now: () => NOW });
    const html = await response.text();
    assert.match(html, /authorization:github:error:/);
    assert.ok(!html.includes(TOKEN));
  }
});

test('non-expiring tokens and OAuth App tokens are refused', async () => {
  const s = await session();
  for (const token of [{ expires_in: undefined }, { expires_in: 999999 }, { access_token: 'gho_testtokenforlocaltests123456789' }]) {
    const calls = [];
    const response = await handle(callback(s), ENV, { fetch: github(true, calls, { token }), now: () => NOW });
    const html = await response.text();
    assert.match(html, /authorization:github:error:/);
    assert.ok(!html.includes(TOKEN));
    assert.equal(calls.length, 1);
  }
});

test('the configured app can be found after the first installation page', async () => {
  const s = await session();
  const mocked = github();
  const fetcher = async (url, options) => {
    if (url === 'https://api.github.com/user/installations?per_page=100&page=1') return Response.json({ total_count: 101, installations: Array.from({ length: 100 }, (_, i) => ({ app_id: i + 1 })) });
    return mocked(url, options);
  };
  const response = await handle(callback(s), ENV, { fetch: fetcher, now: () => NOW });
  assert.match(await response.text(), /authorization:github:success:/);
});

test('read-only account and GitHub errors never return token', async () => {
  const s = await session();
  for (const fetcher of [github(false), async () => { throw new Error('Network issue containing secrets'); }, async () => Response.json({ error: 'bad_verification_code' })]) {
    const response = await handle(callback(s), ENV, { fetch: fetcher, now: () => NOW });
    const html = await response.text();
    assert.match(html, /authorization:github:error:/);
    assert.ok(!html.includes(TOKEN));
    assert.ok(!html.includes(ENV.GITHUB_CLIENT_SECRET));
    assert.ok(!html.includes('Network issue containing secrets'));
  }
});

test('GitHub cancellation clears session and gives safe Decap error', async () => {
  const s = await session();
  const response = await handle(new Request(`https://login.example/callback?error=access_denied&state=${s.state}`, { headers: { Cookie: s.cookie } }), ENV, { now: () => NOW });
  assert.match(await response.text(), /authorization:github:error:/);
  assert.match(response.headers.get('Set-Cookie'), /Max-Age=0/);
});
