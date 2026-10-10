const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const loaders = new WeakMap();
const initialized = new WeakSet();

/** Loads the official, current Turnstile script once per browser window. */
export function loadTurnstile(options = {}) {
  const win = options.window || globalThis;
  const doc = options.document || globalThis.document;
  if (typeof win.turnstile?.render === 'function') return Promise.resolve(win.turnstile);
  if (loaders.has(win)) return loaders.get(win);
  const schedule = options.setTimeout || globalThis.setTimeout;
  const cancel = options.clearTimeout || globalThis.clearTimeout;
  let script;
  const promise = new Promise((resolve, reject) => {
    let settled = false, timer;
    const fail = () => {
      if (settled) return; settled = true; cancel(timer); script?.remove(); reject(new Error('TURNSTILE_LOAD'));
    };
    const ready = () => {
      if (settled) return;
      if (typeof win.turnstile?.render !== 'function') { fail(); return; }
      settled = true; cancel(timer); resolve(win.turnstile);
    };
    script = doc.createElement('script'); script.src = SCRIPT; script.async = true; script.defer = true;
    script.dataset.kwadendammeTurnstile = 'true'; script.referrerPolicy = 'no-referrer';
    script.onerror = fail;
    script.onload = () => { if (typeof win.turnstile?.ready === 'function') win.turnstile.ready(ready); else ready(); };
    timer = schedule(fail, options.scriptTimeout ?? 12_000);
    doc.head.append(script);
  });
  loaders.set(win, promise);
  promise.catch(() => { loaders.delete(win); });
  return promise;
}

function show(node, text, error = false) {
  if (!node) return;
  node.textContent = text; node.className = `notice ${error ? 'notice-error' : 'notice-success'}`;
}

function failure(code) {
  if (['CAPTCHA', 'TOKEN_REPLAY'].includes(code)) return 'De beveiligingscontrole is verlopen of niet gelukt. Voer de controle opnieuw uit.';
  if (['RATE_IP', 'RATE_GLOBAL', 'MAIL_CAP', 'BUSY'].includes(code)) return 'Er zijn momenteel te veel berichten. Probeer het later opnieuw.';
  if (code === 'DUPLICATE') return 'Dit bericht is al verwerkt of wordt nog verwerkt. Verstuur het niet opnieuw.';
  if (code === 'UNCERTAIN') return 'We kunnen de verzending niet bevestigen. Verstuur dit bericht niet opnieuw; neem zo nodig rechtstreeks contact op.';
  if (['INPUT', 'BODY', 'SIZE', 'HONEYPOT'].includes(code)) return 'Controleer de ingevulde velden. Je invoer is behouden.';
  if (['CONFIG', 'MAIL_CONFIG', 'MODE'].includes(code)) return 'Het formulier is nog niet volledig ingesteld. Neem voorlopig rechtstreeks contact op.';
  return 'Het formulier is tijdelijk niet beschikbaar. Je invoer is behouden. Probeer het later opnieuw.';
}

function configuration(form) {
  const endpoint = new URL(form.dataset.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash || endpoint.search ||
      endpoint.pathname !== '/submit' || !['contact', 'idee'].includes(form.dataset.action) ||
      !['verified-test', 'live'].includes(form.dataset.mode) || !/^[A-Za-z0-9_-]{10,100}$/.test(form.dataset.sitekey || '')) throw new Error('CONFIG');
  return { endpoint: endpoint.href, action: form.dataset.action, mode: form.dataset.mode === 'live' ? 'live' : 'test', sitekey: form.dataset.sitekey };
}

function fields(form) {
  const get = name => form.elements.namedItem(name);
  const text = name => { const field = get(name); if (!field || typeof field.value !== 'string') throw new Error('INPUT'); return field.value.trim(); };
  const website = get('website');
  if (!website || typeof website.value !== 'string') throw new Error('INPUT');
  return { name: text('name'), email: text('email'), subject: text('subject'), message: text('message'), website: website.value, privacy: get('consent')?.checked === true };
}

async function mount(form, doc, dependencies) {
  if (initialized.has(form)) return;
  initialized.add(form);
  const status = form.querySelector('[data-form-status]') || form.querySelector('[data-form-feedback]');
  const container = form.querySelector('[data-turnstile]');
  const submit = form.querySelector('button[type="submit"], input[type="submit"]');
  const fieldset = form.querySelector('[data-form-fields]');
  const win = dependencies.window || globalThis;
  const fetcher = dependencies.fetch || globalThis.fetch.bind(globalThis);
  const schedule = dependencies.setTimeout || globalThis.setTimeout;
  const cancel = dependencies.clearTimeout || globalThis.clearTimeout;
  let config, turnstile, widget, token = '', pending = false, submissionId, retry, hasSubmitted = false;
  if (submit) submit.disabled = true;
  if (fieldset) fieldset.disabled = false;

  const availability = () => { if (submit) submit.disabled = pending || !token || !turnstile; if (retry) retry.disabled = pending; };
  const invalid = () => { token = ''; availability(); if (retry) retry.hidden = false; if (!pending && !hasSubmitted) show(status, 'De beveiligingscontrole is verlopen of niet gelukt. Klik op Opnieuw controleren.', true); return true; };
  const resetWidget = () => {
    token = ''; availability();
    try { if (turnstile && widget !== undefined) turnstile.reset(widget); }
    catch { invalid(); }
  };

  // Listener is installed before script loading so a failed widget never falls back to ordinary submission.
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    if (!config || !turnstile || !token) { show(status, 'Voltooi eerst de beveiligingscontrole.', true); return; }
    if (!form.reportValidity()) return;
    let values;
    try { values = fields(form); if (!values.privacy || values.website) throw new Error('INPUT'); }
    catch { show(status, 'Controleer de ingevulde velden. Je invoer is behouden.', true); return; }
    try { submissionId ||= (dependencies.crypto || win.crypto || globalThis.crypto).randomUUID(); }
    catch { show(status, 'Deze browser kan het formulier niet veilig versturen. Neem rechtstreeks contact op.', true); return; }
    const payload = { ...values, form: config.action, mode: config.mode, submissionId, token };
    const original = Array.from(form.elements).map(element => [element, element.disabled]);
    pending = true; hasSubmitted = true; token = ''; for (const [element] of original) element.disabled = true; availability();
    show(status, config.mode === 'test' ? 'Je testbericht en de beveiliging worden gecontroleerd…' : 'Je bericht wordt gecontroleerd en verstuurd…');
    const controller = new AbortController(); let timer;
    try {
      const request = async () => {
        const response = await fetcher(config.endpoint, {
          method: 'POST', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal
        });
        let result; try { result = await response.json(); } catch { throw new Error('RESPONSE'); }
        return { response, result };
      };
      const { response, result } = await Promise.race([request(), new Promise((_, reject) => {
        timer = schedule(() => { controller.abort(); reject(new Error('NETWORK')); }, dependencies.requestTimeout ?? 15_000);
      })]);
      const expected = config.mode === 'test' ? 'TEST_ACCEPTED' : 'SENT';
      if (!response.ok || result?.ok !== true || result.mode !== config.mode || result.code !== expected) {
        const code = typeof result?.code === 'string' && /^[A-Z_]{1,32}$/.test(result.code) ? result.code : 'UNAVAILABLE';
        show(status, failure(code), true);
      } else {
        form.reset(); submissionId = undefined;
        show(status, config.mode === 'test' ? 'De beveiligde test is geslaagd. Dit bericht is niet verstuurd.' : 'Je bericht is aangenomen voor verzending naar de dorpsraad.');
      }
    } catch {
      // A network failure does not establish whether the server processed the message.
      show(status, 'We kunnen de verwerking niet bevestigen. Je invoer is behouden. Verstuur het bericht niet opnieuw als je ontvangst al bevestigd hebt; neem zo nodig rechtstreeks contact op.', true);
    } finally {
      cancel(timer);
      for (const [element, disabled] of original) element.disabled = disabled;
      pending = false; resetWidget(); availability();
    }
  });

  try {
    config = configuration(form);
    if (!container || !submit || !status) throw new Error('CONFIG');
    retry = form.querySelector('[data-turnstile-retry]');
    if (!retry) {
      retry = doc.createElement('button'); retry.type = 'button'; retry.dataset.turnstileRetry = 'true';
      retry.textContent = 'Opnieuw controleren'; retry.className = 'button button-outline'; container.after(retry);
    }
    retry.hidden = true;
    const render = async () => {
      try {
        turnstile = await (dependencies.loadTurnstile || loadTurnstile)({ ...dependencies, document: doc, window: win });
        widget = turnstile.render(container, {
          sitekey: config.sitekey, action: config.action, theme: 'auto', size: 'flexible', 'response-field': false,
          callback: value => {
            token = typeof value === 'string' && value.length > 0 && value.length <= 2048 ? value : '';
            if (retry) retry.hidden = !!token; availability();
            if (!pending && token && !hasSubmitted) show(status, config.mode === 'test' ? 'Beveiliging gereed. Deze test verstuurt geen mail.' : 'Beveiliging gereed. Je kunt het bericht versturen.');
          },
          'expired-callback': invalid, 'timeout-callback': invalid, 'error-callback': invalid
        });
      } catch {
        turnstile = undefined; token = ''; availability(); retry.hidden = false;
        show(status, 'De beveiligingscontrole kon niet laden. Klik op Opnieuw controleren of probeer het later opnieuw. Je invoer is behouden.', true);
      }
    };
    retry.addEventListener('click', () => {
      if (pending) return;
      retry.hidden = true; show(status, 'De beveiligingscontrole wordt opnieuw geladen…');
      if (turnstile && widget !== undefined) resetWidget(); else render();
    });
    show(status, 'De beveiligingscontrole wordt geladen…'); await render();
  } catch {
    token = ''; availability(); show(status, 'Het formulier is nog niet volledig ingesteld. Neem voorlopig rechtstreeks contact op.', true);
  }
}

/** Local forms remain owned by site.js; remote forms never save to local storage. */
export function initRemoteForms(doc = globalThis.document, dependencies = {}) {
  return Promise.all(Array.from(doc.querySelectorAll('[data-remote-form]')).map(form => mount(form, doc, dependencies)));
}
