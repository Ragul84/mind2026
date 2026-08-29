import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// distinct track_ids + counts
const { data: all } = await supabase.from('master_content_vault').select('track_id,day_number');
const byTrack = {};
for (const r of all) byTrack[r.track_id] = (byTrack[r.track_id]||0)+1;
console.log('TRACKS:'); for (const [t,c] of Object.entries(byTrack)) console.log(' ', t, c);

// look at one row's video-ish keys
const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id','upsc_ecosystem').eq('day_number',1).maybeSingle();
const j = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
console.log('\nTOP-LEVEL KEYS:', Object.keys(j));
function findVideos(node, path) {
  if (Array.isArray(node)) { node.forEach((x,i)=>findVideos(x, `${path}[${i}]`)); return; }
  if (node && typeof node==='object') {
    for (const k of Object.keys(node)) {
      if (/video/i.test(k)) console.log('  VIDEO KEY:', `${path}.${k}`, '=>', JSON.stringify(node[k]).slice(0,300));
      findVideos(node[k], `${path}.${k}`);
    }
  }
}
findVideos(j, 'root');
