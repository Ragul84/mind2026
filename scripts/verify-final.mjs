import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const checks = [
  ['upsc_ecosystem', 7, /schedule|recitation/i],
  ['upsc_ecosystem', 20, /right to information/i],
  ['upsc_ecosystem', 85, /energy flow/i],
  ['upsc_ecosystem', 5, /article 21/i],
];
for (const [t,d,re] of checks) {
  const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id',t).eq('day_number',d).maybeSingle();
  const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  const page = (json.lesson_pages||[]).find(p=>re.test(p.title||''));
  if (!page) { console.log(`\n${t} d${d}: page not found`); continue; }
  console.log(`\n■ ${t} d${d} — "${page.title}"`);
  console.log(`  intro: ${page.intro || '(blank)'}`);
  for (const b of page.blocks||[]) {
    if (b.text) console.log(`  ${b.type}: ${b.text}`);
    if (b.items) console.log(`  ${b.type}: ${b.items.map(i=>i.label+(i.value?': '+i.value:'')).join(' | ')}`);
  }
}
