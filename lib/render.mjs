import { safeUrl } from './content.mjs';
import { DEFAULT_DESIGN } from './defaults.mjs';
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function href(url, content) {
  const valid = safeUrl(url, { mail: true, empty: false });
  return valid.startsWith('/') ? (content?.hosting?.basePath || '') + valid : valid;
}
function hidden(url,c) { return Boolean(c?.hiddenPaths?.size && url?.startsWith('/') && c.hiddenPaths.has(new URL(url,'https://internal.invalid').pathname)); }
function inline(value,c,depth=0) {
  const s=String(value); if(depth>3)return escape(s); let out='';
  for(let i=0;i<s.length;) {
    if(s[i]==='[') {
      const close=s.indexOf('](',i+1),end=close<0?-1:s.indexOf(')',close+2);
      if(close>i+1 && close-i<=500 && end>close+2 && end-close<=2050) {
        const label=s.slice(i+1,close),url=s.slice(close+2,end);
        try {const valid=safeUrl(url,{mail:true,empty:false});out+=hidden(valid,c)?escape(label):'<a href="'+escape(href(valid,c))+'">'+escape(label)+'</a>';i=end+1;continue;} catch {}
      }
    }
    const marker=s.startsWith('**',i)?'**':s.startsWith('__',i)?'__':['*','_'].includes(s[i])?s[i]:'';
    if(marker) {const end=s.indexOf(marker,i+marker.length);if(end>i+marker.length){const tag=marker.length===2?'strong':'em';out+='<'+tag+'>'+inline(s.slice(i+marker.length,end),c,depth+1)+'</'+tag+'>';i=end+marker.length;continue;}}
    out+=escape(s[i]);i++;
  }
  return out;
}
export function renderText(body,c) {
  return String(body||'').replace(/\r\n?/g,'\n').split(/\n\s*\n/).filter(b=>b.trim()).map(b=>{
    const lines=b.trim().split('\n'),heading=lines.length===1&&/^(#{1,5})\s+(.+)$/.exec(lines[0]);
    if(heading){const level=heading[1].length+1;return '<h'+level+'>'+inline(heading[2],c)+'</h'+level+'>';}
    if(lines.every(l=>/^[-*] /.test(l)))return '<ul>'+lines.map(l=>'<li>'+inline(l.slice(2),c)+'</li>').join('')+'</ul>';
    if(lines.every(l=>/^\d+[.)] /.test(l)))return '<ol>'+lines.map(l=>'<li>'+inline(l.replace(/^\d+[.)] /,''),c)+'</li>').join('')+'</ol>';
    return '<p>'+lines.map(l=>inline(l,c)).join('<br>')+'</p>';
  }).join('\n');
}
export function dateLabel(value) {return value?new Intl.DateTimeFormat('nl-NL',{dateStyle:'long',timeZone:'Europe/Amsterdam'}).format(new Date(value+'T12:00:00Z')):'';}
function a(url,label,c,css='') {return !url||hidden(url,c)?'':'<a'+(css?' class="'+escape(css)+'"':'')+' href="'+escape(href(url,c))+'">'+escape(label)+'</a>';}
const design=c=>c.design||DEFAULT_DESIGN;
function brand(c) {
  const b=design(c).brand||DEFAULT_DESIGN.brand;
  return '<a class="brand" href="'+escape(href('/',c))+'">'+(b.logo?'<img class="brand-flag" src="'+escape(href(b.logo,c))+'" alt="'+escape(b.logoAlt)+'" width="49" height="33">':'')+'<span class="brand-name">'+(b.eyebrow?'<small>'+escape(b.eyebrow)+'</small>':'')+escape(b.name||c.site.title)+'</span></a>';
}
function buttons(items,c,css='block-actions') {
  const links=(items||[]).filter(i=>i.enabled!==false).map(i=>a(i.href,i.label,c,'button'+(i.style==='outline'?' button-outline':''))).join('');
  return links?'<div class="'+css+'">'+links+'</div>':'';
}
function art(p,c) {
  if(p.image)return '<img class="card-image" src="'+escape(href(p.image,c))+'" alt="'+escape(p.imageAlt||'')+'" loading="lazy" width="600" height="340">';
  if(p.visual==='flag'){const b=design(c).brand||DEFAULT_DESIGN.brand;return b.logo?'<div class="card-art art-flag"><img src="'+escape(href(b.logo,c))+'" alt="'+escape(b.logoAlt)+'" width="185" height="122" loading="lazy"></div>':'';}
  const leaf=p.visual==='leaf',shape=leaf?'<path d="M19 77C19 30 65 19 91 19c0 41-15 76-60 68m-8 12 53-60M48 66l-2-22m13 12 20 2"/>':'<path d="M18 24h70v44H52L29 87V68H18zM34 41h38M34 52h25"/>';
  return '<div class="card-art art-'+(leaf?'leaf':'talk')+'" aria-hidden="true"><svg viewBox="0 0 110 110" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'+shape+'</svg></div>';
}
function card(p,c) {
  const meta=p.kind==='project'?p.status:p.example?'Voorbeeldbericht':dateLabel(p.date);
  return '<article class="card">'+(p.kind==='news'?art(p,c):'')+'<div class="card-body"><p class="card-meta">'+escape(meta)+'</p><h3>'+a(p.path,p.title,c)+'</h3><p>'+escape(p.intro)+'</p>'+a(p.path,p.kind==='project'?'Bekijk onderwerp':design(c).newsReadMore||'Lees het bericht',c,'read-more')+'</div></article>';
}
function cards(items,c) {return items.length?'<div class="cards">'+items.map(p=>card(p,c)).join('')+'</div>':'<p class="empty">Er zijn nog geen berichten geplaatst.</p>';}
function docs(items,c) {
  return items.length?'<ul class="document-list">'+items.map(d=>'<li><h2>'+a(d.path,d.title,c)+'</h2><p>'+escape(d.intro)+'</p>'+(d.file?'<a class="button button-outline" href="'+escape(href(d.file,c))+'" download>Download document (PDF)</a>':'')+'</li>').join('')+'</ul>':'<p class="empty">Er zijn nog geen documenten gepubliceerd.</p>';
}
function meetings(items,c) {
  return items.length?'<ul class="meeting-list">'+items.map(m=>'<li class="meeting-row"><span class="meeting-date">'+escape(m.date?dateLabel(m.date):'Datum volgt')+'</span><div><h2>'+a(m.path,m.title,c)+'</h2><p>'+escape(m.location||'Locatie volgt')+(m.time?' · '+escape(m.time):'')+'</p>'+a(m.path,'Bekijk agenda en informatie',c)+'</div></li>').join('')+'</ul>':'<p class="empty">Er zijn nog geen vergaderingen aangekondigd.</p>';
}
function members(items,c) {
  return items.length?'<div class="cards member-cards">'+items.map(m=>'<article class="card member-card">'+(m.image?'<img class="card-image member-photo" src="'+escape(href(m.image,c))+'" alt="'+escape(m.imageAlt||'')+'" loading="lazy" width="600" height="450">':'')+'<div class="card-body"><h3>'+escape(m.name)+'</h3>'+(m.role?'<p class="card-meta">'+escape(m.role)+'</p>':'')+'<div class="prose">'+renderText(m.body,c)+'</div></div></article>').join('')+'</div>':'<p class="empty">De dorpsraadleden worden binnenkort toegevoegd.</p>';
}
function sectionHeader(s,c) {return (s.eyebrow?'<p class="eyebrow">'+escape(s.eyebrow)+'</p>':'')+(s.title?'<h2>'+escape(s.title)+'</h2>':'')+(s.intro?'<p>'+escape(s.intro)+'</p>':'')+(s.text?'<div class="prose">'+renderText(s.text,c)+'</div>':'');}
function renderSection(s,p,c,home,embedded) {
  if(s.enabled===false)return '';
  const css=embedded?'block-section':'section container';
  if(s.type==='hero') {
    const level=home?1:2,photo=s.image||(home?c.site.heroImage:''),intro=s.intro||(home?p.intro:''),text=s.text||(home?p.body:''),alt=s.image?s.imageAlt:c.site.heroAlt,caption=s.image?s.caption:c.site.heroCaption;
    return '<section class="hero '+(embedded?'block-hero':'container')+'"><div class="hero-copy">'+(s.eyebrow?'<p class="eyebrow">'+escape(s.eyebrow)+'</p>':'')+'<h'+level+'>'+escape(s.title||p.title)+'</h'+level+'>'+(intro?'<p>'+escape(intro)+'</p>':'')+'<div class="prose">'+renderText(text,c)+'</div>'+buttons(s.buttons,c,'hero-actions')+'</div>'+(photo?'<figure class="hero-photo"><img src="'+escape(href(photo,c))+'" alt="'+escape(alt)+'" width="1000" height="680" '+(home?'fetchpriority="high"':'loading="lazy"')+'>'+(caption?'<figcaption>'+escape(caption)+'</figcaption>':'')+'</figure>':'')+'</section>';
  }
  if(s.type==='callouts')return '<section class="'+css+'">'+sectionHeader(s,c)+'<div class="callouts">'+(s.items||[]).filter(i=>i.enabled!==false).map(i=>'<article class="callout">'+sectionHeader(i,c)+(i.button?buttons([i.button],c):buttons(i.buttons,c))+'</article>').join('')+'</div>'+buttons(s.buttons,c)+'</section>';
  let body='';const lists={news:c.news,topics:c.projects,meetings:c.meetings,documents:c.documents,members:c.members||[]};
  if(Object.hasOwn(lists,s.type)){let list=lists[s.type]||[];if(s.featuredOnly)list=list.filter(i=>i.featured);list=list.slice(0,s.limit||100);body=s.type==='meetings'?meetings(list,c):s.type==='documents'?docs(list,c):s.type==='members'?members(list,c):cards(list,c);}
  else if(s.type==='image')body=s.image?'<figure class="article-photo"><img src="'+escape(href(s.image,c))+'" alt="'+escape(s.imageAlt)+'" loading="lazy">'+(s.caption?'<figcaption>'+escape(s.caption)+'</figcaption>':'')+'</figure>':'';
  return '<section class="'+css+' section-'+escape(s.type)+'">'+sectionHeader(s,c)+body+buttons(s.buttons,c)+'</section>';
}
function sidebar(p,c) {
  const wide=['nieuws','onderwerpen','vergaderingen','testinbox'].includes(p.id);
  if(p.showSidebar===false||(p.showSidebar==null&&wide))return '';
  const items=p.sidebar?.length?p.sidebar:design(c).sidebar||[];
  const html=items.filter(i=>i.enabled!==false).map(i=>'<div class="info-box">'+(i.title?'<h2>'+escape(i.title)+'</h2>':'')+(i.text?'<div class="prose">'+renderText(i.text,c)+'</div>':'')+buttons(i.links||i.buttons,c,'sidebar-links')+'</div>').join('');
  return html?'<aside class="sidebar" aria-label="Aanvullende informatie">'+html+'</aside>':'';
}
function form(p,c) {
  const f=c.forms||{mode:'local'},local=f.mode==='local',purpose=p.id==='meedenken'?'idee':'contact',t=f.texts||{};
  if((local&&!c.site.testMode)||(!local&&(!['verified-test','live'].includes(f.mode)||!f.endpoint||!f.turnstileSiteKey)))return '<div class="notice">Het formulier is op dit moment niet beschikbaar.</div>'+(c.site.contactEmail?a('mailto:'+c.site.contactEmail,'Stuur de dorpsraad een e-mail',c,'button'):'');
  const notice=local?'<div class="notice"><strong>Formulier om te testen.</strong><br>Gebruik verzonnen gegevens. Je bericht blijft in de testinbox van deze browser en wordt niet gemaild.</div>':f.mode==='verified-test'?'<div class="notice"><strong>Beveiligde formuliertest.</strong><br>De server controleert de inzending en spambeveiliging. Gebruik voorbeeldgegevens; in deze stand wordt niets gemaild.</div>':'<p>Je bericht wordt veilig aan de dorpsraad doorgegeven.</p>';
  const data=local?'data-test-form="'+purpose+'"':'data-remote-form="'+purpose+'" data-mode="'+escape(f.mode)+'" data-endpoint="'+escape(f.endpoint)+'" data-sitekey="'+escape(f.turnstileSiteKey)+'" data-action="'+purpose+'"';
  return notice+'<form class="form" method="post" '+data+'><input type="hidden" name="type" value="'+purpose+'"><fieldset disabled data-form-fields>'+
    '<div class="form-field"><label for="naam">'+escape(t.nameLabel||'Naam')+'</label><input id="naam" name="name" autocomplete="name" required minlength="2" maxlength="100"></div>'+
    '<div class="form-field"><label for="email">'+escape(t.emailLabel||'E-mailadres')+'</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254"></div>'+
    '<div class="form-field"><label for="onderwerp">'+escape(t.subjectLabel||'Onderwerp')+'</label><input id="onderwerp" name="subject" required minlength="2" maxlength="160"></div>'+
    '<div class="form-field"><label for="bericht">'+escape(purpose==='idee'?t.ideaLabel||'Jouw idee':t.messageLabel||'Jouw bericht')+'</label><textarea id="bericht" name="message" required minlength="10" maxlength="5000" rows="7"></textarea><small>Minimaal 10 tekens.</small></div>'+
    (local?'':'<div class="form-honeypot" aria-hidden="true"><label for="website">Laat dit veld leeg</label><input id="website" name="website" type="text" autocomplete="off" tabindex="-1"></div>')+
    '<label class="checkbox-label"><input type="checkbox" name="consent" required>'+escape(local?'Ik begrijp dat dit een lokale test is en gebruik voorbeeldgegevens.':t.consentLabel||'Ik heb de privacyinformatie gelezen en stem in met verwerking om mijn bericht te beantwoorden.')+'</label>'+
    (local?'':'<div data-turnstile class="turnstile-container"></div>')+'<button class="button" type="submit">'+escape(local?'Bewaar in testinbox':f.mode==='verified-test'?'Test beveiligde verzending':t.submitLabel||'Verstuur bericht')+'</button></fieldset><div data-form-feedback role="status" aria-live="polite"></div><noscript><p>Schakel JavaScript in om dit formulier veilig te gebruiken.</p></noscript></form>'+a('/privacy/','Lees de privacyinformatie',c);
}
function pageHero(p) {return '<section class="page-hero container"><p class="eyebrow">'+escape(p.example?'Voorbeeldinhoud':p.status||'Betrokken bij ons dorp')+'</p><h1>'+escape(p.title)+'</h1><p>'+escape(p.intro)+'</p></section>';}
function pageBody(p,c) {
  if(p.id==='home') {
    const sections=Array.isArray(p.sections)?p.sections:design(c).homeSections;
    const fallback=sections.some(s=>s.type==='hero'&&s.enabled!==false)?'':pageHero(p)+(p.body?'<section class="section container"><div class="prose">'+renderText(p.body,c)+'</div></section>':'');
    return fallback+sections.map(s=>renderSection(s,p,c,true,false)).join('');
  }
  let main='<div class="prose">'+renderText(p.body,c)+'</div>';
  if(p.id==='nieuws')main+=cards(c.news,c);
  if(p.id==='onderwerpen')main+=cards(c.projects,c);
  if(p.id==='documenten')main+=docs(c.documents,c);
  if(p.id==='vergaderingen')main+=meetings(c.meetings,c)+'<p class="after-list">'+a('/documenten/','Alle documenten',c)+'</p>';
  if(p.id==='dorpsraad'&&c.members?.length&&!p.sections?.some(s=>s.type==='members'&&s.enabled!==false))main+=members(c.members,c);
  if(p.id==='contact'||p.id==='meedenken')main+=form(p,c);
  if(p.id==='contact'&&c.site.contactEmail)main+='<p class="after-list">'+a('mailto:'+c.site.contactEmail,c.site.contactEmail,c)+'</p>';
  if(p.kind==='news')main+=(p.image?'<figure class="article-photo"><img src="'+escape(href(p.image,c))+'" alt="'+escape(p.imageAlt)+'" loading="lazy"></figure>':'')+'<p class="article-meta">'+(p.date?escape(dateLabel(p.date))+' · ':'')+escape(p.author)+'</p><p class="after-list">'+a('/nieuws/','Alle nieuwsberichten',c)+'</p>';
  if(p.kind==='project')main+='<p class="after-list">'+a('/meedenken/','Denk mee',c,'button')+'</p><p>'+a('/onderwerpen/','Alle onderwerpen',c)+'</p>';
  if(p.kind==='meeting')main+='<div class="info-box"><h2>Praktische informatie</h2><p>'+escape(p.date?dateLabel(p.date):'Datum volgt')+(p.time?' · '+escape(p.time):'')+'<br>'+escape(p.location||'Locatie volgt')+'</p></div><div class="after-list">'+docs(c.documents.filter(d=>d.meeting===p.id),c)+'</div>';
  if(p.kind==='document'&&p.file)main+='<a class="button" href="'+escape(href(p.file,c))+'" download>Download document (PDF)</a><p class="after-list">'+a(p.file,'Open document',c)+'</p>';
  if(p.id==='testinbox')main+='<div class="inbox-actions">'+a('/contact/','Test een bericht',c,'button')+a('/meedenken/','Test een idee',c,'button button-outline')+'<button class="button button-outline" type="button" id="export-inbox" disabled>Download testberichten</button></div><div id="inbox-list" class="inbox-list"><p class="empty">Schakel JavaScript in om de lokale testinbox te bekijken.</p></div><div id="inbox-feedback" role="status" aria-live="polite"></div>';
  if(p.id==='niet-gevonden')main+=a('/','Naar de startpagina',c,'button');
  main+=(p.sections||[]).map(s=>renderSection(s,p,c,false,true)).join('');
  const side=sidebar(p,c);return pageHero(p)+'<section class="section container'+(side?' content-grid':'')+'">'+(side?'<div>'+main+'</div>'+side:main)+'</section>';
}
function navigation(p,c) {
  function item(i) {
    if(i.enabled===false||hidden(i.href,c))return '';
    const target=i.href?.startsWith('/')?new URL(i.href,'https://internal.invalid').pathname:'',current=target===p.path?' aria-current="page"':target!=='/'&&target&&p.path?.startsWith(target)?' aria-current="true"':'';
    const children=(i.children||[]).map(child=>item(child)).join('');
    return '<li>'+(i.href?'<a href="'+escape(href(i.href,c))+'"'+(target==='/contact/'?' class="nav-contact"':'')+current+'>'+escape(i.label)+'</a>':'<span>'+escape(i.label)+'</span>')+(children?'<details class="nav-submenu"><summary aria-label="Meer bij '+escape(i.label)+'">Meer</summary><ul>'+children+'</ul></details>':'')+'</li>';
  }
  return (design(c).navigation||DEFAULT_DESIGN.navigation).map(i=>item(i)).join('');
}
export function renderPage(p,c) {
  const d=design(c),banner=c.site.testMode?'<div class="concept-bar"><div class="container concept-inner"><span>Testomgeving · voorbeeldinhoud</span><nav aria-label="Testomgeving">'+a('/admin/','Bewerk inhoud',c)+a('/testpagina/','Testpagina',c)+a('/testinbox/','Testinbox',c)+'</nav></div></div>':'';
  const canonicalUrl=c.hosting.siteUrl?new URL(p.path.replace(/^\//,''),c.hosting.siteUrl).href:'';
  const canonical=canonicalUrl?'<link rel="canonical" href="'+escape(canonicalUrl)+'"><meta property="og:url" content="'+escape(canonicalUrl)+'">':'';
  const title=p.seoTitle||p.seo?.title||p.title+' · '+c.site.title,description=p.seoDescription||p.seo?.description||p.intro||c.site.tagline,share=p.shareImage||p.seo?.image||'';
  const imageUrl=share&&c.hosting.siteUrl?new URL(href(share,c),c.hosting.siteUrl).href:'';
  const footer=(d.footerLinks||DEFAULT_DESIGN.footerLinks).filter(i=>i.enabled!==false).map(i=>a(i.href,i.label,c)).join('');
  return '<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="'+escape(description)+'">'+(c.site.testMode?'<meta name="robots" content="noindex,nofollow">':'')+'<title>'+escape(title)+'</title><meta property="og:title" content="'+escape(title)+'"><meta property="og:description" content="'+escape(description)+'"><meta property="og:type" content="'+(p.kind==='news'?'article':'website')+'">'+canonical+(imageUrl?'<meta property="og:image" content="'+escape(imageUrl)+'">':'')+(d.brand?.favicon?'<link rel="icon" href="'+escape(href(d.brand.favicon,c))+'">':'')+'<link rel="stylesheet" href="'+escape(href('/assets/site.css',c))+'"><script type="module" src="'+escape(href('/assets/site.js',c))+'"></script></head><body data-page="'+escape(p.id)+'" data-base="'+escape(c.hosting.basePath)+'"><a class="skip-link" href="#inhoud">Direct naar inhoud</a>'+banner+'<header class="site-header"><div class="header-inner">'+brand(c)+'<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="hoofdmenu">Menu</button><nav class="main-nav" id="hoofdmenu" aria-label="Hoofdnavigatie"><ul>'+navigation(p,c)+'</ul></nav></div></header><main id="inhoud">'+pageBody(p,c)+'</main><footer class="site-footer"><div class="container footer-inner">'+brand(c)+'<nav aria-label="Voettekst">'+footer+'</nav><p>'+escape(c.site.tagline)+'</p></div></footer></body></html>';
}
