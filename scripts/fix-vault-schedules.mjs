// Fix master_content_vault upsc_ecosystem day 7:
//  - Page 1 "Master Schedule Recitation (1–12)": truncated at 11, cryptic
//    shorthand. Replace with the full canonical 12 Schedules, student-readable.
//  - Page 0 overview: remove "Today you will study <topic>" echo, sync labels.
// Backs up the original row to scripts/vault-backup-upsc_ecosystem-7.json first.
// Usage: node scripts/fix-vault-schedules.mjs
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
const TRACK = 'upsc_ecosystem';
const DAY = 7;

const { data: row, error } = await supabase
  .from('master_content_vault')
  .select('content_json')
  .eq('track_id', TRACK)
  .eq('day_number', DAY)
  .maybeSingle();
if (error || !row) { console.error(error || 'row not found'); process.exit(1); }

const json = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
writeFileSync(`scripts/vault-backup-${TRACK}-${DAY}.json`, JSON.stringify(json, null, 2));
console.log('Backup written.');

const pages = json.lesson_pages || [];
const schedPage = pages.find((p) => /schedule recitation/i.test(p.title || ''));
const overviewPage = pages.find((p) => p.type === 'overview');
if (!schedPage) { console.error('Schedules page not found'); process.exit(1); }

// Items are comma-separated "N: text" — keep that contract (the app parser and
// flashcard extractors split on commas), so no commas inside an item.
const SCHEDULES_TEXT = [
  '1: States & Union Territories',
  '2: Salaries & allowances — President · Governors · Speakers · Judges · CAG',
  '3: Forms of Oaths & Affirmations',
  '4: Allocation of Rajya Sabha seats to states & UTs',
  '5: Administration of Scheduled Areas & Scheduled Tribes',
  '6: Tribal Areas in Assam · Meghalaya · Tripura · Mizoram',
  '7: Union · State & Concurrent Lists (division of powers)',
  '8: 22 Official Languages',
  '9: Laws protected from judicial review (1st Amendment 1951)',
  '10: Anti-defection provisions (52nd Amendment 1985)',
  '11: Panchayats — 29 subjects (73rd Amendment 1992)',
  '12: Municipalities — 18 subjects (74th Amendment 1992)',
].join(', ');

const NEW_TITLE = 'The 12 Schedules — Quick Revision';

console.log('\nBEFORE:', JSON.stringify(schedPage, null, 2));

schedPage.title = NEW_TITLE;
schedPage.intro = 'Schedules are tested by number and subject. The 7th Schedule matters most — it holds the Union, State and Concurrent Lists.';
if (schedPage.blocks?.length) {
  schedPage.blocks = [{ type: 'formula', title: NEW_TITLE, text: SCHEDULES_TEXT }];
}

if (overviewPage) {
  overviewPage.intro =
    'This block revises the constitutional foundations from Days 1–6. By the end you should be able to recall the 12 Schedules, the Fundamental Rights article map (12–35), the sources of the Constitution, and the Preamble & citizenship rules.';
  const grid = overviewPage.blocks?.find((b) => b.type === 'fact_grid');
  if (grid?.items) {
    grid.items = grid.items.map((item) =>
      /schedule recitation/i.test(item.label || '') ? { ...item, label: 'The 12 Schedules' } : item
    );
  }
}

console.log('\nAFTER:', JSON.stringify(schedPage, null, 2));

const { error: upErr } = await supabase
  .from('master_content_vault')
  .update({ content_json: json })
  .eq('track_id', TRACK)
  .eq('day_number', DAY);
if (upErr) { console.error('UPDATE FAILED:', upErr); process.exit(1); }

// Verify round-trip
const { data: check } = await supabase
  .from('master_content_vault')
  .select('content_json')
  .eq('track_id', TRACK)
  .eq('day_number', DAY)
  .maybeSingle();
const cj = typeof check.content_json === 'string' ? JSON.parse(check.content_json) : check.content_json;
const verify = (cj.lesson_pages || []).find((p) => p.title === NEW_TITLE);
console.log('\nVERIFIED IN DB:', verify ? 'yes — ' + verify.blocks[0].text.slice(-80) : 'NOT FOUND');
