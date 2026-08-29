// Inspect master_content_vault rows that contain the Schedules recitation blob.
// Read-only. Usage: node scripts/inspect-vault.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = {};
for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {}
}

const url = env.EXPO_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);

const { data, error } = await supabase
  .from('master_content_vault')
  .select('track_id, day_number, topic_title')
  .ilike('topic_title', '%revision%');

if (error) { console.error(error); process.exit(1); }
console.log('Rows with "revision" in title:');
for (const r of data) console.log(`  track=${r.track_id} day=${r.day_number} title=${r.topic_title}`);

// Pull the full content for the Block 1 revision day(s)
for (const r of data.filter((x) => /block\s*1/i.test(x.topic_title || ''))) {
  const { data: row, error: e2 } = await supabase
    .from('master_content_vault')
    .select('content_json')
    .eq('track_id', r.track_id)
    .eq('day_number', r.day_number)
    .maybeSingle();
  if (e2) { console.error(e2); continue; }
  const json = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
  console.log(`\n=== ${r.track_id} day ${r.day_number} ===`);
  const pages = json?.lesson_pages || [];
  pages.forEach((p, i) => {
    const blob = JSON.stringify(p);
    const flag = /recitation|schedule/i.test(blob) ? '  <-- SCHEDULES/RECITATION' : '';
    console.log(`page ${i}: ${p.title}${flag}`);
  });
  // Print any page mentioning schedules in full
  pages.filter((p) => /schedule|recitation/i.test(JSON.stringify(p))).forEach((p) => {
    console.log('\n--- full page ---');
    console.log(JSON.stringify(p, null, 2));
  });
}
