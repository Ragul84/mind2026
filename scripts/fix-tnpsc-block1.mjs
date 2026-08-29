// TNPSC Block 1 factual corrections — applied across the ENTIRE content_json
// tree (quick_notes, exam_hook, mastery_depth, lesson_intro, lesson_pages,
// flashcards, quiz, smart_revision_summary), since the same terms appear in
// many surfaces. Backs up each row first.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const FIXES = {
  2: [['Pagaipadam', 'Pagaapadam']],
  5: [['Sorkul Pinvarunilai', 'Sorporul Pinvarunilai']],
  6: [['Fig flower', 'Atthi flower (Aatthi / Bauhinia)']],
};

const applyTree = (node, subs) => {
  if (typeof node === 'string') { let s = node; for (const [f, r] of subs) s = s.split(f).join(r); return s; }
  if (Array.isArray(node)) return node.map((x) => applyTree(x, subs));
  if (node && typeof node === 'object') { const o = {}; for (const k of Object.keys(node)) o[k] = applyTree(node[k], subs); return o; }
  return node;
};

for (const [dayStr, subs] of Object.entries(FIXES)) {
  const day = Number(dayStr);
  const { data, error } = await supabase.from('master_content_vault')
    .select('content_json').eq('track_id','tnpsc_ecosystem').eq('day_number',day).maybeSingle();
  if (error || !data) { console.error(`load failed day ${day}`, error); continue; }
  const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  const before = JSON.stringify(json);
  writeFileSync(`scripts/backup-tnpsc-${day}.json`, before);
  const fixed = applyTree(json, subs);
  const after = JSON.stringify(fixed);
  const count = subs.reduce((acc,[f]) => acc + (before.split(f).length - 1), 0);
  if (after === before) { console.log(`day ${day}: nothing to change`); continue; }
  const { error: e } = await supabase.from('master_content_vault')
    .update({ content_json: fixed }).eq('track_id','tnpsc_ecosystem').eq('day_number',day);
  if (e) { console.error(`update failed day ${day}`, e); continue; }
  console.log(`day ${day}: replaced ${count} occurrence(s) across all fields`);
}
console.log('done');
