import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve(import.meta.dirname);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + '/') || !['/index.html', '/src/app.js', '/src/style.css'].includes(pathname === '/' ? '/index.html' : pathname)) {
      res.writeHead(404); return res.end('Not found');
    }
    const content = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] + '; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log('Maldoori RMM listening on port ' + (process.env.PORT || 3000)));
