const fs=require('fs');
const OCR={
  'tnpsc-group1-prelims-2019':'ocr_g1_2019.json',
  'tnpsc-group4-prelims-2019-gs':'ocr_g4_2019gs.json',
  'tnpsc-group4-prelims-2019-tamil':'ocr_g4_2019tamil.json',
  'tnpsc-group4-prelims-2022-gs':'ocr_g4_2022gs.json',
  'tnpsc-group4-prelims-2022-tamil':'ocr_g4_2022tamil.json',
  'tnpsc-group4-prelims-2025-tamil':'ocr_g4_2025tamil.json',
  'tnpsc-group2-prelims-2024-gs-v2':'ocr_g2_2024gs.json',
  'tnpsc-group2-prelims-2024-tamil':'ocr_g2_2024tamil.json',
};
const maps={};['g1.json','g4.json','branch_partial.json'].forEach(f=>Object.assign(maps,require('../tmp-pyq/tnpsc/nullified/'+f)));
const L={A:0,B:1,C:2,D:3};
const records=[]; let multi=0;
for(const [src,file] of Object.entries(OCR)){
  const v=maps[src]; const ocr=require('../tmp-pyq/tnpsc/nullified/'+file);
  const year=+src.match(/20\d\d/)[0];
  const nums=[...Object.keys(v.multi||{}), ...(v.all||[]).map(String)];
  for(const n of nums){
    const o=ocr[n]; if(!o||!o.q||!Array.isArray(o.opts)||o.opts.length<4){console.log('SKIP',src,n);continue;}
    let accepted,kind;
    if((v.all||[]).includes(+n)){ accepted=o.opts.slice(); kind='grace'; }
    else { const letters=v.multi[n]; accepted=letters.map(l=>o.opts[L[l]]); kind='multi';
      if(accepted.some(x=>x==null)){console.log('BAD MAP',src,n);continue;} multi++; }
    records.push({ id:`${src}-q${n}`, source_id:src, exam:'TNPSC', year, question_number:String(n),
      question_text:o.q, options:o.opts, answer_text:accepted[0], accepted_answers:accepted, nullified:true,
      question_type:'objective', answer_source:'official-key-nullified', confidence:0.95, needs_figure:false,
      explanation:`⚠️ This question was officially nullified by TNPSC (${kind==='grace'?'grace mark — all answers accepted':'multiple correct answers accepted'}). Accepted: ${accepted.join(' | ')}.` });
  }
}
fs.writeFileSync('tmp-pyq/tnpsc/nullified/records_ocr.json',JSON.stringify(records,null,2));
console.log('built',records.length,'OCR records (',multi,'multi)');
