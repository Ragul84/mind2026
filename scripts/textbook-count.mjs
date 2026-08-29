// Confirms the Samacheer/NCERT embedding work (the OpenRouter session) is in Supabase.
// node --use-system-ca scripts/textbook-count.mjs
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

async function tryTable(name) {
  const { count, error } = await sb.from(name).select('*', { count: 'exact', head: true });
  return error ? null : count;
}
// find the chunks table
let table = null;
for (const t of ['textbook_chunks', 'textbook_embeddings', 'rag_chunks', 'book_chunks']) {
  const c = await tryTable(t);
  if (c !== null) { table = t; console.log(`TABLE ${t}: ${c} rows`); break; }
}
if (!table) { console.log('no textbook table found under common names'); process.exit(0); }

const { data: sample } = await sb.from(table).select('*').limit(1);
const cols = sample?.[0] ? Object.keys(sample[0]) : [];
console.log('columns:', cols.join(', '));
const boardCol = cols.find(c => /board|source|corpus/i.test(c));
const langCol = cols.find(c => /lang/i.test(c));
async function bump(col, val) {
  const { count } = await sb.from(table).select('*', { count: 'exact', head: true }).ilike(col, `%${val}%`);
  return count ?? 0;
}
if (boardCol) {
  console.log(`\nby ${boardCol}:`);
  for (const b of ['samacheer', 'ncert']) console.log(`  ${b}: ${await bump(boardCol, b)}`);
}
if (langCol) {
  console.log(`\nby ${langCol}:`);
  for (const l of ['english', 'tamil']) console.log(`  ${l}: ${await bump(langCol, l)}`);
}
