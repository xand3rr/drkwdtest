import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, hosting, validatePage } from './basis.mjs';
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
async function contentFiles(directory) {
  try { return await readdir(directory); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
export async function loadHosting(env = process.env, root = ROOT) {
  return hosting(await readJson(root, 'config/hosting.json'), env);
}
async function media(value, root, type, required = false) {
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
export async function loadContent(env = process.env, root = ROOT) {
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
  site.formEndpoint = site.formEndpoint ? safeUrl(site.formEndpoint) : '';
  if (site.formEndpoint && !site.formEndpoint.startsWith('https:')) throw new Error('Formulieren moeten naar een https-endpoint verwijzen.');
  if (!site.testMode && !site.formEndpoint && !site.contactEmail) throw new Error('Vul voor livegang eerst een contactadres of formulierdienst in.');
  const prefixes = { news: '/nieuws/', projects: '/onderwerpen/', meetings: '/vergaderingen/', documents: '/documenten/' };
  const kinds = { pages: 'page', news: 'news', projects: 'project', meetings: 'meeting', documents: 'document' };
  const pages = [];
  const routes = new Set();
  for (const [folder, kind] of Object.entries(kinds)) {
    for (const name of (await contentFiles(path.join(root, 'content', folder))).filter(name => name.endsWith('.json')).sort()) {
      const id = name.slice(0, -5);
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`Ongeldige bestandsnaam: ${name}`);
      const d = await readJson(root, `content/${folder}/${name}`);
      for (const field of ['draft', 'example']) if (d[field] != null && typeof d[field] !== 'boolean') throw new Error(`Ongeldig veld ${field}: ${name}`);
      if (d.draft === true || (!site.testMode && id === 'testinbox')) continue;
      const route = folder === 'pages' ? (id === 'home' ? '/' : id === 'niet-gevonden' ? '/404.html' : `/${id}/`) : prefixes[folder] + id + '/';
      if (routes.has(route)) throw new Error(`Dubbele route: ${route}`);
      routes.add(route);
      const entry = { ...d, id, path: route, kind, group: folder === 'pages' ? id : prefixes[folder].split('/')[1],
        title: text(d.title, `${name}: titel`, 200, true), intro: text(d.intro, `${name}: intro`, 1200), body: text(d.body, `${name}: tekst`),
        date: validDate(d.date), author: text(d.author, `${name}: auteur`, 120, kind === 'news'),
        image: await media(d.image, root, 'image'), imageAlt: text(d.imageAlt, 'fotobeschrijving', 300),
        file: await media(d.file, root, 'pdf', kind === 'document'),
        location: text(d.location, 'locatie', 200), time: text(d.time, 'tijd', 20), status: text(d.status, 'status', 100),
        meeting: text(d.meeting, 'vergadering', 200), visual: text(d.visual, 'illustratie', 20)
      };
      if (entry.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) throw new Error('Tijd moet UU:MM zijn.');
      if (entry.meeting && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.meeting)) throw new Error('Ongeldige vergaderingverwijzing.');
      if (entry.visual && !['talk', 'leaf', 'flag'].includes(entry.visual)) throw new Error('Ongeldige illustratie.');
      if (entry.status && !['Idee', 'In behandeling', 'Afgerond'].includes(entry.status)) throw new Error('Ongeldige onderwerpstatus.');
      pages.push(entry);
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
  return { site, hosting: h, pages, news: sorted('news'), projects: sorted('project'), meetings: sorted('meeting').reverse(), documents: sorted('document') };
}
