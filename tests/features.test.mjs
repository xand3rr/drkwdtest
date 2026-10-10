import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, loadContent, validTimestamp } from '../lib/content.mjs';
import { cmsConfig } from '../lib/cms-config.mjs';
import { renderPage, renderText } from '../lib/render.mjs';

async function fixture(run) {
  const root = await mkdtemp(path.join(ROOT, '.test-features-'));
  try {
    for (const folder of ['config', 'content', 'public']) await cp(path.join(ROOT, folder), path.join(root, folder), { recursive: true });
    for (const folder of ['news', 'extra-pages', 'members']) await mkdir(path.join(root, 'content', folder), { recursive: true });
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const read = async (root, file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const put = async (root, file, value) => writeFile(path.join(root, file), JSON.stringify(value));
const patch = async (root, file, value) => put(root, file, { ...await read(root, file), ...value });
const home = c => c.pages.find(p => p.path === '/');

test('Old edited repository loads without the new config files and inherits its saved homepage', async () => fixture(async root => {
  await rm(path.join(root, 'content/design.json'));
  await rm(path.join(root, 'content/forms.json'));
  await patch(root, 'content/pages/home.json', { title: 'Mijn eigen dorpswebsite', intro: 'Mijn bewaarde introductie.' });
  const c = await loadContent({}, root);
  assert.equal(c.forms.mode, 'local');
  assert.match(renderPage(home(c), c), /Mijn eigen dorpswebsite/);
  assert.match(renderPage(home(c), c), /Mijn bewaarde introductie/);
}));

test('Editor can reorder sections, edit labels/buttons and disable a section in the visitor page', async () => fixture(async root => {
  await patch(root, 'content/pages/home.json', { sections: [
    { type: 'text', enabled: true, title: 'Eerst deze tekst', text: '**Onze tekst** en [contact](/contact/).' },
    { type: 'hero', enabled: true, title: 'Nieuwe kop', buttons: [{ label: 'Mijn knop', href: '/documenten/', style: 'outline' }] },
    { type: 'text', enabled: false, title: 'VERBORGEN-UNIEK', text: 'Niet publiceren.' }
  ] });
  const c = await loadContent({}, root), html = renderPage(home(c), c);
  assert(html.indexOf('Eerst deze tekst') < html.indexOf('Nieuwe kop'));
  assert.match(html, /href="\/documenten\/">Mijn knop/);
  assert.match(html, /<strong>Onze tekst<\/strong>/);
  assert.doesNotMatch(html, /VERBORGEN-UNIEK/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
}));

test('A newly created page can be reached through an editable menu and has its own sidebar', async () => fixture(async root => {
  await put(root, 'content/extra-pages/voorzieningen.json', { title: 'Voorzieningen in het dorp', body: 'Eigen nieuwe pagina.', showSidebar: true,
    sidebar: [{ title: 'Eigen zijblok', text: 'Bewerkbare inhoud', links: [{ label: 'Agenda', href: '/vergaderingen/', style: 'solid' }] }] });
  const design = await read(root, 'content/design.json');
  design.navigation.push({ label: 'Voorzieningen', href: '/voorzieningen/', enabled: true });
  design.footerLinks = [{ label: 'Bekijk voorzieningen', href: '/voorzieningen/', enabled: true }];
  design.brand.name = 'Ons Kwadendamme';
  await put(root, 'content/design.json', design);
  const c = await loadContent({}, root), page = c.extraPages.find(p => p.id === 'voorzieningen');
  assert.equal(page.path, '/voorzieningen/');
  const html = renderPage(page, c);
  assert.match(html, /Ons Kwadendamme/);
  assert.match(html, /Eigen zijblok/);
  assert.match(html, /Bekijk voorzieningen/);
  assert.match(renderPage(home(c), c), /href="\/voorzieningen\/"/);
}));

test('Manual news order and featured-only homepage selection affect the published cards', async () => fixture(async root => {
  await rm(path.join(root, 'content/news'), { recursive: true });
  await mkdir(path.join(root, 'content/news'));
  await put(root, 'content/news/eerste.json', { title: 'Eerste handmatig', author: 'Dorpsraad', order: 1, featured: true, date: '2025-01-01' });
  await put(root, 'content/news/tweede.json', { title: 'Tweede handmatig', author: 'Dorpsraad', order: 2, featured: false, date: '2026-01-01' });
  await patch(root, 'content/design.json', { newsOrder: 'manual', homeSections: [{ type: 'news', title: 'Uitgelicht', limit: 1, featuredOnly: true }] });
  const c = await loadContent({}, root);
  assert.deepEqual(c.news.map(p => p.id), ['eerste', 'tweede']);
  const html = renderPage(home(c), c);
  assert.match(html, /Eerste handmatig/);
  assert.doesNotMatch(html, /Tweede handmatig/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
}));

test('Publication and removal timestamps change routes on the build boundary; hidden menu links are withheld', async () => fixture(async root => {
  await put(root, 'content/extra-pages/tijdelijk.json', { title: 'Tijdelijke pagina', body: 'Tijdelijk bericht.', publishAt: '2026-10-10T12:00:00+02:00', unpublishAt: '2026-10-10T14:00:00+02:00' });
  const design = await read(root, 'content/design.json');
  design.navigation.push({ label: 'Tijdelijk', href: '/tijdelijk/', enabled: true });
  await put(root, 'content/design.json', design);
  for (const [now, expected] of [['2026-10-10T09:59:59Z', false], ['2026-10-10T10:00:00Z', true], ['2026-10-10T12:00:00Z', false]]) {
    const c = await loadContent({}, root, Date.parse(now));
    assert.equal(c.extraPages.some(p => p.id === 'tijdelijk'), expected);
    assert.equal(renderPage(home(c), c).includes('href="/tijdelijk/"'), expected);
  }
  assert.throws(() => validTimestamp('2026-02-30T12:00:00Z'));
  assert.throws(() => validTimestamp('2026-10-10T12:00:00'));
}));

test('Malformed blocks, duplicate heroes, unsafe buttons and reserved page routes fail before deployment', async () => fixture(async root => {
  for (const sections of [
    [{ type: 'unknown' }], [{ type: 'hero' }, { type: 'hero' }],
    [{ type: 'button', buttons: [{ label: 'Aanval', href: 'javascript:alert(1)' }] }],
    [{ type: 'news', limit: 100 }]
  ]) {
    await patch(root, 'content/pages/home.json', { sections });
    await assert.rejects(loadContent({}, root));
  }
  await patch(root, 'content/pages/home.json', { sections: [] });
  await put(root, 'content/extra-pages/admin.json', { title: 'Aanval', body: 'Overschrijven beheer.' });
  await assert.rejects(loadContent({}, root), /Gereserveerde/);
}));

test('Member collections render safe photo/role/text cards without creating invented people', async () => fixture(async root => {
  await put(root, 'content/members/voorbeeldlid.json', { name: 'Testlid <script>', role: 'Voorzitter', body: 'Een **introductie**.', image: '/assets/vlag.jpg', imageAlt: 'Voorbeeld', order: 1 });
  await patch(root, 'content/pages/dorpsraad.json', { sections: [{ type: 'members', title: 'Dorpsraadleden', limit: 8 }] });
  const c = await loadContent({}, root), html = renderPage(c.pages.find(p => p.id === 'dorpsraad'), c);
  assert.match(html, /Testlid &lt;script&gt;/);
  assert.match(html, /Voorzitter/);
  assert.match(html, /<strong>introductie<\/strong>/);
  assert.doesNotMatch(html, /<script>/);
}));

test('Protected test mode uses the supplied sitekey; production cannot silently use local test forms', async () => fixture(async root => {
  await patch(root, 'content/forms.json', { mode: 'verified-test' });
  let c = await loadContent({}, root);
  let html = renderPage(c.pages.find(p => p.id === 'contact'), c);
  assert.match(html, /data-remote-form/);
  assert.match(html, /0x4AAAAAAFSmQf4b9cy9HPxm/);
  assert.match(html, /name="website"/);
  assert.doesNotMatch(html, /data-test-form/);
  await patch(root, 'content/site.json', { testMode: false, contactEmail: 'dorpsraad@example.nl' });
  await patch(root, 'content/forms.json', { mode: 'local' });
  c = await loadContent({}, root);
  html = renderPage(c.pages.find(p => p.id === 'contact'), c);
  assert.doesNotMatch(html, /data-test-form|data-remote-form/);
  assert.match(html, /mailto:dorpsraad@example.nl/);
}));

test('All collections use safe custom previews and offer new pages, sections and scheduling', async () => {
  const c = await loadContent({}), config = cmsConfig(c);
  assert.equal(config.editor.preview, true);
  assert.equal(config.slug.encoding, 'ascii');
  assert.equal(config.slug.clean_accents, true);
  assert(config.collections.find(collection => collection.name === 'extra_pages').create);
  assert(config.collections.find(collection => collection.name === 'members').create);
  const fields = config.collections.find(collection => collection.name === 'news').fields;
  assert(fields.some(field => field.name === 'publishAt'));
  assert(fields.some(field => field.name === 'featured'));
  const homeFile = config.collections.find(collection => collection.name === 'paginas').files.find(file => file.name === 'home');
  assert.equal(homeFile.fields.find(field => field.name === 'sections').typeKey, 'type');
  assert.equal(config.publish_mode, undefined);
  assert.equal(cmsConfig({ ...c, site: { ...c.site, editorialWorkflow: true } }).publish_mode, 'editorial_workflow');
});

test('Explicitly empty homepage sections stay empty and preserve existing body text', async () => fixture(async root => {
  await patch(root, 'content/pages/home.json', { sections: [], body: 'Mijn tekst blijft behouden.' });
  const c = await loadContent({}, root), html = renderPage(home(c), c);
  assert.match(html, /Mijn tekst blijft behouden/);
  assert.doesNotMatch(html, /class="hero-photo"|Wat speelt er in ons dorp/);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1);
}));

test('Inline formatting escapes literal HTML and refuses script/data/protocol-relative links', () => {
  const html = renderText('**Vet** en *schuin* en [veilig](https://example.nl/).\n\n[aanval](javascript:alert) <img src=x onerror=alert(1)> [data](data:text/html,test) [host](//evil.example/)');
  assert.match(html, /<strong>Vet<\/strong>/);
  assert.match(html, /<em>schuin<\/em>/);
  assert.match(html, /href="https:\/\/example.nl\/"/);
  assert.doesNotMatch(html, /href="(?:javascript:|data:|\/\/)|<img/);
});
