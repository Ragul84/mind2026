/**
 * TNPSC ingest via the OFFICIAL TNPSC answer key (authoritative — no guessing).
 *
 * The paper is bilingual (English + Tamil) with 5 printed options (A)-(E) where
 * (E) is always "Answer not known". We store only the 4 real options (A-D) in
 * English; the official key letter (A-D) picks the answer. Questions the board
 * NULLIFIED (key = DROPPED, i.e. "ALL" or multi-letter like A/D) are excluded
 * from the gated set.
 *
 * Inputs (tmp-pyq/tnpsc/):
 *   <base>-questions.json : { "<num>": { "q": "...", "options": ["A","B","C","D"] }, ... }
 *   <base>-key-<V>.json   : { version, answers: { "<num>": "A|B|C|D|DROPPED" } }
 *
 *   node scripts/tnpsc-apply-official-key.cjs --base 2021-group1 --key-version D \
 *        --source-id tnpsc-group1-prelims-2021-gs --year 2021 --paper "Group I Prelims — General Studies" [--apply]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const BASE = arg('base');
const KEYV = arg('key-version', 'D');
const YEAR = parseInt(arg('year', '0'), 10);
const NITEMS = parseInt(arg('items', '200'), 10);
const SOURCE_ID = arg('source-id');
const PAPER = arg('paper', 'Prelims — General Studies');
const DIR = path.resolve(__dirname, '../tmp-pyq/tnpsc');
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!BASE || !YEAR || !SOURCE_ID) { console.error('need --base, --year, --source-id'); process.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const LETTER = { A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 };

// Options are transcribed WITHOUT letter labels; leading "(a)"/"B" here are real
// content (statement references, words like "Both"), so only normalise whitespace.
const cleanOpt = (o) => String(o || '').replace(/\s+/g, ' ').trim();
function optionsClean(opts) {
  if (!Array.isArray(opts) || opts.length !== 4) return false;
  const c = opts.map(cleanOpt);
  for (const o of c) {
    if (o.length < 1) return false;
    const ascii = (o.match(/[\x20-\x7E]/g) || []).length / o.length;
    if (ascii < 0.7) return false;                 // Tamil/OCR garbage leaked in
    if (/answer not known/i.test(o)) return false; // the (E) filler must never be an option
  }
  return true;
}
const cleanStem = (s) => String(s || '').replace(/^\s*\d+\.\s*/, '').replace(/[ \t]+/g, ' ').trim();
function stemClean(q) {
  const s = cleanStem(q);
  if (s.length < 8) return false;
  const ascii = (s.match(/[\x20-\x7E\n]/g) || []).length / s.length;
  return ascii >= 0.85;
}

(async () => {
  const questions = JSON.parse(fs.readFileSync(path.join(DIR, `${BASE}-questions.json`), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(DIR, `${BASE}-key-${KEYV}.json`), 'utf8'));
  const answers = key.answers || key;
  console.log(`TNPSC ${YEAR} ${PAPER} — key version ${KEYV}, transcribed ${Object.keys(questions).length}/${NITEMS}\n`);

  const rows = []; const needsFix = []; const dropped = [];
  for (let n = 1; n <= NITEMS; n++) {
    const letter = answers[String(n)];
    if (letter === 'DROPPED') { dropped.push(n); continue; }
    if (!letter || !(letter in LETTER)) { needsFix.push(`${n}(no-key)`); continue; }
    const q = questions[String(n)];
    if (!q) { needsFix.push(`${n}(missing-Q)`); continue; }
    if (!stemClean(q.q) || !optionsClean(q.options)) { needsFix.push(`${n}(garbled)`); continue; }
    const opts = q.options.map(cleanOpt);
    const idx = LETTER[letter];
    rows.push({
      id: `${SOURCE_ID}-q${n}`, source_id: SOURCE_ID, exam: 'TNPSC', year: YEAR,
      subject: null, topic: null, question_number: String(n),
      question_text: cleanStem(q.q), options: opts, answer_text: opts[idx],
      question_type: 'objective', answer_source: 'official-key', confidence: 0.95,
    });
  }

  console.log(`Ready (clean + official answer): ${rows.length}/${NITEMS}`);
  console.log(`Nullified by TNPSC (excluded): ${dropped.length} -> ${dropped.join(', ')}`);
  console.log(`NEEDS-FIX (${needsFix.length}): ${needsFix.join(', ') || 'none'}`);
  console.log('\nSamples:');
  rows.slice(0, 3).forEach((r) => { console.log(`\n[Q${r.question_number}] ${r.question_text.slice(0, 84)}`); r.options.forEach((o, i) => console.log(`   ${'ABCD'[i]}) ${o.slice(0, 56)}${o === r.answer_text ? '  <-- ANSWER' : ''}`)); });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.resolve(__dirname, '../recovery'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, `../recovery/tnpsc-official-${SOURCE_ID}-${stamp}.json`), JSON.stringify(rows, null, 2));

  if (!APPLY) { console.log('\nDRY RUN. Fill NEEDS-FIX in the -questions.json, then --apply.'); return; }

  const srcRow = { id: SOURCE_ID, exam: 'TNPSC', board: 'TNPSC', year: YEAR, language: 'English',
    title: `TNPSC ${PAPER} ${YEAR} (Version ${KEYV})`,
    file_name: `${BASE}-tnpscjob-compilation.pdf`, file_path: `tmp-pyq/tnpsc/${BASE}-tnpscjob-compilation.pdf`, source_type: 'official-pdf' };
  const sr = await fetch(`${URL}/rest/v1/pyq_sources?on_conflict=id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(srcRow) });
  if (!sr.ok) { console.error(`source insert failed ${sr.status}: ${(await sr.text()).slice(0, 160)}`); process.exit(1); }
  let ok = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const r = await fetch(`${URL}/rest/v1/pyq_questions?on_conflict=id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(batch) });
    if (r.ok) ok += batch.length; else console.warn(`  batch ${i} failed ${r.status}: ${(await r.text()).slice(0, 140)}`);
  }
  console.log(`\nDone. Upserted ${ok} rows for TNPSC ${YEAR} ${PAPER} (official-key).`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
