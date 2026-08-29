// Are textbook book-back exercises embedded, or only prose? node --use-system-ca scripts/chunk-type-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
const ROOT = process.cwd();
function loadEnv() {
  const env = {};
  for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f); if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const t = line.trim(); if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('='); env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}
const env = loadEnv();
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

// count by chunk_type (probe known/likely values)
const types = ['prose', 'content', 'text', 'exercise', 'bookback', 'book_back', 'book-back', 'questions', 'summary', 'evaluate', 'qa', 'exercises'];
console.log('chunk_type counts:');
for (const t of types) {
  const { count } = await sb.from('textbook_chunks').select('*', { count: 'exact', head: true }).eq('chunk_type', t);
  if (count) console.log(`  ${t}: ${count}`);
}
// distinct-ish: pull 1000 and tally
const { data } = await sb.from('textbook_chunks').select('chunk_type').limit(1000);
const tally = {};
for (const r of (data || [])) tally[r.chunk_type] = (tally[r.chunk_type] || 0) + 1;
console.log('\nchunk_type in a 1000-row sample:', JSON.stringify(tally));

// is there bookback/exercise CONTENT anywhere?
for (const kw of ['book back', 'bookback', 'Evaluate yourself', 'Answer the following', 'Choose the correct']) {
  const { count } = await sb.from('textbook_chunks').select('*', { count: 'exact', head: true }).ilike('content', `%${kw}%`);
  console.log(`content contains "${kw}": ${count ?? 0}`);
}
