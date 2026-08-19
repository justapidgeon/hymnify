import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3456;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function proxySongbase(req, res, targetPath) {
  const url = `https://songbase.life/api/v2/${targetPath}`;

  https
    .get(url, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Cache-Control': 'no-store'
      });
      proxyRes.pipe(res);
    })
    .on('error', (err) => {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Proxy error: ${err.message}`);
    });
}

function serveStatic(req, res) {
  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

http
  .createServer((req, res) => {
    if (req.url.startsWith('/api/songbase/')) {
      const targetPath = req.url.replace('/api/songbase/', '');
      proxySongbase(req, res, targetPath);
      return;
    }

    serveStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`Hymnify dev server running at http://localhost:${PORT}`);
  });
