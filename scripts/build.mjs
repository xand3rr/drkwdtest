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
await writeFile(path.join(out, 'admin/settings.json'), JSON.stringify({ configured: content.hosting.configured, version: CMS_VERSION, script: CMS_SCRIPT }));
await writeFile(path.join(out, '.nojekyll'), '');
await writeFile(path.join(out, 'robots.txt'), content.site.testMode ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nDisallow: /admin/\n');
// Validate every built route and asset before GitHub Pages can publish it.
await import('./check-site.mjs');
console.log(`${content.pages.length} dorpspagina’s gebouwd met de bestaande Decap ${CMS_VERSION}-loginconfiguratie.`);
