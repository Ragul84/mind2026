/**
 * Step 2 of UPSC ingest: attach CROSS-VERIFIED answers to the structured paper
 * and upsert. Two independent public sources must agree, else the question is
 * dropped (never guessed).
 *
 * Inputs (per year, in tmp-pyq/upsc/):
 *   <year>-questions.json   — my OCR'd+structured paper: [{number,q,options[4]}]
 *   <year>-src1.json        — source 1 as {qnum: "<answer TEXT>"} (set-invariant)
 *   <year>-src2-clearias.txt— source 2 as lines "Qn: A=x B=x C=x D=x" (per series)
 *
 * Method:
 *   1. For each question, fuzzy-match the source-1 answer TEXT to exactly one of
 *      my 4 printed options -> the correct option index (self-validating: the
 *      answer must BE one of the real options). Unmatched/ambiguous -> drop.
 *   2. Source-1 thus yields a per-question letter in MY paper's option order.
 *   3. Detect my paper's booklet SERIES = the ClearIAS series (A/B/C/D) whose
 *      letters agree most with the source-1 letters. High agreement across 100
 *      questions IS the cross-verification that the two sources concur.
 *   4. KEEP a question only when source-1 letter == ClearIAS[mySeries] letter
 *      (ClearIAS "x/y" disputed cells count as agreeing if either matches).
 *      Everything else is dropped.
 *
 *   node scripts/upsc-crossverify-ingest.cjs --year 2013 --source-id upsc-cse-prelims-2013-gs1
 *   ... add --apply to write.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const YEAR = parseInt(arg('year', '0'), 10);
const DIR = path.resolve(__dirname, '../tmp-pyq/upsc');
const SOURCE_ID = arg('source-id', `upsc-cse-prelims-${YEAR}-gs1`);
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!YEAR) { console.error('need --year'); process.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };

const norm = (s) => String(s || '').toLowerCase()
  .replace(/^\s*\([a-e]\)\s*/, '')             // strip a leading "(a) "
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1));

// UPSC answers are very often statement-selection: "1 and 3 only", "Neither 1
// nor 2", "1, 2 and 3", "None". These must be compared by their canonical
// meaning, not token overlap (all such options share the words and/only/etc).
// Returns a canonical key like "d:1,3|m:only" or null if not statement-like.
function canonStatement(s) {
  const t = norm(s);
  const words = t.split(' ');
  const digits = (t.match(/\b[1-6]\b/g) || []).map(Number);
  const hasNeither = /\bneither\b/.test(t) || /\bnone\b/.test(t);
  const hasBoth = /\bboth\b/.test(t);
  const hasOnly = /\bonly\b/.test(t);
  const hasAllofabove = /\ball of the above\b/.test(t);
  // statement-like = mostly digits + connective words, short
  const contentWords = words.filter((w) => !/^[1-6]$/.test(w) && !['and', 'only', 'nor', 'neither', 'none', 'both', 'all', 'of', 'the', 'above'].includes(w));
  const isStmt = (digits.length > 0 && contentWords.length <= 1) || hasNeither || hasAllofabove || (hasBoth && digits.length);
  if (!isStmt) return null;
  const key = `${[...new Set(digits)].sort((a, b) => a - b).join(',')}|${hasNeither ? 'neither' : hasBoth ? 'both' : hasAllofabove ? 'allabove' : hasOnly ? 'only' : 'plain'}`;
  return key;
}

function score(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  const ca = canonStatement(a), cb = canonStatement(b);
  if (ca && cb) return ca === cb ? 1 : 0;   // both statement-like: canonical must match
  if (ca || cb) return 0;                    // one statement, one not: no match
  if (na === nb) return 1;
  // Substring is a strong signal, but ONLY when it is not trivially short.
  if (nb.length >= 8 && (na.includes(nb) || nb.includes(na))) return 0.93;
  // Token overlap is the weakest signal — cap below exact/substring so that an
  // exact match always wins over options that merely share the same words in a
  // different order (e.g. "Mangroves, grasslands, lakes, oceans" permutations).
  const ta = tokens(a), tb = tokens(b);
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  return 0.85 * (inter / Math.max(ta.size, tb.size, 1));
}

const LETTER = ['a', 'b', 'c', 'd'];
function matchOption(options, answerText) {
  let best = -1, bestScore = 0, second = 0;
  options.forEach((o, i) => { const s = score(o, answerText); if (s > bestScore) { second = bestScore; bestScore = s; best = i; } else if (s > second) second = s; });
  if (bestScore === 1 && second < 1) return best;               // unique exact/canonical
  if (bestScore >= 0.6 && (bestScore - second) >= 0.15) return best;
  return -1;
}

function parseClearias(txt) {
  const map = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^Q?(\d{1,3}):\s*A=([a-d](?:\/[a-d])?)\s*B=([a-d](?:\/[a-d])?)\s*C=([a-d](?:\/[a-d])?)\s*D=([a-d](?:\/[a-d])?)/i);
    if (m) map[m[1]] = { A: m[2], B: m[3], C: m[4], D: m[5] };
  }
  return map;
}
const seriesHas = (cell, letter) => String(cell || '').toLowerCase().split('/').includes(letter);

(async () => {
  const questions = JSON.parse(fs.readFileSync(path.join(DIR, `${YEAR}-questions.json`), 'utf8'));
  const src1 = JSON.parse(fs.readFileSync(path.join(DIR, `${YEAR}-src1.json`), 'utf8'));
  const src2jsonPath = path.join(DIR, `${YEAR}-src2.json`);
  const cleariasPath = path.join(DIR, `${YEAR}-src2-clearias.txt`);
  // Preferred: two TEXT sources (both answer-text -> matched to real options).
  // Series-independent and not limited by lossy grid transcription. Falls back
  // to the ClearIAS 4-series grid only when no text source-2 is supplied.
  const useDualText = fs.existsSync(src2jsonPath);
  let rows = []; let disagree = 0, noS2 = 0, unmatched = 0; let mySeries = '?';

  const optCleanOf = (q) => q.options.map((o) => String(o).replace(/^\s*\([a-e]\)\s*/, '').trim());
  const pushRow = (q, idx) => {
    const optClean = optCleanOf(q);
    rows.push({
      id: `${SOURCE_ID}-q${q.number}`, source_id: SOURCE_ID, exam: 'UPSC', year: YEAR,
      subject: null, topic: null, question_number: String(q.number),
      question_text: String(q.q).replace(/^\s*\d+\.\s*/, '').trim(),
      options: optClean, answer_text: optClean[idx],
      question_type: 'objective', answer_source: 'crossverified-key', confidence: 0.9,
    });
  };

  if (useDualText) {
    const src2 = JSON.parse(fs.readFileSync(src2jsonPath, 'utf8'));
    console.log(`UPSC ${YEAR} cross-verify (DUAL TEXT) — questions ${questions.length}, src1 ${Object.keys(src1).length}, src2 ${Object.keys(src2).length}\n`);
    for (const q of questions) {
      const a1 = src1[String(q.number)], a2 = src2[String(q.number)];
      if (!a1 || !a2) { noS2++; continue; }
      const i1 = matchOption(q.options, a1), i2 = matchOption(q.options, a2);
      if (i1 < 0 || i2 < 0) { unmatched++; continue; }
      if (i1 !== i2) { disagree++; continue; }   // sources point to different options
      pushRow(q, i1);
    }
  } else {
    // Legacy single-text + ClearIAS grid path.
    const src2 = parseClearias(fs.readFileSync(cleariasPath, 'utf8'));
    console.log(`UPSC ${YEAR} cross-verify (GRID) — questions ${questions.length}, src1 ${Object.keys(src1).length}, src2 ${Object.keys(src2).length}\n`);
    const s1letter = {}; const optIndex = {};
    for (const q of questions) {
      const at = src1[String(q.number)]; if (!at) { unmatched++; continue; }
      const idx = matchOption(q.options, at); if (idx < 0) { unmatched++; continue; }
      optIndex[q.number] = idx; s1letter[q.number] = LETTER[idx];
    }
    const tally = { A: 0, B: 0, C: 0, D: 0 };
    for (const [n, l] of Object.entries(s1letter)) { const row = src2[n]; if (!row) continue; for (const S of ['A', 'B', 'C', 'D']) if (seriesHas(row[S], l)) tally[S]++; }
    mySeries = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
    console.log(`Source-1 matched: ${Object.keys(s1letter).length}/${questions.length} (unmatched ${unmatched})`);
    console.log(`Series tally: ${JSON.stringify(tally)} -> Series ${mySeries}`);
    for (const q of questions) {
      const l = s1letter[q.number]; if (!l) continue;
      const row = src2[String(q.number)]; if (!row) { noS2++; continue; }
      if (!seriesHas(row[mySeries], l)) { disagree++; continue; }
      pushRow(q, optIndex[q.number]);
    }
  }
  const seen = new Set(); rows = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  console.log(`\nKEPT (both sources agree): ${rows.length}   (dropped: disagree ${disagree}, no-src2 ${noS2}, unmatched ${unmatched})`);
  console.log('\nSamples:');
  rows.slice(0, 4).forEach((r) => { console.log(`\n[Q${r.question_number}] ${r.question_text.slice(0, 90)}`); r.options.forEach((o, i) => console.log(`   ${LETTER[i]}) ${o.slice(0, 66)}${o === r.answer_text ? '  <-- ANSWER' : ''}`)); });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.resolve(__dirname, '../recovery'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, `../recovery/upsc-${SOURCE_ID}-${stamp}.json`), JSON.stringify(rows, null, 2));
  console.log(`\nBackup: recovery/upsc-${SOURCE_ID}-${stamp}.json`);

  if (!APPLY) { console.log('\nDRY RUN — verify samples + series detection. Add --apply to upsert.'); return; }

  const srcRow = { id: SOURCE_ID, exam: 'UPSC', board: 'UPSC', year: YEAR, language: 'English',
    title: `UPSC CSE Prelims ${YEAR} — General Studies Paper I (Series ${mySeries})`,
    file_name: `${YEAR}-gs1-paper.pdf`, file_path: `tmp-pyq/upsc/${YEAR}-gs1-paper.pdf`, source_type: 'official-pdf' };
  const sr = await fetch(`${URL}/rest/v1/pyq_sources?on_conflict=id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(srcRow) });
  if (!sr.ok) { console.error(`source insert failed ${sr.status}: ${(await sr.text()).slice(0, 200)}`); process.exit(1); }
  console.log(`Registered source ${SOURCE_ID}.`);
  let ok = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const batch = rows.slice(i, i + 100);
    const r = await fetch(`${URL}/rest/v1/pyq_questions?on_conflict=id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(batch) });
    if (r.ok) ok += batch.length; else console.warn(`  batch ${i} failed ${r.status}: ${(await r.text()).slice(0, 160)}`);
  }
  console.log(`Done. Upserted ${ok} rows for UPSC ${YEAR}.`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
