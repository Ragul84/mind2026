import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const subs = [['Kudankulam (Thoothukudi', 'Kudankulam (Tirunelveli']];
const apply=(n)=>{ if(typeof n==='string'){let s=n;for(const[f,r]of subs)s=s.split(f).join(r);return s;} if(Array.isArray(n))return n.map(apply); if(n&&typeof n==='object'){const o={};for(const k of Object.keys(n))o[k]=apply(n[k]);return o;} return n; };
const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id','tnpsc_ecosystem').eq('day_number',79).maybeSingle();
const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
const before=JSON.stringify(json); writeFileSync('scripts/backup-tnpsc-79.json', before);
const count=(before.split('Kudankulam (Thoothukudi').length-1);
const fixed=apply(json);
const { error } = await supabase.from('master_content_vault').update({content_json:fixed}).eq('track_id','tnpsc_ecosystem').eq('day_number',79);
console.log(error?error:`day 79: replaced ${count} occurrence(s) (Thoothukudi -> Tirunelveli)`);
