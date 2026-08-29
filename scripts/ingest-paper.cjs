require('dotenv').config();
const fs=require('fs'), crypto=require('crypto');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const L={A:0,B:1,C:2,D:3};
(async()=>{
  const src='tnpsc-group1-prelims-2017', year=2017;
  // register source (matches verified gate pattern tnpsc-group1)
  await sb.from('pyq_sources').upsert([{id:src,exam:'TNPSC',board:'TNPSC',year,language:'English',title:'TNPSC Group I Prelims 2017 — General Studies (VERSION A)',file_name:'2017-group1-paper.pdf',file_path:'tmp-pyq/tnpsc/papers/2017-group1-paper.pdf',source_type:'official-pdf'}],{onConflict:'id'});
  const recs=JSON.parse(fs.readFileSync('tmp-pyq/tnpsc/papers/2017-group1-batch.json','utf8'));
  const rows=recs.map(r=>{
    const ans=r.o[L[r.key]];
    if(ans==null) throw new Error('bad key '+r.n);
    return { id:`${src}-q${r.n}`, source_id:src, exam:'TNPSC', year, subject:r.subj, topic:null,
      question_number:String(r.n), question_text:r.q, options:r.o, answer_text:ans,
      question_type:'objective', answer_source:'official-key', confidence:0.95, needs_figure:false, nullified:false };
  });
  const { error } = await sb.from('pyq_questions').upsert(rows,{onConflict:'id'});
  if(error){console.log('FAIL',error.message);return;}
  const { count } = await sb.from('pyq_verified_clean').select('*',{count:'exact',head:true}).eq('source_id',src);
  console.log('ingested', rows.length, '| G1 2017 clean now:', count);
  rows.forEach(r=>console.log(`  Q${r.question_number}: ${r.question_text.slice(0,45)}... -> ${r.answer_text}`));
})();
