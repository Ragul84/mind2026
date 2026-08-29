// TNPSC Block 2 factual corrections across the ENTIRE content_json tree.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Each fix: { re: RegExp, rep: string }. Applied to every string in the tree.
const FIXES = {
  8: [
    { re: /Tamil Mara\b(?!i)/g, rep: 'Tamil Marai' },
    { re: /Iniyavai Koorald/g, rep: 'Iniyavai Kooral' },
  ],
  12: [
    { re: /introduced\s+.{0,3}Pudhukkavithai.{0,3}\s*\(Modern poetry\)\s*in Tamil/g,
      rep: 'pioneered வசன கவிதை (prose poetry), modernising Tamil verse' },
  ],
};

const applyTree = (node, fixes) => {
  if (typeof node === 'string') { let s = node; for (const { re, rep } of fixes) s = s.replace(re, rep); return s; }
  if (Array.isArray(node)) return node.map((x) => applyTree(x, fixes));
  if (node && typeof node === 'object') { const o = {}; for (const k of Object.keys(node)) o[k] = applyTree(node[k], fixes); return o; }
  return node;
};

for (const [dayStr, fixes] of Object.entries(FIXES)) {
  const day = Number(dayStr);
  const { data, error } = await supabase.from('master_content_vault')
    .select('content_json').eq('track_id','tnpsc_ecosystem').eq('day_number',day).maybeSingle();
  if (error || !data) { console.error(`load failed day ${day}`, error); continue; }
  const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  const before = JSON.stringify(json);
  writeFileSync(`scripts/backup-tnpsc-${day}.json`, before);
  const counts = fixes.map((f) => (before.match(f.re) || []).length);
  const fixed = applyTree(json, fixes);
  const after = JSON.stringify(fixed);
  if (after === before) { console.log(`day ${day}: no change (counts ${counts.join(',')})`); continue; }
  const { error: e } = await supabase.from('master_content_vault')
    .update({ content_json: fixed }).eq('track_id','tnpsc_ecosystem').eq('day_number',day);
  if (e) { console.error(`update failed day ${day}`, e); continue; }
  console.log(`day ${day}: applied (occurrences ${counts.join(', ')})`);
}
console.log('done');
