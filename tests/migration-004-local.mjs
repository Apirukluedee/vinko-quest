// Embedded PostgreSQL only. No connection URL is accepted and no remote DB
// connection is possible. Pass an absolute local @electric-sql/pglite@0.5.8 directory.
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
const notices = [];
const db = new PGlite({extensions:{pgcrypto}});
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const verification = read('tests/migration-004-check.sql');
let count = 0;
function pass(name) { count++; console.log('PASS '+name); }
try {
  console.log(JSON.stringify((await db.query('select version(), current_database(), inet_server_addr()')).rows));
  await db.exec('create role anon; create role authenticated;');
  for (const file of ['001_init.sql','002_delivery.sql','003_refunds.sql']) await db.exec(read('supabase/migrations/'+file));
  pass('original migrations 001-003 execute in isolated PostgreSQL');
  await assert.rejects(db.exec(verification), /M5_TEST_GUARD/);
  pass('default context rejected before any fixture writes');
  await db.exec("select set_config('vinko.m5_test','isolated-local-only',false);");
  await assert.rejects(db.exec(verification), /M5_TEST_GUARD/);
  pass('flag alone cannot authorize fixture writes');
  await db.exec('create role vinko_m5_test_runner bypassrls; grant usage on schema public to vinko_m5_test_runner; grant select, insert on public.orders to vinko_m5_test_runner;');
  await db.exec("insert into public.orders(order_ref,package_code,amount_satang,customer_email) values ('VK-BASELINE-LAB','LAB',19900,'baseline@example.invalid'),('VK-BASELINE-BUNDLE','BUNDLE',39900,'baseline@example.invalid');");
  const before = (await db.query('select * from public.orders order by order_ref')).rows;
  await assert.rejects(db.exec("insert into public.orders(order_ref,package_code,amount_satang,customer_email) values ('VK-BASELINE-STORIES','STORIES',29900,'baseline@example.invalid')"), /orders_package_code_check/);
  pass('reproduced STORIES rejection before migration 004');
  await db.exec(read('supabase/migrations/004_stories_package.sql'));
  await db.exec(read('supabase/migrations/004_stories_package.sql'));
  pass('migration 004 applies and can be rerun');
  await db.exec("set role vinko_m5_test_runner; select set_config('vinko.m5_test','',false);");
  await assert.rejects(db.exec(verification), /M5_TEST_GUARD/);
  pass('test role alone cannot authorize fixture writes');
  await db.exec("select set_config('vinko.m5_test','isolated-local-only',false);");
  await db.exec(verification, {onNotice:n=>notices.push(n.message)}); // deliberately autocommit
  pass('SQL assertions for all packages, invalid code, negative amount and rollback completed');
  for (const n of notices.filter(n=>n.startsWith('PASS '))) pass(n.slice(5));
  await db.exec('reset role');
  assert.deepEqual((await db.query('select * from public.orders order by order_ref')).rows,before);
  pass('baseline LAB/BUNDLE rows unchanged; no test data remains');
  const constraint = await db.query("select pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.orders'::regclass and conname='orders_package_code_check'");
  console.log(JSON.stringify(constraint.rows));
  console.log(`Migration 004: ${count} passed, 0 failed. No remote database connection.`);
} finally { await db.close(); }
