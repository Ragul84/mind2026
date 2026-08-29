import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const CACHE_FILE = 'scripts/yt-cache.json';
const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE,'utf8')) : {};
const TRACKS = ['upsc_ecosystem','tnpsc_ecosystem','ssc_ecosystem'];

const cleanTitle = (t) => (t||'').replace(/^(UPSC|SSC|TNPSC)\s*:\s*(UPSC|SSC|TNPSC)\s*:?\s*/i,'$1: ').replace(/\s+/g,' ').trim();

let updated = 0, skipped = 0;
for (const track of TRACKS) {
  const { data } = await supabase.from('master_content_vault').select('day_number,content_json').eq('track_id',track).order('day_number');
  const backup = [];
  for (const row of data) {
    const k = `${track}::${row.day_number}`;
    const hit = cache[k];
    if (!hit || !hit.videoId) { skipped++; continue; }
    const j = typeof row.content_json==='string'?JSON.parse(row.content_json):row.content_json;
    const vids = j.video_recommendations || [];
    if (!vids.length) { skipped++; continue; }
    const before = JSON.stringify(j);
    const newUrl = `https://www.youtube.com/watch?v=${hit.videoId}`;
    // only the primary (first) recommendation gets the resolved video
    vids[0] = { ...vids[0], url: newUrl, title: cleanTitle(vids[0].title) };
    j.video_recommendations = vids;
    if (JSON.stringify(j) === before) { skipped++; continue; }
    backup.push({ day_number: row.day_number, content_json: before });
    const { error } = await supabase.from('master_content_vault').update({ content_json: j }).eq('track_id',track).eq('day_number',row.day_number);
    if (error) { console.log(`ERR ${k}:`, error.message); continue; }
    updated++;
  }
  if (backup.length) writeFileSync(`scripts/backup-yt-${track}.json`, JSON.stringify(backup));
  console.log(`${track}: updated ${backup.length} rows`);
}
console.log(`\nTotal updated: ${updated}, skipped (no cache yet / no change): ${skipped}`);
