import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreview, entryData, renderPreviewText, safePreviewHref, safePreviewImage, registerPreviews } from '../public/admin/preview.js';

const options = { basePath: '/drkwdtest', siteOrigin: 'https://drkwdtest.xanderfaase.nl' };
const h = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(child => child != null) });
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...tree.children.flatMap(nodes)];
}
function texts(tree) {
  if (typeof tree === 'string') return tree;
  return tree && typeof tree === 'object' ? tree.children.map(texts).join(' ') : '';
}

test('Preview treats HTML as literal text, permits explicit formatting, and rejects script links', () => {
  const content = renderPreviewText(h, '# Tussenkop\n\n**Vet** en *cursief* en [Contact](/contact/).\n\n<img src=x onerror=alert(1)>\n\n[Aanval](javascript:alert)', options);
  const tree = h('div', {}, ...content);
  const all = nodes(tree);
  assert(all.some(node => node.tag === 'h2'));
  assert(all.some(node => node.tag === 'strong' && texts(node) === 'Vet'));
  assert(all.some(node => node.tag === 'em' && texts(node) === 'cursief'));
  assert(all.some(node => node.tag === 'a' && node.props.href === '/drkwdtest/contact/'));
  assert(texts(tree).includes('<img src=x onerror=alert(1)>'));
  assert(!all.some(node => node.tag === 'script' || node.tag === 'img'));
  assert(!all.some(node => node.props.dangerouslySetInnerHTML || node.props.onError || node.props.onLoad));
  assert(!all.some(node => node.props.href?.startsWith('javascript:')));
});

test('Preview links reject unsafe protocols, encoded traversal, credentials and malformed paths', () => {
  for (const value of ['javascript:alert(1)', 'data:text/html,attack', 'http://example.com', '//example.com', '/uploads/%2e%2e/private', '/uploads/%5c..%5cprivate', 'https://name:secret@example.com/', '/%00foo', '/%ZZfoo', '/\\evil.com', '/%2f%2fevil.com', 'https://example.com/\nattack']) {
    assert.equal(safePreviewHref(value, options), '', value);
  }
  assert.equal(safePreviewHref('/contact/', options), '/drkwdtest/contact/');
  assert.equal(safePreviewHref('/drkwdtest/contact/', options), '/drkwdtest/contact/');
  assert.equal(safePreviewHref('/uploads/een foto.png', options), '/drkwdtest/uploads/een%20foto.png');
  assert.equal(safePreviewHref('https://example.com/page', options), 'https://example.com/page');
  assert.equal(safePreviewHref('mailto:info@example.com', options), 'mailto:info@example.com');
  assert.equal(safePreviewHref('#inhoud', options), '#inhoud');
});

test('Preview image uploads allow only local raster images and trusted same-origin asset blobs', () => {
  assert.equal(safePreviewImage('/uploads/foto.jpg', () => ({ toString: () => 'blob:https://drkwdtest.xanderfaase.nl/1234' }), options), 'blob:https://drkwdtest.xanderfaase.nl/1234');
  assert.equal(safePreviewImage('/uploads/foto.jpg', () => ({ url: 'blob:https://evil.example/1234' }), options), '/drkwdtest/uploads/foto.jpg');
  assert.equal(safePreviewImage('/uploads/foto.jpg', () => ({ url: 'data:image/svg+xml,<svg>' }), options), '/drkwdtest/uploads/foto.jpg');
  assert.equal(safePreviewImage('/uploads/foto.jpg', () => { throw new Error('pending'); }, options), '/drkwdtest/uploads/foto.jpg');
  for (const value of ['/uploads/attack.svg', '/assets/attack.html', 'blob:https://drkwdtest.xanderfaase.nl/1234', 'data:image/png;base64,123', 'https://evil.example/foto.jpg', '/uploads/%2e%2e/private.jpg']) {
    assert.equal(safePreviewImage(value, null, options), '', value);
  }
});

test('Typed sections preserve editor order and visibility, callout buttons and safe image attributes', () => {
  const Preview = createPreview(h, options);
  const tree = Preview({ entry: { data: { title: 'Onze startpagina', body: 'Tekst', sections: [
    { type: 'text', enabled: false, title: 'Verborgen' },
    { type: 'text', title: 'Eerst', text: 'Een tekst' },
    { type: 'callouts', title: 'Daarna', items: [{ title: 'Meedoen', text: 'Een idee?', button: { label: 'Denk mee', href: '/meedenken/', style: 'solid' } }] },
    { type: 'image', title: 'Als laatste', image: '/uploads/foto.jpg', imageAlt: '" onerror="alert(1)', caption: '<script>caption</script>' }
  ] } } });
  const all = nodes(tree);
  const copy = texts(tree);
  assert(!copy.includes('Verborgen'));
  assert(copy.indexOf('Eerst') < copy.indexOf('Daarna'));
  assert(copy.indexOf('Daarna') < copy.indexOf('Als laatste'));
  assert(all.some(node => node.tag === 'a' && node.props.href === '/drkwdtest/meedenken/' && texts(node) === 'Denk mee'));
  const image = all.find(node => node.tag === 'img');
  assert.equal(image.props.alt, '" onerror="alert(1)');
  assert.equal(image.props.onError, undefined);
});

test('Settings preview renders editable brand, dropdown menu, footer and sidebar without exposing hidden home defaults', () => {
  const Preview = createPreview(h, options);
  const tree = Preview({ entry: { data: {
    brand: { eyebrow: 'Dorpsraad', name: 'Kwadendamme', logo: '/assets/vlag.jpg', logoAlt: 'Vlag' },
    navigation: [{ label: 'Nieuws', href: '/nieuws/', children: [{ label: 'Documenten', href: '/documenten/' }] }, { label: 'Verborgen', href: '/contact/', enabled: false }],
    footerLinks: [{ label: 'Privacy', href: '/privacy/' }], sidebar: [{ title: 'Doe mee', text: 'Welkom', links: [{ label: 'Contact', href: '/contact/' }] }],
    homeSections: [{ type: 'text', title: 'Standaard startblok', text: 'Bewerkbaar' }]
  } } });
  const all = nodes(tree);
  assert(texts(tree).includes('Kwadendamme'));
  assert(!texts(tree).includes('Standaard startblok'));
  assert(!texts(tree).includes('Verborgen'));
  for (const target of ['/drkwdtest/nieuws/', '/drkwdtest/documenten/', '/drkwdtest/privacy/', '/drkwdtest/contact/']) assert(all.some(node => node.props.href === target), target);
});

test('Homepage hero uses current title and intro, default sections and existing site photo', () => {
  const Preview = createPreview(h, { ...options, content: { site: { heroImage: '/assets/dorp.png', heroAlt: 'Ons dorp' }, design: { homeSections: [{ type: 'hero', enabled: true }, { type: 'news', featuredOnly: true, limit: 1 }] }, news: [{ title: 'Geselecteerd', featured: true }, { title: 'Ander', featured: false }] } });
  const tree = Preview({ entry: { slug: 'home', data: { title: 'Nieuwe titel', intro: 'Een eigen introductie', body: '' } } });
  assert(nodes(tree).some(node => node.props.src === '/drkwdtest/assets/dorp.png'));
  assert(texts(tree).includes('Een eigen introductie'));
  assert(texts(tree).includes('Geselecteerd'));
  assert(!texts(tree).includes('Ander'));
});

test('Member preview shows editable details; collection blocks withhold drafts and future publication', () => {
  const Preview = createPreview(h, { ...options, content: { news: [
    { title: 'Nu zichtbaar', publishAt: '2020-01-01T10:00:00Z' },
    { title: 'Toekomstige inhoud', publishAt: '2099-01-01T10:00:00Z' },
    { title: 'Conceptinhoud', draft: true }
  ] } });
  const page = Preview({ entry: { data: { title: 'Nieuwsselectie', sections: [{ type: 'news' }] } } });
  assert(texts(page).includes('Nu zichtbaar'));
  assert(!texts(page).includes('Toekomstige inhoud'));
  assert(!texts(page).includes('Conceptinhoud'));
  const member = Preview({ entry: { data: { name: 'Voorbeeldlid', role: 'Secretaris', text: 'Mijn dorpsverhaal', image: '/uploads/lid.jpg', imageAlt: 'Portret' } } });
  for (const value of ['Voorbeeldlid', 'Secretaris', 'Mijn dorpsverhaal']) assert(texts(member).includes(value));
  assert(nodes(member).some(node => node.tag === 'img' && node.props.alt === 'Portret'));
});

test('Every fixed-file and folder collection registers safely using Decap h alias without npm React', () => {
  const templates = new Map();
  const styles = [];
  const CMS = { registerPreviewTemplate: (name, component) => templates.set(name, component), registerPreviewStyle: address => styles.push(address) };
  registerPreviews(CMS, { ...options, createElement: h, config: { collections: [{ name: 'paginas', files: [{ name: 'bijzondere-pagina' }] }, { name: 'extra_pages' }] } });
  for (const name of ['home', 'site', 'design', 'forms', 'members', 'news', 'extra_pages', 'bijzondere-pagina']) assert.equal(typeof templates.get(name), 'function', name);
  assert.deepEqual(styles, ['/drkwdtest/admin/preview.css']);
  const fakeData = { toJS: () => ({ title: 'Immutable titel', sections: [] }) };
  assert.equal(entryData({ getIn: paths => paths[0] === 'data' ? fakeData : null }).title, 'Immutable titel');
});
