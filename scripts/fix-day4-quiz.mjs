// Replace UPSC Day 4's generic quiz with real exam-style questions (Claude-authored).
// Each mentions its article so the reader's per-page check matches it correctly.
// node --use-system-ca scripts/fix-day4-quiz.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
const env = {};
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = l.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
  const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
}
const sb = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

const mk = (question, options, answer, explanation) =>
  ({ question, options, answer, correct_index: answer, correct_answer: options[answer], explanation });

const QUESTIONS = [
  mk('Article 13 of the Constitution provides the explicit basis for which of the following?',
    ['Financial Emergency', 'Judicial Review', 'Abolition of untouchability', 'Reservation in promotion'], 1,
    'Article 13 declares that laws inconsistent with Fundamental Rights are void, which is the explicit basis for Judicial Review (Supreme Court under Article 32, High Courts under Article 226).'),
  mk('The President and Governors enjoy immunity from court proceedings while in office. This exception to Article 14 is provided under which article?',
    ['Article 32', 'Article 356', 'Article 361', 'Article 300A'], 2,
    'Article 361 grants the President and state Governors immunity from legal proceedings while they hold office — an exception to the equality guaranteed by Article 14.'),
  mk('Article 15 bars discrimination on grounds ONLY of certain criteria. Which one below is NOT such a ground?',
    ['Religion', 'Residence', 'Caste', 'Place of birth'], 1,
    'The five grounds are religion, race, caste, sex and place of birth. Residence is not among them, so under Article 15 the State may treat people differently based on where they live.'),
  mk('The 10% reservation for Economically Weaker Sections (EWS) under Article 16(6) was introduced by which amendment?',
    ['77th Amendment', '81st Amendment', '86th Amendment', '103rd Amendment'], 3,
    'The 103rd Amendment (2019) inserted Article 16(6), providing 10% reservation in public employment for Economically Weaker Sections.'),
  mk('Under Article 18, which of the following is NOT treated as a "title"?',
    ['A hereditary title of nobility', 'A military distinction such as the Param Vir Chakra', 'A title granted by a foreign state', 'An honorary rank like Raja'], 1,
    'Article 18 abolishes titles, but military and academic distinctions (like the Param Vir Chakra or a PhD) are expressly not considered titles.'),
];

const { data, error } = await sb.from('master_content_vault')
  .select('id, content_json').eq('track_id', 'upsc_ecosystem').eq('day_number', 4).maybeSingle();
if (error || !data) { console.error('fetch failed:', error?.message || 'no row'); process.exit(1); }
const payload = typeof data.content_json === 'string' ? JSON.parse(data.content_json) : data.content_json;

fs.writeFileSync('recovery/day4-quiz-backup.json', JSON.stringify(payload.quiz, null, 2));

if (payload.quiz && Array.isArray(payload.quiz.questions)) payload.quiz.questions = QUESTIONS;
else if (Array.isArray(payload.quiz)) payload.quiz = QUESTIONS;
else payload.quiz = { questions: QUESTIONS };

const newJson = typeof data.content_json === 'string' ? JSON.stringify(payload) : payload;
const { error: upErr } = await sb.from('master_content_vault').update({ content_json: newJson }).eq('id', data.id);
if (upErr) { console.error('update failed:', upErr.message); process.exit(1); }
console.log('Day 4 quiz replaced with 5 exam-style questions (backup: recovery/day4-quiz-backup.json).');
