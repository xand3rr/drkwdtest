import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, hosting } from '../lib/basis.mjs';
const file = path.join(ROOT, 'config/hosting.json');
const config = JSON.parse(await readFile(file, 'utf8'));
const args = process.argv.slice(2);
const keys = { '--repository': 'repository', '--auth-url': 'authUrl', '--site-url': 'siteUrl', '--base-path': 'basePath', '--branch': 'branch' };
if (!args.length || args.length % 2) throw new Error('Gebruik --repository eigenaar/repo --auth-url https://loginserver.example');
for (let i = 0; i < args.length; i += 2) {
  const key = keys[args[i]];
  if (!key) throw new Error(`Onbekende instelling: ${args[i]}`);
  config[key] = args[i + 1];
}
hosting(config);
await writeFile(file, JSON.stringify(config, null, 2) + '\n');
console.log('Instellingen opgeslagen. Bouw daarna met npm run build.');
