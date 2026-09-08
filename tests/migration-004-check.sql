-- LOCAL ISOLATED POSTGRES ONLY. Run through tests/migration-004-local.mjs.
-- Guard and writes share one statement; even autocommit cannot skip the guard.
-- The fixture subtransaction always rolls back, including on successful tests.
do $$
declare
  definition text;
  violated text;
  prefix text := 'VK-M5TEST-' || pg_backend_pid()::text || '-';
  n integer;
begin
  if current_user <> 'vinko_m5_test_runner'
     or current_setting('vinko.m5_test', true) is distinct from 'isolated-local-only'
     or inet_server_addr() is not null then
    raise exception 'M5_TEST_GUARD: use the isolated local runner; never Production';
  end if;
  select pg_get_constraintdef(oid) into definition from pg_constraint
  where conrelid = 'public.orders'::regclass and conname = 'orders_package_code_check';
  if definition is null or definition not like '%STORIES%'
     or definition not like '%LAB%' or definition not like '%BUNDLE%' then
    raise exception 'M5_TEST_FAIL: invalid package constraint: %', definition;
  end if;
  begin
    insert into public.orders (order_ref, package_code, amount_satang, customer_email, client_request_id)
    values (prefix || '1', 'LAB', 19900, 'm5-fixture@example.invalid', prefix || 'lab'),
           (prefix || '2', 'STORIES', 29900, 'm5-fixture@example.invalid', prefix || 'stories'),
           (prefix || '3', 'BUNDLE', 39900, 'm5-fixture@example.invalid', prefix || 'bundle');
    select count(*) into n from public.orders where order_ref like prefix || '%';
    if n <> 3 then raise exception 'M5_TEST_FAIL: expected 3 fixture orders, got %', n; end if;
    raise notice 'PASS LAB / STORIES / BUNDLE inserts';
    begin
      insert into public.orders (order_ref, package_code, amount_satang, customer_email)
      values (prefix || '4', 'FREE_STUFF', 1, 'm5-fixture@example.invalid');
      raise exception 'M5_TEST_FAIL: invalid package accepted';
    exception when check_violation then
      get stacked diagnostics violated = CONSTRAINT_NAME;
      if violated <> 'orders_package_code_check' then raise; end if;
      raise notice 'PASS invalid package rejected by package constraint';
    end;
    begin
      insert into public.orders (order_ref, package_code, amount_satang, customer_email)
      values (prefix || '5', 'STORIES', -1, 'm5-fixture@example.invalid');
      raise exception 'M5_TEST_FAIL: negative amount accepted';
    exception when check_violation then
      get stacked diagnostics violated = CONSTRAINT_NAME;
      if violated <> 'orders_amount_satang_check' then raise; end if;
      raise notice 'PASS negative amount rejected by amount constraint';
    end;
    raise exception sqlstate 'Z0001' using message = 'ROLL_BACK_M5_FIXTURES';
  exception when sqlstate 'Z0001' then
    raise notice 'PASS fixture subtransaction rolled back';
  end;
  select count(*) into n from public.orders where order_ref like prefix || '%';
  if n <> 0 then raise exception 'M5_TEST_FAIL: fixture orders left behind'; end if;
  raise notice 'PASS zero leftover fixture orders';
end $$;
