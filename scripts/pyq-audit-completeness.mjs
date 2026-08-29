/**
 * TNPSC GS Completeness Audit
 * 
 * For each exam-year, shows:
 *   - Expected GS question count (by exam type)
 *   - What's clean in DB
 *   - What's demoted in DB  
 *   - What question numbers are MISSING (gap in 1..N range)
 *   - What demoted questions look like (GS or Tamil garbage?)
 *
 * Run: node --use-system-ca scripts/pyq-audit-completeness.mjs
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
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

// Expected GS question count per exam type
// Group I: 200 total, all GS
// Group II: 200 total, GS is Q1-100 (Part A)
// Group IV: 200 total, GS is Q1-100 (Part A)
// ACF: ~200, all GS
const EXPECTED = {
  'tnpsc-group1-prelims-2019':      { label: 'Group I 2019',     expected: 200, gs_range: [1, 200] },
  'tnpsc-group1-prelims-2021-gs':   { label: 'Group I 2021',     expected: 200, gs_range: [1, 200] },
  'tnpsc-group1-prelims-2022-gs':   { label: 'Group I 2022',     expected: 200, gs_range: [1, 200] },
  'tnpsc-group1-prelims-2024-gs':   { label: 'Group I 2024',     expected: 200, gs_range: [1, 200] },
  'tnpsc-group2-prelims-2014':      { label: 'Group II 2014',    expected: 100, gs_range: [1, 100] },
  'tnpsc-group2a-2017-gs':          { label: 'Group IIA 2017',   expected: 100, gs_range: [1, 100] },
  'tnpsc-group2-2018-gs':           { label: 'Group II 2018',    expected: 100, gs_range: [1, 100] },
  'tnpsc-group2-prelims-2022-gs-v2':{ label: 'Group II 2022',    expected: 100, gs_range: [1, 100] },
  'tnpsc-group2-prelims-2024-gs-v2':{ label: 'Group II 2024',    expected: 100, gs_range: [1, 100] },
  'tnpsc-group4-prelims-2019-gs':   { label: 'Group IV 2019',    expected: 100, gs_range: [1, 100] },
  'tnpsc-group4-prelims-2022-gs':   { label: 'Group IV 2022',    expected: 100, gs_range: [1, 100] },
  'tnpsc-group4-prelims-2025':      { label: 'Group IV 2025',    expected: 100, gs_range: [1, 100] },
  'tnpsc-acf-prelims-2023-gs':      { label: 'ACF 2023',         expected: 185, gs_range: [1, 185] },
};

async function fetchSource(sourceId) {
  const PAGE = 500;
  const rows = [];
  let from = 0;
  while (true) {
    const r = await fetch(
      `${URL}/rest/v1/pyq_questions?select=question_number,question_text,answer_source,confidence,needs_figure&source_id=eq.${encodeURIComponent(sourceId)}&order=question_number.asc`,
      { headers: { ...H, Range: `${from}-${from + PAGE - 1}` } }
    );
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    from += PAGE;
    if (batch.length < PAGE) break;
  }
  return rows;
}

function isDemoted(row) {
  const s = String(row.answer_source || '').toLowerCase();
  return s.includes('demoted') || s.includes('rejected');
}

function isTamilGarbage(text) {
  // Tamil OCR signature: lots of semicolon-letter clusters
  const semis = (text.match(/[A-Za-z];[A-Za-z]/g) || []).length;
  const cleanWords = text.split(/\s+/).filter(t => {
    const w = t.replace(/[^A-Za-z]/g, '');
    return w.length >= 3 && /[aeiouy]/i.test(w) && !t.includes(';');
  }).length;
  return semis >= 3 && cleanWords < 5;
}

const report = [];
const fullDetails = {};

for (const [sourceId, meta] of Object.entries(EXPECTED)) {
  process.stdout.write(`Checking ${meta.label}...`);
  const rows = await fetchSource(sourceId);
  
  const clean = rows.filter(r => !isDemoted(r) && r.confidence >= 0.7);
  const demoted = rows.filter(r => isDemoted(r));
  const figureDep = clean.filter(r => r.needs_figure);
  
  // Parse question numbers in DB
  const cleanNums = new Set(clean.map(r => parseInt(r.question_number, 10)).filter(n => !isNaN(n)));
  const demotedNums = new Set(demoted.map(r => parseInt(r.question_number, 10)).filter(n => !isNaN(n)));
  
  // Find missing question numbers in GS range
  const [lo, hi] = meta.gs_range;
  const missing = [];
  for (let n = lo; n <= hi; n++) {
    if (!cleanNums.has(n) && !demotedNums.has(n)) missing.push(n);
  }
  
  // Check demoted: are they Tamil garbage or valid GS that got incorrectly demoted?
  const demotedDetails = demoted.map(r => ({
    qnum: r.question_number,
    isTamil: isTamilGarbage(r.question_text || ''),
    isShort: (r.question_text || '').length < 30,
    preview: String(r.question_text || '').slice(0, 80),
    answer_source: r.answer_source,
  }));
  
  const validDemoted = demotedDetails.filter(d => !d.isTamil && !d.isShort);
  
  const status = {
    sourceId,
    label: meta.label,
    expected: meta.expected,
    clean: clean.length,
    demoted: demoted.length,
    figureDependent: figureDep.length,
    missingFromDB: missing.length,   // never ingested
    validDemoted: validDemoted.length, // demoted but may be recoverable
    gap: meta.expected - clean.length,
    missingNums: missing,
    validDemotedRows: validDemoted.slice(0, 5), // sample
    complete: clean.length >= meta.expected - 2, // allow 2 tolerance for figure-only Qs
  };
  
  report.push(status);
  process.stdout.write(` ${clean.length}/${meta.expected} clean, ${missing.length} never ingested, ${validDemoted.length} recoverable demoted\n`);
}

// Print summary table
console.log('\n' + '='.repeat(90));
console.log('TNPSC GS COMPLETENESS AUDIT');
console.log('='.repeat(90));
console.log(`${'Exam'.padEnd(18)} ${'Exp'.padStart(4)} ${'Clean'.padStart(5)} ${'Demoted'.padStart(7)} ${'NotInDB'.padStart(7)} ${'Recover'.padStart(7)} ${'Status'}`);
console.log('-'.repeat(90));
for (const s of report) {
  const status = s.complete ? '✅ OK' : 
    s.missingFromDB > 0 && s.validDemoted > 0 ? '🔴 GAP + DEMOTED' :
    s.missingFromDB > 0 ? '🔴 GAP (never ingested)' :
    s.validDemoted > 0 ? '🟡 DEMOTED (recoverable?)' : '🟡 CHECK';
  console.log(`${s.label.padEnd(18)} ${String(s.expected).padStart(4)} ${String(s.clean).padStart(5)} ${String(s.demoted).padStart(7)} ${String(s.missingFromDB).padStart(7)} ${String(s.validDemoted).padStart(7)}   ${status}`);
}

// Print detail on recoverable demoted and missing
console.log('\n' + '='.repeat(90));
console.log('DETAIL: RECOVERABLE DEMOTED (may be valid GS questions incorrectly demoted)');
console.log('='.repeat(90));
for (const s of report) {
  if (s.validDemotedRows.length === 0) continue;
  console.log(`\n${s.label}:`);
  for (const d of s.validDemotedRows) {
    console.log(`  Q${d.qnum}: [${d.answer_source}] "${d.preview}"`);
  }
}

console.log('\n' + '='.repeat(90));
console.log('DETAIL: NEVER-INGESTED QUESTION NUMBERS (gap in DB)');
console.log('='.repeat(90));
for (const s of report) {
  if (s.missingNums.length === 0) continue;
  const nums = s.missingNums.length <= 30 
    ? s.missingNums.join(', ')
    : s.missingNums.slice(0, 30).join(', ') + ` ... (+${s.missingNums.length - 30} more)`;
  console.log(`${s.label}: [${nums}]`);
}

// Save full report
fs.writeFileSync('scripts/pyq-completeness-report.json', JSON.stringify(report, null, 2));
console.log('\nFull report saved to scripts/pyq-completeness-report.json');
