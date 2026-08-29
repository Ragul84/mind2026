import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
// max run of consecutive same-source cards (lower = better interleaving)
function maxRun(cards){ let max=1,cur=1; for(let i=1;i<cards.length;i++){ if(cards[i].source===cards[i-1].source){cur++;max=Math.max(max,cur);}else cur=1;} return max; }
for (const [t,d] of [['upsc_ecosystem',5],['upsc_ecosystem',7],['tnpsc_ecosystem',6],['ssc_ecosystem',16]]) {
  const { data } = await supabase.from('master_content_vault').select('content_json,topic_title').eq('track_id',t).eq('day_number',d).maybeSingle();
  const j = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
  const cards = j.flashcards||[];
  const sources = [...new Set(cards.map(c=>c.source))];
  console.log(`${t} d${d}: ${cards.length} cards, ${sources.length} topics, longest same-topic run=${maxRun(cards)}`);
}
