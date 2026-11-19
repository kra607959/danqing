// 零依赖静态服务器：node danqing/serve.mjs  →  http://localhost:5320（部落）、/sandbox.html（三支笔沙盘）、/lab.html（符号实验室）
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, process.argv[2] || '.');
const port = Number(process.env.PORT) || 5320;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8' };

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => {
  console.log(`纸上文明 → http://localhost:${port}（部落 M1）  http://localhost:${port}/sandbox.html（三支笔沙盘 M0）  http://localhost:${port}/lab.html（符号实验室）`);
  const lan = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === 'IPv4' && !a.internal).map(a => a.address);
  for (const ip of lan) console.log(`  平板（同一 Wi-Fi）→ http://${ip}:${port}/`);
});
