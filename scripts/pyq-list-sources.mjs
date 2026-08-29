/**
 * Lists all distinct source_ids in pyq_questions, grouped by exam.
 * Run: node --use-system-ca scripts/pyq-list-sources.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

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
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Fetch all distinct source_ids per exam
for (const exam of ['TNPSC', 'UPSC', 'SSC', 'NEET', 'JEE']) {
  // Get rows grouped by source_id using a count
  const r = await fetch(
    `${URL}/rest/v1/pyq_questions?select=source_id,exam,answer_source&exam=eq.${exam}&order=source_id.asc`,
    { headers: { ...H, Range: '0-9999' } }
  );
  const rows = await r.json();
  
  // Group by source_id
  const bySource = {};
  for (const row of rows) {
    const sid = row.source_id || '(null)';
    if (!bySource[sid]) bySource[sid] = { count: 0, demoted: 0 };
    bySource[sid].count++;
    if (String(row.answer_source || '').includes('demoted') || String(row.answer_source || '').includes('rejected')) {
      bySource[sid].demoted++;
    }
  }
  
  const sources = Object.entries(bySource)
    .sort((a, b) => b[1].count - a[1].count);
  
  console.log(`\n=== ${exam} (${rows.length} rows, ${sources.length} sources) ===`);
  for (const [sid, { count, demoted }] of sources) {
    const clean = count - demoted;
    const tag = demoted > 0 ? ` [${demoted} demoted, ${clean} clean]` : ` [${count} clean]`;
    console.log(`  ${sid}${tag}`);
  }
}
