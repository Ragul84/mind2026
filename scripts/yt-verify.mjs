import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
for (const track of ['upsc_ecosystem','tnpsc_ecosystem','ssc_ecosystem']) {
  console.log('\n=== '+track+' ===');
  for (const d of [1, 20, 42]) {
    const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id',track).eq('day_number',d).maybeSingle();
    const j = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
    const v = (j.video_recommendations||[])[0]||{};
    console.log(`  D${d}: ${v.url}`);
    console.log(`       "${v.title}"`);
  }
}
