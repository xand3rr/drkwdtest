import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const CMS_VERSION = '3.16.3';
export const CMS_SCRIPT = `https://cdn.jsdelivr.net/npm/decap-cms@${CMS_VERSION}/dist/decap-cms.js`;
export const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function hosting(config, env = {}) {
  const repository = config.repository || env.GITHUB_REPOSITORY || '';
  if (repository && !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Ongeldige GitHub-repository.');
  const branch = config.branch || 'main';
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes('..')) throw new Error('Ongeldige branch.');
  const authUrl = config.authUrl || '';
  if (authUrl) {
    const url = new URL(authUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('De loginserver moet een HTTPS-oorsprong zijn, zonder pad.');
  }
  let basePath = config.basePath;
  if (basePath === null || basePath === undefined) {
    const [owner, repo] = repository.split('/');
    basePath = env.GITHUB_REPOSITORY && repository ? (repo.toLowerCase() === `${owner.toLowerCase()}.github.io` ? '' : `/${repo}`) : '';
    if (config.siteUrl) basePath = new URL(config.siteUrl).pathname.replace(/\/$/, '');
  }
  if (typeof basePath !== 'string' || (basePath && !/^\/[A-Za-z0-9_./-]+$/.test(basePath)) || basePath.includes('..') || basePath.includes('//')) throw new Error('Ongeldig websitepad.');
  if (config.siteUrl) {
    const url = new URL(config.siteUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Ongeldig HTTPS-websiteadres.');
  }
  const siteDomain = config.siteUrl ? new URL(config.siteUrl).hostname : (repository ? `${repository.split('/')[0].toLowerCase()}.github.io` : '');
  return { repository, branch, authUrl: authUrl.replace(/\/$/, ''), basePath, siteDomain, configured: Boolean(repository && authUrl) };
}

export function validatePage(page) {
  for (const [key, max] of [['title', 200], ['body', 20000]]) {
    if (typeof page[key] !== 'string' || !page[key].trim() || page[key].length > max) throw new Error(`Ongeldig veld: ${key}.`);
  }
  return page;
}

export function cmsConfig(h) {
  return {
    backend: { name: 'github', repo: h.repository, branch: h.branch, base_url: h.authUrl, auth_endpoint: 'auth', site_domain: h.siteDomain },
    load_config_file: false,
    locale: 'nl',
    media_folder: 'public/uploads',
    public_folder: `${h.basePath}/uploads`,
    collections: [{ name: 'pages', label: 'Basispagina', editor: { preview: false }, files: [{
      name: 'page', label: 'Testpagina', file: 'content/page.json', format: 'json',
      fields: [
        { name: 'title', label: 'Titel', widget: 'string', required: true },
        { name: 'body', label: 'Tekst', widget: 'text', required: true }
      ]
    }] }]
  };
}

export function render(page, h) {
  validatePage(page);
  const body = page.body.split(/\n\s*\n/).map(p => `<p>${escape(p).replace(/\n/g, '<br>')}</p>`).join('\n');
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escape(page.title)}</title></head><body><main><h1>${escape(page.title)}</h1>${body}<hr><p><a href="${h.basePath}/admin/">Inhoud bewerken</a></p><p>Basistest: wijzigingen worden pas zichtbaar na de nieuwe GitHub-build.</p></main></body></html>`;
}
