import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, hosting, validatePage } from './basis.mjs';
import { DEFAULT_DESIGN, DEFAULT_FORMS } from './defaults.mjs';
export { ROOT };

export function text(value, field, max = 20000, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new Error(`Ongeldig veld: ${field}`);
  return value.trim();
}
export function safeUrl(value, { external = true, mail = false, empty = true } = {}) {
  if ((value == null || value === '') && empty) return '';
  if (typeof value !== 'string' || value.length > 2048 || /[<>"'\\\x00-\x1f\x7f]/u.test(value)) throw new Error('Ongeldige URL');
  if (value.startsWith('/') && !value.startsWith('//')) {
    const decoded = decodeURIComponent(value);
    if (/[<>"'\\\x00-\x1f\x7f]/u.test(decoded) || decoded.startsWith('//') || decoded.split(/[/?#]/).some(part => part === '..' || part === '.')) throw new Error('Ongeldig websitepad');
    const url = new URL(value, 'https://internal.invalid');
    if (url.origin !== 'https://internal.invalid') throw new Error('Ongeldig websitepad');
    return url.pathname + url.search + url.hash;
  }
  if (/^#[\w-]+$/.test(value)) return value;
  if (mail && /^mailto:[^@\s]+@[^@\s]+\.[^@\s]+$/i.test(value)) return value;
  if (external && /^https:\/\//i.test(value) && !/\s/.test(value)) {
    const url = new URL(value);
    if (!url.username && !url.password) return url.href;
  }
  throw new Error('Gebruik een interne link of een volledig https-adres.');
}
export function validDate(value, field = 'datum') {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value) throw new Error(`Ongeldig veld: ${field}`);
  return value;
}
const readJson = async (root, file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
async function optionalJson(root, file, fallback) {
  try { return await readJson(root, file); }
  catch (error) { if (error.code === 'ENOENT') return structuredClone(fallback); throw error; }
}
async function contentFiles(directory) {
  try { return await readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function loadHosting(env = process.env, root = ROOT) {
  return hosting(await readJson(root, 'config/hosting.json'), env);
}
export async function media(value, root, type, required = false) {
  const url = safeUrl(value, { external: false, empty: !required });
  if (!url) return '';
  const extensions = type === 'image' ? /\.(?:png|jpe?g|webp|gif)$/i : /\.pdf$/i;
  if (!/^\/(?:assets|uploads)\//.test(url) || /[?#]/.test(url) || !extensions.test(url)) throw new Error(`Kies ${type === 'image' ? 'een PNG, JPG, WEBP of GIF' : 'een PDF'} uit assets of uploads.`);
  const filename = path.resolve(root, 'public', '.' + decodeURIComponent(url));
  const publicRoot = path.resolve(root, 'public') + path.sep;
  if (!filename.startsWith(publicRoot) || !(await stat(filename)).isFile()) throw new Error(`Mediabestand ontbreekt: ${url}`);
  const bytes = await readFile(filename);
  const matches = type === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-' : (
    /\.png$/i.test(url) ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) :
    /\.jpe?g$/i.test(url) ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    /\.gif$/i.test(url) ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString()) :
    bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  );
  if (!matches) throw new Error(`Bestandsinhoud past niet bij het bestandstype: ${url}`);
  return url;
}
function boolean(value, field, fallback = false) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') throw new Error(`Ongeldig veld: ${field}`);
  return value;
}
function integer(value, field, fallback = 0, min = -10000, max = 10000) {
  if (value == null || value === '') return fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Ongeldig veld: ${field}`);
  return value;
}
function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Ongeldig veld: ${field}`);
  return value;
}
function list(value, field, max = 24) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > max) throw new Error(`Ongeldig veld: ${field} (maximaal ${max})`);
  return value;
}
export function validTimestamp(value, field = 'publicatietijd') {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`Ongeldig veld: ${field}. Gebruik een tijd met tijdzone.`);
  validDate(value.slice(0, 10), field);
  return value;
}
function button(value, field) {
  const d = object(value, field);
  const style = d.style || 'solid';
  if (!['solid', 'outline'].includes(style)) throw new Error(`Ongeldige knopstijl: ${field}`);
  return { label: text(d.label, `${field}: tekst`, 100, true), href: safeUrl(d.href, { mail: true, empty: false }), style };
}
function buttons(value, field) { return list(value, field, 6).map((d, i) => button(d, `${field} ${i + 1}`)); }
function sidebar(value) {
  return list(value, 'zijblokken', 8).map((d, i) => {
    object(d, 'zijblok');
    return { title: text(d.title, 'zijblok: titel', 200, true), text: text(d.text, 'zijblok: tekst', 5000), links: buttons(d.links, `zijblok ${i + 1}: links`) };
  });
}
function navigation(value, children = true) {
  return list(value, 'navigatie', 12).map(d => {
    object(d, 'navigatie');
    return { label: text(d.label, 'linknaam', 100, true), href: safeUrl(d.href, { mail: true, empty: false }), enabled: boolean(d.enabled, 'link zichtbaar', true),
      ...(children ? { children: navigation(d.children, false) } : {}) };
  });
}
async function sections(value, root) {
  const result = [];
  for (const d of list(value, 'secties')) {
    object(d, 'sectie');
    if (!['hero', 'text', 'image', 'button', 'news', 'topics', 'meetings', 'documents', 'members', 'callouts'].includes(d.type)) throw new Error('Onbekend sectietype.');
    const block = { type: d.type, enabled: boolean(d.enabled, 'sectie zichtbaar', true), eyebrow: text(d.eyebrow, 'sectielabel', 100), title: text(d.title, 'sectietitel', 200), intro: text(d.intro, 'sectieintro', 1200), text: text(d.text, 'sectietekst'),
      image: await media(d.image, root, 'image'), imageAlt: text(d.imageAlt, 'fotobeschrijving', 300), caption: text(d.caption, 'fotobijschrift', 300), buttons: buttons(d.buttons, 'sectieknoppen') };
    if (['news', 'topics', 'meetings', 'documents', 'members'].includes(d.type)) {
      block.limit = integer(d.limit, 'aantal items', 3, 1, 24);
      block.featuredOnly = boolean(d.featuredOnly, 'alleen uitgelichte items');
    }
    if (d.type === 'callouts') block.items = list(d.items, 'uitnodigingen', 6).map(item => {
      object(item, 'uitnodiging');
      return { eyebrow: text(item.eyebrow, 'uitnodiging: label', 100), title: text(item.title, 'uitnodiging: titel', 200, true), text: text(item.text, 'uitnodiging: tekst', 5000), button: item.button ? button(item.button, 'uitnodiging: knop') : null };
    });
    result.push(block);
  }
  if (result.filter(d => d.type === 'hero' && d.enabled).length > 1) throw new Error('Gebruik maximaal één zichtbaar openingsblok per pagina.');
  return result;
}
async function loadDesign(root) {
  const d = object(await optionalJson(root, 'content/design.json', DEFAULT_DESIGN), 'ontwerp');
  const brand = { ...DEFAULT_DESIGN.brand, ...object(d.brand || DEFAULT_DESIGN.brand, 'merk') };
  for (const key of ['eyebrow', 'name', 'logoAlt']) brand[key] = text(brand[key], `merk: ${key}`, 100, key === 'name');
  for (const key of ['logo', 'favicon']) brand[key] = await media(brand[key], root, 'image', true);
  const newsOrder = d.newsOrder || 'date';
  if (!['date', 'manual'].includes(newsOrder)) throw new Error('Ongeldige nieuwsvolgorde.');
  return { brand, navigation: navigation(d.navigation ?? DEFAULT_DESIGN.navigation), footerLinks: navigation(d.footerLinks ?? DEFAULT_DESIGN.footerLinks, false), sidebar: sidebar(d.sidebar ?? DEFAULT_DESIGN.sidebar),
    homeSections: await sections(d.homeSections ?? DEFAULT_DESIGN.homeSections, root), newsOrder, newsReadMore: text(d.newsReadMore ?? DEFAULT_DESIGN.newsReadMore, 'leesmeerknop', 100, true) };
}
async function loadForms(root) {
  const d = object(await optionalJson(root, 'content/forms.json', DEFAULT_FORMS), 'formulieren');
  const mode = d.mode || 'local';
  if (!['local', 'verified-test', 'live'].includes(mode)) throw new Error('Ongeldige formuliermodus.');
  const endpoint = d.endpoint ? safeUrl(d.endpoint, { empty: false }) : '';
  if (endpoint) {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.pathname !== '/submit' || url.hash || url.search) throw new Error('Gebruik het HTTPS-adres van de formulierworker met /submit, zonder parameters of fragment.');
  }
  const turnstileSiteKey = text(d.turnstileSiteKey, 'Turnstile-sitekey', 100);
  if (turnstileSiteKey && !/^0x[a-zA-Z0-9_-]{10,80}$/.test(turnstileSiteKey)) throw new Error('Ongeldige Turnstile-sitekey.');
  if (mode !== 'local' && (!endpoint || !turnstileSiteKey)) throw new Error('Vul backend en Turnstile-sitekey in voordat je de beschermde formulieren activeert.');
  const texts = { ...DEFAULT_FORMS.texts };
  if (d.texts != null) {
    object(d.texts, 'formulierlabels');
    for (const key of Object.keys(texts)) if (d.texts[key] != null) texts[key] = text(d.texts[key], `formulier: ${key}`, key === 'consentLabel' ? 500 : 100, true);
  }
  return { endpoint, turnstileSiteKey, mode, texts };
}
export async function loadContent(env = process.env, root = ROOT, now = Date.now()) {
  const h = await loadHosting(env, root);
  const site = await readJson(root, 'content/site.json');
  site.title = text(site.title, 'sitenaam', 100, true);
  site.tagline = text(site.tagline, 'slogan', 200, true);
  site.heroImage = await media(site.heroImage, root, 'image', true);
  site.heroAlt = text(site.heroAlt, 'fotobeschrijving', 300);
  site.heroCaption = text(site.heroCaption, 'fotobijschrift', 200);
  site.contactEmail = text(site.contactEmail, 'contactadres', 254);
  if (site.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(site.contactEmail)) throw new Error('Ongeldig contactadres.');
  if (typeof site.testMode !== 'boolean') throw new Error('testMode moet true of false zijn.');
  site.editorialWorkflow = boolean(site.editorialWorkflow, 'redactionele controle');
  site.formEndpoint = site.formEndpoint ? safeUrl(site.formEndpoint) : '';
  if (site.formEndpoint && !site.formEndpoint.startsWith('https:')) throw new Error('Formulieren moeten naar een https-endpoint verwijzen.');
  const design = await loadDesign(root);
  const forms = await loadForms(root);
  if (!site.testMode && forms.mode !== 'live' && !site.contactEmail) throw new Error('Vul voor livegang eerst een officieel contactadres en de formulierinstellingen in.');
  const prefixes = { news: '/nieuws/', projects: '/onderwerpen/', meetings: '/vergaderingen/', documents: '/documenten/' };
  const kinds = { pages: 'page', 'extra-pages': 'extra_page', news: 'news', projects: 'project', meetings: 'meeting', documents: 'document', members: 'member' };
  const pages = [];
  const cmsPages = [];
  const members = [];
  const hiddenPaths = new Set();
  const routes = new Set();
  const reserved = new Set(['admin', 'assets', 'uploads', 'home', 'niet-gevonden', 'testpagina', 'testinbox', 'nieuws', 'onderwerpen', 'vergaderingen', 'documenten', 'dorpsraad', 'contact', 'meedenken', 'privacy', 'robots', 'sitemap']);
  for (const [folder, kind] of Object.entries(kinds)) {
    for (const name of (await contentFiles(path.join(root, 'content', folder))).filter(name => name.endsWith('.json')).sort()) {
      const id = name.slice(0, -5);
      if (!/^[A-Za-z0-9][A-Za-z0-9_~-]{0,199}$/.test(id)) throw new Error(`Ongeldige bestandsnaam: ${name}`);
      const d = await readJson(root, `content/${folder}/${name}`);
      for (const field of ['draft', 'example']) if (d[field] != null && typeof d[field] !== 'boolean') throw new Error(`Ongeldig veld ${field}: ${name}`);
      const publishAt = validTimestamp(d.publishAt, `${name}: publicatie`);
      const unpublishAt = validTimestamp(d.unpublishAt, `${name}: verbergen`);
      if (publishAt && unpublishAt && Date.parse(unpublishAt) <= Date.parse(publishAt)) throw new Error('Verbergen moet na de publicatie liggen.');
      const visible = !d.draft && (!publishAt || Date.parse(publishAt) <= now) && (!unpublishAt || Date.parse(unpublishAt) > now);
      if (kind === 'member') {
        const member = { id, kind, name: text(d.name, 'naam dorpsraadslid', 100, true), role: text(d.role, 'functie', 100), body: text(d.body, 'introductie lid', 5000), image: await media(d.image, root, 'image'), imageAlt: text(d.imageAlt, 'fotobeschrijving', 300), order: integer(d.order, 'ledenvolgorde'), publishAt, unpublishAt, draft: Boolean(d.draft) };
        if (visible) members.push(member);
        continue;
      }
      if (kind === 'extra_page' && reserved.has(id.toLowerCase())) throw new Error(`Gereserveerde paginanaam: ${id}`);
      const route = folder === 'pages' || kind === 'extra_page' ? (id === 'home' ? '/' : id === 'niet-gevonden' ? '/404.html' : `/${id}/`) : prefixes[folder] + id + '/';
      if (routes.has(route)) throw new Error(`Dubbele route: ${route}`);
      routes.add(route);
      const entry = { ...d, id, path: route, kind, group: folder === 'pages' || kind === 'extra_page' ? id : prefixes[folder].split('/')[1],
        title: text(d.title, `${name}: titel`, 200, true), intro: text(d.intro, `${name}: intro`, 1200), body: text(d.body, `${name}: tekst`),
        date: validDate(d.date), author: text(d.author, `${name}: auteur`, 120, kind === 'news'),
        image: await media(d.image, root, 'image'), imageAlt: text(d.imageAlt, 'fotobeschrijving', 300),
        file: await media(d.file, root, 'pdf', kind === 'document'),
        location: text(d.location, 'locatie', 200), time: text(d.time, 'tijd', 20), status: text(d.status, 'status', 100),
        meeting: text(d.meeting, 'vergadering', 200), visual: text(d.visual, 'illustratie', 20),
        sections: d.sections == null ? undefined : await sections(d.sections, root), showSidebar: boolean(d.showSidebar, 'zijbalk zichtbaar', !['nieuws', 'onderwerpen', 'vergaderingen', 'testinbox'].includes(id)), sidebar: sidebar(d.sidebar),
        seoTitle: text(d.seoTitle, 'zoekmachinetitel', 200), seoDescription: text(d.seoDescription, 'zoekmachineomschrijving', 320), shareImage: await media(d.shareImage, root, 'image'),
        featured: boolean(d.featured, 'uitgelicht'), order: integer(d.order, 'volgorde'), publishAt, unpublishAt
      };
      if (entry.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) throw new Error('Tijd moet UU:MM zijn.');
      if (entry.meeting && !/^[A-Za-z0-9][A-Za-z0-9_~-]{0,199}$/.test(entry.meeting)) throw new Error('Ongeldige vergaderingverwijzing.');
      if (entry.visual && !['talk', 'leaf', 'flag'].includes(entry.visual)) throw new Error('Ongeldige illustratie.');
      if (entry.status && !['Idee', 'In behandeling', 'Afgerond'].includes(entry.status)) throw new Error('Ongeldige onderwerpstatus.');
      if (folder === 'pages') cmsPages.push(entry);
      if (visible && (site.testMode || id !== 'testinbox')) pages.push(entry);
      else hiddenPaths.add(route);
    }
  }
  for (const id of ['home', 'dorpsraad', 'nieuws', 'onderwerpen', 'vergaderingen', 'documenten', 'contact', 'meedenken', 'privacy', 'niet-gevonden', ...(site.testMode ? ['testinbox'] : [])]) {
    if (!pages.some(p => p.id === id && p.kind === 'page')) throw new Error(`Vaste pagina ontbreekt: ${id}`);
  }
  // Keep the CMS-edited baseline file and its collection intact, on its own route.
  if (site.testMode) {
    if (routes.has('/testpagina/')) throw new Error('De route /testpagina/ is gereserveerd voor de bestaande testpagina.');
    const legacy = validatePage(await readJson(root, 'content/page.json'));
    pages.push({ ...legacy, id: 'testpagina', kind: 'page', group: 'testpagina', path: '/testpagina/', intro: 'De bestaande, bewerkbare testpagina.', example: false });
  }
  const sorted = kind => pages.filter(p => p.kind === kind).sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'nl'));
  const news = sorted('news');
  if (design.newsOrder === 'manual') news.sort((a, b) => a.order - b.order || (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title, 'nl'));
  members.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'nl'));
  return { site, design, forms, hosting: h, pages, cmsPages, hiddenPaths, extraPages: pages.filter(p => p.kind === 'extra_page'), news, projects: sorted('project'), meetings: sorted('meeting').reverse(), documents: sorted('document'), members };
}
