// Blank intro-only truncations where the block below carries the full text.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ELLIPSIS = /(\.\.\.|…)\s*$/;
const TARGETS = [
  { t:'ssc_ecosystem', d:3,  re:/digital sum/i },
  { t:'ssc_ecosystem', d:57, re:/divisibility rules/i },
  { t:'upsc_ecosystem',d:10, re:/lok sabha vs rajya sabha/i },
  { t:'upsc_ecosystem',d:47, re:/swadeshi movement/i },
];
for (const x of TARGETS) {
  const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id',x.t).eq('day_number',x.d).maybeSingle();
  const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  writeFileSync(`scripts/backup-${x.t}-${x.d}.json`, JSON.stringify(json));
  const page = (json.lesson_pages||[]).find(p=>x.re.test(p.title||''));
  if (page && page.intro && ELLIPSIS.test(page.intro)) {
    // only blank if a block carries non-truncated text
    const hasFull = (page.blocks||[]).some(b=>b.text && !ELLIPSIS.test(b.text));
    if (hasFull) { page.intro=''; console.log(`✎ ${x.t} d${x.d} "${page.title}" intro blanked`); }
    else console.warn(`! ${x.t} d${x.d} block also truncated — skipped`);
  } else console.warn(`! ${x.t} d${x.d} no truncated intro`);
  const { error } = await supabase.from('master_content_vault').update({content_json:json}).eq('track_id',x.t).eq('day_number',x.d);
  if (error) console.error(error);
}
console.log('done');
