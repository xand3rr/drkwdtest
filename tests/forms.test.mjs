import test from 'node:test';
import assert from 'node:assert/strict';
import { FormGuard, handleForm } from '../forms/worker.mjs';

const ORIGIN = 'https://drkwdtest.xanderfaase.nl';
const WORKER = 'https://kwadendamme-formulieren.xanderfaase-cloudflare.workers.dev';
const START = Date.parse('2026-10-09T20:00:00Z');
const DAY = 86_400_000;

class Storage {
  constructor() { this.map = new Map(); this.chain = Promise.resolve(); this.alarm = null; }
  transaction(fn) {
    const run = this.chain.then(async () => {
      const next = new Map([...this.map].map(([key, value]) => [key, structuredClone(value)]));
      const tx = { get: async key => structuredClone(next.get(key)), put: async (key, value) => { next.set(key, structuredClone(value)); }, delete: async key => next.delete(key) };
      const result = await fn(tx); this.map = next; return result;
    });
    this.chain = run.catch(() => {}); return run;
  }
  async setAlarm(at) { this.alarm = at; }
  async deleteAlarm() { this.alarm = null; }
}

function payload(index = 0, overrides = {}) {
  return { form: 'contact', mode: 'test', name: 'Dorpsbewoner', email: 'bewoner@example.nl', subject: `Vraag ${index}`,
    message: `Een inhoudelijk bericht voor de dorpsraad ${index}.`, privacy: true, website: '', submissionId: crypto.randomUUID(), token: `token-valid-${index}`, ...overrides };
}

function setup(overrides = {}) {
  let time = START; const requests = []; const logs = []; const storage = new Storage();
  const env = { SITE_ORIGIN: ORIGIN, MODE: 'test', TURNSTILE_SECRET_KEY: 'turnstile-private-secret', ANTISPAM_SECRET: 'a'.repeat(64),
    __now: () => time, __log: entry => logs.push(entry), ...overrides };
  const object = new FormGuard({ storage }, env);
  env.FORM_GUARD = { idFromName: name => name, get: () => ({ fetch: request => object.fetch(request) }) };
  const fetcher = async (url, options) => {
    requests.push({ url, options }); assert.equal(options.redirect, 'manual');
    if (url.includes('siteverify')) return Response.json({ success: true, hostname: 'drkwdtest.xanderfaase.nl', action: 'contact', challenge_ts: new Date(time).toISOString() });
    if (url === 'https://api.resend.com/emails') return Response.json({ id: 'mail-fixed-id' });
    throw new Error('Unexpected network endpoint');
  };
  return {
    env, object, storage, requests, logs, setTime: value => { time = value; },
    request: (data, headers = {}, init = {}) => new Request(`${WORKER}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.4', ...headers }, body: JSON.stringify(data), ...init }),
    submit: async (data, headers = {}, customFetch) => handleForm(new Request(`${WORKER}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.4', ...headers }, body: JSON.stringify({ ...data, mode: data.mode === 'test' && env.MODE === 'live' ? 'live' : data.mode }) }), env, { fetch: customFetch || fetcher, now: () => time }),
    fetcher
  };
}

const live = { MODE: 'live', MAIL_FROM: 'formulier@dorpsraad.example.nl', MAIL_TO: 'raad@example.nl', RESEND_API_KEY: 're_private_secret' };

test('test mode validates real Siteverify and stores no message or raw identifiers', async () => {
  const h = setup(); const data = payload(); const response = await h.submit(data); const result = await response.json();
  assert.equal(result.code, 'TEST_ACCEPTED'); assert.equal(result.mode, 'test'); assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN); assert.equal(h.requests.length, 1);
  const persisted = JSON.stringify([...h.storage.map]);
  for (const secret of [data.message, data.name, data.email, data.token, data.submissionId, '203.0.113.4', h.env.ANTISPAM_SECRET]) assert.ok(!persisted.includes(secret));
  assert.deepEqual(h.logs.map(JSON.parse), [{ event: 'form', code: 'TEST_ACCEPTED' }]);
});

test('live requires explicit complete configuration and never accepts client recipient/from fields', async () => {
  for (const overrides of [{ MODE: 'live' }, { ...live, MAIL_TO: 'evil\nBcc: attacker@example.nl' }, { ...live, RESEND_API_KEY: '' }, { MODE: 'production' }]) {
    const h = setup(overrides); const response = await h.submit(payload()); assert.equal(response.status, 503); assert.equal(h.requests.length, 0);
  }
  const h = setup(live); const response = await h.submit(payload(0, { to: 'attacker@example.nl' })); assert.equal(response.status, 400); assert.equal(h.requests.length, 0);
});

test('live sends one plain text email only to fixed recipient with idempotency and safe reply-to', async () => {
  const h = setup(live); const data = payload(); const response = await h.submit(data);
  assert.equal((await response.json()).code, 'SENT'); assert.equal(h.requests.length, 2);
  const sent = h.requests[1].options; const body = JSON.parse(sent.body);
  assert.deepEqual(body.to, [live.MAIL_TO]); assert.equal(body.from, live.MAIL_FROM); assert.equal(body.reply_to, data.email);
  assert.equal(body.html, undefined); assert.equal(body.cc, undefined); assert.equal(body.bcc, undefined); assert.match(body.text, /Een inhoudelijk bericht/);
  assert.match(sent.headers['Idempotency-Key'], /^kwadendamme\/[a-f0-9]{64}$/);
  assert.equal(sent.headers.Authorization, `Bearer ${live.RESEND_API_KEY}`);
  assert.equal(h.storage.map.get('guard-v1').mails.length, 1);
});

test('request test mode never mails with live deployment; live request is refused by test deployment', async () => {
  const h = setup(live);
  const request = h.request(payload(0, { mode: 'test' }));
  const tested = await handleForm(request, h.env, { fetch: h.fetcher, now: () => START });
  assert.equal((await tested.json()).mode, 'test'); assert.equal(h.requests.length, 1);
  assert.equal(h.storage.map.get('guard-v1').mails.length, 0);
  const disabled = setup(); const rejected = await disabled.submit(payload(1, { mode: 'live' }));
  assert.equal((await rejected.json()).code, 'MODE'); assert.equal(rejected.status, 503); assert.equal(disabled.requests.length, 0);
});

test('a protected test does not block the first live submission of the same content', async () => {
  const h = setup(live); const data = payload();
  const tested = await handleForm(h.request(data), h.env, { fetch: h.fetcher, now: () => START });
  assert.equal((await tested.json()).code, 'TEST_ACCEPTED');
  const sent = await h.submit({ ...data, mode: 'live', submissionId: crypto.randomUUID(), token: 'fresh-live-token' });
  assert.equal((await sent.json()).code, 'SENT');
  const duplicate = await h.submit({ ...data, mode: 'live', submissionId: crypto.randomUUID(), token: 'another-live-token' });
  assert.equal((await duplicate.json()).code, 'DUPLICATE');
  assert.equal(h.requests.filter(entry => entry.url.includes('resend')).length, 1);
});

test('strict origin, route, method, content type, preflight, IP and encoding gates run before network', async () => {
  const h = setup();
  for (const headers of [{ Origin: 'https://attacker.example' }, { Origin: '' }, { 'Content-Type': 'text/plain' }, { 'CF-Connecting-IP': '' }, { 'Content-Encoding': 'gzip' }]) {
    const response = await h.submit(payload(), headers); assert.ok(response.status >= 400);
  }
  for (const [method, path] of [['GET', '/submit'], ['PUT', '/submit'], ['POST', '/submit?debug=yes'], ['POST', '/mail']]) {
    const response = await handleForm(new Request(`${WORKER}${path}`, { method, headers: { Origin: ORIGIN } }), h.env);
    assert.ok(response.status >= 400);
  }
  const preflight = await handleForm(new Request(`${WORKER}/submit`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } }), h.env);
  assert.equal(preflight.status, 200); assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
  const wrong = await handleForm(new Request(`${WORKER}/submit`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'DELETE' } }), h.env);
  assert.equal(wrong.status, 403); assert.equal(h.requests.length, 0);
});

test('honeypot, consent, unknown fields, CRLF headers, lengths, links and missing token fail closed', async () => {
  for (const change of [{ website: 'bot' }, { privacy: false }, { name: '' }, { email: 'a@example.nl\r\nBcc:spam@example.nl' }, { subject: 'Vraag\nBcc' },
    { message: 'short' }, { message: 'x'.repeat(5001) }, { message: 'https://a.nl https://b.nl https://c.nl https://d.nl' }, { submissionId: 'not-a-uuid' }, { token: '' }, { token: 'x'.repeat(2049) }]) {
    const h = setup(live); const response = await h.submit(payload(0, change)); assert.equal(response.status, 400); assert.equal(h.requests.length, 0);
  }
});

test('actual streamed body byte cap cannot be bypassed by missing content-length', async () => {
  const h = setup(); const response = await h.submit(payload(0, { message: 'x'.repeat(40_000) }));
  assert.equal(response.status, 413); assert.equal(h.requests.length, 0);
  const badJson = h.request(payload(), {}, { body: '{"broken"' });
  const bad = await handleForm(badJson, h.env, { fetch: h.fetcher }); assert.equal(bad.status, 400);
});

test('Turnstile failure, replay, action, hostname, expiry and malformed responses never reach mail', async () => {
  const checks = [
    { success: false, 'error-codes': ['timeout-or-duplicate'] }, { success: false, 'error-codes': ['invalid-input-response'] },
    { success: true, hostname: 'attacker.example', action: 'contact', challenge_ts: new Date(START).toISOString() },
    { success: true, hostname: 'drkwdtest.xanderfaase.nl', action: 'idee', challenge_ts: new Date(START).toISOString() },
    { success: true, hostname: 'drkwdtest.xanderfaase.nl', action: 'contact', challenge_ts: new Date(START - 301_000).toISOString() },
    { success: true, hostname: 'drkwdtest.xanderfaase.nl', action: 'contact', challenge_ts: new Date(START + 31_000).toISOString() },
    { success: true, hostname: 'drkwdtest.xanderfaase.nl', action: 'contact' }
  ];
  for (const result of checks) {
    const h = setup(live); let calls = 0;
    const response = await h.submit(payload(), {}, async url => { calls++; assert.ok(url.includes('siteverify')); return Response.json(result); });
    assert.equal((await response.json()).code, 'CAPTCHA'); assert.equal(calls, 1); assert.equal(h.storage.map.get('guard-v1').mails.length, 0);
  }
});

test('idea action is accepted only for idea form', async () => {
  const h = setup(); const response = await h.submit(payload(0, { form: 'idee' }), {}, async () => Response.json({ success: true, hostname: 'drkwdtest.xanderfaase.nl', action: 'idee', challenge_ts: new Date(START).toISOString() }));
  assert.equal((await response.json()).code, 'TEST_ACCEPTED');
});

test('Turnstile outage, redirect, invalid secret and non-JSON response never reach mail or leak upstream text', async () => {
  for (const fetcher of [async () => { throw new Error('Secret: re_private_secret turnstile-private-secret'); }, async () => new Response('secret', { status: 302, headers: { Location: 'https://evil.example' } }),
    async () => new Response('not json'), async () => Response.json({ success: false, 'error-codes': ['invalid-input-secret'] }), async () => Response.json({ success: false, 'error-codes': ['internal-error'] })]) {
    const h = setup(live); const response = await h.submit(payload(), {}, fetcher); const text = await response.text();
    assert.equal(response.status, 503); assert.match(text, /CAPTCHA_UNAVAILABLE/); assert.ok(!text.includes('private_secret')); assert.equal(h.storage.map.get('guard-v1').mails.length, 0);
  }
});

test('same message and same token cannot be replayed even with new submission id', async () => {
  const h = setup(live); const data = payload(); assert.equal((await h.submit(data)).status, 200);
  const duplicate = await h.submit({ ...data, submissionId: crypto.randomUUID(), token: 'new-token' }); assert.equal((await duplicate.json()).code, 'DUPLICATE');
  const replay = await h.submit(payload(1, { token: data.token })); assert.equal((await replay.json()).code, 'TOKEN_REPLAY');
  assert.equal(h.requests.filter(entry => entry.url.includes('resend')).length, 1);
});

test('same UUID may retry a definite pre-mail denial with a new token, without allowing token replay', async () => {
  const h = setup(); const data = payload();
  const denied = await h.submit(data, {}, async () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }));
  assert.equal((await denied.json()).code, 'CAPTCHA');
  const replay = await h.submit(data); assert.equal((await replay.json()).code, 'TOKEN_REPLAY');
  const accepted = await h.submit({ ...data, token: 'fresh-token' }); assert.equal((await accepted.json()).code, 'TEST_ACCEPTED');
});

test('concurrent requests share one persisted global lease and cannot send twice', async () => {
  const h = setup(live); let release; const blocked = new Promise(resolve => { release = resolve; }); let reached; const siteverifyReached = new Promise(resolve => { reached = resolve; });
  const fetcher = async (url, options) => {
    if (url.includes('siteverify')) { reached(); await blocked; } return h.fetcher(url, options);
  };
  const first = h.submit(payload(0), {}, fetcher); await siteverifyReached;
  const others = await Promise.all(Array.from({ length: 12 }, (_, index) => h.submit(payload(index + 1), { 'CF-Connecting-IP': `203.0.113.${index + 10}` })));
  for (const response of others) assert.equal((await response.json()).code, 'BUSY');
  release(); assert.equal((await first).status, 200); assert.equal(h.requests.filter(entry => entry.url.includes('resend')).length, 1);
});

test('IP attempt limit persists across object restart and reset occurs after retention', async () => {
  const h = setup();
  for (let i = 0; i < 3; i++) assert.equal((await h.submit(payload(i))).status, 200);
  const restarted = new FormGuard({ storage: h.storage }, h.env); h.env.FORM_GUARD.get = () => ({ fetch: request => restarted.fetch(request) });
  const limited = await h.submit(payload(4)); assert.equal((await limited.json()).code, 'RATE_IP');
  h.setTime(START + DAY + 1); assert.equal((await h.submit(payload(5))).status, 200);
});

test('global mail cap counts reservations, prevents race and resets only after window', async () => {
  const h = setup(live);
  for (let i = 0; i < 10; i++) assert.equal((await h.submit(payload(i), { 'CF-Connecting-IP': `203.0.113.${i + 10}` })).status, 200);
  const denied = await h.submit(payload(12), { 'CF-Connecting-IP': '203.0.113.99' }); assert.equal((await denied.json()).code, 'MAIL_CAP');
  assert.equal(h.requests.filter(entry => entry.url.includes('resend')).length, 10);
  h.setTime(START + 600_001); assert.equal((await h.submit(payload(13), { 'CF-Connecting-IP': '203.0.113.99' })).status, 200);
});

test('daily global mail cap remains strict across many IP addresses', async () => {
  const h = setup(live);
  for (let i = 0; i < 50; i++) {
    h.setTime(START + Math.floor(i / 10) * 601_000);
    assert.equal((await h.submit(payload(i), { 'CF-Connecting-IP': `203.0.113.${i + 1}` })).status, 200);
  }
  h.setTime(START + 6 * 601_000);
  const limited = await h.submit(payload(99), { 'CF-Connecting-IP': '203.0.113.101' }); assert.equal((await limited.json()).code, 'MAIL_CAP');
  assert.equal(h.requests.filter(entry => entry.url.includes('resend')).length, 50);
});

test('provider timeout or redirect locks duplicate message and consumes cap; no automatic resend', async () => {
  for (const provider of [async () => { throw new Error('timeout with secret'); }, async () => new Response('secret', { status: 307, headers: { Location: 'https://evil.example' } }), async () => new Response('invalid-json'), async () => Response.json({ error: 'invalid api key' }, { status: 403 })]) {
    const h = setup(live); let emails = 0; const data = payload();
    const fetcher = async (url, options) => { if (url.includes('resend')) { emails++; return provider(); } return h.fetcher(url, options); };
    const response = await h.submit(data, {}, fetcher); assert.equal((await response.json()).code, 'UNCERTAIN');
    const second = await h.submit({ ...data, submissionId: crypto.randomUUID(), token: 'next-token' }, {}, fetcher);
    assert.equal((await second.json()).code, 'DUPLICATE'); assert.equal(emails, 1); assert.equal(h.storage.map.get('guard-v1').mails.length, 1);
  }
});

test('expired mail lease cannot authorize another send and retains uncertain fingerprint', async () => {
  const h = setup(live); const id = '1'.repeat(64); const fingerprint = '2'.repeat(64);
  const internal = async (path, data) => (await h.object.fetch(new Request(`https://guard.internal/${path}`, { method: 'POST', headers: { 'X-Guard-Secret': h.env.ANTISPAM_SECRET }, body: JSON.stringify(data) }))).json();
  const reserved = await internal('reserve', { id, fingerprint, ip: '3'.repeat(64), token: '4'.repeat(64), mode: 'live' });
  assert.equal((await internal('mail', { id, lease: reserved.lease })).ok, true);
  h.setTime(START + 90_001); await h.object.alarm();
  assert.equal(h.storage.map.get('guard-v1').records[id].status, 'uncertain');
  assert.equal((await internal('mail', { id, lease: reserved.lease })).code, 'LEASE');
  assert.equal((await internal('reserve', { id: '5'.repeat(64), fingerprint, ip: '6'.repeat(64), token: '7'.repeat(64), mode: 'live' })).code, 'DUPLICATE');
});

test('cleanup removes live anti-spam data and stops alarm after retention', async () => {
  const h = setup(); await h.submit(payload()); h.setTime(START + DAY + 1); await h.object.alarm();
  assert.equal(h.storage.map.size, 0); assert.equal(h.storage.alarm, null);
});

test('missing Durable Object, storage failure or forged internal requests fail closed', async () => {
  const h = setup(live); const rejected = await h.object.fetch(new Request('https://guard.internal/reserve', { method: 'POST', body: '{}' })); assert.equal(rejected.status, 403);
  h.env.FORM_GUARD.get = () => ({ fetch: async () => { throw new Error('private storage error with secret'); } });
  const response = await h.submit(payload()); assert.equal(response.status, 503); assert.equal(h.requests.length, 0);
  delete h.env.FORM_GUARD; const missing = await h.submit(payload()); assert.equal((await missing.json()).code, 'CONFIG');
});

test('default fetch preserves global receiver and never uses unsupported redirect:error', async () => {
  const original = globalThis.fetch; const h = setup();
  globalThis.fetch = function (url, options) { assert.equal(this, globalThis); assert.equal(options.redirect, 'manual'); return h.fetcher(url, options); };
  try { const response = await handleForm(h.request(payload()), h.env, { now: () => START }); assert.equal(response.status, 200); }
  finally { globalThis.fetch = original; }
});
