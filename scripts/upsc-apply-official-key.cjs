/**
 * UPSC ingest via the OFFICIAL answer key (authoritative — no guessing, no
 * dropping). The official UPSC key is read from the key image directly (vision)
 * into <year>-official-key.json { series, answers:{num:letter} }.
 *
 * For every question 1..N the official letter picks the answer option. A question
 * is emitted only when its options are CLEAN (4 distinct, readable). Questions
 * whose options were OCR-garbled (or missing) are listed as NEEDS-FIX so they can
 * be repaired from the paper image via a patch file <year>-patch.json
 * { "<num>": { "q": "...", "options": ["a","b","c","d"] } }, which overrides the
 * structured question. Goal: all 100 with correct official answers.
 *
 *   node scripts/upsc-apply-official-key.cjs --year 2013            # dry + needs-fix list
 *   node scripts/upsc-apply-official-key.cjs --year 2013 --apply
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const YEAR = parseInt(arg('year', '0'), 10);
const DIR = path.resolve(__dirname, '../tmp-pyq/upsc');
const SOURCE_ID = arg('source-id', `upsc-cse-prelims-${YEAR}-gs1`);
const NITEMS = parseInt(arg('items', '100'), 10);
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!YEAR) { console.error('need --year'); process.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const LETTER = { A: 0, B: 1, C: 2, D: 3, a: 0, b: 1, c: 2, d: 3 };

const cleanOpt = (o) => String(o || '').replace(/^\s*\([a-e]\)\s*/i, '').replace(/\s+/g, ' ').trim();
function optionsClean(opts) {
  if (!Array.isArray(opts) || opts.length !== 4) return false;
  const c = opts.map(cleanOpt);
  for (const o of c) {
    if (o.length < 2) return false;                                   // empty / "a"
    if (/^[a-d]$/i.test(o)) return false;                             // just a letter
    const ascii = (o.match(/[\x20-\x7E]/g) || []).length / o.length;
    if (ascii < 0.75) return false;                                   // OCR/Hindi garbage
    if (/[~�]/.test(o)) return false;                                 // OCR noise chars
    if (/\b[A-Za-z]?[a-z]*[A-Z]{2,}[a-z]*\b/.test(o) && /Cfi|CIT|Cll|fciCfi|IB~|�/.test(o)) return false; // Hindi-OCR clusters
  }
  if (new Set(c.map((x) => x.toLowerCase())).size < 4) return false;   // must be distinct
  return true;
}
const cleanStem = (s) => String(s || '').replace(/^\s*\d+\.\s*/, '').replace(/[ \t]+/g, ' ').trim();
function stemClean(q) {
  const s = cleanStem(q);
  if (s.length < 15) return false;
  const ascii = (s.match(/[\x20-\x7E\n]/g) || []).length / s.length;
  return ascii >= 0.9;
}

(async () => {
  const readJson = (f) => { const p = path.join(DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  const llm = readJson(`${YEAR}-questions.json`) || [];        // LLM structuring (cleanest text)
  const parser = readJson(`${YEAR}-questions-parser.json`) || []; // deterministic OCR parse (fallback)
  const key = JSON.parse(fs.readFileSync(path.join(DIR, `${YEAR}-official-key.json`), 'utf8'));
  const answers = key.answers || key;
  const patch = readJson(`${YEAR}-patch.json`) || {};
  // Merge sources by question number: parser as base, LLM overrides (cleaner),
  // hand-patch overrides all. A number kept only if its options look clean.
  const byNum = {};
  for (const q of parser) if (q && q.number) byNum[String(q.number)] = q;
  for (const q of llm) if (q && q.number && optionsClean(q.options)) byNum[String(q.number)] = q;
  for (const [n, p] of Object.entries(patch)) byNum[n] = { number: Number(n), q: p.q, options: p.options };

  console.log(`UPSC ${YEAR} official-key ingest — series ${key.series || '?'}, llm ${llm.length}, parser ${parser.length}, patched ${Object.keys(patch).length}\n`);

  const rows = []; const needsFix = [];
  for (let n = 1; n <= NITEMS; n++) {
    const q = byNum[String(n)];
    const letter = answers[String(n)];
    if (!letter || !(letter in LETTER)) { needsFix.push(`${n}(no-key)`); continue; }
    if (!q) { needsFix.push(`${n}(missing-Q)`); continue; }
    if (!stemClean(q.q) || !optionsClean(q.options)) { needsFix.push(`${n}(garbled)`); continue; }
    const opts = q.options.map(cleanOpt);
    const idx = LETTER[letter];
    rows.push({
      id: `${SOURCE_ID}-q${n}`, source_id: SOURCE_ID, exam: 'UPSC', year: YEAR,
      subject: null, topic: null, question_number: String(n),
      question_text: cleanStem(q.q), options: opts, answer_text: opts[idx],
      question_type: 'objective', answer_source: 'official-key', confidence: 0.95,
    });
  }

  console.log(`Ready (clean + official answer): ${rows.length}/${NITEMS}`);
  console.log(`NEEDS-FIX (${needsFix.length}): ${needsFix.join(', ') || 'none'}`);
  console.log('\nSamples:');
  rows.slice(0, 3).forEach((r) => { console.log(`\n[Q${r.question_number}] ${r.question_text.slice(0, 84)}`); r.options.forEach((o, i) => console.log(`   ${'abcd'[i]}) ${o.slice(0, 60)}${o === r.answer_text ? '  <-- ANSWER' : ''}`)); });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.resolve(__dirname, '../recovery'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, `../recovery/upsc-official-${SOURCE_ID}-${stamp}.json`), JSON.stringify(rows, null, 2));

  if (!APPLY) { console.log('\nDRY RUN. Fix NEEDS-FIX via <year>-patch.json (read the paper image), then --apply.'); return; }

  const srcRow = { id: SOURCE_ID, exam: 'UPSC', board: 'UPSC', year: YEAR, language: 'English',
    title: `UPSC CSE Prelims ${YEAR} — General Studies Paper I (Series ${key.series || 'A'})`,
    file_name: `${YEAR}-gs1-paper.pdf`, file_path: `tmp-pyq/upsc/${YEAR}-gs1-paper.pdf`, source_type: 'official-pdf' };
  const sr = await fetch(`${URL}/rest/v1/pyq_sources?on_conflict=id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(srcRow) });
  if (!sr.ok) { console.error(`source insert failed ${sr.status}`); process.exit(1); }
  let ok = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const r = await fetch(`${URL}/rest/v1/pyq_questions?on_conflict=id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(batch) });
    if (r.ok) ok += batch.length; else console.warn(`  batch ${i} failed ${r.status}: ${(await r.text()).slice(0, 140)}`);
  }
  console.log(`\nDone. Upserted ${ok} rows for UPSC ${YEAR} (official-key).`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
