import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArguments, resolveRoot } from './export-backup.mjs';

const placeholder = /(?:voor de livegang|in dit concept|voorbeeld(?:gegevens|inhoud|foto|tekst|vergadering)?|de dorpsraad vult hier|vul hier|lorem ipsum|nog in te vullen|tijdens het testen|testgegevens)/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function https(value, originOnly = false) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && (!originOnly || (url.pathname === '/' && !url.search));
  } catch { return false; }
}
export async function checkProduction(root) {
  root = await resolveRoot(root);
  const checks = [];
  const check = (okay, code, message) => { if (!okay) checks.push({ level: 'error', code, message }); };
  async function json(relative) {
    try { return JSON.parse(await readFile(path.join(root, relative), 'utf8')); }
    catch { checks.push({ level: 'error', code: 'FILE', message: `Leesbaar JSON-bestand ontbreekt: ${relative}` }); return {}; }
  }
  const site = await json('content/site.json');
  const forms = await json('content/forms.json');
  const hosting = await json('config/hosting.json');
  const privacy = await json('content/pages/privacy.json');
  check(site.testMode === false, 'TEST_MODE', 'Zet de website pas na de eindcontrole uit testmodus.');
  check(typeof site.contactEmail === 'string' && email.test(site.contactEmail) && !/@(?:example\.(?:com|org|net)|test\.(?:com|org)|invalid)$/i.test(site.contactEmail), 'CONTACT', 'Vul het officiële, werkende contactadres van de dorpsraad in.');
  check(forms.mode === 'live', 'FORM_MODE', 'Formulieren staan nog niet op live verzending. Activeer de Worker en maildienst vóór deze instelling.');
  check(https(forms.endpoint), 'FORM_ENDPOINT', 'Het formulierendpoint moet een volledig HTTPS-adres zijn.');
  check(typeof forms.turnstileSiteKey === 'string' && /^0x4[A-Za-z0-9_-]{12,}$/.test(forms.turnstileSiteKey) && !/^1x|^2x|^3x/.test(forms.turnstileSiteKey), 'TURNSTILE', 'Vul een echte Turnstile-sitekey in; testkeys zijn niet geschikt voor productie.');
  check(typeof privacy.body === 'string' && privacy.body.trim().length >= 150 && privacy.example !== true && !placeholder.test(`${privacy.title || ''}\n${privacy.intro || ''}\n${privacy.body || ''}`), 'PRIVACY', 'Vervang de voorbeeldprivacytekst door de daadwerkelijke verantwoordelijke, diensten, contactwijze en bewaartermijnen.');
  check(privacy.draft !== true, 'PRIVACY_PUBLISHED', 'De privacyverklaring moet openbaar beschikbaar zijn.');
  check(https(hosting.siteUrl) && https(hosting.authUrl, true), 'HOSTING', 'Vul de definitieve HTTPS-site-URL en loginworker-oorsprong in.');
  check(typeof hosting.repository === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(hosting.repository), 'REPOSITORY', 'Vul de eigen website-repository in.');
  check(hosting.repository !== 'xand3rr/xand3rr.github.io', 'EXISTING_SITE', 'Gebruik een aparte repository; de huidige persoonlijke website blijft buiten dit project.');
  if (typeof site.heroCaption === 'string') check(!placeholder.test(site.heroCaption), 'PHOTO', 'Vervang het voorbeeldfotobijschrift en controleer de publicatierechten van de foto.');
  async function scan(relative) {
    let names;
    try { names = await readdir(path.join(root, relative), { withFileTypes: true }); }
    catch { checks.push({ level: 'error', code: 'CONTENT', message: `Inhoudsmap ontbreekt: ${relative}` }); return; }
    for (const item of names) {
      if (item.isSymbolicLink()) { checks.push({ level: 'error', code: 'SYMLINK', message: `Symlink in inhoud niet toegestaan: ${relative}/${item.name}` }); continue; }
      if (item.isDirectory()) { await scan(`${relative}/${item.name}`); continue; }
      if (!item.name.endsWith('.json') || !item.isFile()) continue;
      const name = `${relative}/${item.name}`;
      const value = await json(name);
      if (value.draft === true || name === 'content/page.json' || name === 'content/pages/testinbox.json' || name === 'content/pages/privacy.json') continue;
      check(value.example !== true, 'EXAMPLE_CONTENT', `Verwijder het voorbeeldlabel na inhoudelijke controle: ${name}`);
    }
  }
  await scan('content/pages');
  for (const folder of ['extra-pages', 'news', 'projects', 'meetings', 'documents', 'members']) {
    try { if ((await lstat(path.join(root, 'content', folder))).isDirectory()) await scan(`content/${folder}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  checks.push({ level: 'warning', code: 'LIVE_CHECK', message: 'Dit lokale rapport verifieert geen DNS, TLS, Cloudflare secrets, Turnstile-hostnames, mailbezorging of serverlimieten. Test die op het echte domein.' });
  checks.push({ level: 'warning', code: 'CMS_AUDIT', message: 'Het externe Decap-browserpakket is niet automatisch door deze controle op kwetsbaarheden geaudit. Volg BEVEILIGING.md.' });
  checks.push({ level: 'warning', code: 'OPERATIONS', message: 'Controleer eigenaarschap, 2FA, privélogs, mislukte-buildmeldingen, actieve planning en herstel met een tweede beheerder.' });
  if (site.editorialWorkflow === true) checks.push({ level: 'warning', code: 'REVIEW', message: 'Redactionele goedkeuring vereist werkende Pull requests-rechten voor de GitHub App én afgedwongen reviewregels op de publicatiebranch.' });
  return { ready: !checks.some(item => item.level === 'error'), checks };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2), { '--root': 'value', '--allow-incomplete': 'flag', '--json': 'flag' });
    const result = await checkProduction(args['--root']);
    if (args['--json']) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.ready ? 'Lokale productie-instellingen zijn ingevuld; rond de live-controles af.' : 'Productiecheck: er staan nog punten open.');
      for (const item of result.checks) console.log(`${item.level === 'error' ? 'BLOKKADE' : 'CONTROLE'} [${item.code}] ${item.message}`);
      if (!result.ready && args['--allow-incomplete']) console.log('Testmodus: --allow-incomplete houdt de exitcode op 0. Dit betekent geen productiegoedkeuring.');
    }
    if (!result.ready && !args['--allow-incomplete']) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
