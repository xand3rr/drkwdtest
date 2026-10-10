import test from 'node:test';
import assert from 'node:assert/strict';
import { initRemoteForms, loadTurnstile } from '../public/assets/forms.js';

class Node {
  constructor(tag = 'div') { this.tagName = tag; this.dataset = {}; this.listeners = {}; this.disabled = false; this.hidden = false; this.textContent = ''; this.children = []; }
  addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  emit(name) { return Promise.all((this.listeners[name] || []).map(fn => fn({ preventDefault() {} }))); }
  append(...children) { this.children.push(...children); }
  after(node) { this.form.retry = node; this.form.elements.push(node); }
  remove() { this.removed = true; }
}

function fixture(dataset = {}) {
  const form = new Node('form'); form.dataset = { remoteForm: 'contact', action: 'contact', mode: 'verified-test',
    endpoint: 'https://kwadendamme-formulieren.xanderfaase-cloudflare.workers.dev/submit', sitekey: '0x4AAAAAAFSmQf4b9cy9HPxm', ...dataset };
  const status = new Node(); const container = new Node(); container.form = form;
  const submit = new Node('button'); submit.type = 'submit'; const fieldset = new Node('fieldset'); fieldset.disabled = true;
  const values = { name: 'Dorpsbewoner', email: 'bewoner@example.nl', subject: 'Een vraag', message: 'Een bericht aan de dorpsraad.', website: '' };
  const controls = Object.fromEntries(Object.entries(values).map(([key, value]) => { const node = new Node('input'); node.name = key; node.value = value; return [key, node]; }));
  controls.consent = new Node('input'); controls.consent.checked = true;
  form.elements = [...Object.values(controls), submit, fieldset];
  form.elements.namedItem = name => controls[name];
  form.querySelector = selector => ({ '[data-form-status]': status, '[data-form-feedback]': status, '[data-turnstile]': container,
    'button[type="submit"], input[type="submit"]': submit, '[data-form-fields]': fieldset, '[data-turnstile-retry]': form.retry }[selector] || null);
  form.valid = true; form.reportValidity = () => form.valid; form.resets = 0;
  form.reset = () => { form.resets++; for (const node of Object.values(controls)) { if ('value' in node) node.value = ''; node.checked = false; } };
  form.refill = () => { for (const [key, value] of Object.entries(values)) controls[key].value = value; controls.consent.checked = true; };
  const doc = { querySelectorAll: selector => selector === '[data-remote-form]' ? [form] : [], createElement: tag => new Node(tag), head: new Node('head') };
  const widgets = [];
  const turnstile = { resets: 0, render: (_, options) => { widgets.push(options); return `widget-${widgets.length}`; }, reset() { this.resets++; } };
  const requests = [];
  const fetcher = async (url, options) => { requests.push({ url, options }); return Response.json({ ok: true, code: form.dataset.mode === 'live' ? 'SENT' : 'TEST_ACCEPTED', mode: form.dataset.mode === 'live' ? 'live' : 'test' }); };
  const dependencies = { window: { crypto }, loadTurnstile: async () => turnstile, fetch: fetcher };
  return { form, status, container, submit, fieldset, controls, doc, turnstile, widgets, requests, dependencies,
    init: overrides => initRemoteForms(doc, { ...dependencies, ...overrides }), solved: (value = 'valid-widget-token') => widgets.at(-1).callback(value) };
}

test('remote client remains blocked before successful Turnstile and sends exact protected JSON after solving', async () => {
  const h = fixture(); await h.init(); assert.equal(h.submit.disabled, true); assert.equal(h.fieldset.disabled, false);
  await h.form.emit('submit'); assert.equal(h.requests.length, 0); assert.match(h.status.textContent, /eerst de beveiligingscontrole/);
  h.solved(); assert.equal(h.submit.disabled, false); await h.form.emit('submit');
  const sent = JSON.parse(h.requests[0].options.body);
  assert.deepEqual(Object.keys(sent).sort(), ['email', 'form', 'message', 'mode', 'name', 'privacy', 'subject', 'submissionId', 'token', 'website'].sort());
  assert.equal(sent.mode, 'test'); assert.equal(sent.form, 'contact'); assert.equal(sent.privacy, true); assert.equal(sent.website, '');
  assert.equal(h.requests[0].options.redirect, 'error'); assert.equal(h.requests[0].options.credentials, 'omit');
  assert.match(sent.submissionId, /^[a-f0-9-]{36}$/); assert.equal(h.form.resets, 1); assert.equal(h.turnstile.resets, 1);
  assert.match(h.status.textContent, /test is geslaagd.*niet verstuurd/); assert.equal(h.submit.disabled, true);
  h.solved('token-next'); assert.match(h.status.textContent, /test is geslaagd/); // Confirmation survives next widget generation.
});

test('live client accepts only exact live SENT response and never reports a successful test as delivery', async () => {
  for (const result of [{ ok: true, mode: 'test', code: 'TEST_ACCEPTED' }, { ok: false, mode: 'live', code: 'SENT' }, { ok: true, mode: 'live', code: 'TEST_ACCEPTED' }, { ok: true, mode: 'live' }]) {
    const h = fixture({ mode: 'live' }); await h.init({ fetch: async () => Response.json(result) }); h.solved(); await h.form.emit('submit');
    assert.equal(h.form.resets, 0); assert.equal(h.controls.message.value, 'Een bericht aan de dorpsraad.'); assert.match(h.status.className, /notice-error/);
  }
  const h = fixture({ mode: 'live' }); await h.init(); h.solved(); await h.form.emit('submit');
  assert.equal(JSON.parse(h.requests[0].options.body).mode, 'live'); assert.equal(h.form.resets, 1); assert.match(h.status.textContent, /aangenomen voor verzending/);
});

test('configuration rejects insecure endpoint, credentials, redirects/query, invalid mode/action and key before load', async () => {
  for (const dataset of [{ endpoint: 'http://example.nl/submit' }, { endpoint: 'https://user:password@example.nl/submit' }, { endpoint: 'https://example.nl/submit?redirect=evil' },
    { endpoint: 'https://example.nl/other' }, { mode: 'local' }, { action: 'mail' }, { sitekey: '' }]) {
    const h = fixture(dataset); let calls = 0; await h.init({ loadTurnstile: async () => { calls++; throw new Error(); } });
    assert.equal(calls, 0); assert.equal(h.submit.disabled, true); await h.form.emit('submit'); assert.equal(h.requests.length, 0); assert.equal(h.form.resets, 0);
  }
});

test('expired/error token disables submit and manual retry resets challenge without losing input', async () => {
  const h = fixture(); await h.init(); h.solved(); h.widgets[0]['expired-callback']();
  assert.equal(h.submit.disabled, true); assert.equal(h.form.retry.hidden, false); await h.form.emit('submit'); assert.equal(h.requests.length, 0);
  await h.form.retry.emit('click'); assert.equal(h.turnstile.resets, 1); assert.equal(h.controls.message.value, 'Een bericht aan de dorpsraad.');
  h.solved(); h.widgets[0]['error-callback']('secret detail'); assert.equal(h.submit.disabled, true); assert.ok(!h.status.textContent.includes('secret'));
});

test('script loading outage never falls back locally; retry can initialize after recovery', async () => {
  const h = fixture(); let loads = 0; await h.init({ loadTurnstile: async () => { loads++; if (loads === 1) throw new Error('unsafe details'); return h.turnstile; } });
  assert.equal(h.submit.disabled, true); assert.match(h.status.textContent, /kon niet laden/); await h.form.emit('submit'); assert.equal(h.requests.length, 0);
  await h.form.retry.emit('click'); await Promise.resolve(); assert.equal(loads, 2); h.solved(); await h.form.emit('submit'); assert.equal(h.requests.length, 1);
});

test('pending submission disables controls and blocks double-click until single completion', async () => {
  const h = fixture(); let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
  await h.init({ fetch: async () => { calls++; await gate; return Response.json({ ok: true, code: 'TEST_ACCEPTED', mode: 'test' }); } }); h.solved();
  const pending = h.form.emit('submit'); assert.equal(h.controls.message.disabled, true); assert.equal(h.submit.disabled, true);
  await h.form.emit('submit'); assert.equal(calls, 1); release(); await pending;
  assert.equal(h.controls.message.disabled, false); assert.equal(h.fieldset.disabled, false); assert.equal(h.form.resets, 1);
});

test('failed network preserves input and UUID across retry; success starts a new UUID', async () => {
  const h = fixture(); const ids = []; let calls = 0;
  await h.init({ fetch: async (_, options) => { ids.push(JSON.parse(options.body).submissionId); if (++calls === 1) throw new Error('token-secret'); return Response.json({ ok: true, code: 'TEST_ACCEPTED', mode: 'test' }); } });
  h.solved(); await h.form.emit('submit'); assert.equal(h.form.resets, 0); assert.match(h.status.textContent, /niet bevestigen/); assert.ok(!h.status.textContent.includes('token-secret'));
  h.solved('new-token'); await h.form.emit('submit'); assert.equal(ids[0], ids[1]);
  h.form.refill(); h.solved('third-token'); await h.form.emit('submit'); assert.notEqual(ids[1], ids[2]);
});

test('request deadline aborts stalled backend and restores controls without clearing input', async () => {
  const h = fixture(); let signal;
  await h.init({ fetch: async (_, options) => { signal = options.signal; return new Promise(() => {}); }, requestTimeout: 1 }); h.solved(); await h.form.emit('submit');
  assert.equal(signal.aborted, true); assert.equal(h.form.resets, 0); assert.equal(h.controls.name.disabled, false); assert.match(h.status.className, /notice-error/);
});

test('backend errors use known safe messages and neither HTML nor untrusted response text is rendered', async () => {
  for (const [code, text] of [['CAPTCHA', /beveiligingscontrole/], ['MODE', /niet volledig ingesteld/], ['DUPLICATE', /al verwerkt/], ['UNCERTAIN', /niet bevestigen/], ['RATE_IP', /te veel berichten/], ['malicious', /tijdelijk niet beschikbaar/]]) {
    const h = fixture(); await h.init({ fetch: async () => Response.json({ ok: false, code, mode: 'test', message: '<img onerror="secret">private' }, { status: 400 }) });
    h.solved(); await h.form.emit('submit'); assert.match(h.status.textContent, text); assert.ok(!h.status.textContent.includes('<img')); assert.ok(!h.status.textContent.includes('private')); assert.equal(h.form.resets, 0);
  }
});

test('browser validation and consent/honeypot failures cannot call backend', async () => {
  for (const change of ['invalid', 'consent', 'website']) {
    const h = fixture(); await h.init(); h.solved();
    if (change === 'invalid') h.form.valid = false;
    if (change === 'consent') h.controls.consent.checked = false;
    if (change === 'website') h.controls.website.value = ' ';
    await h.form.emit('submit'); assert.equal(h.requests.length, 0); assert.equal(h.form.resets, 0);
  }
});

test('local-only pages never load Turnstile and repeated init never attaches duplicate handlers', async () => {
  let loads = 0; await initRemoteForms({ querySelectorAll: () => [] }, { loadTurnstile: () => { loads++; } }); assert.equal(loads, 0);
  const h = fixture(); await h.init(); await h.init(); assert.equal(h.widgets.length, 1); assert.equal(h.form.listeners.submit.length, 1);
});

test('official script loader is singleton, uses exact URL and supports load recovery', async () => {
  const win = {}; const doc = { createElement: tag => new Node(tag), head: new Node('head') };
  const first = loadTurnstile({ window: win, document: doc }); const second = loadTurnstile({ window: win, document: doc });
  assert.equal(first, second); assert.equal(doc.head.children.length, 1);
  const script = doc.head.children[0]; assert.equal(script.src, 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'); assert.equal(script.async, true);
  win.turnstile = { render() {}, ready: callback => callback() }; script.onload(); assert.equal(await first, win.turnstile);
  const other = {}; const broken = loadTurnstile({ window: other, document: doc }); doc.head.children.at(-1).onerror(); await assert.rejects(broken, /TURNSTILE_LOAD/);
  await Promise.resolve(); const recovered = loadTurnstile({ window: other, document: doc });
  other.turnstile = { render() {} }; doc.head.children.at(-1).onload(); assert.equal(await recovered, other.turnstile);
});

test('script load deadline rejects safely and removes broken script', async () => {
  const doc = { createElement: tag => new Node(tag), head: new Node('head') };
  await assert.rejects(loadTurnstile({ window: {}, document: doc, scriptTimeout: 1 }), /TURNSTILE_LOAD/);
  assert.equal(doc.head.children[0].removed, true);
});
