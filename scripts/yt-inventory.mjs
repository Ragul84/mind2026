import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const TRACKS = ['upsc_ecosystem','tnpsc_ecosystem','ssc_ecosystem'];
let totalEntries = 0;
const titles = new Set();
const realUrls = { real: 0, search: 0 };
for (const track of TRACKS) {
  const { data } = await supabase.from('master_content_vault').select('day_number,content_json').eq('track_id',track).order('day_number');
  let trackEntries = 0;
  for (const row of data) {
    const j = typeof row.content_json==='string'?JSON.parse(row.content_json):row.content_json;
    const vids = j.video_recommendations || [];
    for (const v of vids) {
      trackEntries++; totalEntries++;
      titles.add(`${track}::${(v.title||'').trim()}`);
      if (/watch\?v=|youtu\.be\//.test(v.url||'')) realUrls.real++; else realUrls.search++;
    }
  }
  console.log(`${track}: ${data.length} days, ${trackEntries} video entries`);
}
console.log(`\nTOTAL entries: ${totalEntries}`);
console.log(`Unique (track::title): ${titles.size}`);
console.log(`Already real watch URLs: ${realUrls.real} | search/other URLs: ${realUrls.search}`);
