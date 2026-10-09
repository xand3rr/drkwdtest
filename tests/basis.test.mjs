import test from 'node:test';
import assert from 'node:assert/strict';
import { hosting, render, cmsConfig, validatePage, CMS_SCRIPT } from '../lib/basis.mjs';
const config = { repository: '', authUrl: '', basePath: null };
test('CMS-editable JSON reaches the visitor page; HTML is displayed as text', () => {
  const page = { title: '<script>alert(1)</script>', body: 'Nieuwe tekst\n\n<img src=x onerror=alert(1)>\nVolgende regel' };
  const html = render(page, hosting(config));
  assert.match(html, /Nieuwe tekst/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /<br>Volgende regel/);
});
test('Project repositories, root repositories and custom domains retain correct admin links', () => {
  const project = hosting(config, { GITHUB_REPOSITORY: 'voorbeeld/testsite' });
  assert.equal(project.basePath, '/testsite');
  assert.match(render({ title: 'Test', body: 'Tekst' }, project), /href="\/testsite\/admin\/"/);
  assert.equal(hosting(config, { GITHUB_REPOSITORY: 'voorbeeld/voorbeeld.github.io' }).basePath, '');
  assert.equal(hosting({ ...config, siteUrl: 'https://example.org/' }, { GITHUB_REPOSITORY: 'voorbeeld/testsite' }).basePath, '');
});
test('The minimal CMS targets one real JSON file and uses plain text widgets', () => {
  const cms = cmsConfig(hosting(config));
  assert.equal(cms.backend.name, 'github');
  assert.equal(cms.local_backend, undefined);
  assert.equal(cms.collections.length, 1);
  const entry = cms.collections[0].files[0];
  assert.equal(entry.file, 'content/page.json');
  assert.equal(entry.format, 'json');
  assert.deepEqual(entry.fields.map(f => f.widget), ['string', 'text']);
  assert.match(CMS_SCRIPT, /decap-cms@3\.16\.3\/dist\/decap-cms\.js$/);
});
test('Invalid content and unsafe login/configuration addresses fail before writing HTML', () => {
  for (const page of [{ title: '', body: 'Tekst' }, { title: 'Titel', body: null }, { title: 'Titel', body: 'x'.repeat(20001) }]) assert.throws(() => validatePage(page));
  for (const authUrl of ['http://login.example', 'https://user:secret@login.example', 'https://login.example/callback']) assert.throws(() => hosting({ ...config, authUrl }));
  assert.throws(() => hosting({ ...config, basePath: '/../secret' }));
});
