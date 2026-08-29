import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
let badIndex = 0, dupOpt = 0, checked = 0, trunc = 0;
const PAGE=200; let from=0; const rows=[];
for(;;){ const {data}=await supabase.from('master_content_vault').select('track_id,day_number,content_json').in('track_id',['upsc_ecosystem','tnpsc_ecosystem','ssc_ecosystem']).range(from,from+PAGE-1); rows.push(...data); if(data.length<PAGE)break; from+=PAGE; }
for(const r of rows){ const j=typeof r.content_json==='string'?JSON.parse(r.content_json):r.content_json; const qs=j?.quiz?.questions||[]; for(const q of qs){ checked++; if(q.source!=='generated_from_study_cards')continue; if(!(q.answer_index>=0&&q.answer_index<q.options.length))badIndex++; if(new Set(q.options).size!==q.options.length)dupOpt++; if(/\.\.\.|…/.test(q.question+JSON.stringify(q.options)))trunc++; } }
console.log(`questions checked: ${checked}, bad answer_index: ${badIndex}, duplicate options: ${dupOpt}, contains ellipsis: ${trunc}`);
// sample day 7
const s = rows.find(r=>r.track_id==='upsc_ecosystem'&&r.day_number===7);
const j=typeof s.content_json==='string'?JSON.parse(s.content_json):s.content_json;
console.log('\nday 7 sample:');
for(const q of j.quiz.questions.slice(0,3)){
  console.log(`\nQ: ${q.question}`);
  q.options.forEach((o,i)=>console.log(`   ${i===q.answer_index?'✓':' '} ${o}`));
}
