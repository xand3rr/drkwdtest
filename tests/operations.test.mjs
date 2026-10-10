import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PROJECT_ROOT, createArchive, entry, validateArchive } from '../scripts/export-backup.mjs';
import { restoreBackup } from '../scripts/restore-backup.mjs';
import { checkProduction } from '../scripts/check-production.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(PROJECT_ROOT, '.test-operations-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (name, value) => { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)); };
  return { root, write };
}
const archive = files => ({ format: 'kwadendamme-backup', version: 1, createdAt: new Date().toISOString(), files, remove: [], excluded: [] });

test('back-up contains source/content/media and excludes secrets, credentials and generated folders', async t => {
  const { root, write } = await fixture(t);
  await write('content/site.json', { title: 'Dorpsraad' });
  await write('public/uploads/foto.png', Buffer.from([137, 80, 78, 71]));
  await write('scripts/build.mjs', 'export default true;');
  await write('.github/workflows/pages.yml', 'name: Publiceren');
  await write('auth/.dev.vars', 'GITHUB_CLIENT_SECRET=geheim');
  await write('auth/private-key.pem', 'privé');
  await write('forms/secrets.json', { secret: 'geheim' });
  await write('content/node_modules/private.json', { ignored: true });
  await write('_site/index.html', 'uitvoer');
  const result = await createArchive(root);
  assert.deepEqual(result.files.map(item => item.path).sort(), ['.github/workflows/pages.yml', 'content/site.json', 'public/uploads/foto.png', 'scripts/build.mjs']);
  assert.equal(validateArchive(result).totalBytes, result.files.reduce((sum, item) => sum + item.size, 0));
  assert.equal(JSON.stringify(result).includes('GITHUB_CLIENT_SECRET=geheim'), false);
});

test('backup rejects known credential material hardcoded in normal source', async t => {
  const { root, write } = await fixture(t);
  await write('scripts/example.mjs', `const key='${'ghu_' + '012345678901234567890123456789'}';`);
  await assert.rejects(createArchive(root), /Mogelijk geheim/);
});

test('back-up and restore reject symlink destinations and symlink ancestors', async t => {
  const { root, write } = await fixture(t);
  const outside = await mkdtemp(path.join(PROJECT_ROOT, '.test-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await write('content/site.json', { title: 'Dorpsraad' });
  await symlink(outside, path.join(root, 'public'));
  await assert.rejects(createArchive(root), /Symlink/);
  const result = archive([entry('public/uploads/photo.png', Buffer.from('test'))]);
  await assert.rejects(restoreBackup(result, { root, apply: true }), /Symlinks/);
  assert.deepEqual(await readdir(outside), []);
});

test('archive validation rejects traversal, platform ambiguity, secret paths and checksum corruption', () => {
  for (const value of ['../content/site.json', '/content/site.json', 'content/../site.json', 'content\\site.json', 'content//site.json', 'content/site.json.', 'content/CON.json', 'content/file:ads.json', 'auth/.env', 'auth/key.pem', 'xand3rr.github.io/index.html']) {
    assert.throws(() => validateArchive(archive([{ path: value, data: 'eA==', size: 1, sha256: '0'.repeat(64) }])));
  }
  const value = entry('content/site.json', Buffer.from('{}'));
  assert.throws(() => validateArchive(archive([{ ...value, sha256: '0'.repeat(64) }])), /Bestandscontrole/);
  assert.throws(() => validateArchive(archive([{ ...value, data: value.data + '\n' }])), /bestandsinhoud/);
  assert.throws(() => validateArchive(archive([value, { ...value, path: 'content/SITE.json' }])), /Dubbel/);
});

test('restore is dry-run by default and preserves unrelated source files', async t => {
  const { root, write } = await fixture(t);
  await write('content/site.json', 'origineel');
  await write('content/pages/eigen-pagina.json', 'behouden');
  const before = archive([entry('content/site.json', Buffer.from('gewijzigd')), entry('public/uploads/foto.png', Buffer.from('nieuw'))]);
  const result = await restoreBackup(before, { root });
  assert.equal(result.applied, false);
  assert.deepEqual(result.write, ['content/site.json', 'public/uploads/foto.png']);
  assert.equal(await readFile(path.join(root, 'content/site.json'), 'utf8'), 'origineel');
  assert.equal(await readFile(path.join(root, 'content/pages/eigen-pagina.json'), 'utf8'), 'behouden');
  assert.deepEqual(await readdir(root), ['content']);
});

test('applied restore creates a verified rollback restoring previous files and removing added files', async t => {
  const { root, write } = await fixture(t);
  await write('content/site.json', 'origineel');
  await write('content/pages/eigen-pagina.json', 'behouden');
  const before = archive([entry('content/site.json', Buffer.from('gewijzigd')), entry('public/uploads/foto.png', Buffer.from('nieuw'))]);
  const restored = await restoreBackup(before, { root, apply: true });
  assert.equal(restored.applied, true);
  assert.equal(await readFile(path.join(root, 'content/site.json'), 'utf8'), 'gewijzigd');
  const rollback = JSON.parse(await readFile(restored.rollback, 'utf8'));
  assert.deepEqual(rollback.remove, ['public/uploads/foto.png']);
  await restoreBackup(rollback, { root, apply: true });
  assert.equal(await readFile(path.join(root, 'content/site.json'), 'utf8'), 'origineel');
  await assert.rejects(readFile(path.join(root, 'public/uploads/foto.png')), { code: 'ENOENT' });
  assert.equal(await readFile(path.join(root, 'content/pages/eigen-pagina.json'), 'utf8'), 'behouden');
});

test('invalid entry anywhere refuses the complete restore before any file mutation', async t => {
  const { root, write } = await fixture(t);
  await write('content/site.json', 'origineel');
  const valid = entry('content/site.json', Buffer.from('gewijzigd'));
  await assert.rejects(restoreBackup(archive([valid, { ...valid, path: '../site.json' }]), { root, apply: true }));
  assert.equal(await readFile(path.join(root, 'content/site.json'), 'utf8'), 'origineel');
  assert.deepEqual(await readdir(root), ['content']);
});

async function productionFixture(t) {
  const f = await fixture(t);
  await f.write('content/site.json', { testMode: false, contactEmail: 'contact@dorpsraad.nl', heroCaption: 'Foto van het dorp' });
  await f.write('content/forms.json', { mode: 'live', endpoint: 'https://formulieren.example.net/submit', turnstileSiteKey: '0x4AAAAAAFSmQf4b9cy9HPxm' });
  await f.write('config/hosting.json', { repository: 'xand3rr/drkwdtest', siteUrl: 'https://drkwdtest.xanderfaase.nl/', authUrl: 'https://login.example.net' });
  await f.write('content/pages/privacy.json', { example: false, title: 'Privacy', body: 'Dorpsraad Kwadendamme is verantwoordelijk voor de persoonsgegevens. Contact opnemen kan via het officiële adres. Berichten gaan naar de dorpsraad en worden maximaal drie maanden bewaard. Hosting en mail worden verzorgd door de genoemde diensten.' });
  return f;
}

test('production check distinguishes filled local configuration from still-required live controls', async t => {
  const { root } = await productionFixture(t);
  const result = await checkProduction(root);
  assert.equal(result.ready, true);
  assert.ok(result.checks.some(item => item.code === 'LIVE_CHECK' && item.level === 'warning'));
  assert.ok(result.checks.some(item => item.code === 'CMS_AUDIT' && item.level === 'warning'));
});

test('production check blocks test settings, examples, fake keys and placeholder privacy without changing content', async t => {
  const { root, write } = await productionFixture(t);
  await write('content/site.json', { testMode: true, contactEmail: '', heroCaption: 'voorbeeldfoto' });
  await write('content/forms.json', { mode: 'verified-test', endpoint: 'http://unsafe.invalid/', turnstileSiteKey: '1x00000000000000000000AA' });
  await write('content/pages/privacy.json', { title: 'Privacy in dit concept', example: true, body: 'De dorpsraad vult hier later de informatie in.' });
  await write('content/news/bericht.json', { title: 'Nieuws', example: true });
  await write('content/news/concept.json', { title: 'Concept', example: true, draft: true });
  const result = await checkProduction(root);
  assert.equal(result.ready, false);
  for (const code of ['TEST_MODE', 'CONTACT', 'FORM_MODE', 'FORM_ENDPOINT', 'TURNSTILE', 'PRIVACY', 'PHOTO', 'EXAMPLE_CONTENT']) assert.ok(result.checks.some(item => item.code === code), code);
  assert.equal(result.checks.filter(item => item.code === 'EXAMPLE_CONTENT').length, 1);
  assert.equal(JSON.parse(await readFile(path.join(root, 'content/site.json'), 'utf8')).testMode, true);
});
