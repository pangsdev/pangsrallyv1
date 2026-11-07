-- Pangs Cup autopilot: every minute, call the cup-publish function. It starts every Cup round that is
-- due (rounds resolve when someone asks, so this keeps them on time with nobody watching) and, once the
-- Grand Final has finished, writes the results and the Participant root on chain and turns on the
-- Claim buttons. The function only does what is due, so the extra calls change nothing.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'pangs-cup-autopilot';
select cron.schedule(
  'pangs-cup-autopilot',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://rzpcppmzpyocoqnjwrwp.supabase.co/functions/v1/cup-publish',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
