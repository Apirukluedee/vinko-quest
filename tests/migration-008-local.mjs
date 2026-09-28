// Embedded PostgreSQL only. No connection URL is accepted and no remote DB
// connection is possible. Pass an absolute local @electric-sql/pglite@0.5.8 directory.
//   node tests/migration-008-local.mjs /abs/path/node_modules/@electric-sql/pglite
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
if (process.argv.length !== 3 || !path.isAbsolute(process.argv[2])) throw Error('Pass an absolute local PGlite package directory');
const dir = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@electric-sql/pglite');
assert.equal(manifest.version, '0.5.8');
const { PGlite } = await import(pathToFileURL(path.join(dir, 'dist/index.js')));
const { pgcrypto } = await import(pathToFileURL(path.join(dir, 'dist/contrib/pgcrypto.js')));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new PGlite({extensions:{pgcrypto}});
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
let count = 0;
function pass(name) { count++; console.log('PASS '+name); }
const IMMUTABLE = /ORDER_ATTRIBUTION_IMMUTABLE/;
const snap = JSON.stringify({first:{utm_source:'test',t:'2026-09-28T09:00:00.000Z'},last:{utm_source:'test',utm_campaign:'b2check',click_id_platform:'meta',click_id_value:'IwAR0'},captured_at:'2026-09-28T10:00:00.000Z',schema_version:1});
const ins = (ref, status, snapshot) => db.query(
  "insert into public.orders(order_ref,package_code,amount_satang,customer_email,attribution_status,attribution_snapshot) values ($1,'LAB',19900,'fixture@example.invalid',$2,$3::jsonb)",
  [ref, status, snapshot]);
const row = async ref => (await db.query('select attribution_status, attribution_snapshot, status from public.orders where order_ref=$1', [ref])).rows[0];
try {
  console.log(JSON.stringify((await db.query('select version(), current_database(), inet_server_addr()')).rows));
  await db.exec('create role anon; create role authenticated;');
  for (const f of ['001_init.sql','002_delivery.sql','003_refunds.sql','004_stories_package.sql','005_marketing_consent.sql','006_unsubscribe_token.sql','007_custom_cart_package.sql']) {
    await db.exec(read('supabase/migrations/'+f));
  }
  pass('migrations 001-007 execute in isolated PostgreSQL');

  await db.exec("insert into public.orders(order_ref,package_code,amount_satang,customer_email) values ('VK-PRE-0001','LAB',19900,'baseline@example.invalid'),('VK-PRE-0002','CUSTOM',9900,'baseline@example.invalid');");
  const before = (await db.query('select * from public.orders order by order_ref')).rows;

  await db.exec(read('supabase/migrations/008_order_attribution.sql'));
  await db.exec(read('supabase/migrations/008_order_attribution.sql'));
  pass('migration 008 applies and can be rerun');

  const after = (await db.query('select * from public.orders order by order_ref')).rows;
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].attribution_status, null);
    assert.equal(after[i].attribution_snapshot, null);
    const { attribution_status, attribution_snapshot, ...rest } = after[i];
    assert.deepEqual(rest, before[i]);
  }
  pass('pre-existing rows untouched and stay NULL (no backfill)');

  await ins('VK-ATTR-0001', 'captured', snap);
  assert.equal((await row('VK-ATTR-0001')).attribution_snapshot.last.utm_campaign, 'b2check');
  await ins('VK-ATTR-0002', 'none', null);
  await ins('VK-ATTR-0003', 'no_consent', null);
  pass('insert with captured/none/no_consent succeeds');

  await assert.rejects(db.query("update public.orders set attribution_snapshot = '{\"first\":null,\"last\":{\"utm_source\":\"forged\"}}'::jsonb where order_ref='VK-ATTR-0001'"), IMMUTABLE);
  await assert.rejects(db.query("update public.orders set attribution_snapshot = null, attribution_status = 'none' where order_ref='VK-ATTR-0001'"), IMMUTABLE);
  await assert.rejects(db.query("update public.orders set attribution_status = 'captured', attribution_snapshot = $1::jsonb where order_ref='VK-ATTR-0002'", [snap]), IMMUTABLE);
  await assert.rejects(db.query("update public.orders set attribution_status = 'none' where order_ref='VK-ATTR-0003'"), IMMUTABLE);
  assert.equal((await row('VK-ATTR-0001')).attribution_snapshot.last.utm_source, 'test');
  pass('UPDATE changing snapshot or status is rejected (write-once)');

  await assert.rejects(db.query("update public.orders set attribution_status = 'captured', attribution_snapshot = $1::jsonb where order_ref='VK-PRE-0001'", [snap]), IMMUTABLE);
  pass('pre-feature NULL rows cannot be backfilled by UPDATE');

  await db.query("update public.orders set status='paid', omise_charge_id='chrg_test_x' where order_ref='VK-ATTR-0001'");
  await db.query("update public.orders set attribution_status = attribution_status, attribution_snapshot = attribution_snapshot where order_ref='VK-ATTR-0001'");
  await db.query("update public.orders set status='paid' where order_ref='VK-PRE-0001'");
  assert.equal((await row('VK-ATTR-0001')).status, 'paid');
  assert.equal((await row('VK-ATTR-0001')).attribution_status, 'captured');
  pass('other columns (status, omise_charge_id) still update normally; no-op rewrite allowed');

  await assert.rejects(ins('VK-BAD-0001', 'utm', null), /orders_attribution_(status|consistent)_check/);
  await assert.rejects(ins('VK-BAD-0002', 'captured', null), /orders_attribution_consistent_check/);
  await assert.rejects(ins('VK-BAD-0003', 'none', snap), /orders_attribution_consistent_check/);
  await assert.rejects(ins('VK-BAD-0004', 'captured', '[1,2]'), /orders_attribution_consistent_check/);
  await assert.rejects(ins('VK-BAD-0005', null, snap), /orders_attribution_consistent_check/);
  pass('check constraints reject unknown status and status/snapshot mismatch');

  // --- ลบตามคำขอลูกค้า (PDPA): ทางออกเดียวของ write-once ---
  const ERASE = "update public.orders set attribution_snapshot = null, attribution_status = 'erased' where order_ref = $1";
  await assert.rejects(db.query("update public.orders set attribution_status = 'erased' where order_ref='VK-ATTR-0001'"), IMMUTABLE);
  await assert.rejects(db.query("update public.orders set attribution_snapshot = null where order_ref='VK-ATTR-0001'"), IMMUTABLE);
  await assert.rejects(db.query("update public.orders set attribution_snapshot = '{\"first\":null,\"last\":{\"utm_source\":\"forged\"}}'::jsonb where order_ref='VK-ATTR-0001'"), IMMUTABLE);
  assert.equal((await row('VK-ATTR-0001')).attribution_snapshot.last.utm_campaign, 'b2check');
  pass('before erase: half-erase (status only / snapshot only) and editing snapshot to another value still fail');

  const erased = await db.query(ERASE, ['VK-ATTR-0001']);
  assert.equal(erased.affectedRows, 1);
  assert.deepEqual(await row('VK-ATTR-0001'), { attribution_status: 'erased', attribution_snapshot: null, status: 'paid' });
  await db.query(ERASE, ['VK-ATTR-0003']);   // no_consent -> erased
  await db.query(ERASE, ['VK-PRE-0002']);    // ออเดอร์ก่อน 008 (NULL) -> erased
  assert.equal((await row('VK-ATTR-0003')).attribution_status, 'erased');
  assert.equal((await row('VK-PRE-0002')).attribution_status, 'erased');
  pass('erase works: captured, no_consent and pre-008 rows -> (NULL, erased)');

  await assert.rejects(db.query("update public.orders set attribution_status = 'captured', attribution_snapshot = $1::jsonb where order_ref='VK-ATTR-0001'", [snap]), IMMUTABLE);
  await assert.rejects(db.query("update public.orders set attribution_snapshot = $1::jsonb where order_ref='VK-ATTR-0001'", [snap]), IMMUTABLE);
  await assert.rejects(db.query("update public.orders set attribution_status = 'none' where order_ref='VK-ATTR-0001'"), IMMUTABLE);
  await assert.rejects(db.query("update public.orders set attribution_status = null where order_ref='VK-ATTR-0001'"), IMMUTABLE);
  assert.deepEqual(await row('VK-ATTR-0001'), { attribution_status: 'erased', attribution_snapshot: null, status: 'paid' });
  pass('after erase: any change to snapshot or status fails');

  await db.query(ERASE, ['VK-ATTR-0001']);   // ลบซ้ำ = ไม่เปลี่ยนค่า ไม่ error
  await db.query("update public.orders set status='refunded' where order_ref='VK-ATTR-0001'");
  assert.equal((await row('VK-ATTR-0001')).status, 'refunded');
  pass('after erase: repeating the erase is a no-op; other columns still update');

  await assert.rejects(ins('VK-BAD-0006', 'erased', snap), /orders_attribution_consistent_check/);
  await ins('VK-ERASED-0001', 'erased', null);
  await db.query("delete from public.orders where order_ref='VK-ERASED-0001'");
  pass("consistency check: 'erased' requires snapshot IS NULL");

  await ins('VK-LEGACY-0001', null, null);
  pass('insert without attribution (fallback path) still succeeds as NULL');

  await db.query("delete from public.orders where order_ref like 'VK-ATTR-%' or order_ref like 'VK-LEGACY-%'");
  pass('delete is not blocked by the write-once trigger');

  const defs = await db.query("select conname, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.orders'::regclass and conname like 'orders_attribution_%' order by conname");
  console.log(JSON.stringify(defs.rows));
  const trg = await db.query("select tgname, tgenabled from pg_trigger where tgrelid='public.orders'::regclass and tgname='orders_attribution_write_once'");
  assert.deepEqual(trg.rows, [{tgname:'orders_attribution_write_once', tgenabled:'O'}]);
  pass('verification queries from 008 return expected constraint and trigger');
  console.log(`Migration 008: ${count} passed, 0 failed. No remote database connection.`);
} finally { await db.close(); }
