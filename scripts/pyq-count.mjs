// Quick health check of the PYQ oracle's data source: how many real PYQs are in
// pyq_questions, and a small sample. Run: node --use-system-ca scripts/pyq-count.mjs
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

const { count, error } = await sb.from('pyq_questions').select('*', { count: 'exact', head: true });
console.log('pyq_questions total rows:', count ?? '(null)', '| error:', error?.message || 'none');

if (count && count > 0) {
  const { data } = await sb.from('pyq_questions').select('*').limit(2);
  console.log('columns:', data?.[0] ? Object.keys(data[0]).join(', ') : '(none)');
  console.log('sample:', JSON.stringify(data, null, 1).slice(0, 900));
  for (const exam of ['TNPSC', 'UPSC', 'SSC']) {
    const { count: c } = await sb.from('pyq_questions').select('*', { count: 'exact', head: true }).ilike('exam', `%${exam}%`);
    console.log(`  ${exam}: ${c ?? 0}`);
  }
}
