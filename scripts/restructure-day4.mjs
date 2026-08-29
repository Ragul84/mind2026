// One-time structuring pass for UPSC Day 4 (Right to Equality, Art 12-18).
// Authored by Claude (not an external LLM) — facts unchanged, presentation
// re-shaped into rich blocks the reader already renders (table = comparison,
// timeline = amendments, fact_grid = classification, trap = callout, text = points/chips).
// Backs up the current row first. Run: node --use-system-ca scripts/restructure-day4.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const TRACK = 'upsc_ecosystem', DAY = 4;

// ---- The restructured concept pages (page 0 overview kept as-is) ----
const PAGES = {
  'Article 12 & 13: The Guardians': {
    intro: 'Articles 12 and 13 are the guardians of Fundamental Rights: Article 12 defines who is bound by them, and Article 13 lets courts strike down laws that violate them.',
    blocks: [
      { type: 'fact_grid', items: [
        { label: 'Central', value: 'Government and Parliament' },
        { label: 'State', value: 'State governments and their legislatures' },
        { label: 'Local', value: 'Panchayats and Municipalities' },
        { label: 'Statutory bodies', value: 'LIC, ONGC, SAIL — created by law, carrying out public functions' },
      ] },
      { type: 'text', text: 'Article 13 declares that any law inconsistent with Fundamental Rights is void. This is the explicit basis for Judicial Review, exercised by the Supreme Court under Article 32 and by the High Courts under Article 226.' },
    ],
  },
  'Article 14: Equality Before Law': {
    intro: 'Article 14 guarantees two linked ideas, each borrowed from a different country.',
    blocks: [
      { type: 'table',
        headers: ['Equality before Law', 'Equal Protection of Laws'],
        rows: [
          ['UK origin', 'USA origin'],
          ['Negative concept', 'Positive concept'],
          ['No one is above the law', 'Law treats equals equally'],
        ] },
      { type: 'text', text: 'It permits Reasonable Classification, meaning different rules for different groups on a fair and logical basis, but it bans Class Legislation, meaning arbitrarily singling out a person or group.' },
      { type: 'trap', text: 'Exception: the President and Governors have immunity under Article 361 while in office.' },
    ],
  },
  'Article 15: Prohibition of Discrimination': {
    intro: 'The State cannot discriminate against a citizen on grounds only of religion, race, caste, sex, place of birth.',
    blocks: [
      { type: 'trap', text: 'The word "only" matters: on other grounds, such as residence or income, the State can still treat people differently, for example giving benefits only to residents of a state.' },
      { type: 'text', text: 'Exceptions: the State may make special provisions for women and children, and for socially and educationally backward classes such as SC and ST, under Articles 15(4) and 15(5).' },
    ],
  },
  'Article 16: Equality of Opportunity in Public Employment': {
    intro: 'Equal access to government jobs, with no discrimination on religion, race, caste, sex, descent, place of birth or residence. Three amendments expanded it:',
    blocks: [
      { type: 'timeline', items: [
        { label: '77th Amendment · 1995', value: 'Art 16(4A): reservation in promotions for SC and ST if under-represented' },
        { label: '81st Amendment · 2000', value: 'Art 16(4B): the carry-forward rule for unfilled reserved posts, even beyond 50%' },
        { label: '103rd Amendment · 2019', value: 'Art 16(6): 10% reservation for Economically Weaker Sections (EWS)' },
      ] },
    ],
  },
  'Article 17 & 18: Social Equality': {
    intro: 'Two articles that remove artificial social hierarchy.',
    blocks: [
      { type: 'fact_grid', items: [
        { label: 'Article 17', value: 'Abolition of Untouchability — an absolute right with no exceptions; practising it is a punishable offence' },
        { label: 'Article 18', value: 'Abolition of Titles, the honorary rankings like "Sir" or "Raja"' },
      ] },
      { type: 'trap', text: 'NOT titles: military and academic distinctions such as a Param Vir Chakra or a PhD. National awards like the Bharat Ratna cannot be used as a prefix or suffix to a name.' },
    ],
  },
};

const { data, error } = await sb.from('master_content_vault')
  .select('id, content_json').eq('track_id', TRACK).eq('day_number', DAY).maybeSingle();
if (error) { console.error('fetch error:', error.message); process.exit(1); }
if (!data) { console.error('no Day 4 row'); process.exit(1); }

const payload = typeof data.content_json === 'string' ? JSON.parse(data.content_json) : data.content_json;

// backup
fs.mkdirSync('recovery', { recursive: true });
fs.writeFileSync('recovery/day4-upsc-backup.json', JSON.stringify(payload, null, 2));
console.log('backed up -> recovery/day4-upsc-backup.json');

let changed = 0;
(payload.lesson_pages || []).forEach((pg) => {
  const r = PAGES[pg.title];
  if (r) { pg.intro = r.intro; pg.blocks = r.blocks; changed++; }
});
console.log(`restructured ${changed} pages`);

const newJson = typeof data.content_json === 'string' ? JSON.stringify(payload) : payload;
const { error: upErr } = await sb.from('master_content_vault')
  .update({ content_json: newJson }).eq('id', data.id);
if (upErr) { console.error('update error:', upErr.message); process.exit(1); }
console.log('UPDATED master_content_vault Day 4. Reload the app to see it.');
