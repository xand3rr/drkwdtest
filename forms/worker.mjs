/* Dorpsraad Kwadendamme: separate forms Worker. No message is persisted here. */
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const MAX_BYTES = 32_768;
const LEASE_MS = 90_000;
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RESEND = 'https://api.resend.com/emails';
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

class FormError extends Error {
  constructor(code, status = 400, retryAfter = 0) { super(code); this.code = code; this.status = status; this.retryAfter = retryAfter; }
}

function settings(env) {
  let origin;
  try { origin = new URL(env.SITE_ORIGIN); } catch { throw new FormError('CONFIG', 503); }
  if (origin.protocol !== 'https:' || origin.origin !== env.SITE_ORIGIN || origin.username || origin.password ||
      !['test', 'live'].includes(env.MODE) || !env.TURNSTILE_SECRET_KEY ||
      typeof env.ANTISPAM_SECRET !== 'string' || env.ANTISPAM_SECRET.length < 32 ||
      !env.FORM_GUARD?.idFromName || !env.FORM_GUARD?.get) throw new FormError('CONFIG', 503);
  if (env.MODE === 'live' && (!env.RESEND_API_KEY || !validEmail(env.MAIL_FROM) || !validEmail(env.MAIL_TO))) {
    throw new FormError('MAIL_CONFIG', 503);
  }
  return { origin: origin.origin, hostname: origin.hostname, mode: env.MODE };
}

function validEmail(value) { return typeof value === 'string' && value.length <= 254 && EMAIL.test(value) && !value.includes('..'); }

function reply(data, status, origin = '', retryAfter = 0) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'Vary': 'Origin'
  };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  if (retryAfter) headers['Retry-After'] = String(retryAfter);
  return new Response(JSON.stringify(data), { status, headers });
}

function message(code) {
  if (code === 'TEST_ACCEPTED') return 'De beveiligde test is geslaagd. Dit bericht is niet verstuurd.';
  if (code === 'SENT') return 'Je bericht is aangenomen voor verzending naar de dorpsraad.';
  if (['CAPTCHA', 'TOKEN_REPLAY'].includes(code)) return 'De beveiligingscontrole is verlopen of niet gelukt. Voer de controle opnieuw uit.';
  if (code === 'DUPLICATE') return 'Dit bericht is al verwerkt of wordt nog verwerkt. Verstuur het niet opnieuw.';
  if (code === 'UNCERTAIN') return 'We kunnen de verzending niet bevestigen. Verstuur dit bericht niet opnieuw; neem zo nodig rechtstreeks contact op.';
  if (['RATE_IP', 'RATE_GLOBAL', 'MAIL_CAP', 'BUSY'].includes(code)) return 'Er zijn momenteel te veel berichten. Probeer het later opnieuw.';
  if (['INPUT', 'BODY', 'SIZE', 'HONEYPOT'].includes(code)) return 'Controleer de ingevulde velden en probeer het opnieuw.';
  return 'Het formulier is tijdelijk niet beschikbaar. Probeer het later opnieuw.';
}

function log(env, code) {
  // Never log the request, error text, IP, email, body, token or secrets.
  const event = JSON.stringify({ event: 'form', code });
  if (typeof env.__log === 'function') env.__log(event); else console.log(event);
}

async function readJson(request) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') || '') ||
      !['', 'identity'].includes(request.headers.get('content-encoding') || '')) throw new FormError('BODY', 415);
  const advertised = request.headers.get('content-length');
  if (advertised && (!/^\d+$/.test(advertised) || Number(advertised) > MAX_BYTES)) throw new FormError('SIZE', 413);
  if (!request.body) throw new FormError('BODY');
  const reader = request.body.getReader();
  let timer;
  const read = async () => {
    const chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new FormError('SIZE', 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new FormError('BODY'); }
  };
  try {
    return await Promise.race([read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new FormError('BODY', 408)), 10_000); })]);
  } catch (error) { reader.cancel().catch(() => {}); throw error; }
  finally { clearTimeout(timer); }
}

function input(data) {
  const keys = ['form', 'mode', 'name', 'email', 'subject', 'message', 'privacy', 'website', 'submissionId', 'token'];
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(key => !keys.includes(key))) throw new FormError('INPUT');
  if (!['contact', 'idee'].includes(data.form) || !['test', 'live'].includes(data.mode) || data.privacy !== true || !UUID.test(data.submissionId || '')) throw new FormError('INPUT');
  if (typeof data.website !== 'string' || data.website.length) throw new FormError('HONEYPOT');
  for (const [key, min, max] of [['name', 2, 100], ['subject', 2, 160], ['message', 10, 5000]]) {
    if (typeof data[key] !== 'string') throw new FormError('INPUT');
    data[key] = data[key].trim().normalize('NFC');
    if (data[key].length < min || data[key].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(data[key]) ||
        (key !== 'message' && /[\r\n\t]/.test(data[key]))) throw new FormError('INPUT');
  }
  if (typeof data.email !== 'string') throw new FormError('INPUT');
  data.email = data.email.trim();
  if (!validEmail(data.email) || (data.message.match(/https?:\/\/|www\./gi) || []).length > 3) throw new FormError('INPUT');
  if (typeof data.token !== 'string' || !data.token.length || data.token.length > 2048 || /\s|[^\x21-\x7e]/.test(data.token)) throw new FormError('CAPTCHA');
  return data;
}

async function digest(secret, label, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${label}\n${value}`)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function guard(env, path, payload) {
  const instance = env.FORM_GUARD.get(env.FORM_GUARD.idFromName('kwadendamme-global-v1'));
  const response = await instance.fetch(new Request(`https://guard.internal/${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guard-Secret': env.ANTISPAM_SECRET }, body: JSON.stringify(payload)
  }));
  if (!response.ok) throw new FormError('GUARD_UNAVAILABLE', 503);
  const result = await response.json();
  if (!result?.ok) throw new FormError(result?.code || 'GUARD_UNAVAILABLE', result?.status || 503, result?.retryAfter || 0);
  return result;
}

async function verify(fetcher, env, config, data, ip, now) {
  let response, result;
  try {
    response = await fetcher(SITEVERIFY, {
      method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: data.token, remoteip: ip }),
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('upstream');
    result = await response.json();
  } catch { throw new FormError('CAPTCHA_UNAVAILABLE', 503); }
  if (result?.success !== true) {
    if ((result?.['error-codes'] || []).some(code => ['internal-error', 'invalid-input-secret', 'missing-input-secret'].includes(code))) throw new FormError('CAPTCHA_UNAVAILABLE', 503);
    throw new FormError('CAPTCHA');
  }
  const age = now - Date.parse(result.challenge_ts);
  if (result.hostname !== config.hostname || result.action !== data.form || !Number.isFinite(age) || age > 300_000 || age < -30_000) throw new FormError('CAPTCHA');
}

/** Exported for dependency-free tests; production uses only default.fetch. */
export async function handleForm(request, env, dependencies = {}) {
  let config, record, mailStarted = false;
  const fetcher = dependencies.fetch || globalThis.fetch.bind(globalThis);
  const now = dependencies.now || Date.now;
  let cors = '';
  try {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/' && !url.search) {
      let ready = false; try { config = settings(env); ready = true; } catch { /* Public health does not expose values. */ }
      return reply({ ok: ready, code: ready ? 'READY' : 'CONFIG', mode: ['test', 'live'].includes(env.MODE) ? env.MODE : 'unset', message: ready ? 'Dorpsraad Kwadendamme: formulierbeveiliging ingesteld.' : 'Dorpsraad Kwadendamme: formulierworker nog niet volledig ingesteld.' }, ready ? 200 : 503);
    }
    if (url.pathname !== '/submit' || url.search) throw new FormError('NOT_FOUND', 404);
    if (!['POST', 'OPTIONS'].includes(request.method)) throw new FormError('METHOD', 405);
    config = settings(env);
    if (request.headers.get('origin') !== config.origin) throw new FormError('ORIGIN', 403);
    cors = config.origin;
    if (request.method === 'OPTIONS') {
      const asked = (request.headers.get('access-control-request-headers') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
      if (request.headers.get('access-control-request-method') !== 'POST' || asked.some(value => value !== 'content-type')) throw new FormError('ORIGIN', 403);
      const response = reply({}, 200, cors);
      response.headers.set('Access-Control-Allow-Methods', 'POST'); response.headers.set('Access-Control-Allow-Headers', 'Content-Type');
      response.headers.set('Access-Control-Max-Age', '600'); return response;
    }
    const data = input(await readJson(request));
    // A test request can never send mail, even against a Worker enabled for live.
    if (data.mode === 'live' && config.mode !== 'live') throw new FormError('MODE', 503);
    config = { ...config, mode: data.mode };
    // CF-Connecting-IP is supplied by Cloudflare on the public Worker route. No forwarded headers are trusted.
    const ip = request.headers.get('cf-connecting-ip');
    if (!ip || ip.length > 64 || !/^[0-9a-f:.]+$/i.test(ip)) throw new FormError('IP', 400);
    const normalized = JSON.stringify([config.mode, data.form, data.email.toLowerCase(), data.subject.replace(/\s+/g, ' '), data.message.replace(/\s+/g, ' ')]);
    const [ipKey, fingerprint, id, tokenKey] = await Promise.all([
      digest(env.ANTISPAM_SECRET, 'ip', ip), digest(env.ANTISPAM_SECRET, 'message', normalized),
      digest(env.ANTISPAM_SECRET, 'submission', data.submissionId), digest(env.ANTISPAM_SECRET, 'token', data.token)
    ]);
    record = { id, ...(await guard(env, 'reserve', { id, ip: ipKey, fingerprint, token: tokenKey, mode: config.mode })) };
    await verify(fetcher, env, config, data, ip, now());
    if (config.mode === 'test') {
      await guard(env, 'finish', { id, lease: record.lease, outcome: 'tested' });
      log(env, 'TEST_ACCEPTED'); return reply({ ok: true, code: 'TEST_ACCEPTED', mode: 'test', message: message('TEST_ACCEPTED') }, 200, cors);
    }
    await guard(env, 'mail', { id, lease: record.lease });
    mailStarted = true;
    let sent;
    try {
      const response = await fetcher(RESEND, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(12_000),
        headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `kwadendamme/${id}` },
        body: JSON.stringify({
          from: env.MAIL_FROM, to: [env.MAIL_TO], reply_to: data.email,
          subject: `${data.form === 'idee' ? 'Dorpsidee' : 'Contact'}: ${data.subject}`,
          text: `Formulier: ${data.form}\nNaam: ${data.name}\nE-mailadres: ${data.email}\nOnderwerp: ${data.subject}\n\n${data.message}`
        })
      });
      if (!response.ok) throw new Error('upstream');
      sent = await response.json();
      if (typeof sent?.id !== 'string' || !sent.id) throw new Error('upstream');
    } catch { throw new FormError('UNCERTAIN', 503); }
    await guard(env, 'finish', { id, lease: record.lease, outcome: 'sent' });
    log(env, 'SENT'); return reply({ ok: true, code: 'SENT', mode: 'live', message: message('SENT') }, 200, cors);
  } catch (error) {
    let safe = error instanceof FormError ? error : new FormError(mailStarted ? 'UNCERTAIN' : 'UNAVAILABLE', 503);
    if (mailStarted && safe.code !== 'UNCERTAIN') safe = new FormError('UNCERTAIN', 503);
    if (record?.lease) {
      try { await guard(env, 'finish', { id: record.id, lease: record.lease, outcome: mailStarted ? 'uncertain' : 'denied' }); }
      catch { /* Stored pending lease remains fail-closed until expiry; never retry mail here. */ }
    }
    log(env, safe.code);
    return reply({ ok: false, code: safe.code, mode: config?.mode || 'unset', message: message(safe.code) }, safe.status, cors, safe.retryAfter);
  }
}

function blank() { return { attempts: [], records: {}, mails: [], counts: [] }; }

function clean(state, now) {
  state.attempts = state.attempts.filter(entry => entry.at > now - DAY);
  state.mails = state.mails.filter(at => at > now - DAY);
  state.counts = state.counts.filter(entry => entry.at > now - DAY);
  for (const [id, entry] of Object.entries(state.records)) {
    if (entry.expires <= now) { delete state.records[id]; continue; }
    if (entry.status === 'pending' && entry.leaseUntil <= now) {
      entry.status = entry.mailReserved ? 'uncertain' : 'denied';
      if (!entry.mailReserved) entry.expires = now + 5 * MINUTE;
    }
  }
  if (state.active && (!state.records[state.active.id] || state.active.until <= now)) state.active = null;
}

/** Legacy fetch-style Durable Object requires no cloudflare:workers import. */
export class FormGuard {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async change(mutate) {
    const now = typeof this.env.__now === 'function' ? this.env.__now() : Date.now();
    const result = await this.ctx.storage.transaction(async txn => {
      const state = (await txn.get('guard-v1')) || blank();
      clean(state, now);
      const result = mutate(state, now);
      await txn.put('guard-v1', state);
      return result;
    });
    await this.ctx.storage.setAlarm(now + 5 * MINUTE);
    return result;
  }
  async alarm() {
    const now = typeof this.env.__now === 'function' ? this.env.__now() : Date.now();
    let remains = false;
    await this.ctx.storage.transaction(async txn => {
      const state = (await txn.get('guard-v1')) || blank(); clean(state, now);
      remains = !!(state.attempts.length || state.mails.length || Object.keys(state.records).length || state.counts.length);
      if (remains) await txn.put('guard-v1', state); else await txn.delete('guard-v1');
    });
    if (remains) await this.ctx.storage.setAlarm(now + 5 * MINUTE);
    else await this.ctx.storage.deleteAlarm();
  }
  async fetch(request) {
    if (request.method !== 'POST' || !this.env.ANTISPAM_SECRET || request.headers.get('x-guard-secret') !== this.env.ANTISPAM_SECRET) return reply({ ok: false }, 403);
    let data; try { data = await request.json(); } catch { return reply({ ok: false }, 400); }
    if (!data || !HASH.test(data.id || '')) return reply({ ok: false }, 400);
    const path = new URL(request.url).pathname;
    if (path === '/reserve' && (![data.ip, data.fingerprint, data.token].every(value => HASH.test(value || '')) || !['test', 'live'].includes(data.mode))) return reply({ ok: false }, 400);
    const result = await this.change((state, now) => {
      const reject = (code, status = 429, retryAfter = 600) => {
        // Count only aggregate rejection codes, never submitted data.
        state.counts.push({ at: now, code }); state.counts = state.counts.slice(-1000);
        return { ok: false, code, status, retryAfter };
      };
      if (path === '/reserve') {
        if (state.attempts.filter(entry => entry.at > now - MINUTE).length >= 60 || state.attempts.length >= 600) return reject('RATE_GLOBAL');
        if (state.attempts.filter(entry => entry.ip === data.ip && entry.at > now - 10 * MINUTE).length >= 3 || state.attempts.filter(entry => entry.ip === data.ip).length >= 10) return reject('RATE_IP');
        state.attempts.push({ ip: data.ip, at: now });
        // A definitively denied pre-mail request may retry with the same UUID and a new token.
        // Pending, delivered, tested and uncertain submissions remain blocked.
        if (state.records[data.id] && state.records[data.id].status !== 'denied') return reject('DUPLICATE', 409, 0);
        const records = Object.values(state.records);
        if (records.some(entry => entry.token === data.token)) return reject('TOKEN_REPLAY', 400, 0);
        if (records.some(entry => entry.fingerprint === data.fingerprint && ['pending', 'tested', 'sent', 'uncertain'].includes(entry.status))) return reject('DUPLICATE', 409, 0);
        if (state.active) return reject('BUSY', 429, 10);
        const lease = crypto.randomUUID();
        state.records[data.id] = { fingerprint: data.fingerprint, token: data.token, status: 'pending', lease, leaseUntil: now + LEASE_MS, expires: now + DAY, mode: data.mode };
        state.active = { id: data.id, until: now + LEASE_MS };
        return { ok: true, lease };
      }
      const entry = state.records[data.id];
      if (!entry || entry.status !== 'pending' || entry.lease !== data.lease || entry.leaseUntil <= now || state.active?.id !== data.id) return reject('LEASE', 503, 0);
      if (path === '/mail') {
        if (entry.mode !== 'live' || entry.mailReserved) return reject('LEASE', 503, 0);
        if (state.mails.length >= 50 || state.mails.filter(at => at > now - 10 * MINUTE).length >= 10) return reject('MAIL_CAP');
        // Reserve capacity before network I/O. Failed/uncertain provider attempts also consume quota.
        state.mails.push(now); entry.mailReserved = true; return { ok: true };
      }
      if (path === '/finish') {
        if (!['tested', 'sent', 'denied', 'uncertain'].includes(data.outcome) ||
            (data.outcome === 'tested' && (entry.mode !== 'test' || entry.mailReserved)) ||
            (['sent', 'uncertain'].includes(data.outcome) && !entry.mailReserved)) return reject('LEASE', 503, 0);
        entry.status = data.outcome; if (data.outcome === 'denied') entry.expires = now + 5 * MINUTE;
        state.active = null; state.counts.push({ at: now, code: data.outcome.toUpperCase() });
        return { ok: true };
      }
      return reject('NOT_FOUND', 404, 0);
    });
    return reply(result, 200);
  }
}

export default { fetch: handleForm };
