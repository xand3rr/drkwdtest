import { cmsConfig as baselineConfig } from './basis.mjs';

const limited = (name, label, max, widget = 'string', required = false) => ({ name, label, widget, required,
  pattern: [`^[\\s\\S]{0,${max}}$`, `Gebruik maximaal ${max} tekens.`] });
const common = [
  limited('title', 'Titel', 200, 'string', true),
  limited('intro', 'Introductie', 1200, 'text'),
  { ...limited('body', 'Tekst', 20000, 'text'), hint: 'Gewone tekst. Gebruik een lege regel tussen alinea’s. Een losse regel met # Titel maakt een tussenkop; - tekst maakt een opsomming. HTML wordt als tekst getoond.' },
  { label: 'Voorbeeldinhoud', name: 'example', widget: 'boolean', default: false, required: false }
];
const date = { name: 'date', label: 'Datum', widget: 'datetime', date_format: 'DD-MM-YYYY', time_format: false, format: 'YYYY-MM-DD', required: false };
const draft = { name: 'draft', label: 'Concept: nog niet op de website tonen', widget: 'boolean', default: false, required: false };
const image = { name: 'image', label: 'Foto', widget: 'image', choose_url: false, required: false,
  hint: 'Upload een PNG, JPG, WEBP of GIF. SVG wordt niet gepubliceerd.', pattern: ['^$|^/(?:assets|uploads)/.+\\.(?:[pP][nN][gG]|[jJ][pP][eE]?[gG]|[wW][eE][bB][pP]|[gG][iI][fF])$', 'Gebruik een PNG, JPG, WEBP of GIF uit de mediabibliotheek.'] };
export function cmsConfig(content) {
  const h = content.hosting;
  const baseline = baselineConfig(h);
  const fixed = content.pages.filter(p => p.kind === 'page' && p.id !== 'testpagina');
  const folder = (name, label, fields) => ({ name, label, folder: `content/${name}`, create: true, extension: 'json', format: 'json',
    slug: '{{slug}}', identifier_field: 'title', summary: '{{title}}', editor: { preview: false }, fields: [...common, ...fields, draft] });
  return { ...baseline, editor: { preview: false }, media_folder: 'public/uploads', public_folder: '/uploads',
    site_url: h.siteUrl || '/', display_url: h.siteUrl || '/', logo_url: `${h.basePath}/assets/vlag.jpg`, show_preview_links: false,
    collections: [
      { name: 'paginas', label: 'Pagina’s', editor: { preview: false }, files: fixed.map(p => ({ name: p.id, label: p.id === 'home' ? 'Startpagina' : p.title,
        file: `content/pages/${p.id}.json`, format: 'json', fields: common })) },
      folder('news', 'Nieuws', [date, { ...limited('author', 'Auteur', 120, 'string', true), default: 'Dorpsraad Kwadendamme' }, image,
        limited('imageAlt', 'Beschrijving van de foto', 300),
        { name: 'visual', label: 'Illustratie als er geen foto is', widget: 'select', default: 'talk', options: [
          { label: 'Gesprek', value: 'talk' }, { label: 'Omgeving', value: 'leaf' }, { label: 'Dorpsvlag', value: 'flag' }
        ] }]),
      folder('projects', 'Onderwerpen', [{ name: 'status', label: 'Stand van zaken', widget: 'select', default: 'Idee', options: ['Idee', 'In behandeling', 'Afgerond'] }]),
      folder('meetings', 'Vergaderingen', [date,
        { name: 'time', label: 'Tijd (UU:MM)', widget: 'string', required: false, pattern: ['^$|^([01][0-9]|2[0-3]):[0-5][0-9]$', 'Gebruik bijvoorbeeld 19:30, of laat leeg.'] },
        limited('location', 'Locatie', 200)]),
      folder('documents', 'Documenten', [{ name: 'file', label: 'PDF-bestand', widget: 'file', choose_url: false, required: true,
        pattern: ['^/(?:assets|uploads)/.+\\.[pP][dD][fF]$', 'Upload een PDF-bestand.'], hint: 'Upload uitsluitend een PDF.', media_library: { config: { multiple: false } } },
        { name: 'meeting', label: 'Hoort bij vergadering', widget: 'relation', collection: 'meetings', search_fields: ['title'], value_field: '{{slug}}', display_fields: ['title'], required: false }]),
      { name: 'instellingen', label: 'Website-instellingen', editor: { preview: false }, files: [{ name: 'site', label: 'Algemene instellingen', file: 'content/site.json', format: 'json', fields: [
        limited('title', 'Naam van de website', 100, 'string', true), limited('tagline', 'Slogan in de voettekst', 200, 'string', true),
        { ...image, name: 'heroImage', label: 'Foto op de startpagina', required: true },
        limited('heroAlt', 'Beschrijving van de startfoto', 300), limited('heroCaption', 'Bijschrift van de startfoto', 200),
        { ...limited('contactEmail', 'Officieel contactadres', 254), hint: 'Laat leeg zolang er geen officieel adres is vastgesteld. Testformulieren blijven lokaal.' },
        { name: 'testMode', widget: 'hidden', default: true }, { name: 'formEndpoint', widget: 'hidden', default: '' }
      ] }] },
      ...baseline.collections
    ]
  };
}
