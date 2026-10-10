import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT, cmsConfig as baselineConfig } from '../lib/basis.mjs';
import { loadContent, safeUrl, validDate } from '../lib/content.mjs';
import { renderPage, renderText } from '../lib/render.mjs';
import { cmsConfig } from '../lib/cms-config.mjs';
import { readInbox, saveMessage, deleteMessage, STORAGE_KEY } from '../public/assets/inbox.js';

async function fixture(run) {
  const root = await mkdtemp(path.join(ROOT, '.test-layout-'));
  try {
    for (const folder of ['config', 'content', 'public']) await cp(path.join(ROOT, folder), path.join(root, folder), { recursive: true });
    await mkdir(path.join(root, 'public/uploads'), { recursive: true });
    // Editors may delete every example entry. Tests create their own fixtures.
    for (const folder of ['news', 'meetings', 'documents', 'projects']) await mkdir(path.join(root, 'content', folder), { recursive: true });
    await writeFile(path.join(root, 'content/news/welkom-op-de-dorpswebsite.json'), JSON.stringify({ title: 'Fixturebericht', body: 'Testtekst.', author: 'Testauteur', draft: false }));
    await writeFile(path.join(root, 'content/meetings/voorbeeldvergadering.json'), JSON.stringify({ title: 'Fixturevergadering', body: 'Testagenda.', draft: false }));
    await writeFile(path.join(root, 'content/documents/voorbeeldagenda.json'), JSON.stringify({ title: 'Fixtureagenda', body: 'Testdocument.', file: '/assets/voorbeeldagenda.pdf', draft: false }));
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const update = async (root, file, values) => writeFile(path.join(root, file), JSON.stringify({ ...await json(path.join(root, file)), ...values }));

test('Every content record renders a real page with the village flag and a single heading', async () => {
  const content = await loadContent({});
  for (const page of content.pages) {
    const html = renderPage(page, content);
    assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, page.path);
    assert.match(html, /Vlag van Kwadendamme/);
    assert.match(html, /class="site-header"/);
  }
  const home = renderPage(content.pages.find(p => p.id === 'home'), content);
  assert.match(home, /class="hero-photo"/);
  assert.match(home, /class="cards"|nog geen berichten/);
});
test('CMS backend remains identical; every editable file and required field exists', async () => {
  const content = await loadContent({});
  const config = cmsConfig(content);
  assert.deepEqual(config.backend, baselineConfig(content.hosting).backend);
  assert.equal(config.load_config_file, false);
  assert.equal(config.editor.preview, true);
  assert.equal(config.local_backend, undefined);
  assert.equal(config.collections.find(c => c.name === 'pages').files[0].file, 'content/page.json');
  assert(config.collections.find(c => c.name === 'news').fields.some(f => f.name === 'author' && f.required === true));
  for (const collection of config.collections) {
    assert.equal(collection.editor.preview, true);
    for (const field of collection.fields || []) assert.notEqual(field.widget, 'markdown');
    for (const file of collection.files || []) {
      const data = await json(path.join(ROOT, file.file));
      for (const field of file.fields) {
        assert.notEqual(field.widget, 'markdown');
        if (field.required !== false && field.widget !== 'hidden') assert(Object.hasOwn(data, field.name), `${file.file}: ${field.name}`);
      }
    }
  }
});
test('Existing test content survives the layout migration and still publishes as text', async () => {
  await fixture(async root => {
    await update(root, 'content/page.json', { title: 'Mijn bestaande titel', body: 'Mijn opgeslagen tekst <img src=x onerror=alert(1)>' });
    const content = await loadContent({}, root);
    const page = content.pages.find(p => p.path === '/testpagina/');
    assert.equal(page.title, 'Mijn bestaande titel');
    const html = renderPage(page, content);
    assert.match(html, /Mijn opgeslagen tekst &lt;img/);
    assert.doesNotMatch(html, /<img src=x/);
  });
});
test('An edited home and newly created news item reach actual rendered routes; drafts are withheld', async () => {
  await fixture(async root => {
    await update(root, 'content/pages/home.json', { title: 'Onze aangepaste startpagina', intro: 'Deze intro is via het CMS gewijzigd.' });
    const file = 'content/news/nieuw-bericht-uit-het-cms.json';
    const post = { title: 'Nieuw CMS-bericht', intro: 'Een eigen nieuwsbericht.', body: '# Een tussenkop\n\nDit is de nieuwe tekst.', author: 'Testauteur', date: '2026-10-09', draft: false };
    await writeFile(path.join(root, file), JSON.stringify(post));
    let content = await loadContent({}, root);
    assert.match(renderPage(content.pages.find(p => p.id === 'home'), content), /Onze aangepaste startpagina/);
    const news = content.news.find(p => p.id === 'nieuw-bericht-uit-het-cms');
    assert.equal(news.path, '/nieuws/nieuw-bericht-uit-het-cms/');
    assert.match(renderPage(news, content), /Testauteur/);
    assert.match(renderPage(news, content), /<h2>Een tussenkop<\/h2>/);
    await update(root, file, { draft: true });
    content = await loadContent({}, root);
    assert(!content.news.some(p => p.id === 'nieuw-bericht-uit-het-cms'));
  });
});
test('Uploaded images with spaces and linked meeting PDFs reach both lists and detail pages', async () => {
  await fixture(async root => {
    await mkdir(path.join(root, 'public/uploads'), { recursive: true });
    await cp(path.join(ROOT, 'public/assets/dorp.png'), path.join(root, 'public/uploads/een foto.png'));
    await cp(path.join(ROOT, 'public/assets/voorbeeldagenda.pdf'), path.join(root, 'public/uploads/nieuwe agenda.pdf'));
    await update(root, 'content/news/welkom-op-de-dorpswebsite.json', { image: '/uploads/een foto.png', imageAlt: 'Onze eigen foto' });
    await update(root, 'content/documents/voorbeeldagenda.json', { file: '/uploads/nieuwe agenda.pdf', meeting: 'voorbeeldvergadering' });
    const content = await loadContent({}, root);
    const post = content.news.find(p => p.id === 'welkom-op-de-dorpswebsite');
    assert.match(renderPage(post, content), /src="\/uploads\/een%20foto.png" alt="Onze eigen foto"/);
    assert.match(renderPage(content.meetings.find(p => p.id === 'voorbeeldvergadering'), content), /href="\/uploads\/nieuwe%20agenda.pdf" download/);
  });
});
test('Project prefixes apply exactly once to every page and uploaded image', async () => {
  const content = await loadContent({});
  content.hosting = { ...content.hosting, basePath: '/drkwdtest', siteUrl: 'https://xand3rr.github.io/drkwdtest/' };
  const post = { kind: 'news', id: 'fixturebericht', path: '/nieuws/fixturebericht/', title: 'Fixturebericht', author: 'Testauteur', image: '/uploads/foto.png', imageAlt: 'Foto' };
  const html = renderPage(post, content);
  assert.match(html, /href="\/drkwdtest\/nieuws\/"/);
  assert.match(html, /src="\/drkwdtest\/uploads\/foto.png"/);
  assert.doesNotMatch(html, /\/drkwdtest\/drkwdtest\//);
  assert.equal(cmsConfig(content).public_folder, '/uploads');
});
test('HTML stays escaped, and unsafe media addresses, invalid dates and missing author fail before publishing', async () => {
  const body = renderText('# <script>aanval</script>\n\n<img src=x onerror=alert(1)>\n\n- <iframe>\n- Gewone tekst');
  assert.match(body, /&lt;script&gt;/);
  assert.match(body, /<ul><li>&lt;iframe&gt;/);
  assert.doesNotMatch(body, /<script>|<img|<iframe>/);
  for (const url of ['javascript:alert(1)', '//evil.example', '/uploads/%2e%2e/config.json', '/uploads/%5c..%5cconfig.json', 'https://user:password@evil.example/']) assert.throws(() => safeUrl(url));
  assert.throws(() => validDate('2026-02-30'));
  await fixture(async root => {
    await update(root, 'content/news/welkom-op-de-dorpswebsite.json', { author: '' });
    await assert.rejects(loadContent({}, root), /auteur/);
    await update(root, 'content/news/welkom-op-de-dorpswebsite.json', { author: 'Test', image: '/uploads/gevaar.svg' });
    await assert.rejects(loadContent({}, root), /PNG/);
    await writeFile(path.join(root, 'public/uploads/namaak.png'), '<script>geen afbeelding</script>');
    await update(root, 'content/news/welkom-op-de-dorpswebsite.json', { image: '/uploads/namaak.png' });
    await assert.rejects(loadContent({}, root), /Bestandsinhoud/);
  });
});
test('Local test inbox persists and deletes messages; denied storage does not report success', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  const message = { id: 'test-id', type: 'contact', name: 'Testpersoon', email: 'test@example.com', subject: 'Een vraag', message: 'Dit is een testbericht.', consent: true, createdAt: '2026-10-09T18:00:00Z' };
  saveMessage(storage, message);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).messages[0].subject, 'Een vraag');
  assert.equal(readInbox(storage).messages.length, 1);
  deleteMessage(storage, 'test-id');
  assert.equal(readInbox(storage).messages.length, 0);
  assert.throws(() => saveMessage({ getItem: () => null, setItem: () => { throw new Error('Denied'); } }, message));
  assert.throws(() => saveMessage(storage, { ...message, consent: false }));
});
test('The actual mobile menu opens, closes with Escape and outside clicks, and updates accessibility state', async () => {
  function element() {
    const attributes = new Map();
    const classes = new Set();
    return { id: '', events: {}, focused: false,
      setAttribute: (key, value) => attributes.set(key, value), getAttribute: key => attributes.get(key),
      classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
      addEventListener(type, callback) { this.events[type] = callback; },
      contains(target) { return target === this; }, focus() { this.focused = true; }
    };
  }
  const toggle = element();
  const menu = element();
  const viewport = { matches: true, addEventListener(type, callback) { this.change = callback; } };
  const document = { readyState: 'complete', documentElement: element(), events: {}, activeElement: null,
    querySelector: selector => selector === '.menu-toggle' ? toggle : menu,
    addEventListener(type, callback) { this.events[type] = callback; }
  };
  vm.runInNewContext(await readFile(path.join(ROOT, 'public/assets/navigation.js'), 'utf8'), { document, window: { matchMedia: () => viewport } });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.events.click();
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert(menu.classList.contains('is-open'));
  let prevented = false;
  document.events.keydown({ key: 'Escape', preventDefault: () => { prevented = true; } });
  assert(prevented);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert(toggle.focused);
  toggle.events.click();
  document.events.click({ target: {} });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  toggle.events.click();
  menu.events.click({ target: { closest: () => ({}) } });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});
test('Deleting all optional example collections does not break the next CMS publication', async () => {
  await fixture(async root => {
    for (const folder of ['news', 'projects', 'meetings', 'documents']) await rm(path.join(root, 'content', folder), { recursive: true });
    const content = await loadContent({}, root);
    assert.equal(content.news.length, 0);
    assert.equal(content.documents.length, 0);
    assert.match(renderPage(content.pages.find(p => p.id === 'nieuws'), content), /nog geen berichten/);
    assert(cmsConfig(content).collections.find(c => c.name === 'news').create);
  });
});
