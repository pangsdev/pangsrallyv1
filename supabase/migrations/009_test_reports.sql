-- Bug reports and ideas sent from the /report page. Only the function's service role touches this table.
create table if not exists test_reports (
  id uuid primary key,
  wallet text,               -- null when sent while signed out
  kind text not null check (kind in ('bug', 'idea', 'other')),
  area text not null,
  message text not null check (char_length(message) between 10 and 2000),
  contact text,
  page text,
  agent text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);
create index if not exists test_reports_created on test_reports (created_at desc);
create index if not exists test_reports_wallet on test_reports (wallet, created_at desc);
alter table test_reports enable row level security;
