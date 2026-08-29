import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ELLIPSIS = /(\.\.\.|…)\s*$/;
const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id','upsc_ecosystem').eq('day_number',57).maybeSingle();
const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
const page = (json.lesson_pages||[]).find(p=>/key features/i.test(p.title||''));
if (!page) { console.error('page not found'); process.exit(1); }
let done=false;
for (const b of page.blocks||[]) if (b.text && ELLIPSIS.test(b.text)) { const before=b.text; b.text=b.text.replace(ELLIPSIS,'')+' and a Federal Court.'; console.log(`✔ …${before.slice(-40)} -> …${b.text.slice(-50)}`); done=true; }
if (page.intro && ELLIPSIS.test(page.intro)) page.intro='';
if (!done){console.error('no truncated block');process.exit(1);}
const { error } = await supabase.from('master_content_vault').update({content_json:json}).eq('track_id','upsc_ecosystem').eq('day_number',57);
console.log(error?error:'updated day 57 GoI Act Key Features');
