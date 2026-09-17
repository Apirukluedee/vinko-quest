#!/usr/bin/env node
/**
 * upload-reader-assets.js
 * อัปโหลดไฟล์ภาพ + เสียงนิทาน VINKO ขึ้น Supabase Storage bucket "story-reader"
 *
 * ใช้งาน:
 *   node scripts/upload-reader-assets.js           # ทุกเล่ม
 *   node scripts/upload-reader-assets.js --story 1 # เล่ม 1 เท่านั้น
 *   node scripts/upload-reader-assets.js --dry-run # แสดงรายการแต่ไม่ upload
 */

'use strict';
const { readFile, readdir } = require('fs/promises');
const { join, extname }     = require('path');

const ROOT   = join(__dirname, '..');
const MASTER = 'C:\\Users\\ACER\\Documents\\VINKO_MASTER\\_UPLOAD';
const BUCKET = 'story-reader';
const MIME   = { '.png': 'image/png', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

async function main() {
  // Load env
  const envText = await readFile(join(ROOT, '.env.local'), 'utf8').catch(() => '');
  function getEnv(key) {
    const m = envText.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return m ? m[1].trim() : process.env[key] || '';
  }
  const SB_URL = getEnv('SUPABASE_URL');
  const SB_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!SB_URL || !SB_KEY) {
    console.error('ERROR: SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ไม่พบใน .env.local');
    process.exit(1);
  }

  // CLI args
  const args     = process.argv.slice(2);
  const dryRun   = args.includes('--dry-run');
  const storyArg = args.indexOf('--story');
  const stories  = storyArg >= 0
    ? [parseInt(args[storyArg + 1], 10)]
    : [1, 2, 3, 4, 5];

  console.log(`\nVINKO Reader Assets Uploader`);
  console.log(`Supabase: ${SB_URL}`);
  console.log(`Bucket:   ${BUCKET}`);
  console.log(`Mode:     ${dryRun ? 'DRY RUN (ไม่ upload จริง)' : 'UPLOAD'}\n`);

  // Ensure bucket exists
  async function ensureBucket() {
    const r = await fetch(`${SB_URL}/storage/v1/bucket/${BUCKET}`, {
      headers: { Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY }
    });
    if (r.ok) { console.log(`bucket "${BUCKET}" มีอยู่แล้ว`); return; }

    const c = await fetch(`${SB_URL}/storage/v1/bucket`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SB_KEY}`,
        apikey: SB_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true })
    });
    if (c.ok) {
      console.log(`สร้าง bucket "${BUCKET}" เสร็จแล้ว (public)`);
    } else {
      console.error('สร้าง bucket ไม่สำเร็จ:', await c.text());
      process.exit(1);
    }
  }

  // Upload one file
  async function uploadFile(localPath, remotePath) {
    const ext  = extname(localPath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const data = await readFile(localPath);

    const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${remotePath}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SB_KEY}`,
        apikey: SB_KEY,
        'Content-Type': mime,
        'x-upsert': 'true'
      },
      body: data
    });

    if (r.ok) {
      console.log(`  ✓ ${remotePath}  (${Math.round(data.length / 1024)} KB)`);
      return true;
    } else {
      console.error(`  ✗ ${remotePath}: ${await r.text()}`);
      return false;
    }
  }

  if (!dryRun) await ensureBucket();

  let totalFiles = 0, totalOk = 0, totalErr = 0;

  for (const n of stories) {
    const pad = String(n).padStart(2, '0');
    console.log(`\n── STORY-${pad} ──────────────────────────`);

    // Images
    const imgDir = join(MASTER, 'IMAGES', `STORY-${pad}`);
    try {
      const files = (await readdir(imgDir)).filter(f => f.endsWith('.png')).sort();
      console.log(`  ภาพ: ${files.length} ไฟล์`);
      for (const f of files) {
        totalFiles++;
        if (dryRun) { console.log(`  [dry] images/STORY-${pad}/${f}`); continue; }
        const ok = await uploadFile(join(imgDir, f), `images/STORY-${pad}/${f}`);
        if (ok) totalOk++; else totalErr++;
      }
    } catch {
      console.log(`  ภาพ: ไม่พบโฟลเดอร์`);
    }

    // Audio
    const audDir = join(MASTER, 'AUDIO', `STORY-${pad}`);
    try {
      const files = (await readdir(audDir)).filter(f => /\.(wav|mp3)$/i.test(f)).sort();
      console.log(`  เสียง: ${files.length} ไฟล์`);
      for (const f of files) {
        totalFiles++;
        if (dryRun) { console.log(`  [dry] audio/STORY-${pad}/${f}`); continue; }
        const ok = await uploadFile(join(audDir, f), `audio/STORY-${pad}/${f}`);
        if (ok) totalOk++; else totalErr++;
      }
    } catch {
      console.log(`  เสียง: ไม่พบโฟลเดอร์`);
    }
  }

  console.log(`\n──────────────────────────────────────`);
  if (dryRun) {
    console.log(`Dry run เสร็จ — รวม ${totalFiles} ไฟล์`);
  } else {
    console.log(`เสร็จแล้ว: ${totalOk} สำเร็จ, ${totalErr} ผิดพลาด (จาก ${totalFiles} ไฟล์)`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
