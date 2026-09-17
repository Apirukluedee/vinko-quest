'use strict';
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');

const outDir = path.join('C:', 'Users', 'ACER', 'Documents', 'VINKO_MASTER', 'POSTERS-v1', 'assets');
const targets = [
  ['poster-stories', 'https://vinko.quest/r/poster-stories'],
  ['poster-wowlab', 'https://vinko.quest/r/poster-wowlab'],
];

(async () => {
  for (const [name, url] of targets) {
    const svg = await QRCode.toString(url, {
      type: 'svg', errorCorrectionLevel: 'M', margin: 1,
      color: { dark: '#16255c', light: '#ffffff' }
    });
    const outPath = path.join(outDir, 'QR-' + name + '.svg');
    fs.writeFileSync(outPath, svg);
    console.log('wrote', outPath, '<-', url);
  }
})();
