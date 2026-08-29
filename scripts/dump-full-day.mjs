import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const TRACK = process.argv[2] || 'tnpsc_ecosystem';
const DAY = Number(process.argv[3] || 6);
const { data } = await supabase.from('master_content_vault').select('topic_title,content_json').eq('track_id',TRACK).eq('day_number',DAY).maybeSingle();
const j = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
const line='='.repeat(70);
console.log(`${line}\n${TRACK}  DAY ${DAY}: ${data.topic_title}\n${line}`);
if(j.lesson_intro) console.log(`\n--- LESSON INTRO ---\n${j.lesson_intro}`);
if(j.snapshot?.exam_hook) console.log(`\n--- EXAM HOOK ---\n${j.snapshot.exam_hook}`);
console.log(`\n--- QUICK NOTES (source of truth) ---`);
for(const n of (j.snapshot?.quick_notes||[])) console.log(`  • ${n.title}\n    ${n.detail}`);
console.log(`\n--- LESSON PAGES (what the reader shows) ---`);
for(const p of (j.lesson_pages||[])){ console.log(`\n  [${p.title}]  (type=${p.type})`); if(p.intro)console.log(`   intro: ${p.intro}`); for(const b of (p.blocks||[])){ if(b.text)console.log(`   ${b.type}${b.title?` "${b.title}"`:''}: ${b.text}`); if(b.items)console.log(`   ${b.type}: ${b.items.map(i=>[i.label,i.value,i.detail].filter(Boolean).join(' = ')).join(' | ')}`); if(b.rows)console.log(`   table ${JSON.stringify(b.headers)}: ${b.rows.map(r=>r.join('/')).join(' | ')}`); } }
console.log(`\n--- FLASHCARD DECK (${(j.flashcards||[]).length} cards, in order) ---`);
(j.flashcards||[]).forEach((c,i)=>console.log(`  ${i+1}. Q: ${c.front}\n     A: ${c.back}`));
console.log(`\n--- QUIZ (${(j.quiz?.questions||[]).length} questions) ---`);
(j.quiz?.questions||[]).forEach((q,i)=>{ console.log(`  Q${i+1}. ${q.question}`); q.options.forEach((o,k)=>console.log(`      ${k===q.answer_index?'[✓]':'[ ]'} ${o}`)); if(q.explanation)console.log(`      explanation: ${q.explanation}`); });
if(j.smart_revision_summary?.one_screen_summary) console.log(`\n--- ONE-SCREEN SUMMARY ---\n${j.smart_revision_summary.one_screen_summary}`);
