// Dump FULL text of every block flagged by the sweep, for manual review.
// Read-only. Usage: node scripts/dump-flagged.mjs > scripts/flagged-full.txt
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
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const findings = JSON.parse(readFileSync('scripts/vault-sweep-report.json', 'utf8'));
const keys = [...new Set(findings.map((f) => `${f.track}|${f.day}`))];

for (const key of keys) {
  const [track, day] = key.split('|');
  const { data } = await supabase
    .from('master_content_vault')
    .select('content_json, topic_title')
    .eq('track_id', track)
    .eq('day_number', Number(day))
    .maybeSingle();
  const json = typeof data.content_json === 'string' ? JSON.parse(data.content_json) : data.content_json;
  const flaggedPages = [...new Set(findings.filter((f) => f.track === track && f.day === Number(day)).map((f) => parseInt(f.page)))];
  console.log(`\n████ ${track} day ${day} — ${data.topic_title}`);
  for (const pi of flaggedPages) {
    const page = (json.lesson_pages || [])[pi];
    if (!page) continue;
    console.log(`\n  ── page ${pi}: ${page.title} [type=${page.type}]`);
    if (page.intro) console.log(`  intro: ${page.intro}`);
    (page.blocks || []).forEach((b, bi) => {
      if (b.text) console.log(`  block ${bi} (${b.type}${b.title ? ` "${b.title}"` : ''}): ${b.text}`);
      if (b.items) console.log(`  block ${bi} items: ${JSON.stringify(b.items)}`);
    });
  }
}
