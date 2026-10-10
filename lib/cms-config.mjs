import { cmsConfig as baselineConfig } from './basis.mjs';
import { DEFAULT_FORMS } from './defaults.mjs';

const limited = (name, label, max, widget = 'string', required = false) => ({ name, label, widget, required,
  pattern: [`^[\\s\\S]{0,${max}}$`, `Gebruik maximaal ${max} tekens.`] });
const bool = (name, label, value = true) => ({ name, label, widget: 'boolean', default: value, required: false });
const count = (name, label, value = 3, max = 24) => ({ name, label, widget: 'number', value_type: 'int', min: 1, max, default: value });
const image = { name: 'image', label: 'Foto', widget: 'image', choose_url: false, required: false, allow_multiple: false,
  media_library: { config: { multiple: false, max_file_size: 10485760 } },
  hint: 'Upload een PNG, JPG, WEBP of GIF. SVG wordt niet gepubliceerd.',
  pattern: ['^$|^/(?:assets|uploads)/.+\\.(?:[pP][nN][gG]|[jJ][pP][eE]?[gG]|[wW][eE][bB][pP]|[gG][iI][fF])$', 'Gebruik een PNG, JPG, WEBP of GIF uit de mediabibliotheek.'] };
const body = (name = 'body', label = 'Tekst', max = 20000) => ({ ...limited(name, label, max, 'text'),
  hint: 'Gebruik lege regels tussen alinea’s, # Tussenkop, - opsomming, **vet**, *cursief* en [linktekst](/contact/) of [linktekst](https://voorbeeld.nl). HTML wordt als gewone tekst getoond.' });
const href = (required = true) => ({ ...limited('href', 'Bestemming', 2048, 'string', required),
  pattern: ['^$|^(?:/(?!/)[^<>"\\\\\\r\\n]*|https://[^\\s<>"\\\\]+|mailto:[^\\s@/?#]+@[^\\s@/?#]+\\.[^\\s@/?#]+|#[A-Za-z0-9_-]+)$', 'Gebruik /contact/, een https-adres, mailto:adres@voorbeeld.nl of #sectie.'],
  hint: 'Interne link, bijvoorbeeld /nieuws/ of /nieuwe-pagina/. De publicatietest controleert of interne pagina’s bestaan.' });
const linkFields = (styles = true) => [limited('label', 'Tekst', 100, 'string', true), href(), ...(styles ? [
  { name: 'style', label: 'Knopstijl', widget: 'select', options: [{ label: 'Groen', value: 'solid' }, { label: 'Omlijnd', value: 'outline' }], default: 'solid', required: false }
] : [])];
const links = (name = 'buttons', label = 'Knoppen', styles = true) => ({ name, label, widget: 'list', required: false, default: [], min: 0, max: 6,
  allow_add: true, allow_remove: true, allow_reorder: true, collapsed: true, summary: '{{fields.label}}', fields: linkFields(styles) });
const sidebar = (name = 'sidebar', label = 'Zijblokken', defaults = []) => ({ name, label, widget: 'list', required: false, default: defaults, min: 0, max: 8,
  allow_add: true, allow_remove: true, allow_reorder: true, collapsed: true, summary: '{{fields.title}}',
  hint: 'De volgorde bepaal je met de pijlen. Laat eigen zijblokken leeg om de algemene zijblokken te gebruiken.', fields: [
    limited('title', 'Titel', 200, 'string', true), body('text', 'Tekst', 5000), links('links', 'Links en knoppen')
  ] });
const sectionCommon = [bool('enabled', 'Deze sectie tonen'), limited('eyebrow', 'Kleine tussentitel boven de kop', 100),
  limited('title', 'Sectietitel', 200), limited('intro', 'Introductie', 1200, 'text')];
const mediaFields = [image, limited('imageAlt', 'Beschrijving van de foto', 300), limited('caption', 'Bijschrift', 300)];
const type = (name, label, fields, hint = '') => ({ name, label, widget: 'object', summary: '{{fields.title}}', fields: [...sectionCommon, ...fields], ...(hint ? { hint } : {}) });
function sections(name = 'sections', label = 'Secties', defaults = []) {
  return { name, label, widget: 'list', typeKey: 'type', required: false, default: defaults, min: 0, max: 24,
    allow_add: true, allow_remove: true, allow_reorder: true, collapsed: true, summary: '{{fields.type}} · {{fields.title}}',
    hint: 'Voeg secties toe, verander de volgorde met de pijlen en zet een sectie tijdelijk uit met “Deze sectie tonen”.', types: [
      type('hero', 'Grote opening met foto', [body('text'), ...mediaFields, links()], 'Op de startpagina gebruikt een leeg titel-, introductie- of tekstveld de gewone paginavelden. Een lege foto gebruikt de algemene startfoto.'),
      type('text', 'Tekstblok', [body('text'), links()]),
      type('image', 'Foto met bijschrift', [...mediaFields, body('text'), links()]),
      type('button', 'Knoppen', [body('text'), links()]),
      type('news', 'Nieuwsselectie', [count('limit', 'Aantal berichten'), bool('featuredOnly', 'Alleen uitgelichte berichten', false), links()]),
      type('topics', 'Onderwerpen', [count('limit', 'Aantal onderwerpen'), links()]),
      type('meetings', 'Vergaderingen', [count('limit', 'Aantal vergaderingen'), links()]),
      type('documents', 'Documenten', [count('limit', 'Aantal documenten'), links()]),
      type('members', 'Dorpsraadleden', [count('limit', 'Aantal leden', 12), links()]),
      type('callouts', 'Naast elkaar: tekst en knop', [{ name: 'items', label: 'Blokken', widget: 'list', required: false, default: [], min: 0, max: 6,
        allow_add: true, allow_remove: true, allow_reorder: true, collapsed: true, summary: '{{fields.title}}', fields: [
          limited('eyebrow', 'Kleine tussentitel', 100), limited('title', 'Titel', 200, 'string', true), body('text', 'Tekst', 5000),
          { name: 'button', label: 'Knop', widget: 'object', required: false, collapsed: true, fields: linkFields() }
        ] }])
    ] };
}
const seo = [limited('seoTitle', 'Titel voor zoekmachines (optioneel)', 200), limited('seoDescription', 'Beschrijving voor zoekmachines (optioneel)', 320, 'text'),
  { ...image, name: 'shareImage', label: 'Afbeelding bij delen (optioneel)' }];
const common = [limited('title', 'Titel', 200, 'string', true), limited('intro', 'Introductie', 1200, 'text'), body(),
  bool('example', 'Voorbeeldinhoud', false), ...seo];
const date = { name: 'date', label: 'Datum', widget: 'datetime', format: 'YYYY-MM-DD', date_format: 'YYYY-MM-DD', time_format: false, picker_utc: true, default: '', required: false };
const draft = bool('draft', 'Concept: nog niet op de website tonen', false);
const schedule = [
  { name: 'publishAt', label: 'Publiceren vanaf (optioneel)', widget: 'datetime', format: 'YYYY-MM-DDTHH:mm:ssZ', picker_utc: false, default: '', required: false,
    hint: 'Lokale datum en tijd; de tijdzone wordt opgeslagen. Publicatie volgt bij de eerstvolgende geslaagde build, doorgaans binnen een uur. Een concept blijft verborgen.' },
  { name: 'unpublishAt', label: 'Verbergen vanaf (optioneel)', widget: 'datetime', format: 'YYYY-MM-DDTHH:mm:ssZ', picker_utc: false, default: '', required: false,
    hint: 'Het item verdwijnt bij de eerstvolgende geslaagde build na dit tijdstip. Zorg dat menu’s en links daarna nog naar bestaande pagina’s verwijzen.' }
];

export function cmsConfig(content) {
  const h = content.hosting;
  const baseline = baselineConfig(h);
  const design = content.design || {};
  const fixed = (content.cmsPages || content.pages).filter(p => p.kind === 'page' && p.id !== 'testpagina');
  const pageFields = (defaults, showSidebar = true, home = false) => [
    ...common.map(field => home && ['title', 'intro', 'body'].includes(field.name) ? { ...field,
      hint: `${field.hint ? field.hint + ' ' : ''}Deze tekst verschijnt in het openingsblok zolang de betreffende velden van dat blok leeg zijn. Knoppen, tussentitels en volgorde wijzig je hieronder bij Secties.` } : field),
    sections('sections', 'Secties: knoppen, tussentitels en volgorde', defaults), bool('showSidebar', 'Zijblokken tonen', showSidebar), sidebar()
  ];
  const folder = (name, label, fields, directory = name) => ({ name, label, folder: `content/${directory}`, create: true, extension: 'json', format: 'json',
    slug: '{{slug}}', identifier_field: 'title', summary: '{{title}}', editor: { preview: true }, fields: [...pageFields([]), ...fields, ...schedule, draft] });
  const config = { ...baseline, editor: { preview: true }, slug: { encoding: 'ascii', clean_accents: true, sanitize_replacement: '-' }, media_folder: 'public/uploads', public_folder: '/uploads',
    site_url: h.siteUrl || '/', display_url: h.siteUrl || '/', logo_url: `${h.basePath}/assets/vlag.jpg`, show_preview_links: false,
    collections: [
      { name: 'paginas', label: 'Vaste pagina’s', editor: { preview: true }, files: fixed.map(p => ({ name: p.id, label: p.id === 'home' ? 'Startpagina' : p.title,
        file: `content/pages/${p.id}.json`, format: 'json', fields: pageFields(p.id === 'home' ? design.homeSections || [] : [], p.showSidebar !== false, p.id === 'home') })) },
      folder('extra_pages', 'Nieuwe pagina’s', [], 'extra-pages'),
      folder('news', 'Nieuws', [date, { ...limited('author', 'Auteur', 120, 'string', true), default: 'Dorpsraad Kwadendamme' }, ...mediaFields.slice(0, 2),
        bool('featured', 'Uitgelicht op de startpagina', false), { name: 'order', label: 'Volgorde bij handmatige sortering', widget: 'number', value_type: 'int', default: 0, min: 0, max: 10000, required: false },
        { name: 'visual', label: 'Illustratie als er geen foto is', widget: 'select', default: 'talk', options: [
          { label: 'Gesprek', value: 'talk' }, { label: 'Omgeving', value: 'leaf' }, { label: 'Dorpsvlag', value: 'flag' }
        ] }]),
      folder('projects', 'Onderwerpen', [{ name: 'status', label: 'Stand van zaken', widget: 'select', default: 'Idee', options: ['Idee', 'In behandeling', 'Afgerond'] }]),
      folder('meetings', 'Vergaderingen', [date,
        { name: 'time', label: 'Tijd (UU:MM)', widget: 'string', required: false, pattern: ['^$|^([01][0-9]|2[0-3]):[0-5][0-9]$', 'Gebruik bijvoorbeeld 19:30, of laat leeg.'] },
        limited('location', 'Locatie', 200)]),
      folder('documents', 'Documenten', [{ name: 'file', label: 'PDF-bestand', widget: 'file', choose_url: false, required: true, allow_multiple: false,
        pattern: ['^/(?:assets|uploads)/.+\\.[pP][dD][fF]$', 'Upload een PDF-bestand.'], hint: 'Upload uitsluitend een PDF.',
        media_library: { config: { multiple: false, max_file_size: 20971520 } } },
        { name: 'meeting', label: 'Hoort bij vergadering', widget: 'relation', collection: 'meetings', search_fields: ['title'], value_field: '{{slug}}', display_fields: ['title'], required: false }]),
      { name: 'members', label: 'Dorpsraadleden', folder: 'content/members', create: true, extension: 'json', format: 'json', slug: '{{slug}}', identifier_field: 'name', summary: '{{name}} · {{role}}',
        editor: { preview: true }, fields: [limited('name', 'Naam', 100, 'string', true), limited('role', 'Rol', 100), body('body', 'Tekst', 5000), ...mediaFields.slice(0, 2),
          { name: 'order', label: 'Volgorde', widget: 'number', value_type: 'int', default: 0, min: 0, max: 10000, required: false }, ...schedule, draft] },
      { name: 'instellingen', label: 'Website-instellingen', editor: { preview: true }, files: [
        { name: 'site', label: 'Algemene instellingen', file: 'content/site.json', format: 'json', fields: [
          limited('title', 'Naam van de website', 100, 'string', true), limited('tagline', 'Slogan in de voettekst', 200, 'string', true),
          { ...image, name: 'heroImage', label: 'Standaardfoto op de startpagina', required: true },
          limited('heroAlt', 'Beschrijving van de startfoto', 300), limited('heroCaption', 'Bijschrift van de startfoto', 200),
          { ...limited('contactEmail', 'Officieel contactadres', 254), hint: 'Publiek zichtbaar adres. De vaste ontvanger voor formulieren wordt afzonderlijk op de formulierworker ingesteld.' },
          { ...bool('editorialWorkflow', 'Redactie: concepten via pull requests', false),
            hint: 'Eerst in de GitHub App Pull requests: Read & write toevoegen, de nieuwe rechten accepteren en opnieuw aanmelden. Voor verplichte tweede goedkeuring zijn GitHub-reviewregels nodig. Een wijziging hier werkt na publicatie en herladen van beheer.' },
          { name: 'testMode', widget: 'hidden', default: true }, { name: 'formEndpoint', widget: 'hidden', default: '' }
        ] },
        { name: 'design', label: 'Layout, menu en zijblokken', file: 'content/design.json', format: 'json', fields: [
          { name: 'brand', label: 'Naam en vlag', widget: 'object', fields: [
            limited('eyebrow', 'Kleine naamregel', 100), limited('name', 'Naam naast de vlag', 100, 'string', true),
            { ...image, name: 'logo', label: 'Vlag of logo', required: true }, limited('logoAlt', 'Beschrijving van de vlag of het logo', 100),
            { ...image, name: 'favicon', label: 'Icoon in het browsertabblad', required: true }
          ] },
          { name: 'navigation', label: 'Hoofdmenu', widget: 'list', required: false, default: design.navigation || [], min: 0, max: 12,
            collapsed: true, allow_add: true, allow_remove: true, allow_reorder: true, summary: '{{fields.label}}', fields: [
              ...linkFields(false), bool('enabled', 'Menu-item tonen'), { ...links('children', 'Submenu', false), max: 12, fields: [...linkFields(false), bool('enabled', 'Submenu-item tonen')] }
            ] },
          { ...links('footerLinks', 'Links in de voettekst', false), max: 12, default: design.footerLinks || [], fields: [...linkFields(false), bool('enabled', 'Link tonen')] },
          sidebar('sidebar', 'Algemene zijblokken', design.sidebar || []), { name: 'homeSections', widget: 'hidden', default: design.homeSections || [] },
          { name: 'newsOrder', label: 'Nieuws sorteren', widget: 'select', default: 'date', options: [{ label: 'Nieuwste datum eerst', value: 'date' }, { label: 'Handmatige volgorde', value: 'manual' }] },
          limited('newsReadMore', 'Tekst van de nieuwsknop', 100, 'string', true)
        ] },
        { name: 'forms', label: 'Formulieren en spambeveiliging', file: 'content/forms.json', format: 'json', fields: [
          { name: 'mode', label: 'Verzendmodus', widget: 'select', default: 'local', options: [
            { label: 'Lokale testinbox: geen verzending', value: 'local' }, { label: 'Beveiligde servertest: geen mail', value: 'verified-test' }, { label: 'Echte verzending', value: 'live' }
          ], hint: 'Gebruik de servertest na het instellen van de worker. Echte verzending werkt pas wanneer de maildienst en ontvanger op de worker zijn ingesteld.' },
          { ...limited('endpoint', 'Formulierworker-endpoint', 2048, 'string', true), pattern: ['^https://[^\\s<>"\\\\]+/submit$', 'Gebruik het volledige https-adres van de worker met /submit.'] },
          { ...limited('turnstileSiteKey', 'Turnstile sitekey (openbaar)', 100, 'string', true), hint: 'De openbare sitekey. De secret key hoort alleen in Cloudflare; zet die hier nooit neer.' },
          { name: 'texts', label: 'Formulierteksten', widget: 'object', required: false, collapsed: true, default: content.forms?.texts || DEFAULT_FORMS.texts,
            fields: [['nameLabel', 'Label naam'], ['emailLabel', 'Label e-mailadres'], ['subjectLabel', 'Label onderwerp'],
              ['messageLabel', 'Label contactbericht'], ['ideaLabel', 'Label idee'], ['submitLabel', 'Tekst van verzendknop'],
              ['consentLabel', 'Tekst bij akkoord met de privacyinformatie']].map(([name, label]) => ({
                ...limited(name, label, name === 'consentLabel' ? 500 : 100, name === 'consentLabel' ? 'text' : 'string', true),
                default: content.forms?.texts?.[name] || DEFAULT_FORMS.texts[name]
              })) }
        ] }
      ] },
      ...baseline.collections.map(collection => ({ ...collection, editor: { preview: true } }))
    ]
  };
  if (content.site.editorialWorkflow === true) config.publish_mode = 'editorial_workflow';
  return config;
}
