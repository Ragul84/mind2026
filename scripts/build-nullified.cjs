require('dotenv').config();
const fs=require('fs');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const load=f=>JSON.parse(fs.readFileSync('./tmp-pyq/tnpsc/'+f,'utf8'));
const getQ=o=>o&&(o.q||o.question||o.text||o.question_text||'');
const getO=o=>o&&(o.options||o.opts||o.choices||[]);
const L={A:0,B:1,C:2,D:3};
function index(f){const d=load(f);const m={};if(Array.isArray(d))d.forEach(o=>{const n=o.n??o.q_no??o.number??o.question_number;if(n!=null)m[+n]=o;});else for(const[k,v]of Object.entries(d))if(/^\d+$/.test(k))m[+k]=v;return m;}
const maps={};['g1.json','g4.json','branch_partial.json'].forEach(f=>Object.assign(maps,load('nullified/'+f)));
const FILE={'tnpsc-group1-prelims-2019':'g1-2019-parsed.json','tnpsc-group1-prelims-2021-gs':'2021-group1-questions.json','tnpsc-group1-prelims-2022-gs':'2022-group1-questions.json','tnpsc-group1-prelims-2024-gs':'2024-group1-questions.json','tnpsc-acf-prelims-2023-gs':'2023-acf-questions.json','tnpsc-group2-prelims-2024-gs-v2':'2024-group2-questions.json'};
const YEAR=s=>+(s.match(/20\d\d/)[0]);
(async()=>{
  const records=[]; const review=[];
  for(const[src,v]of Object.entries(maps)){
    if(!FILE[src])continue;
    const idx=index(FILE[src]);
    // VALIDATE mapping on 3 clean DB rows (skip parsed/garbled files gracefully)
    const {data:clean}=await sb.from('pyq_questions').select('question_number,answer_text').eq('source_id',src).limit(30);
    let val=0,valChecked=0;
    (clean||[]).slice(0,8).forEach(r=>{const q=idx[+r.question_number];if(!q)return;const o=getO(q);if(!o||o.length<4)return;
      // find db answer in staged options
      const hit=o.some(opt=>String(opt).trim()===String(r.answer_text).trim());valChecked++;if(hit)val++;});
    const mapOK = valChecked>=3 ? (val/valChecked)>=0.8 : null;
    const nums=[...Object.keys(v.multi||{}).map(Number),...(v.all||[]),...Object.keys(v.uncertain||{}).map(Number)];
    let deferredMulti=0;
    for(const n of nums){
      const q=idx[n]; const text=getQ(q); const opts=getO(q);
      if(!(text&&text.length>=8&&Array.isArray(opts)&&opts.length>=4))continue;
      let accepted, kind;
      const mult=(v.multi||{})[n]||(v.uncertain||{})[n];
      if((v.all||[]).includes(n)){ accepted=opts.slice(); kind='grace'; }
      else if(mult){
        // multi-answer needs a VALIDATED letter->option mapping; if unvalidated, defer for safety
        if(mapOK!==true){ deferredMulti++; continue; }
        const idxs=mult.map(l=>L[l]).filter(i=>i!=null&&i<opts.length); accepted=idxs.map(i=>opts[i]); kind='multi';
        if(accepted.length<mult.length){ accepted=opts.slice(); kind='grace-fallback'; } }
      else continue;
      records.push({ id:`${src}-q${n}`, source_id:src, exam:'TNPSC', year:YEAR(src),
        question_number:String(n), question_text:text, options:opts, answer_text:accepted[0],
        accepted_answers:accepted, nullified:true, question_type:'objective',
        answer_source:'official-key-nullified', confidence:0.95, needs_figure:false,
        explanation:`⚠️ This question was officially nullified by TNPSC (${kind==='grace'||kind==='grace-fallback'?'grace mark — all answers accepted':'multiple correct answers accepted'}). Accepted: ${accepted.join(' | ')}.` });
      if(kind!=='grace') review.push(`${src} q${n} [${kind}] "${text.slice(0,50)}" -> ${accepted.join(' / ')}`);
    }
    const builtHere=records.filter(r=>r.source_id===src).length;
    console.log(`${src.padEnd(34)} mapValidate:${mapOK===null?'n/a':mapOK?'PASS':'FAIL'} (${val}/${valChecked})  built:${builtHere}${deferredMulti?`  deferredMulti:${deferredMulti}`:''}`);
  }
  fs.writeFileSync('tmp-pyq/tnpsc/nullified/records.json',JSON.stringify(records,null,2));
  console.log(`\nBUILT ${records.length} records -> tmp-pyq/tnpsc/nullified/records.json`);
  console.log('\n=== multi-answer questions (eyeball correctness) ===');
  review.forEach(r=>console.log('  '+r));
})();
