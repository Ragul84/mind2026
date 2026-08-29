// Prove the fixed generator produces complete, untruncated content from the
// (good) quick_notes source — without writing anything. Re-implements the two
// key functions to mirror the .cjs and runs them on day 7's source.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
const env = {};
for (const f of ['.env', '.env.local']) { try { for (const l of readFileSync(f,'utf8').split(/\r?\n/)){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)env[m[1]]=m[2].trim();}}catch{} }
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const clean = (v) => String(v||'').replace(/\s+:/g,':').replace(/\s+/g,' ').trim();
const sentences = (t) => clean(t).split(/(?<=[.!?])\s+/).map(clean).filter(Boolean);
function compact(value, max = 600) {       // ← the fixed version
  const text = clean(value);
  if (text.length <= max) return text;
  const parts = sentences(text);
  let out = '';
  for (const part of parts) { if (out && (out.length+part.length+1) > max) break; out = out ? `${out} ${part}` : part; }
  return out || parts[0] || text;
}

const { data } = await supabase.from('master_content_vault').select('content_json').eq('track_id','upsc_ecosystem').eq('day_number',7).maybeSingle();
const json = typeof data.content_json==='string'?JSON.parse(data.content_json):data.content_json;
const note = (json.snapshot?.quick_notes||[]).find(n=>/recitation|schedule/i.test(n.title||''));
const out = compact(note.detail, 220); // even with the old tight budget passed
console.log('Source detail length:', note.detail.length);
console.log('Generator output (fixed compact):');
console.log(out);
console.log('\nEnds with ellipsis?', /(\.\.\.|…)\s*$/.test(out));
console.log('Includes 12th schedule?', /12\s*:/.test(out));
