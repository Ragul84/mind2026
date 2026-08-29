// Seeds per-state civics lessons into master_content_vault (track_id='civics_lessons').
// Bodies are templated from verified states_meta + states_gk so they're accurate.
// Run: node --use-system-ca scripts/build-civics-seed.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim(); } } catch {} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const META = JSON.parse(readFileSync('assets/data/states_meta.json', 'utf8'));
const GK = JSON.parse(readFileSync('assets/data/states_gk.json', 'utf8'));

function module(key) {
  const m = META[key], g = GK[key];
  if (!m || !g) return null;
  const isUT = m.assembly === 0;
  const govBody = isUT
    ? `${m.state} is a Union Territory administered by the Centre through a Lieutenant Governor / Administrator. It sends ${m.lokSabha} MP${m.lokSabha > 1 ? 's' : ''} to the Lok Sabha and is organised into ${m.districts} district${m.districts > 1 ? 's' : ''}.`
    : `${m.state} elects ${m.assembly} MLAs to its Legislative Assembly (Vidhan Sabha), who in turn choose the Chief Minister. It sends ${m.lokSabha} MPs to the Lok Sabha. The Governor (or Lieutenant Governor) is the constitutional head, and administration runs through ${m.districts} districts.`;
  return {
    scope: 'state',
    state_key: key,
    title: `${m.state}: History & Governance`,
    icon: 'library',
    color: '#0EA5E9',
    blurb: `How ${m.state} came to be and how it is run.`,
    sections: [
      { head: 'Identity & formation', body: `Capital: ${g.capital}. Official language: ${g.language}. ${m.state} took its present form in ${g.formed}. ${g.facts[0]}` },
      { head: 'How it is governed', body: govBody },
      { head: 'Local self-government', body: `Under the 73rd & 74th Constitutional Amendments, ${m.state} runs villages through gram, block and zilla panchayats and towns through municipalities — with reserved seats for women, SCs & STs, and a Gram Sabha (all village voters) in every panchayat.` },
      { head: 'Did you know', body: `${g.facts[1]} ${g.facts[2] || ''}`.trim() },
      { head: 'Why it matters for you', body: `Knowing your state's structure tells you which representative to approach: your local body for civic problems, your MLA for state matters, and your MP for national ones.` },
    ],
  };
}

const keys = Object.keys(META);
await supabase.from('master_content_vault').delete().eq('track_id', 'civics_lessons');
const rows = [];
let day = 1;
for (const k of keys) { const mod = module(k); if (mod) rows.push({ track_id: 'civics_lessons', day_number: day++, topic_title: mod.title, content_json: mod }); }
const { error } = await supabase.from('master_content_vault').insert(rows);
console.log(error ? error : `seeded ${rows.length} per-state civics lessons`);
