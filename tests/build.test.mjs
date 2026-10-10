import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ROOT } from '../lib/basis.mjs';
const execute = promisify(execFile);

test('Actual website builds in each form mode; data-action never becomes an internal link', async () => {
  const root = await mkdtemp(path.join(ROOT, '.test-build-'));
  try {
    for (const folder of ['lib', 'scripts', 'content', 'public', 'config']) await cp(path.join(ROOT, folder), path.join(root, folder), { recursive: true });
    const file = path.join(root, 'content/forms.json');
    const forms = JSON.parse(await readFile(file, 'utf8'));
    const childEnv = { ...process.env };
    // Exercise configured source settings rather than the caller's deployment overrides.
    for (const key of ['GITHUB_REPOSITORY', 'KWADENDAMME_REPOSITORY', 'KWADENDAMME_AUTH_URL', 'KWADENDAMME_SITE_URL', 'KWADENDAMME_BASE_PATH']) delete childEnv[key];
    for (const mode of ['local', 'verified-test', 'live']) {
      await writeFile(file, JSON.stringify({ ...forms, mode }));
      const result = await execute(process.execPath, ['scripts/build.mjs'], { cwd: root, env: childEnv, timeout: 20000 });
      assert.match(result.stdout, /Checked \d+ HTML pages/);
      const html = await readFile(path.join(root, '_site/contact/index.html'), 'utf8');
      assert.equal(html.includes('data-remote-form'), mode !== 'local');
      if (mode !== 'local') assert.match(html, /data-action="contact"/);
      const snapshot = JSON.parse(await readFile(path.join(root, '_site/admin/preview-content.json'), 'utf8'));
      assert.deepEqual(Object.keys(snapshot).sort(), ['design', 'documents', 'meetings', 'members', 'news', 'projects', 'site']);
      await assert.rejects(readFile(path.join(root, '_site/forms/worker.mjs')));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
