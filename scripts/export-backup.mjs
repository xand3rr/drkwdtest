import { createHash, randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const LIMITS = { files: 5000, fileBytes: 25 * 1024 * 1024, totalBytes: 100 * 1024 * 1024, archiveBytes: 145 * 1024 * 1024 };
const directories = new Set(['lib', 'scripts', 'docs', 'public', 'content', 'config', 'auth', 'forms', 'tests']);
const rootFiles = new Set(['package.json', 'package-lock.json', 'LEESMIJ.md', 'BEVEILIGING.md', 'LAYOUT-UPDATE.md', 'VALIDATIE.txt']);
const privateNames = /^(?:\.env(?:\..*)?|\.dev\.vars(?:\..*)?|secrets?(?:\..*)?|credentials?(?:\..*)?|private[-_]?keys?(?:\..*)?|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/i;
const ignoredDirectories = new Set(['node_modules', '_site', 'dist', 'backups', '.git', '.wrangler']);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function validatePath(value) {
  if (typeof value !== 'string' || !value || value.length > 2048 || /[\\\x00-\x1f\x7f:<>"|?*]/u.test(value) || value.startsWith('/')) throw new Error('Ongeldig back-uppad.');
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || /[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw new Error(`Onveilig back-uppad: ${value}`);
  const allowed = segments.length === 1 ? rootFiles.has(value) : directories.has(segments[0]) || (segments[0] === '.github' && segments[1] === 'workflows' && segments.length > 2);
  if (!allowed || segments.some(segment => privateNames.test(segment) || ignoredDirectories.has(segment) || (segment.startsWith('.') && segment !== '.github'))) throw new Error(`Bestand hoort niet in deze back-up: ${value}`);
  return value;
}

export async function resolveRoot(root = PROJECT_ROOT) {
  const resolved = await realpath(path.resolve(root));
  if (!(await lstat(resolved)).isDirectory()) throw new Error('De projectmap is geen map.');
  return resolved;
}

export async function safeTarget(root, relative, { allowBackup = false } = {}) {
  if (allowBackup) {
    if (!/^backups\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(relative)) throw new Error('Bewaar een back-up als backups/naam.json.');
  } else validatePath(relative);
  const target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Pad valt buiten de projectmap.');
  const parts = relative.split('/');
  for (let i = 1; i <= parts.length; i++) {
    let info;
    try { info = await lstat(path.join(root, ...parts.slice(0, i))); }
    catch (error) { if (error.code === 'ENOENT') break; throw error; }
    if (info.isSymbolicLink() || (i < parts.length && !info.isDirectory()) || (i === parts.length && !info.isFile())) throw new Error(`Symlinks of afwijkende bestanden zijn niet toegestaan: ${relative}`);
  }
  return target;
}

function rejectKnownCredentials(bytes, relative) {
  if (!/\.(?:json|[cm]?js|ts|txt|md|ya?ml|toml|html|css)$/i.test(relative)) return;
  const value = bytes.toString('utf8');
  const tokens = value.match(/\b(?:gh[opusr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g) || [];
  // These two exact existing fixture values never came from GitHub. Other
  // credentials, including any different value in tests, still stop export.
  const unsafeToken = tokens.some(token => !(relative === 'auth/worker.test.mjs' && /^(?:ghu|gho)_testtokenforlocaltests123456789$/.test(token)));
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) || unsafeToken) throw new Error(`Mogelijk geheim gevonden in ${relative}; verplaats het naar de secret-instellingen vóór export.`);
}

export function entry(relative, bytes) {
  validatePath(relative);
  if (bytes.length > LIMITS.fileBytes) throw new Error(`Bestand is te groot voor export: ${relative}`);
  rejectKnownCredentials(bytes, relative);
  return { path: relative, size: bytes.length, sha256: digest(bytes), data: bytes.toString('base64') };
}

export async function createArchive(root = PROJECT_ROOT) {
  root = await resolveRoot(root);
  const files = [];
  const skipped = [];
  let total = 0;
  async function scan(relative) {
    const absolute = path.join(root, relative);
    let info;
    try { info = await lstat(absolute); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) throw new Error(`Symlink niet geëxporteerd: ${relative}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) {
        if (privateNames.test(name) || ignoredDirectories.has(name) || name.startsWith('.')) { skipped.push(`${relative}/${name}`); continue; }
        await scan(`${relative}/${name}`);
      }
      return;
    }
    if (!info.isFile()) throw new Error(`Geen regulier bestand: ${relative}`);
    await safeTarget(root, relative);
    const result = entry(relative, await readFile(absolute));
    total += result.size;
    if (files.length >= LIMITS.files || total > LIMITS.totalBytes) throw new Error('De back-up overschrijdt de veilige exportlimiet.');
    files.push(result);
  }
  try { if ((await lstat(path.join(root, '.github'))).isSymbolicLink()) throw new Error('Symlink niet geëxporteerd: .github'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of [...directories, '.github/workflows', ...rootFiles].sort()) await scan(name);
  return { format: 'kwadendamme-backup', version: 1, createdAt: new Date().toISOString(), files, remove: [], excluded: skipped };
}

export function validateArchive(archive) {
  if (!archive || archive.format !== 'kwadendamme-backup' || archive.version !== 1 || !Array.isArray(archive.files) || !Array.isArray(archive.remove) || archive.files.length + archive.remove.length > LIMITS.files) throw new Error('Ongeldig of niet ondersteund back-upbestand.');
  const seen = new Set();
  let total = 0;
  const files = archive.files.map(item => {
    if (!item || typeof item.data !== 'string' || item.data.length > Math.ceil(LIMITS.fileBytes / 3) * 4 || item.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.data)) throw new Error('Ongeldige bestandsinhoud in back-up.');
    validatePath(item.path);
    const key = item.path.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error(`Dubbel back-uppad: ${item.path}`);
    seen.add(key);
    const bytes = Buffer.from(item.data, 'base64');
    if (bytes.toString('base64') !== item.data || !Number.isSafeInteger(item.size) || item.size !== bytes.length || bytes.length > LIMITS.fileBytes || !/^[a-f0-9]{64}$/.test(item.sha256) || digest(bytes) !== item.sha256) throw new Error(`Bestandscontrole mislukt: ${item.path}`);
    rejectKnownCredentials(bytes, item.path);
    total += bytes.length;
    if (total > LIMITS.totalBytes) throw new Error('De back-up is te groot.');
    return { path: item.path, bytes };
  });
  const remove = archive.remove.map(value => {
    validatePath(value);
    const key = value.normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new Error(`Dubbel back-uppad: ${value}`);
    seen.add(key);
    return value;
  });
  return { files, remove, totalBytes: total };
}

export async function writeArchive(root, relative, archive) {
  validateArchive(archive);
  const target = await safeTarget(root, relative, { allowBackup: true });
  await mkdir(path.dirname(target), { recursive: true });
  await safeTarget(root, relative, { allowBackup: true });
  const json = JSON.stringify(archive, null, 2) + '\n';
  if (Buffer.byteLength(json) > LIMITS.archiveBytes) throw new Error('Het JSON-back-upbestand is te groot.');
  await writeFile(target, json, { mode: 0o600, flag: 'wx' });
  return target;
}

export async function applyArchive(root, validated) {
  for (const item of validated.files) {
    const target = await safeTarget(root, item.path);
    await mkdir(path.dirname(target), { recursive: true });
    await safeTarget(root, item.path);
    const temporary = path.join(path.dirname(target), `.restore-${randomBytes(12).toString('hex')}.tmp`);
    try { await writeFile(temporary, item.bytes, { flag: 'wx', mode: 0o600 }); await rename(temporary, target); }
    finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  for (const relative of validated.remove) {
    const target = await safeTarget(root, relative);
    await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function backupName(prefix = 'kwadendamme') {
  return `backups/${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}.json`;
}

export function parseArguments(args, options) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const type = options[args[i]];
    if (!type) throw new Error(`Onbekende optie: ${args[i]}`);
    if (result[args[i]] !== undefined) throw new Error(`Dubbele optie: ${args[i]}`);
    if (type === 'flag') result[args[i]] = true;
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Waarde ontbreekt voor ${args[i - 1]}`);
      result[args[i - 1]] = value;
    }
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2), { '--root': 'value', '--output': 'value' });
    const root = await resolveRoot(args['--root']);
    const archive = await createArchive(root);
    const output = await writeArchive(root, args['--output'] || backupName(), archive);
    console.log(`Back-up opgeslagen: ${output}\n${archive.files.length} bron-, inhoud- en mediabestanden. Cloudflare secrets, privékeys, lokale berichten, Git-historie en bouwuitvoer zijn niet inbegrepen.`);
    if (archive.excluded.length) console.log(`Uitgesloten paden: ${archive.excluded.join(', ')}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
