import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIMITS, applyArchive, backupName, entry, parseArguments, resolveRoot, safeTarget, validateArchive, writeArchive } from './export-backup.mjs';

export async function restoreBackup(archive, { root, apply = false } = {}) {
  root = await resolveRoot(root);
  const validated = validateArchive(archive);
  const changed = [];
  const previous = [];
  const missing = [];
  const removed = [];
  for (const item of validated.files) {
    const target = await safeTarget(root, item.path);
    let before;
    try { before = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before?.equals(item.bytes)) continue;
    changed.push(item);
    if (before) previous.push(entry(item.path, before));
    else missing.push(item.path);
  }
  for (const relative of validated.remove) {
    const target = await safeTarget(root, relative);
    let before;
    try { before = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (before) { previous.push(entry(relative, before)); removed.push(relative); }
  }
  const plan = { write: changed.map(item => item.path), remove: removed, applied: false, rollback: null };
  if (!apply || (!changed.length && !removed.length)) return plan;
  const rollbackArchive = { format: 'kwadendamme-backup', version: 1, createdAt: new Date().toISOString(), files: previous, remove: missing, excluded: [] };
  const rollback = validateArchive(rollbackArchive);
  plan.rollback = await writeArchive(root, backupName('voor-herstel'), rollbackArchive);
  try {
    await applyArchive(root, { files: changed, remove: removed });
    plan.applied = true;
  } catch (error) {
    try { await applyArchive(root, rollback); }
    catch { throw new Error(`Herstel onderbroken; automatisch terugzetten mislukte. Gebruik de herstelback-up: ${plan.rollback}. ${error.message}`); }
    throw new Error(`Herstel afgebroken en wijzigingen teruggezet. Herstelback-up: ${plan.rollback}. ${error.message}`);
  }
  return plan;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArguments(process.argv.slice(2), { '--root': 'value', '--file': 'value', '--apply': 'flag' });
    if (!args['--file']) throw new Error('Gebruik: node scripts/restore-backup.mjs --file backups/naam.json [--apply]');
    const root = await resolveRoot(args['--root']);
    const file = await safeTarget(root, args['--file'], { allowBackup: true });
    if ((await lstat(file)).size > LIMITS.archiveBytes) throw new Error('Back-upbestand is te groot.');
    const archive = JSON.parse(await readFile(file, 'utf8'));
    const result = await restoreBackup(archive, { root, apply: args['--apply'] === true });
    console.log(`${result.applied ? 'Herstel uitgevoerd' : 'Controle zonder wijzigingen'}\nTe schrijven: ${result.write.length}\nTe verwijderen: ${result.remove.length}`);
    for (const value of result.write) console.log(`SCHRIJF ${value}`);
    for (const value of result.remove) console.log(`VERWIJDER ${value}`);
    if (result.rollback) console.log(`Terugdraaien: node scripts/restore-backup.mjs --file ${path.relative(root, result.rollback).split(path.sep).join('/')} --apply`);
    else if (!args['--apply'] && (result.write.length || result.remove.length)) console.log('Voeg --apply toe nadat je deze wijzigingen hebt bekeken. Andere bestanden worden behouden.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
