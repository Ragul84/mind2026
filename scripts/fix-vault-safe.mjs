// Tier-1 SAFE vault fixes only (no factual authoring):
//   1. Expand "Amdt" -> "Amendment" everywhere (readability, zero fact risk).
//   2. tnpsc day 50 "Schedules (12)": complete the list to all 12 (canonical).
// Backs up every touched row to scripts/backup-<track>-<day>.json first.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const env = {};
for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {}
}
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const SCHEDULES_12 = [
  '1: States & Union Territories',
  '2: Salaries & allowances of top constitutional posts',
  '3: Forms of Oaths & Affirmations',
  '4: Allocation of Rajya Sabha seats to states & UTs',
  '5: Administration of Scheduled Areas & Scheduled Tribes',
  '6: Tribal Areas in Assam · Meghalaya · Tripura · Mizoram',
  '7: Union · State & Concurrent Lists',
  '8: 22 Official Languages',
  '9: Laws protected from judicial review (1st Amendment 1951)',
  '10: Anti-defection provisions (52nd Amendment 1985)',
  '11: Panchayats — 29 subjects (73rd Amendment 1992)',
  '12: Municipalities — 18 subjects (74th Amendment 1992)',
].join(', ');

// Expand "Amdt"/"Amdt." -> "Amendment" inside any string of a JSON tree.
const expandAmdt = (node) => {
  if (typeof node === 'string') return node.replace(/\bAmdt\b\.?/g, 'Amendment');
  if (Array.isArray(node)) return node.map(expandAmdt);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[k] = expandAmdt(node[k]);
    return out;
  }
  return node;
};

// Pull all rows
const PAGE = 200; let from = 0; const rows = [];
for (;;) {
  const { data, error } = await supabase
    .from('master_content_vault')
    .select('track_id, day_number, content_json')
    .range(from, from + PAGE - 1);
  if (error) { console.error(error); process.exit(1); }
  rows.push(...data);
  if (data.length < PAGE) break;
  from += PAGE;
}

let amdtCount = 0;
let schedFixed = false;

for (const row of rows) {
  let json;
  try { json = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json; }
  catch { continue; }

  const before = JSON.stringify(json);

  // 2. tnpsc day 50 schedules completion
  if (row.track_id === 'tnpsc_ecosystem' && row.day_number === 50) {
    for (const page of json.lesson_pages || []) {
      if (/schedules?\s*\(12\)/i.test(page.title || '')) {
        for (const b of page.blocks || []) {
          if (b.text && /states\/uts/i.test(b.text)) { b.text = SCHEDULES_12; schedFixed = true; }
        }
      }
    }
  }

  // 1. Amdt expansion (count occurrences for the report)
  const matches = before.match(/\bAmdt\b\.?/g);
  json = expandAmdt(json);

  const after = JSON.stringify(json);
  if (after === before) continue;

  writeFileSync(`scripts/backup-${row.track_id}-${row.day_number}.json`, before);
  const { error: upErr } = await supabase
    .from('master_content_vault')
    .update({ content_json: json })
    .eq('track_id', row.track_id)
    .eq('day_number', row.day_number);
  if (upErr) { console.error(`UPDATE FAILED ${row.track_id} ${row.day_number}:`, upErr); continue; }

  if (matches) amdtCount += matches.length;
  console.log(`fixed ${row.track_id} day ${row.day_number}${matches ? ` (${matches.length}× Amdt)` : ''}`);
}

console.log(`\nDone. "Amdt"→"Amendment": ${amdtCount} occurrences. Schedules list completed: ${schedFixed}`);
