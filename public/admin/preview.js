/* Local preview: React text nodes and validated URLs, never HTML deserialization. */
const FORBIDDEN = /[<>"'\\\u0000-\u001f\u007f]/u;
const RASTER = /\.(?:png|jpe?g|webp|gif)$/i;
const DEFAULT_ORIGIN = 'https://preview.invalid';
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const list = value => Array.isArray(value) ? value.slice(0, 100) : [];
const string = (value, max = 20000) => typeof value === 'string' ? value.slice(0, max) : '';

export function entryData(entry) {
  const data = entry?.getIn ? entry.getIn(['data']) : entry?.data;
  return record(data?.toJS ? data.toJS() : data);
}

export function safePreviewHref(value, { basePath = '', siteOrigin = DEFAULT_ORIGIN, mail = true } = {}) {
  if (typeof value !== 'string' || !value || value.length > 2048 || FORBIDDEN.test(value)) return '';
  try {
    const origin = new URL(siteOrigin).origin;
    const prefix = typeof basePath === 'string' && /^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath) ? basePath : '';
    if (/^#[A-Za-z0-9_-]+$/.test(value)) return value;
    if (mail && /^mailto:[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/i.test(value)) return value;
    if (value.startsWith('/') && !value.startsWith('//')) {
      const decoded = decodeURIComponent(value);
      if (FORBIDDEN.test(decoded) || decoded.startsWith('//') || decoded.split(/[/?#]/).some(part => part === '.' || part === '..')) return '';
      const address = new URL(value, origin);
      if (address.origin !== origin) return '';
      const pathname = prefix && address.pathname !== prefix && !address.pathname.startsWith(prefix + '/') ? prefix + address.pathname : address.pathname;
      return pathname + address.search + address.hash;
    }
    if (!/^https:\/\//i.test(value) || /\s/.test(value)) return '';
    const address = new URL(value);
    if (address.username || address.password) return '';
    return address.href;
  } catch { return ''; }
}

export function safePreviewImage(value, getAsset, options = {}) {
  if (typeof value !== 'string' || !/^\/(?:assets|uploads)\//.test(value) || !RASTER.test(value) || /[?#]/.test(value)) return '';
  const local = safePreviewHref(value, { ...options, mail: false });
  if (!local) return '';
  if (typeof getAsset === 'function') {
    try {
      const asset = getAsset(value);
      const candidate = typeof asset?.url === 'string' ? asset.url : asset?.toString?.();
      if (typeof candidate === 'string' && candidate.startsWith('blob:')) {
        const address = new URL(candidate);
        if (address.origin === new URL(options.siteOrigin || DEFAULT_ORIGIN).origin) return address.href;
      }
      if (typeof candidate === 'string' && /^https:\/\//i.test(candidate)) {
        const address = new URL(candidate);
        if (address.origin === new URL(options.siteOrigin || DEFAULT_ORIGIN).origin && !address.username && !address.password && RASTER.test(address.pathname)) return address.href;
      }
    } catch { /* Pending/unknown assets keep their safe published path. */ }
  }
  return local;
}

export function renderInline(h, input, options = {}) {
  const source = string(input);
  const nodes = [];
  const pattern = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\(([^)\n]+)\)/g;
  let end = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index > end) nodes.push(source.slice(end, match.index));
    if (match[1]) nodes.push(h('strong', { key: match.index }, match[1]));
    else if (match[2]) nodes.push(h('em', { key: match.index }, match[2]));
    else {
      const href = safePreviewHref(match[4], options);
      nodes.push(href ? h('a', { key: match.index, href, target: '_blank', rel: 'noopener noreferrer' }, match[3]) : match[0]);
    }
    end = pattern.lastIndex;
  }
  if (end < source.length) nodes.push(source.slice(end));
  return nodes;
}

export function renderPreviewText(h, value, options = {}) {
  return string(value).replace(/\r\n?/g, '\n').split(/\n\s*\n/).filter(block => block.trim()).slice(0, 200).map((block, index) => {
    const lines = block.trim().split('\n');
    const heading = lines.length === 1 && /^(#{1,5})\s+(.+)$/.exec(lines[0]);
    if (heading) return h(`h${heading[1].length + 1}`, { key: index }, ...renderInline(h, heading[2], options));
    if (lines.every(line => /^[-*] /.test(line))) return h('ul', { key: index }, ...lines.map((line, item) => h('li', { key: item }, ...renderInline(h, line.slice(2), options))));
    const content = [];
    lines.forEach((line, item) => {
      if (item) content.push(h('br', { key: `br-${item}` }));
      content.push(...renderInline(h, line, options));
    });
    return h('p', { key: index }, ...content);
  });
}

export function createPreview(h, options = {}) {
  if (typeof h !== 'function') throw new Error('React.createElement ontbreekt voor de voorbeeldweergave.');
  const link = (item, key) => {
    const data = record(item);
    if (data.enabled === false) return null;
    const label = string(data.label || data.text || data.title, 200);
    const href = safePreviewHref(data.url || data.href || data.link, options);
    return label ? h(href ? 'a' : 'span', { key, ...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {}), className: `preview-button${data.style === 'solid' ? ' preview-button-solid' : ''}` }, label) : null;
  };
  const image = (data, getAsset, key) => {
    const src = safePreviewImage(data.image || data.src, getAsset, options);
    return src ? h('figure', { key, className: 'preview-figure' }, h('img', { src, alt: string(data.imageAlt || data.alt, 300), loading: 'lazy' }), data.caption ? h('figcaption', {}, string(data.caption, 500)) : null) : null;
  };
  const collectionCards = (type, block, collections, getAsset) => {
    const names = { news: 'news', topics: 'projects', projects: 'projects', meetings: 'meetings', documents: 'documents', members: 'members' };
    const items = list(collections[names[type] || type]).filter(item => item.draft !== true && (!block.featuredOnly || item.featured === true)
      && (!item.publishAt || (Number.isFinite(Date.parse(item.publishAt)) && Date.parse(item.publishAt) <= Date.now()))
      && (!item.unpublishAt || (Number.isFinite(Date.parse(item.unpublishAt)) && Date.parse(item.unpublishAt) > Date.now())));
    if (type === 'news') items.sort((a, b) => options.content?.design?.newsOrder === 'manual'
      ? (Number(a.order) || 0) - (Number(b.order) || 0) || string(b.date).localeCompare(string(a.date))
      : string(b.date).localeCompare(string(a.date)));
    else if (type === 'members') items.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || string(a.name).localeCompare(string(b.name), 'nl'));
    else if (type === 'meetings') items.sort((a, b) => string(a.date).localeCompare(string(b.date)) || string(a.title).localeCompare(string(b.title), 'nl'));
    else items.sort((a, b) => string(b.date).localeCompare(string(a.date)) || string(a.title).localeCompare(string(b.title), 'nl'));
    const selected = list(block.items || block.selected || block.news);
    const displayed = (selected.length ? selected.map(slug => items.find(item => item.slug === slug || item.id === slug)).filter(Boolean) : items)
      .slice(0, Math.min(24, Math.max(1, Number(block.limit || block.count) || 3)));
    if (!displayed.length) return h('p', { className: 'preview-placeholder' }, `Hier verschijnen de gepubliceerde items uit ${type}.`);
    return h('div', { className: 'preview-cards' }, ...displayed.map((item, index) => h('article', { key: index, className: 'preview-card' }, image(item, getAsset, 'image'),
      h('p', { className: 'preview-eyebrow' }, string(item.date || item.status || item.role, 100)), h('h3', {}, string(item.title || item.name, 200)), h('p', {}, string(item.intro || item.text || item.body, 1200)))));
  };
  const blockView = (value, index, props) => {
    const block = record(value);
    if (block.enabled === false || block.visible === false) return null;
    const type = string(block.type || block.kind, 40) || 'text';
    const data = props.data || {};
    const headline = block.title || block.heading || (type === 'hero' ? data.title : '');
    const intro = block.intro || (type === 'hero' ? data.intro : '');
    const body = block.body || block.text || (type === 'hero' ? data.body : '');
    const site = options.content?.site || {};
    const media = type === 'hero' ? { ...block, image: block.image || site.heroImage, imageAlt: block.imageAlt || site.heroAlt, caption: block.caption || site.heroCaption } : block;
    const buttons = list(block.buttons || block.links || (block.button ? [block.button] : []));
    const cards = list(block.cards || block.callouts || (type === 'callouts' ? block.items : []));
    return h('section', { key: index, className: `preview-section preview-section-${['hero', 'text', 'image', 'button', 'buttons', 'cards', 'callouts', 'news', 'topics', 'projects', 'meetings', 'documents', 'members'].includes(type) ? type : 'text'}` },
      block.eyebrow ? h('p', { className: 'preview-eyebrow' }, string(block.eyebrow, 200)) : null,
      headline ? h(type === 'hero' && props.isHome ? 'h1' : 'h2', {}, string(headline, 200)) : null,
      intro ? h('p', {}, string(intro, 1200)) : null,
      h('div', { className: 'preview-prose' }, ...renderPreviewText(h, body, options)),
      image(media, props.getAsset, 'image'),
      buttons.length ? h('div', { className: 'preview-buttons' }, ...buttons.map(link)) : null,
      cards.length ? h('div', { className: 'preview-cards' }, ...cards.map((card, cardIndex) => h('article', { key: cardIndex, className: 'preview-card' },
        card.eyebrow ? h('p', { className: 'preview-eyebrow' }, string(card.eyebrow, 200)) : null,
        h('h3', {}, string(card.title || card.heading, 200)), ...renderPreviewText(h, card.body || card.text, options),
        ...list(card.buttons || card.links || (card.button ? [card.button] : [])).map(link), card.url ? link(card, 'card-link') : null))) : null,
      ['news', 'topics', 'projects', 'meetings', 'documents', 'members'].includes(type) ? collectionCards(type, block, { ...(options.content || {}), ...(props.collections || {}) }, props.getAsset) : null
    );
  };
  return function Preview(props) {
    const data = entryData(props.entry);
    const name = props.entry?.get?.('slug') || props.entry?.slug;
    const sections = list(data.sections || data.blocks || (name === 'home' ? options.content?.design?.homeSections : []));
    const isHome = name === 'home';
    const homeHero = isHome && sections.some(block => block.type === 'hero' && block.enabled !== false);
    const settings = Boolean(data.brand || data.menu || data.navigation || data.footerLinks || data.brandName || data.tagline || data.heroImage || data.turnstileSiteKey);
    const body = [];
    if (settings) {
      if (data.turnstileSiteKey) {
        body.push(h('h1', { key: 'title' }, 'Formulierinstellingen'));
        body.push(h('p', { key: 'mode' }, `Verzendmodus: ${string(data.mode, 100)}`));
        body.push(h('p', { key: 'endpoint' }, `Endpoint: ${string(data.endpoint, 2048)}`));
        body.push(h('p', { key: 'captcha' }, 'Turnstile wordt op de bezoekerswebsite geladen. In het CMS worden geen tokens of berichten verstuurd.'));
      }
      body.push(h('div', { key: 'brand', className: 'preview-brand' }, image({ image: data.brand?.logo || data.flagImage || data.flag, imageAlt: data.brand?.logoAlt }, props.getAsset, 'flag'),
        h('div', {}, data.brand?.eyebrow ? h('p', { className: 'preview-eyebrow' }, string(data.brand.eyebrow, 200)) : null, h('strong', {}, string(data.brand?.name || data.brandName || data.title, 200)))));
      const menu = list(data.menu || data.navigation);
      if (menu.length) body.push(h('nav', { key: 'nav', className: 'preview-menu', 'aria-label': 'Voorbeeld van het hoofdmenu' }, ...menu.filter(item => item.enabled !== false).map((item, index) => h('div', { key: index }, link(item, 'parent'),
        list(item.children).length ? h('div', { className: 'preview-submenu' }, ...list(item.children).map(link)) : null))));
      body.push(image({ image: data.heroImage, imageAlt: data.heroAlt, caption: data.heroCaption }, props.getAsset, 'hero'));
      if (list(data.sidebar || data.sidebars).length) body.push(h('aside', { key: 'sidebar' }, ...list(data.sidebar || data.sidebars).map((item, index) => blockView(item, index, props))));
      const footer = list(data.footerLinks || data.footer?.links);
      if (footer.length || data.tagline) body.push(h('footer', { key: 'footer', className: 'preview-footer' }, ...footer.map(link), h('p', {}, string(data.tagline, 200))));
    } else {
      if (data.eyebrow) body.push(h('p', { key: 'eyebrow', className: 'preview-eyebrow' }, string(data.eyebrow, 200)));
      if (!homeHero) body.push(h('h1', { key: 'title' }, string(data.title || data.name, 200) || 'Nieuwe pagina'));
      if (!homeHero && data.intro) body.push(h('p', { key: 'intro', className: 'preview-intro' }, string(data.intro, 1200)));
      if (!homeHero) body.push(h('div', { key: 'body', className: 'preview-prose' }, ...renderPreviewText(h, data.body || data.text, options)));
      body.push(image(data, props.getAsset, 'image'));
      if (list(data.buttons).length) body.push(h('div', { key: 'buttons', className: 'preview-buttons' }, ...list(data.buttons).map(link)));
      const meta = [data.date, data.time, data.location, data.author, data.status, data.role].filter(value => typeof value === 'string' && value);
      if (meta.length) body.push(h('p', { key: 'meta', className: 'preview-meta' }, meta.map(value => string(value, 300)).join(' · ')));
      if (data.file) body.push(link({ label: 'Open document (PDF)', url: data.file }, 'file'));
      body.push(...sections.map((block, index) => blockView(block, index, { ...props, data, isHome })));
      if (data.showSidebar !== false) {
        const customSidebar = list(data.sidebar);
        const sidebar = customSidebar.length ? customSidebar : list(options.content?.design?.sidebar);
        if (sidebar.length) body.push(h('aside', { key: 'sidebar', className: 'preview-sidebar' }, ...sidebar.map((block, index) => blockView(block, index, props))));
      }
    }
    return h('article', { className: 'village-preview' },
      h('p', { className: 'preview-notice' }, 'Voorbeeld vóór publicatie. De publicatietest controleert ook links, media en pagina’s.'),
      data.draft === true ? h('p', { className: 'preview-draft' }, 'Concept: verborgen op de bezoekerswebsite.') : null,
      data.publishAt ? h('p', { className: 'preview-meta' }, `Publiceren vanaf ${string(data.publishAt, 100)}`) : null,
      data.unpublishAt ? h('p', { className: 'preview-meta' }, `Verbergen vanaf ${string(data.unpublishAt, 100)}`) : null,
      ...body
    );
  };
}

export function registerPreviews(CMS, options = {}) {
  if (!CMS?.registerPreviewTemplate || !CMS?.registerPreviewStyle) throw new Error('Decap ondersteunt de lokale voorbeeldweergave niet.');
  const h = options.createElement || options.React?.createElement || globalThis.React?.createElement || globalThis.h;
  const Preview = createPreview(h, options);
  const names = new Set(['home', 'dorpsraad', 'nieuws', 'onderwerpen', 'vergaderingen', 'documenten', 'contact', 'meedenken', 'privacy', 'niet-gevonden', 'testinbox', 'testpagina', 'site', 'design', 'forms', 'news', 'projects', 'meetings', 'documents', 'members', 'pages', 'extra_pages']);
  for (const collection of options.config?.collections || []) {
    if (collection.files) collection.files.forEach(file => names.add(file.name));
    else names.add(collection.name);
  }
  let Component = Preview;
  const createClass = options.createClass || globalThis.createClass;
  if (typeof createClass === 'function') Component = createClass({
    getInitialState() { return { collections: {} }; },
    componentDidMount() {
      this.previewAlive = true;
      if (typeof this.props.getCollection !== 'function') return;
      for (const name of ['news', 'projects', 'meetings', 'documents', 'members']) {
        Promise.resolve().then(() => this.props.getCollection(name)).then(entries => {
          if (!this.previewAlive) return;
          const converted = entries?.toArray ? entries.toArray() : entries;
          const values = list(converted).map(entry => ({ ...entryData(entry), slug: entry?.get?.('slug') || entry?.slug }));
          this.setState(state => ({ collections: { ...state.collections, [name]: values } }));
        }).catch(() => { /* Unavailable collections keep an explicit placeholder. */ });
      }
    },
    componentWillUnmount() { this.previewAlive = false; },
    render() { return Preview({ ...this.props, collections: this.state.collections }); }
  });
  for (const name of names) if (typeof name === 'string' && name) CMS.registerPreviewTemplate(name, Component);
  const style = safePreviewHref(options.styleUrl || `${options.basePath || ''}/admin/preview.css`, options);
  if (!style) throw new Error('Het stylesheetadres voor de voorbeeldweergave is ongeldig.');
  CMS.registerPreviewStyle(style);
  return Component;
}
