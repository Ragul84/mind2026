import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const track=process.argv[2], A=Number(process.argv[3]), B=Number(process.argv[4]);
for (let d=A; d<=B; d++){
  const { data } = await supabase.from('master_content_vault').select('topic_title,content_json').eq('track_id',track).eq('day_number',d).maybeSingle();
  if(!data){ console.log(`\n##### DAY ${d}: (missing)`); continue; }
  const j = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  console.log(`\n##### DAY ${d}: ${data.topic_title}`);
  for(const n of (j?.snapshot?.quick_notes||[])){ console.log(`  • ${n.title}: ${n.detail}`); }
}
