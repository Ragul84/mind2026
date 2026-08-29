import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
for (const [t,d] of [['upsc_ecosystem',7],['ssc_ecosystem',1],['tnpsc_ecosystem',50]]) {
  const { data } = await supabase.from('master_content_vault').select('content_json,topic_title').eq('track_id',t).eq('day_number',d).maybeSingle();
  const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  const cards = json.flashcards||[];
  console.log(`\n■ ${t} d${d} — ${data.topic_title} (${cards.length} cards)`);
  for (const c of cards.slice(0,6)) console.log(`  Q: ${c.front}\n  A: ${c.back}`);
}
