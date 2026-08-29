require('dotenv').config();
const fs=require('fs');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
(async()=>{
  const recs=JSON.parse(fs.readFileSync('tmp-pyq/tnpsc/nullified/records.json','utf8'));
  console.log('records to ingest:', recs.length);
  const { count: before } = await sb.from('pyq_verified_clean').select('*',{count:'exact',head:true}).eq('exam','TNPSC');
  console.log('TNPSC clean BEFORE:', before);

  // upsert in chunks (id is PK) - safe to re-run
  let ok=0, fail=0;
  for(let i=0;i<recs.length;i+=50){
    const chunk=recs.slice(i,i+50);
    const { error } = await sb.from('pyq_questions').upsert(chunk, { onConflict:'id' });
    if(error){ fail+=chunk.length; console.log('  chunk FAIL:', error.message); } else ok+=chunk.length;
  }
  console.log(`upserted: ${ok}  failed: ${fail}`);

  const { count: after } = await sb.from('pyq_verified_clean').select('*',{count:'exact',head:true}).eq('exam','TNPSC');
  console.log('TNPSC clean AFTER:', after, ' (delta +'+(after-before)+')');
  // verify nullified rows are visible with accepted_answers
  const { data: sample } = await sb.from('pyq_verified_clean').select('source_id,question_number,accepted_answers,nullified,answer_text').eq('nullified',true).limit(4);
  console.log('\nsample nullified rows now in clean view:');
  (sample||[]).forEach(r=>console.log(`  ${r.source_id} q${r.question_number}: accepted=${JSON.stringify(r.accepted_answers).slice(0,80)}`));
  const { count: nc } = await sb.from('pyq_verified_clean').select('*',{count:'exact',head:true}).eq('nullified',true);
  console.log('\ntotal nullified now serveable:', nc);
})();
