import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {ROOT,loadHosting} from '../lib/content.mjs';
const root=path.join(ROOT,'_site'),h=await loadHosting();
async function files(dir) {const result=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())result.push(...await files(p));else result.push(p);}return result;}
const pages=(await files(root)).filter(p=>p.endsWith('.html'));
let links=0;
for(const file of pages) {
  const html=await readFile(file,'utf8');
  assert(!html.includes('playground.wordpress.net'),`Playground dependency in ${file}`);
  if(!file.includes('/admin/'))assert.equal((html.match(/<h1[\s>]/g)||[]).length,1,`Exactly one page title in ${file}`);
  for(const m of html.matchAll(/\b(?:href|src|action)="([^"]+)"/g)) {
    let url=m[1].replaceAll('&amp;','&');
    if(/^(?:https?:|mailto:|data:|#)/i.test(url))continue;
    let target;
    if(url.startsWith('/')) {
      assert(!h.basePath||url.startsWith(h.basePath+'/'),`Missing GitHub repository prefix: ${url}`);
      if(h.basePath)url=url.slice(h.basePath.length);
      target=path.join(root,decodeURIComponent(url.split(/[?#]/)[0]));
    } else target=path.resolve(path.dirname(file),decodeURIComponent(url.split(/[?#]/)[0]));
    let s;try{s=await stat(target);}catch{assert.fail(`Broken internal link ${m[1]} in ${path.relative(root,file)}`);}
    if(s.isDirectory())await stat(path.join(target,'index.html'));
    links++;
  }
}
console.log(`Checked ${pages.length} HTML pages and ${links} internal links/assets.`);
