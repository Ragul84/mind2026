import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id','upsc_ecosystem').eq('day_number',7).maybeSingle();
const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
const notes = json?.snapshot?.quick_notes || [];
console.log(`quick_notes count: ${notes.length}\n`);
for (const n of notes) {
  const endsTrunc = /(\.\.\.|…)\s*$/.test(n.detail||'');
  const shorthand = /RS Seats|Sched Areas|Amdt/i.test(n.detail||'');
  console.log(`• ${n.title}`);
  console.log(`   trunc=${endsTrunc} shorthand=${shorthand}`);
  if (/schedule|recitation/i.test((n.title||'')+(n.detail||''))) console.log(`   DETAIL: ${n.detail}`);
}
