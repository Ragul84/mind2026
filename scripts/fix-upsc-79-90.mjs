import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const FIXES = {
  85: [
    { re:/Lindeman's 10 percent law says only about one-tenth of energy passes from one trophic level to the next \(Lindeman\): Only 10% of energy is transferred to the next trophic level\./g,
      rep:"Lindeman's 10% Law: Only about 10% of energy is transferred from one trophic level to the next." },
  ],
  86: [
    { re:/Critically Endangered \(Critically Endangered\)/g, rep:'Critically Endangered (CR)' },
    { re:/Endangered \(Endangered\)/g, rep:'Endangered (EN)' },
    { re:/1, 500 endemic vascular plants/g, rep:'1,500 endemic vascular plants' },
  ],
  87: [
    { re:/₹6, 000/g, rep:'₹6,000' },
  ],
  89: [
    { re:/Guiral Doctrine/g, rep:'Gujral Doctrine' },
  ],
};
const apply=(n,fx)=>{ if(typeof n==='string'){let s=n;for(const{re,rep}of fx)s=s.replace(re,rep);return s;} if(Array.isArray(n))return n.map(x=>apply(x,fx)); if(n&&typeof n==='object'){const o={};for(const k of Object.keys(n))o[k]=apply(n[k],fx);return o;} return n; };
for (const [dayStr,fx] of Object.entries(FIXES)) {
  const day=Number(dayStr);
  const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id','upsc_ecosystem').eq('day_number',day).maybeSingle();
  const json=typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  const before=JSON.stringify(json); writeFileSync(`scripts/backup-upsc-${day}.json`,before);
  const counts=fx.map(f=>(before.match(f.re)||[]).length);
  const fixed=apply(json,fx);
  if(JSON.stringify(fixed)===before){console.log(`day ${day}: no change (${counts})`);continue;}
  const { error } = await supabase.from('master_content_vault').update({content_json:fixed}).eq('track_id','upsc_ecosystem').eq('day_number',day);
  console.log(error?error:`upsc day ${day}: applied (${counts.join(',')})`);
}
