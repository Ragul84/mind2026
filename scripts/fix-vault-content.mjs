// Tier-2 vault fixes:
//   A. Complete 16 truncated blocks (append reviewed text after stripping the
//      trailing ellipsis on the matching block).
//   B. Blank truncated-duplicate intros (intro that just mirrors the block and
//      ends in "...") and explicitly-identified wrong-domain template intros.
// Every touched row backed up to scripts/backup-<track>-<day>.json first.
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

const ELLIPSIS = /(\.\.\.|…)\s*$/;

// track, day, title regex, and the text to append after the cut.
const COMPLETIONS = [
  { t: 'ssc_ecosystem',  d: 1,  re: /divisibility rules/i,         add: ' or a multiple of 11).' },
  { t: 'ssc_ecosystem',  d: 8,  re: /age problems/i,               add: ' constant before solving.' },
  { t: 'upsc_ecosystem', d: 5,  re: /article 21/i,                 add: ' and reasonable.' },
  { t: 'upsc_ecosystem', d: 10, re: /sessions of parliament/i,     add: ' a sitting indefinitely).' },
  { t: 'upsc_ecosystem', d: 12, re: /impeachment/i,                add: ' in his election.' },
  { t: 'upsc_ecosystem', d: 15, re: /financial relations/i,        add: ' borrow on the Consolidated Fund of India; states only within India.' },
  { t: 'upsc_ecosystem', d: 16, re: /44th amendment safeguards/i,  add: '. Made the Emergency proclamation subject to judicial review.' },
  { t: 'upsc_ecosystem', d: 18, re: /73rd amendment/i,             add: ', SCs and STs.' },
  { t: 'upsc_ecosystem', d: 19, re: /procedure for amendment/i,    add: ' majority.' },
  { t: 'upsc_ecosystem', d: 19, re: /elements of basic structure/i, add: ' Elections.' },
  { t: 'upsc_ecosystem', d: 20, re: /right to information/i,       add: ' and economic interests.' },
  { t: 'upsc_ecosystem', d: 31, re: /land revenue/i,              add: ' (uncultivated 5+ years).' },
  { t: 'upsc_ecosystem', d: 57, re: /goi act 1935/i,             add: ' and a Federal Court.' },
  { t: 'upsc_ecosystem', d: 85, re: /energy flow/i,              add: ' you move up trophic levels.' },
  { t: 'upsc_ecosystem', d: 91, re: /ecology recap/i,            add: ' organisms and their environment.' },
  { t: 'upsc_ecosystem', d: 91, re: /species & pollutants/i,     add: ' that harms aquatic life.' },
];

// Wrong-domain template intros to blank (block content carries the real material).
const INTRO_BLANK = [
  { t: 'upsc_ecosystem', d: 9,  re: /procedure for amendment/i },
  { t: 'upsc_ecosystem', d: 14, re: /42nd amendment shift/i },
  { t: 'upsc_ecosystem', d: 15, re: /financial relations/i },
  { t: 'upsc_ecosystem', d: 18, re: /73rd amendment/i },
  { t: 'upsc_ecosystem', d: 19, re: /procedure for amendment/i },
  { t: 'upsc_ecosystem', d: 19, re: /elements of basic structure/i },
  { t: 'upsc_ecosystem', d: 20, re: /right to information/i },
  { t: 'upsc_ecosystem', d: 31, re: /land revenue/i },
  { t: 'upsc_ecosystem', d: 57, re: /goi act 1935/i },
  { t: 'upsc_ecosystem', d: 85, re: /energy flow/i },
  { t: 'upsc_ecosystem', d: 91, re: /ecology recap/i },
  { t: 'upsc_ecosystem', d: 91, re: /species & pollutants/i },
];

const rowKeys = [...new Set([...COMPLETIONS, ...INTRO_BLANK].map((x) => `${x.t}|${x.d}`))];

for (const key of rowKeys) {
  const [track, dayStr] = key.split('|');
  const day = Number(dayStr);
  const { data, error } = await supabase
    .from('master_content_vault')
    .select('content_json')
    .eq('track_id', track).eq('day_number', day).maybeSingle();
  if (error || !data) { console.error(`load failed ${key}`, error); continue; }
  const json = typeof data.content_json === 'string' ? JSON.parse(data.content_json) : data.content_json;
  writeFileSync(`scripts/backup-${track}-${day}.json`, JSON.stringify(json));
  const pages = json.lesson_pages || [];

  for (const fix of COMPLETIONS.filter((x) => x.t === track && x.d === day)) {
    const page = pages.find((p) => fix.re.test(p.title || ''));
    if (!page) { console.warn(`! no page for ${key} ${fix.re}`); continue; }
    let done = false;
    for (const b of page.blocks || []) {
      if (b.text && ELLIPSIS.test(b.text)) {
        const before = b.text;
        b.text = b.text.replace(ELLIPSIS, '') + fix.add;
        console.log(`✔ ${key} "${page.title}"\n    …${before.slice(-46)}  ->  …${b.text.slice(-60)}`);
        done = true;
      }
    }
    if (page.intro && ELLIPSIS.test(page.intro)) page.intro = ''; // drop truncated dup intro
    if (!done) console.warn(`! no truncated block found for ${key} "${page.title}"`);
  }

  for (const fix of INTRO_BLANK.filter((x) => x.t === track && x.d === day)) {
    const page = pages.find((p) => fix.re.test(p.title || ''));
    if (page && page.intro) { page.intro = ''; console.log(`✎ blanked intro: ${key} "${page.title}"`); }
  }

  const { error: upErr } = await supabase
    .from('master_content_vault')
    .update({ content_json: json })
    .eq('track_id', track).eq('day_number', day);
  if (upErr) console.error(`UPDATE FAILED ${key}`, upErr);
}

console.log('\nDone.');
