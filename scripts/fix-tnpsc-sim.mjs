// TNPSC "Full GS & Aptitude Simulation" days (broken placeholders) -> real
// revision drills: fill each with a random spread of already-verified good
// questions pooled from the other TNPSC days. No LLM, no fact risk. Backup + revert-safe.
//   node --use-system-ca scripts/fix-tnpsc-sim.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const isBad = (q) => /key (fact|point) about|simulation:/i.test(String(q.question || '')) || typeof q.answer !== 'number' || !Array.isArray(q.options);

const { data } = await sb.from('master_content_vault').select('id, day_number, content_json').eq('track_id', 'tnpsc_ecosystem').order('day_number');

// 1) pool of good, verified questions from the healthy TNPSC days
const pool = [];
const simRows = [];
for (const row of data) {
  const p = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
  const qs = p.quiz?.questions || p.quiz || [];
  const good = qs.filter((q) => !isBad(q));
  if (qs.length && qs.every((q) => isBad(q))) simRows.push(row);       // fully-broken = a sim/placeholder day
  good.forEach((q) => pool.push(q));
}
console.log(`pool of ${pool.length} verified questions; ${simRows.length} simulation days to fill`);
if (pool.length < 12) { console.error('pool too small'); process.exit(1); }

fs.mkdirSync('recovery/tnpsc-sim-backup', { recursive: true });
const pick = (n) => { const s = pool.slice(); for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; } return s.slice(0, n); };

let fixed = 0;
for (const row of simRows) {
  const p = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
  fs.writeFileSync(`recovery/tnpsc-sim-backup/${row.day_number}.json`, JSON.stringify(p.quiz || []));
  const q = pick(12).map((x) => ({ question: x.question, options: x.options, answer: x.answer, correct_index: x.answer, correct_answer: (x.options || [])[x.answer], explanation: x.explanation || '' }));
  if (p.quiz && Array.isArray(p.quiz.questions)) p.quiz.questions = q; else p.quiz = { questions: q };
  const nj = typeof row.content_json === 'string' ? JSON.stringify(p) : p;
  const { error } = await sb.from('master_content_vault').update({ content_json: nj }).eq('id', row.id);
  if (error) console.error('D' + row.day_number, error.message); else { fixed++; console.log('filled D' + row.day_number); }
}
console.log(`\nDONE. filled ${fixed} simulation days with verified revision questions.`);
