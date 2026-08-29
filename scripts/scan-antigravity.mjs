import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await supabase.from('master_content_vault').select('track_id,day_number,content_json');
if(error){console.log(error);process.exit(1);}
for(const row of data){
  const s = typeof row.content_json==='string'?row.content_json:JSON.stringify(row.content_json);
  const n = (s.match(/Antigravity/gi)||[]).length;
  if(n) console.log(`${row.track_id} day ${row.day_number}: ${n} hit(s)`);
}
console.log('scan done, rows:', data.length);
