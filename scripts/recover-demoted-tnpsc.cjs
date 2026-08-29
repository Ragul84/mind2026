require('dotenv').config();
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const PAPERS = ['tnpsc-group2-prelims-2014','tnpsc-group2a-2017-gs','tnpsc-group2-2018-gs','tnpsc-group4-prelims-2025'];
const isDemotedFlag = a => !!a && /(-demoted$|^rejected-|\|garbage-demoted$|\|quality-demoted$)/.test(a);
const stripFlags = a => a.split('|').filter(seg => !/-demoted$/.test(seg) && !/^rejected$/.test(seg)).join('|');
const meetsClean = r =>
  r.question_type==='objective' &&
  Array.isArray(r.options) && r.options.length>=4 &&
  (r.confidence||0)>=0.7 &&
  r.answer_text!=null && String(r.answer_text).trim().length>0 &&
  (r.question_text||'').length>=30;

(async()=>{
  // before count
  const { count: before } = await sb.from('pyq_verified_clean').select('*',{count:'exact',head:true}).eq('exam','TNPSC');
  console.log('clean TNPSC BEFORE:', before);

  const targets = [];
  for (const src of PAPERS){
    const { data, error } = await sb.from('pyq_questions')
      .select('id,source_id,question_number,answer_source,confidence,question_type,answer_text,question_text,options').eq('source_id',src);
    if(error){console.log('read err',src,error.message);continue;}
    data.filter(r=>isDemotedFlag(r.answer_source) && meetsClean(r)).forEach(r=>{
      const restored = stripFlags(r.answer_source);
      targets.push({ id:r.id, source_id:r.source_id, qnum:r.question_number, old:r.answer_source, new:restored });
    });
  }
  console.log('recoverable rows:', targets.length);

  // BACKUP before any mutation
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const backupPath = `recovery/tnpsc-recover-backup-${stamp}.json`;
  fs.writeFileSync(backupPath, JSON.stringify(targets,null,2));
  console.log('backup written:', backupPath);

  // apply updates (per-row, restore answer_source)
  let ok=0, fail=0;
  for (const t of targets){
    const { error } = await sb.from('pyq_questions').update({ answer_source: t.new }).eq('id', t.id);
    if(error){ fail++; console.log('  FAIL', t.id, error.message); } else ok++;
  }
  console.log(`updated: ${ok}  failed: ${fail}`);

  const { count: after } = await sb.from('pyq_verified_clean').select('*',{count:'exact',head:true}).eq('exam','TNPSC');
  console.log('clean TNPSC AFTER:', after, ' (delta +'+(after-before)+')');
})();
