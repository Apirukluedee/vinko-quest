/* เซิร์ฟเวอร์ดูงานในเครื่อง เลียนแบบ cleanUrls ของ Vercel
   รัน:  node serve-local.js     แล้วเปิด http://localhost:8842
   หมายเหตุ: /api/* จะไม่ทำงาน ต้องใช้ `vercel dev` ถึงจะทดสอบ API ได้ */
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = __dirname, PORT = 8842;
const TYPES = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8', '.webp':'image/webp', '.png':'image/png',
  '.svg':'image/svg+xml', '.xml':'application/xml', '.txt':'text/plain; charset=utf-8',
  '.pdf':'application/pdf', '.ttf':'font/ttf', '.json':'application/json' };

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/lab01' || p.startsWith('/lab01/')) { res.writeHead(308, { Location: '/' }); return res.end(); }
  if (p.startsWith('/api/')) {
    res.writeHead(501, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok:false, error:'/api ทำงานเฉพาะบน Vercel หรือ vercel dev' }));
  }
  if (p === '/') p = '/index.html';
  if (!path.extname(p) && fs.existsSync(path.join(ROOT, p + '.html'))) p += '.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end('<h1>404</h1><p>ไม่พบ ' + p + '</p><p><a href="/">กลับหน้าแรก</a></p>');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                       'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('เปิดดูงานได้ที่  http://localhost:' + PORT));
