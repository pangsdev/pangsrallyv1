-- Test season invites: a new wallet needs a code to join; wallets already
-- registered keep signing in without one. A code has a number of places
-- (e.g. one code for the first 30 players). Like 003, only the test-season
-- Edge Function (service role) touches this: RLS on, no policies.

create table if not exists test_invite_codes (
  code text primary key check (code ~ '^[A-Z0-9-]{4,32}$'),
  max_uses int not null check (max_uses >= 1),
  uses int not null default 0 check (uses >= 0 and uses <= max_uses),
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table test_invite_codes enable row level security;

alter table test_players add column if not exists invite_code text references test_invite_codes(code);

-- Registers a wallet with a code in one transaction, so two people can never
-- take the last place and a failed insert never burns a place.
-- Returns 'exists' (already a player), 'joined', or 'invalid' (unknown, inactive or full).
create or replace function test_join_with_invite(p_wallet text, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from test_players where wallet = p_wallet) then
    return 'exists';
  end if;
  update test_invite_codes set uses = uses + 1
    where code = p_code and active and uses < max_uses;
  if not found then
    return 'invalid';
  end if;
  -- A unique violation here (the same wallet signing in twice at once) aborts the
  -- whole call, which also rolls back the use of the code; the server reads it as 'exists'.
  insert into test_players (wallet, invite_code) values (p_wallet, p_code);
  return 'joined';
end;
$$;

revoke all on function test_join_with_invite(text, text) from public, anon, authenticated;
grant execute on function test_join_with_invite(text, text) to service_role;
