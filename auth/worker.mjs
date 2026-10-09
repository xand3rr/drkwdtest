// Decap GitHub OAuth bridge for one website and one repository.
// Deploy this component separately from the GitHub Pages website.
const COOKIE = '__Host-kwadendamme-oauth';
const MAX_AGE = 600;
const encoder = new TextEncoder();

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}

function random() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}

async function key(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signSession(session, secret) {
  const payload = encode(encoder.encode(JSON.stringify(session)));
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(payload));
  return `${payload}.${encode(new Uint8Array(signature))}`;
}

async function readSession(request, secret, now) {
  const cookies = request.headers.get('Cookie') || '';
  const value = cookies.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!value || value.length > 1800) return null;
  try {
    const [payload, signature, extra] = value.split('.');
    if (!payload || !signature || extra) return null;
    if (!await crypto.subtle.verify('HMAC', await key(secret), decode(signature), encoder.encode(payload))) return null;
    const data = JSON.parse(new TextDecoder().decode(decode(payload)));
    if (!data || !/^[A-Za-z0-9_-]{43}$/.test(data.state) || !/^[A-Za-z0-9_-]{43}$/.test(data.verifier)) return null;
    if (!Number.isInteger(data.expires) || data.expires <= now || data.expires > now + MAX_AGE) return null;
    return data;
  } catch { return null; }
}

function cookie(value, age = MAX_AGE) {
  return `${COOKIE}=${value}; Max-Age=${age}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

function configuredOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Invalid origin');
  return url.origin;
}

function config(env) {
  const siteOrigin = configuredOrigin(env.SITE_ORIGIN);
  const workerOrigin = configuredOrigin(env.WORKER_ORIGIN);
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPO || '')) throw new Error('Invalid repository');
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || (env.SESSION_SECRET || '').length < 32) throw new Error('Missing secrets');
  if (!['false', 'true'].includes(env.PRIVATE_REPO || 'false')) throw new Error('Invalid scope');
  return { siteOrigin, workerOrigin, repo: env.GITHUB_REPO, scope: env.PRIVATE_REPO === 'true' ? 'repo' : 'public_repo' };
}

function headers(extra = {}) {
  return {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cross-Origin-Opener-Policy': 'unsafe-none',
    ...extra
  };
}

function text(message, status = 200, extra = {}) {
  return new Response(message, { status, headers: headers({ 'Content-Type': 'text/plain; charset=utf-8', ...extra }) });
}

// Only fixed strings and a validated token are used here. Escaping < prevents
// a GitHub response from ever closing the inline script element.
function js(value) {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
}

function callbackPage(origin, token, error) {
  const nonce = random();
  const result = error
    ? `authorization:github:error:${JSON.stringify({ message: error })}`
    : `authorization:github:success:${JSON.stringify({ token, provider: 'github' })}`;
  const html = `<!doctype html><html lang="nl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Inloggen bij de dorpswebsite</title><body><p id="status">De aanmelding wordt afgerond. Dit venster sluit automatisch.</p><script nonce="${nonce}">
    const targetOrigin = ${js(origin)};
    const result = ${js(result)};
    const status = document.getElementById('status');
    if (!window.opener) {
      status.textContent = 'Open de beheerpagina en meld je daar opnieuw aan.';
    } else {
      const opener = window.opener;
      function receive(event) {
        if (event.source !== opener || event.origin !== targetOrigin || event.data !== 'authorizing:github') return;
        window.removeEventListener('message', receive);
        opener.postMessage(result, targetOrigin);
        status.textContent = ${js(error ? 'Aanmelding geweigerd. Je kunt dit venster sluiten.' : 'Je bent aangemeld. Je kunt dit venster sluiten.')};
        window.close();
      }
      window.addEventListener('message', receive);
      opener.postMessage('authorizing:github', targetOrigin);
      setTimeout(() => { window.removeEventListener('message', receive); status.textContent = 'De beheerpagina reageert niet. Sluit dit venster en probeer opnieuw vanaf de beheerpagina.'; }, 20000);
    }
  </script></body></html>`;
  return new Response(html, { headers: headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Set-Cookie': cookie('', 0),
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`
  }) });
}

export async function handle(request, env, dependencies = {}) {
  const fetcher = dependencies.fetch || fetch;
  const now = Math.floor((dependencies.now?.() ?? Date.now()) / 1000);
  let cfg;
  try { cfg = config(env); } catch { return text('De loginserver is nog niet volledig ingesteld. Controleer de variabelen en secrets uit docs/LOGIN.md.', 503); }
  const url = new URL(request.url);
  if (url.origin !== cfg.workerOrigin) return text('Onjuist adres voor de loginserver.', 400);
  if (request.method !== 'GET') return text('Alleen GET is toegestaan.', 405, { Allow: 'GET' });
  if (url.pathname === '/') return text('Dorpsraad Kwadendamme: loginserver is ingesteld. Start de aanmelding via de beheerpagina van de website.');
  if (url.pathname === '/auth') {
    if (url.searchParams.get('provider') !== 'github') return text('Alleen GitHub wordt ondersteund.', 400);
    if (url.searchParams.get('site_id') !== new URL(cfg.siteOrigin).hostname) return text('Deze website is niet toegestaan.', 403);
    const requestOrigin = request.headers.get('Origin');
    if (requestOrigin && requestOrigin !== cfg.siteOrigin) return text('Deze herkomst is niet toegestaan.', 403);
    const state = random();
    const verifier = random();
    const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))));
    const session = await signSession({ state, verifier, expires: now + MAX_AGE }, env.SESSION_SECRET);
    const authorization = new URL('https://github.com/login/oauth/authorize');
    authorization.search = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: `${cfg.workerOrigin}/callback`, scope: cfg.scope, state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    return new Response(null, { status: 302, headers: headers({ Location: authorization.href, 'Set-Cookie': cookie(session) }) });
  }
  if (url.pathname !== '/callback') return text('Pagina niet gevonden.', 404);
  const session = await readSession(request, env.SESSION_SECRET, now);
  if (!session || url.searchParams.get('state') !== session.state) return text('De aanmelding is verlopen of ongeldig. Sluit dit venster en meld je opnieuw aan via de beheerpagina.', 400, { 'Set-Cookie': cookie('', 0) });
  if (url.searchParams.has('error')) return callbackPage(cfg.siteOrigin, null, 'Aanmelding geannuleerd of geweigerd door GitHub.');
  const code = url.searchParams.get('code');
  if (!code || !/^[A-Za-z0-9_-]{1,256}$/.test(code)) return callbackPage(cfg.siteOrigin, null, 'GitHub stuurde geen geldige aanmeldcode.');
  try {
    const exchange = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code, redirect_uri: `${cfg.workerOrigin}/callback`, code_verifier: session.verifier }),
      signal: AbortSignal.timeout(10000)
    });
    if (!exchange.ok) throw new Error('Exchange failed');
    const data = await exchange.json();
    if (!data || typeof data.access_token !== 'string' || !/^[A-Za-z0-9_]{20,512}$/.test(data.access_token) || data.error) throw new Error('No token');
    const repository = await fetcher(`https://api.github.com/repos/${cfg.repo}`, {
      redirect: 'error', headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${data.access_token}`, 'User-Agent': 'kwadendamme-decap-login', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(10000)
    });
    if (!repository.ok) return callbackPage(cfg.siteOrigin, null, 'Je GitHub-account heeft geen toegang tot de ingestelde website-repository.');
    const repo = await repository.json();
    if (repo.full_name?.toLowerCase() !== cfg.repo.toLowerCase() || repo.permissions?.push !== true) return callbackPage(cfg.siteOrigin, null, 'Je hebt schrijfrecht op de website-repository nodig om inhoud te bewerken.');
    return callbackPage(cfg.siteOrigin, data.access_token, null);
  } catch {
    return callbackPage(cfg.siteOrigin, null, 'GitHub reageerde niet goed. Sluit dit venster en probeer opnieuw.');
  }
}

export default { fetch: handle };
