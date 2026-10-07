// Embedded PostgreSQL only. No connection URL is accepted and no remote DB
// connection is possible. Pass an absolute local @electric-sql/pglite@0.5.8 directory.
//   node tests/migration-009-local.mjs /abs/path/node_modules/@electric-sql/pglite
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
const db = new PGlite({ extensions: { pgcrypto } });
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
let count = 0;
function pass(name) { count++; console.log('PASS ' + name); }
const snap = JSON.stringify({ first: null, last: { utm_source: 'test', t: '2026-10-08T00:00:00.000Z' }, captured_at: '2026-10-08T00:00:00.000Z', schema_version: 1 });
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';
const row = async ref => (await db.query('select attribution_status, attribution_snapshot, client_user_agent from public.orders where order_ref=$1', [ref])).rows[0];
try {
  await db.exec('create role anon; create role authenticated;');
  for (const f of ['001_init.sql', '002_delivery.sql', '003_refunds.sql', '004_stories_package.sql', '005_marketing_consent.sql',
                   '006_unsubscribe_token.sql', '007_custom_cart_package.sql', '008_order_attribution.sql']) {
    await db.exec(read('supabase/migrations/' + f));
  }
  pass('migrations 001-008 execute in isolated PostgreSQL');

  await db.query("insert into public.orders(order_ref,package_code,amount_satang,customer_email,attribution_status,attribution_snapshot) values ('VK-PRE9-0001','LAB',19900,'fixture@example.invalid','captured',$1::jsonb)", [snap]);
  const before = (await db.query('select * from public.orders order by order_ref')).rows;

  await db.exec(read('supabase/migrations/009_order_client_user_agent.sql'));
  await db.exec(read('supabase/migrations/009_order_client_user_agent.sql'));
  pass('migration 009 applies and can be rerun');

  const col = await db.query("select data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='orders' and column_name='client_user_agent'");
  assert.deepEqual(col.rows, [{ data_type: 'text', is_nullable: 'YES' }]);
  pass('verification 1: client_user_agent text NULL');

  const after = (await db.query('select * from public.orders order by order_ref')).rows;
  assert.equal(after.length, before.length);
  for (let i = 0; i < before.length; i++) {
    assert.equal(after[i].client_user_agent, null);
    const { client_user_agent, ...rest } = after[i];
    assert.deepEqual(rest, before[i]);
  }
  pass('verification 3: existing rows untouched (no backfill)');

  const ins = (ref, ua) => db.query(
    "insert into public.orders(order_ref,package_code,amount_satang,customer_email,attribution_status,attribution_snapshot,client_user_agent) values ($1,'LAB',19900,'fixture@example.invalid','captured',$2::jsonb,$3)",
    [ref, snap, ua]);
  await ins('VK-UA-0001', UA);
  await ins('VK-UA-0002', null);
  await ins('VK-UA-0003', 'ก'.repeat(512));
  assert.equal((await row('VK-UA-0001')).client_user_agent, UA);
  pass('insert with user agent, NULL, and exactly 512 chars (Thai counted as chars) succeeds');

  await assert.rejects(ins('VK-UA-BAD', 'x'.repeat(513)), /orders_client_user_agent_len_check/);
  pass('513 chars rejected by orders_client_user_agent_len_check');

  const con = await db.query("select conname from pg_constraint where conrelid='public.orders'::regclass and conname='orders_client_user_agent_len_check'");
  assert.equal(con.rows.length, 1);
  pass('verification 2: constraint exists');

  await db.query("update public.orders set attribution_snapshot = null, attribution_status = 'erased', client_user_agent = null where order_ref = 'VK-UA-0001'");
  assert.deepEqual(await row('VK-UA-0001'), { attribution_status: 'erased', attribution_snapshot: null, client_user_agent: null });
  pass('combined PDPA erase from the 009 header works with the 008 write-once trigger');

  await db.query("update public.orders set status = 'paid' where order_ref = 'VK-UA-0002'");
  await assert.rejects(db.query("update public.orders set attribution_status = 'none' where order_ref = 'VK-UA-0002'"), /ORDER_ATTRIBUTION_IMMUTABLE/);
  pass('008 write-once trigger still enforced after 009');

  console.log(`Migration 009: ${count} passed, 0 failed. No remote database connection.`);
} finally { await db.close(); }
