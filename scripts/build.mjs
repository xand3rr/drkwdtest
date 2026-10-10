import { mkdir, rm, cp, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, CMS_VERSION, CMS_SCRIPT } from '../lib/basis.mjs';
import { loadContent } from '../lib/content.mjs';
import { cmsConfig } from '../lib/cms-config.mjs';
import { renderPage } from '../lib/render.mjs';

const content = await loadContent();
const out = path.join(ROOT, '_site');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const publicRoot = path.join(ROOT, 'public');
await cp(publicRoot, out, { recursive: true, filter: async source => {
  const relative = path.relative(publicRoot, source);
  if (!relative.startsWith('uploads' + path.sep)) return true;
  if ((await stat(source)).isDirectory()) return true;
  // Uploaded HTML, SVG and scripts are never copied to the public website.
  return /\.(?:png|jpe?g|webp|gif|pdf)$/i.test(source);
} });
for (const page of content.pages) {
  const target = page.path.endsWith('/') ? page.path.slice(1) + 'index.html' : page.path.slice(1);
  const file = path.join(out, target);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, renderPage(page, content));
}
await writeFile(path.join(out, 'admin/config.yml'), JSON.stringify(cmsConfig(content), null, 2));
await writeFile(path.join(out, 'admin/settings.json'), JSON.stringify({ configured: content.hosting.configured, version: CMS_VERSION, script: CMS_SCRIPT, basePath: content.hosting.basePath }));
// Only visitor-public records are placed in the preview snapshot. Never copy
// auth configuration, source backups, private drafts or Worker secrets here.
await writeFile(path.join(out, 'admin/preview-content.json'), JSON.stringify({
  site: content.site, design: content.design, news: content.news, projects: content.projects,
  meetings: content.meetings, documents: content.documents, members: content.members
}));
await writeFile(path.join(out, '.nojekyll'), '');
const canonical = route => new URL(content.hosting.basePath + route, content.hosting.siteUrl).href;
const xml = value => String(value).replace(/[<>&"']/g, character => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[character]));
const sitemapPages = content.site.testMode ? [] : content.pages.filter(p => p.path !== '/404.html' && !['testpagina', 'testinbox'].includes(p.id));
await writeFile(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapPages.map(page => `<url><loc>${xml(canonical(page.path))}</loc></url>`).join('')}</urlset>\n`);
await writeFile(path.join(out, 'robots.txt'), content.site.testMode ? 'User-agent: *\nDisallow: /\n' : `User-agent: *\nDisallow: ${content.hosting.basePath}/admin/\nSitemap: ${canonical('/sitemap.xml')}\n`);
// Validate every built route and asset before GitHub Pages can publish it.
await import('./check-site.mjs');
console.log(`${content.pages.length} dorpspagina’s gebouwd met de bestaande Decap ${CMS_VERSION}-loginconfiguratie.`);
