/* เซิร์ฟเวอร์ดูงานในเครื่อง เลียนแบบ cleanUrls ของ Vercel
   รัน:  node serve-local.js     แล้วเปิด http://localhost:8842
   หมายเหตุ: /api/* จะไม่ทำงาน ต้องใช้ `vercel dev` ถึงจะทดสอบ API ได้ */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = Number(process.env.PORT || 8842);
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.webp':'image/webp', '.png':'image/png',
  '.svg':'image/svg+xml', '.xml':'application/xml', '.txt':'text/plain; charset=utf-8',
  '.pdf':'application/pdf', '.ttf':'font/ttf', '.json':'application/json' };

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); }
  catch (e) { res.writeHead(400); return res.end('Bad request'); }
  // Local review must not serve repository secrets, tooling or filesystem paths.
  if (p.includes('\\') || p.includes('\0') || p.split('/').some(s => s.startsWith('.')) ||
      /^\/(?:node_modules|supabase|tests|scripts)(?:\/|$)/.test(p) ||
      /^\/package(?:-lock)?\.json$/.test(p)) { res.writeHead(404); return res.end('Not found'); }
  if (p === '/ef-checkin') {
    const query = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    res.writeHead(308, { Location: '/ef-check' + query }); return res.end();
  }
  if (p === '/lab01' || p.startsWith('/lab01/')) { res.writeHead(308, { Location: '/' }); return res.end(); }

  /* /r/:token ทำงานได้ในเครื่องด้วย เพราะไม่ต้องพึ่ง DB หรือ env เลย
     (บน Vercel ใช้ rewrite ใน vercel.json ไปที่ /api/redirect) */
  if (p.startsWith('/r/')) {
    const token = p.slice(3);
    req.url = '/api/redirect?token=' + encodeURIComponent(token);
    return require('./api/redirect.js')(req, res);
  }

  if (p.startsWith('/api/')) {
    res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok:false, error:'/api ทำงานเฉพาะบน Vercel หรือ vercel dev' }));
  }
  if (p === '/') p = '/index.html';
  if (!path.extname(p) && fs.existsSync(path.join(ROOT, p + '.html'))) p += '.html';
  const file = path.resolve(ROOT, '.' + p);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>404</h1><p><a href="/">กลับหน้าแรก</a></p>');
  }
  if (p.startsWith('/downloads/')) res.setHeader('X-Robots-Tag', 'noindex');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                       'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log('เปิดดูงานได้ที่  http://127.0.0.1:' + PORT));
