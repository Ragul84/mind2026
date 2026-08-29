// Expand cryptic shorthand inside snapshot.quick_notes (the generator source)
// across the daily-mission tracks. Conservative, word-boundary-aware. Backs up
// every touched row to scripts/backup-src-<track>-<day>.json.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const SUBS = [
  [/\bRS\s+[Ss]eats\b/g, 'Rajya Sabha seats'],
  [/\bSched\.?\s+Areas\b/g, 'Scheduled Areas'],
  [/\bSched\.?\s+Tribes\b/g, 'Scheduled Tribes'],
  [/\(\s*AMTM\s*\)/g, '(Assam, Meghalaya, Tripura & Mizoram)'],
  [/\bGovt\.?\b/g, 'Government'],
  [/\bw\/o\b/g, 'without'],
  [/\bw\/\b/g, 'with'],
  [/\bb\/w\b/g, 'between'],
  [/\bimp\.\b/gi, 'important'],
  [/\bdefn\b/gi, 'definition'],
];

const apply = (s) => { let t = String(s||''); for (const [re, rep] of SUBS) t = t.replace(re, rep); return t; };

const PAGE = 200; let from = 0; const rows = [];
for (;;) {
  const { data, error } = await supabase
    .from('master_content_vault')
    .select('track_id, day_number, content_json')
    .in('track_id', ['upsc_ecosystem','tnpsc_ecosystem','ssc_ecosystem'])
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); process.exit(1); }
  rows.push(...data);
  if (data.length < PAGE) break;
  from += PAGE;
}

let touched = 0, edits = 0;
for (const row of rows) {
  let json;
  try { json = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json; } catch { continue; }
  const notes = json?.snapshot?.quick_notes;
  if (!Array.isArray(notes)) continue;
  let rowEdits = 0;
  for (const n of notes) {
    for (const field of ['title','detail']) {
      if (typeof n[field] === 'string') {
        const next = apply(n[field]);
        if (next !== n[field]) { n[field] = next; rowEdits++; }
      }
    }
  }
  if (!rowEdits) continue;
  writeFileSync(`scripts/backup-src-${row.track_id}-${row.day_number}.json`, JSON.stringify(row.content_json));
  const { error } = await supabase.from('master_content_vault').update({ content_json: json }).eq('track_id', row.track_id).eq('day_number', row.day_number);
  if (error) { console.error(`update failed ${row.track_id} ${row.day_number}`, error); continue; }
  touched++; edits += rowEdits;
  console.log(`expanded ${row.track_id} day ${row.day_number} (${rowEdits} field edits)`);
}
console.log(`\nRows touched: ${touched}, total field edits: ${edits}`);
