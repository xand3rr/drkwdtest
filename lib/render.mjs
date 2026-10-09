import { safeUrl } from './content.mjs';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function href(url, content) {
  const valid = safeUrl(url, { mail: true, empty: false });
  return valid.startsWith('/') ? content.hosting.basePath + valid : valid;
}
export function renderText(body) {
  // Plain text only: optional block headings and lists are escaped as well.
  // No HTML, inline links, images, rich text or Markdown parser is accepted.
  return String(body || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).filter(block => block.trim()).map(block => {
    const lines = block.trim().split('\n');
    const heading = lines.length === 1 && /^(#{1,5})\s+(.+)$/.exec(lines[0]);
    if (heading) {
      const level = heading[1].length + 1;
      return `<h${level}>${escape(heading[2])}</h${level}>`;
    }
    if (lines.every(line => /^[-*] /.test(line))) return `<ul>${lines.map(line => `<li>${escape(line.slice(2))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(line => escape(line)).join('<br>')}</p>`;
  }).join('\n');
}
export function dateLabel(value) { return value ? new Intl.DateTimeFormat('nl-NL', { dateStyle: 'long', timeZone: 'Europe/Amsterdam' }).format(new Date(value + 'T12:00:00Z')) : ''; }
function a(url, label, c, css = '') { return `<a${css ? ` class="${css}"` : ''} href="${escape(href(url, c))}">${escape(label)}</a>`; }
function brand(c) { return `<a class="brand" href="${href('/',c)}"><img class="brand-flag" src="${href('/assets/vlag.jpg',c)}" alt="Vlag van Kwadendamme" width="49" height="33"><span class="brand-name"><small>Dorpsraad</small>Kwadendamme</span></a>`; }
function art(p,c) {
  if (p.image) return `<img class="card-image" src="${escape(href(p.image,c))}" alt="${escape(p.imageAlt || '')}" loading="lazy" width="600" height="340">`;
  if (p.visual === 'flag') return `<div class="card-art art-flag"><img src="${href('/assets/vlag.jpg',c)}" alt="Vlag van Kwadendamme" width="185" height="122" loading="lazy"></div>`;
  const leaf = p.visual === 'leaf';
  const shape = leaf ? '<path d="M19 77C19 30 65 19 91 19c0 41-15 76-60 68m-8 12 53-60M48 66l-2-22m13 12 20 2"/>' : '<path d="M18 24h70v44H52L29 87V68H18zM34 41h38M34 52h25"/>';
  return `<div class="card-art art-${leaf?'leaf':'talk'}" aria-hidden="true"><svg viewBox="0 0 110 110" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${shape}</svg></div>`;
}
function card(p,c) {
  const meta = p.kind === 'project' ? p.status : p.example ? 'Voorbeeldbericht' : dateLabel(p.date);
  return `<article class="card">${p.kind==='news'?art(p,c):''}<div class="card-body"><p class="card-meta">${escape(meta)}</p><h3>${a(p.path,p.title,c)}</h3><p>${escape(p.intro)}</p>${a(p.path,p.kind==='project'?'Bekijk onderwerp':'Lees het bericht',c,'read-more')}</div></article>`;
}
function cards(items,c) { return items.length ? `<div class="cards">${items.map(p=>card(p,c)).join('')}</div>` : '<p class="empty">Er zijn nog geen berichten geplaatst.</p>'; }
function docs(items,c) {
  return items.length ? `<ul class="document-list">${items.map(d=>`<li><h2>${a(d.path,d.title,c)}</h2><p>${escape(d.intro)}</p>${d.file ? `<a class="button button-outline" href="${escape(href(d.file,c))}" download>Download document (PDF)</a>` : ''}</li>`).join('')}</ul>` : '<p class="empty">Er zijn nog geen documenten gepubliceerd.</p>';
}
function form(p,c) {
  const test = c.site.testMode;
  const email = c.site.contactEmail;
  if (!test && !c.site.formEndpoint) return `<p>${a(`mailto:${email}`,'Stuur de dorpsraad een e-mail',c,'button')}</p>`;
  const purpose = p.id === 'meedenken' ? 'idee' : 'contact';
  return `${test ? '<div class="notice"><strong>Formulier om te testen.</strong><br>Gebruik verzonnen gegevens. Je bericht blijft in de testinbox van deze browser en wordt niet gemaild.</div>' : '<p>Je bericht wordt via onze formulierdienst aan de dorpsraad doorgegeven.</p>'}
  <form class="form" method="post" ${test?`data-test-form="${purpose}"`:`action="${escape(c.site.formEndpoint)}"`}>
  <input type="hidden" name="type" value="${purpose}"><fieldset ${test?'disabled data-form-fields':''}>
  <div class="form-field"><label for="naam">Naam</label><input id="naam" name="name" autocomplete="name" required maxlength="100"></div>
  <div class="form-field"><label for="email">E-mailadres</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"></div>
  <div class="form-field"><label for="onderwerp">Onderwerp</label><input id="onderwerp" name="subject" required maxlength="150"></div>
  <div class="form-field"><label for="bericht">${purpose==='idee'?'Jouw idee':'Jouw bericht'}</label><textarea id="bericht" name="message" required minlength="10" maxlength="5000" rows="7"></textarea><small>Minimaal 10 tekens.</small></div>
  <label class="checkbox-label"><input type="checkbox" name="consent" required>${test?'Ik begrijp dat dit een lokale test is en gebruik voorbeeldgegevens.':'Ik heb de privacyinformatie gelezen en ga akkoord met verwerking om mijn bericht te beantwoorden.'}</label>
  <button class="button" type="submit">${test?'Bewaar in testinbox':'Verstuur bericht'}</button></fieldset><div data-form-feedback role="status" aria-live="polite"></div></form>
  ${a('/privacy/','Lees de privacyinformatie',c)}`;
}
function pageBody(p,c) {
  if(p.id==='home') return `<section class="hero container"><div class="hero-copy"><p class="eyebrow">Betrokken bij ons dorp</p><h1>${escape(p.title)}</h1><p>${escape(p.intro)}</p><div class="prose">${renderText(p.body)}</div><div class="hero-actions">${a('/nieuws/','Wat speelt er?',c,'button')}${a('/meedenken/','Denk mee',c,'button button-outline')}</div></div><figure class="hero-photo"><img src="${escape(href(c.site.heroImage,c))}" alt="${escape(c.site.heroAlt)}" width="1000" height="680" fetchpriority="high"><figcaption>${escape(c.site.heroCaption)}</figcaption></figure></section>
  <section class="section container"><div class="section-heading"><div><p class="eyebrow">Nieuws &amp; verhalen</p><h2>Wat speelt er in ons dorp?</h2></div>${a('/nieuws/','Alle nieuwsberichten',c)}</div>${cards(c.news.slice(0,3),c)}</section>
  <section class="section container callouts"><article class="callout"><p class="eyebrow">Vergaderingen</p><h2>Schuif aan bij de dorpsraad</h2><p>Bekijk de agenda, lees de stukken en praat mee.</p>${a('/vergaderingen/','Vergaderingen bekijken',c,'button')}</article><article class="callout"><p class="eyebrow">Jouw dorp</p><h2>Een vraag of een idee?</h2><p>We horen graag wat er bij jou leeft.</p>${a('/meedenken/','Denk mee',c,'button button-outline')}</article></section>`;
  let main = `<div class="prose">${renderText(p.body)}</div>`;
  if(p.id==='nieuws') main += cards(c.news,c);
  if(p.id==='onderwerpen') main += cards(c.projects,c);
  if(p.id==='documenten') main += docs(c.documents,c);
  if(p.id==='vergaderingen') main += c.meetings.length ? `<ul class="meeting-list">${c.meetings.map(m=>`<li class="meeting-row"><span class="meeting-date">${escape(m.date?dateLabel(m.date):'Datum volgt')}</span><div><h2>${a(m.path,m.title,c)}</h2><p>${escape(m.location || 'Locatie volgt')}${m.time?' · '+escape(m.time):''}</p>${a(m.path,'Bekijk agenda en informatie',c)}</div></li>`).join('')}</ul><p class="after-list">${a('/documenten/','Alle documenten',c)}</p>` : '<p class="empty">Er zijn nog geen vergaderingen aangekondigd.</p>';
  if(p.id==='contact'||p.id==='meedenken') main += form(p,c);
  if(p.id==='contact'&&c.site.contactEmail) main += `<p class="after-list">${a(`mailto:${c.site.contactEmail}`,c.site.contactEmail,c)}</p>`;
  if(p.kind==='news') main += `${p.image ? `<figure class="article-photo"><img src="${escape(href(p.image,c))}" alt="${escape(p.imageAlt)}" loading="lazy"></figure>` : ''}<p class="article-meta">${p.date?escape(dateLabel(p.date))+' · ':''}${escape(p.author)}</p><p class="after-list">${a('/nieuws/','Alle nieuwsberichten',c)}</p>`;
  if(p.kind==='project') main += `<p class="after-list">${a('/meedenken/','Denk mee',c,'button')}</p><p>${a('/onderwerpen/','Alle onderwerpen',c)}</p>`;
  if(p.kind==='meeting') main += `<div class="info-box"><h2>Praktische informatie</h2><p>${escape(p.date?dateLabel(p.date):'Datum volgt')}${p.time?' · '+escape(p.time):''}<br>${escape(p.location||'Locatie volgt')}</p></div><div class="after-list">${docs(c.documents.filter(d=>d.meeting===p.id),c)}</div>`;
  if(p.kind==='document'&&p.file) main += `<a class="button" href="${escape(href(p.file,c))}" download>Download document (PDF)</a><p class="after-list">${a(p.file,'Open document',c)}</p>`;
  if(p.id==='testinbox') main += `<div class="inbox-actions">${a('/contact/','Test een bericht',c,'button')}${a('/meedenken/','Test een idee',c,'button button-outline')}<button class="button button-outline" type="button" id="export-inbox" disabled>Download testberichten</button></div><div id="inbox-list" class="inbox-list"><p class="empty">Schakel JavaScript in om de lokale testinbox te bekijken.</p></div><div id="inbox-feedback" role="status" aria-live="polite"></div>`;
  if(p.id==='niet-gevonden') main += a('/','Naar de startpagina',c,'button');
  const eyebrow = p.example ? 'Voorbeeldinhoud' : p.status || 'Betrokken bij ons dorp';
  const hero = `<section class="page-hero container"><p class="eyebrow">${escape(eyebrow)}</p><h1>${escape(p.title)}</h1><p>${escape(p.intro)}</p></section>`;
  if(['nieuws','onderwerpen','vergaderingen','testinbox'].includes(p.id)) return hero+`<section class="section container">${main}</section>`;
  return hero+`<section class="section container content-grid"><div>${main}</div><aside class="sidebar"><div class="info-box"><h2>Doe mee</h2><p>Een vraag, een idee of een aandachtspunt voor het dorp?</p>${a('/meedenken/','Denk mee',c,'button button-outline')}</div><div class="info-box"><h2>Blijf betrokken</h2><p>${a('/vergaderingen/','Bekijk vergaderingen',c)}</p><p>${a('/documenten/','Lees de documenten',c)}</p><p>${a('/contact/','Neem contact op',c)}</p></div></aside></section>`;
}
export function renderPage(p,c) {
  const nav=[['/','Home','home'],['/dorpsraad/','Dorpsraad','dorpsraad'],['/nieuws/','Nieuws','nieuws'],['/onderwerpen/','Onderwerpen','onderwerpen'],['/vergaderingen/','Vergaderingen','vergaderingen'],['/contact/','Contact','contact']].map(([url,label,id])=>`<li><a href="${href(url,c)}"${id==='contact'?' class="nav-contact"':''}${p.id===id?' aria-current="page"':p.group===id?' aria-current="true"':''}>${label}</a></li>`).join('');
  const banner=c.site.testMode?`<div class="concept-bar"><div class="container concept-inner"><span>Testomgeving · voorbeeldinhoud</span><nav aria-label="Testomgeving">${a('/admin/','Bewerk inhoud',c)}${a('/testpagina/','Testpagina',c)}${a('/testinbox/','Testinbox',c)}</nav></div></div>`:'';
  const canonical=c.hosting.siteUrl?`<link rel="canonical" href="${escape(new URL(p.path.replace(/^\//,''),c.hosting.siteUrl).href)}">`:'';
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escape(p.intro)}">${c.site.testMode?'<meta name="robots" content="noindex,nofollow">':''}<title>${escape(p.title)} · ${escape(c.site.title)}</title>${canonical}<link rel="icon" href="${href('/assets/vlag.jpg',c)}"><link rel="stylesheet" href="${href('/assets/site.css',c)}"><script type="module" src="${href('/assets/site.js',c)}"></script></head><body data-page="${escape(p.id)}" data-base="${escape(c.hosting.basePath)}"><a class="skip-link" href="#inhoud">Direct naar inhoud</a>${banner}<header class="site-header"><div class="header-inner">${brand(c)}<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="hoofdmenu">Menu</button><nav class="main-nav" id="hoofdmenu" aria-label="Hoofdnavigatie"><ul>${nav}</ul></nav></div></header><main id="inhoud">${pageBody(p,c)}</main><footer class="site-footer"><div class="container footer-inner">${brand(c)}<nav aria-label="Voettekst">${a('/contact/','Contact',c)}${a('/documenten/','Documenten',c)}${a('/privacy/','Privacy',c)}${a('/admin/','Beheer',c)}</nav><p>${escape(c.site.tagline)}</p></div></footer></body></html>`;
}
