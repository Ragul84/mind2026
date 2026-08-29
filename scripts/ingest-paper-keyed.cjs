require('dotenv').config();
const fs=require('fs');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const L={A:0,B:1,C:2,D:3};

// Usage: node scripts/ingest-paper-keyed.cjs <batchFile> <keyFile> <source_id> <year> [pdfBasename] [title]
const [,,batchFile,keyFile,src,yearS,pdfArg,titleArg]=process.argv;
const year=+yearS;

(async()=>{
  if(!batchFile||!keyFile||!src||!year){console.log('args: <batchFile> <keyFile> <source_id> <year> [pdfBasename] [title]');return;}
  const grp=(src.match(/group(\d[a-z]?)/i)||[])[1];
  const pdf=pdfArg||`${year}-group${grp||'x'}-paper.pdf`;
  const title=titleArg||`TNPSC Group ${grp?grp.toUpperCase():''} Prelims ${year} — General Studies`;
  await sb.from('pyq_sources').upsert([{id:src,exam:'TNPSC',board:'TNPSC',year,language:'English',title,file_name:pdf,file_path:`tmp-pyq/tnpsc/papers/${pdf}`,source_type:'official-pdf'}],{onConflict:'id'});
  const recs=JSON.parse(fs.readFileSync(batchFile,'utf8'));
  const key=JSON.parse(fs.readFileSync(keyFile,'utf8'));
  const rows=[]; let nullc=0;
  for(const r of recs){
    const k=key[String(r.n)];
    if(k==null){console.log('NO KEY for q'+r.n);continue;}
    if(r.o.length<4){console.log('BAD OPTIONS q'+r.n);continue;}
    const base={ id:`${src}-q${r.n}`, source_id:src, exam:'TNPSC', year, subject:r.subj, topic:null,
      question_number:String(r.n), question_text:r.q, options:r.o,
      question_type:'objective', needs_figure:false };
    if(k==='ALL'){
      nullc++;
      rows.push({...base, answer_text:r.o[0], accepted_answers:r.o.slice(), nullified:true,
        answer_source:'official-key-nullified', confidence:0.95,
        explanation:`⚠️ This question was officially nullified by TNPSC (grace mark — all answers accepted). Accepted: ${r.o.join(' | ')}.`});
    } else if(/^[A-D](\/[A-D]){1,2}$/.test(k) && new Set(k.split('/')).size===k.split('/').length){
      nullc++;
      const acc=k.split('/').map(l=>r.o[L[l]]);
      rows.push({...base, answer_text:acc[0], accepted_answers:acc, nullified:true,
        answer_source:'official-key-nullified', confidence:0.95,
        explanation:`⚠️ This question was officially nullified by TNPSC (multiple correct answers accepted). Accepted: ${acc.join(' | ')}.`});
    } else if(/^[A-D]{2,4}$/.test(k) && new Set(k.split('')).size===k.length){
      // multi-letter concatenated key (e.g. "BC", "AD", "ABCD") — TNPSC grace/multi-answer format
      nullc++;
      if(k.length===4){
        rows.push({...base, answer_text:r.o[0], accepted_answers:r.o.slice(), nullified:true,
          answer_source:'official-key-nullified', confidence:0.95,
          explanation:`⚠️ This question was officially nullified by TNPSC (grace mark — all answers accepted). Accepted: ${r.o.join(' | ')}.`});
      } else {
        const acc=k.split('').map(l=>r.o[L[l]]);
        rows.push({...base, answer_text:acc[0], accepted_answers:acc, nullified:true,
          answer_source:'official-key-nullified', confidence:0.95,
          explanation:`⚠️ This question was officially nullified by TNPSC (multiple correct answers accepted). Accepted: ${acc.join(' | ')}.`});
      }
    } else {
      const ans=r.o[L[k]];
      if(ans==null){console.log('BAD KEY '+k+' q'+r.n);continue;}
      rows.push({...base, answer_text:ans, nullified:false, answer_source:'official-key', confidence:0.95});
    }
  }
  const { error } = await sb.from('pyq_questions').upsert(rows,{onConflict:'id'});
  if(error){console.log('FAIL',error.message);return;}
  const { count } = await sb.from('pyq_verified_clean').select('*',{count:'exact',head:true}).eq('source_id',src);
  console.log(`ingested ${rows.length} rows (${nullc} nullified) | ${src} clean now: ${count}`);
})();
