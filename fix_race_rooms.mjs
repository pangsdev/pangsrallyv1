import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

// Test connection and add player_count column via SQL
const { error } = await supabase.rpc('exec_sql', { 
  sql: 'ALTER TABLE race_rooms ADD COLUMN IF NOT EXISTS player_count INT NOT NULL DEFAULT 0;'
});

console.log('Result:', error ? 'RPC not available, trying direct' : 'Column added');

// Try direct select to verify table exists
const { data, error: e2 } = await supabase.from('race_rooms').select('*').limit(1);
console.log('Table check:', e2 ? e2.message : `OK - ${data?.length || 0} rows`);
