import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
// Count how many rows have quiz questions, and sample one.
const PAGE=200; let from=0; const rows=[];
for(;;){ const {data}=await supabase.from('master_content_vault').select('track_id,day_number,content_json').in('track_id',['upsc_ecosystem','tnpsc_ecosystem','ssc_ecosystem']).range(from,from+PAGE-1); rows.push(...data); if(data.length<PAGE)break; from+=PAGE; }
let withQuiz=0, total=0;
for(const r of rows){ const j=typeof r.content_json==='string'?JSON.parse(r.content_json):r.content_json; const q=j?.quiz?.questions||[]; total++; if(q.length)withQuiz++; }
console.log(`rows=${total}, withQuiz=${withQuiz}`);
const sample = rows.find(r=>{const j=typeof r.content_json==='string'?JSON.parse(r.content_json):r.content_json; return r.track_id==='upsc_ecosystem'&&r.day_number===7&&j?.quiz?.questions?.length;});
if(sample){ const j=typeof sample.content_json==='string'?JSON.parse(sample.content_json):sample.content_json; console.log('\nday7 quiz sample:'); for(const q of j.quiz.questions.slice(0,2)) console.log(JSON.stringify(q,null,2)); }
