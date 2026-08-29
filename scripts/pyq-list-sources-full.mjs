/**
 * Full source enumeration — paginates through ALL rows.
 * Run: node --use-system-ca scripts/pyq-list-sources-full.mjs
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

async function fetchAllForExam(exam) {
  const PAGE = 1000;
  const bySource = {};
  let from = 0;
  while (true) {
    const r = await fetch(
      `${URL}/rest/v1/pyq_questions?select=source_id,answer_source&exam=eq.${exam}&order=source_id.asc`,
      { headers: { ...H, Range: `${from}-${from + PAGE - 1}` } }
    );
    const rows = await r.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      const sid = row.source_id || '(null)';
      if (!bySource[sid]) bySource[sid] = { total: 0, demoted: 0 };
      bySource[sid].total++;
      const src = String(row.answer_source || '').toLowerCase();
      if (src.includes('demoted') || src.includes('rejected')) bySource[sid].demoted++;
    }
    from += PAGE;
    if (rows.length < PAGE) break;
  }
  return bySource;
}

const EXAMS = ['TNPSC', 'UPSC', 'SSC', 'NEET', 'JEE'];
const result = {};

for (const exam of EXAMS) {
  process.stdout.write(`Fetching ${exam}...`);
  const bySource = await fetchAllForExam(exam);
  result[exam] = bySource;
  const total = Object.values(bySource).reduce((s, v) => s + v.total, 0);
  const clean = Object.values(bySource).reduce((s, v) => s + (v.total - v.demoted), 0);
  process.stdout.write(` ${total} rows (${clean} clean) across ${Object.keys(bySource).length} sources\n`);
}

// Print full breakdown
for (const exam of EXAMS) {
  const bySource = result[exam];
  const total = Object.values(bySource).reduce((s, v) => s + v.total, 0);
  console.log(`\n=== ${exam} (${total} rows total) ===`);
  const sorted = Object.entries(bySource).sort((a, b) => (b[1].total - b[1].demoted) - (a[1].total - a[1].demoted));
  for (const [sid, { total, demoted }] of sorted) {
    const clean = total - demoted;
    const flag = demoted > 0 ? ` ⚠️ ${demoted} demoted` : ' ✅';
    console.log(`  [${String(clean).padStart(4)} clean] ${sid}${flag}`);
  }
}

// Save to file for reference
fs.writeFileSync('scripts/pyq-sources-audit.json', JSON.stringify(result, null, 2));
console.log('\nFull data saved to scripts/pyq-sources-audit.json');
