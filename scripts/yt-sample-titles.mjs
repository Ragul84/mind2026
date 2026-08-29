import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
for (const track of ['upsc_ecosystem','tnpsc_ecosystem','ssc_ecosystem']) {
  console.log('\n=== '+track+' ===');
  for (const d of [1, 25, 64, 92]) {
    const { data } = await supabase.from('master_content_vault').select('topic_title,content_json').eq('track_id',track).eq('day_number',d).maybeSingle();
    if(!data) continue;
    const j = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
    const v = (j.video_recommendations||[])[0]||{};
    console.log(`  D${d} topic="${data.topic_title}"`);
    console.log(`     title="${v.title}"`);
    console.log(`     why="${v.why}"`);
  }
}
