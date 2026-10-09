import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, hosting } from '../lib/basis.mjs';
const root=path.join(ROOT,'_site');
const {basePath}=hosting(JSON.parse(await readFile(path.join(ROOT,'config/hosting.json'),'utf8')),process.env);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.yml':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
  try {
    let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(basePath) {if(!name.startsWith(basePath+'/')){res.writeHead(404);res.end('Pagina niet gevonden');return;}name=name.slice(basePath.length);}
    const target=path.resolve(root,'.'+name);
    if(target!==root&&!target.startsWith(root+path.sep))throw new Error('Invalid path');
    let file=target;
    if((await stat(file)).isDirectory())file=path.join(file,'index.html');
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});
    res.end(req.method==='HEAD'?undefined:bytes);
  } catch {res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Pagina niet gevonden');}
});
const port=process.env.PORT===undefined?8080:Number(process.env.PORT);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT moet een geldig poortnummer zijn.');
server.listen(port,'127.0.0.1',()=>console.log(`Open http://localhost:${server.address().port}${basePath}/`));
process.on('SIGINT',()=>server.close());
process.on('SIGTERM',()=>server.close());
