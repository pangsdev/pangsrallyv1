#!/bin/sh
# Pangs Cup autopilot, one-time setup (run from the repo: sh scripts/cup-autopilot-setup.sh).
#   1. deploys the cup-publish function
#   2. gives it its secrets: the Cup operator key (from .env) and the PangsCup address
#   3. schedules it every minute (migration 014: pg_cron + pg_net)
#   4. sends the operator a little gas and hands it PangsCup (transferOwnership)
# After this, rounds start on time and the results go on chain after every Grand Final by themselves.
set -e
cd "$(dirname "$0")/.."
export PATH="/usr/local/bin:$PATH"
REF=rzpcppmzpyocoqnjwrwp
CONTRACT=0xCd8BDd8A091833263EcFd409545bdf3bc36e69B8
SB="${SUPABASE_BIN:-/private/tmp/claude-501/-Users-macintoshi--claude-spares-spare-ndgzPu/90e369c4-9b9a-41bf-87ec-dbdcfe097781/scratchpad/supabase-cli/supabase}"
[ -x "$SB" ] || SB=supabase
grep -q '^CUP_OPERATOR_KEY=' .env || { echo 'CUP_OPERATOR_KEY missing in .env'; exit 1; }

node scripts/sync-race-shared.mjs

echo; echo '1/4 Deploying the cup-publish function…'
"$SB" functions deploy cup-publish --no-verify-jwt --use-api --project-ref "$REF"

echo; echo '2/4 Saving its secrets…'
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
grep '^CUP_OPERATOR_KEY=' .env > "$tmp"
echo "CUP_CONTRACT=$CONTRACT" >> "$tmp"
"$SB" secrets set --env-file "$tmp" --project-ref "$REF"
rm -f "$tmp"

echo; echo '3/4 Scheduling it every minute…'
"$SB" db query --linked -f supabase/migrations/014_cup_autopilot.sql

echo; echo '4/4 Handing PangsCup to the Cup operator…'
node scripts/cup-admin.mjs operator --contract "$CONTRACT" --eth 0.0008 --send

echo; echo 'Autopilot is on.'
