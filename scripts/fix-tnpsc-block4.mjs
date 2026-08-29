import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const FIXES = {
  22: [{ re: /Andaman & Nicobar \(Volcanic origin[^)]*\)/g, rep: 'Andaman & Nicobar (Tectonic origin; Barren Island is India’s only active volcano)' }],
  26: [{ re: /Muappandal/g, rep: 'Muppandal' }],
};
const apply = (n, fixes) => {
  if (typeof n === 'string'){ let s=n; for(const {re,rep} of fixes) s=s.replace(re,rep); return s; }
  if (Array.isArray(n)) return n.map(x=>apply(x,fixes));
  if (n && typeof n==='object'){ const o={}; for(const k of Object.keys(n)) o[k]=apply(n[k],fixes); return o; }
  return n;
};
for (const [dayStr, fixes] of Object.entries(FIXES)) {
  const day = Number(dayStr);
  const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id','tnpsc_ecosystem').eq('day_number',day).maybeSingle();
  const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  const before = JSON.stringify(json);
  writeFileSync(`scripts/backup-tnpsc-${day}.json`, before);
  const counts = fixes.map(f=>(before.match(f.re)||[]).length);
  const fixed = apply(json, fixes);
  if (JSON.stringify(fixed)===before){ console.log(`day ${day}: no change (counts ${counts.join(',')})`); continue; }
  const { error } = await supabase.from('master_content_vault').update({content_json:fixed}).eq('track_id','tnpsc_ecosystem').eq('day_number',day);
  console.log(error?error:`day ${day}: applied (occurrences ${counts.join(', ')})`);
}
