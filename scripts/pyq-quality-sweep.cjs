/**
 * PYQ content-quality sweep.  (calibrated 2026-07-21)
 *
 * Row-counting says the corpus is clean; reading the rows says a slice is not.
 * The retrieval gate already drops `rejected-*` / `*-demoted`, but the last
 * import only judged rows by metadata, never by the question TEXT. So OCR-mangled
 * Tamil and scrape furniture still pass every count and reach students as
 * "verified" PYQs. This finds them by content.
 *
 * PRECISION OVER RECALL — this was calibrated against the live data, and the
 * whole point is that it must NEVER demote a real question:
 *   - Glyph garbage is defined SURGICALLY as Tamil-transliteration OCR (dense
 *     `letter;letter` semicolon soup) that is NOT salvageable English and NOT
 *     LaTeX. Generic "gibberish"/"vowelless" heuristics were rejected because
 *     they nuke real JEE chemistry/math (`\mathrm`, `C6H5CH`, `\sqrt`) — 7,725
 *     JEE LaTeX rows must survive untouched, and bilingual TNPSC rows keep their
 *     English half.
 *   - Furniture demotes only pure instruction text ("Answer all questions:"),
 *     never a real question that merely carries a furniture prefix.
 *
 * Figures: per the product decision to BUILD figure storage, figure-dependent
 * questions are NOT demoted. They are FLAGGED (needs_figure = true) so a future
 * retrieval/render path can require an image before serving them.
 *
 * Actions:
 *   - HARD (demote): answer_source -> "<orig>|quality-demoted"  (gate excludes)
 *   - FLAG (figure): needs_figure -> true                       (kept, marked)
 *   - SOFT (report): option-bleed, logged for human review, never written
 *
 * DRY RUN by default. Every candidate set is written to recovery/ as JSON before
 * anything changes, per the repo's "back up rows, fix whole-tree" rule.
 *
 *   node --use-system-ca scripts/pyq-quality-sweep.cjs           # dry run
 *   node --use-system-ca scripts/pyq-quality-sweep.cjs --apply   # write
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SR) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };
const APPLY = process.argv.includes('--apply');

// ---------------------------------------------------------------------------
// Calibrated primitives
// ---------------------------------------------------------------------------

// LaTeX / math markers → STEM content. Never a glyph/furniture false positive.
const LATEX_RE = /[\\$]|\\math|\\left|\\right|\\frac|\\sqrt|\\sum|\\int|\\lim|\^\{|_\{|\\begin|\\text\b|\\mathrm/;

// Tamil-transliteration OCR signature: `letter;letter` clusters (the ; stands in
// for a vowel marker). Real English/LaTeX almost never produces these.
function internalSemis(q) {
  return (String(q).match(/[A-Za-z];[A-Za-z]/g) || []).length;
}

// A "real" English word: ascii letters, has a vowel, no embedded semicolon. Used
// to detect a salvageable question inside otherwise-corrupt text.
function cleanEnglishWords(q) {
  return String(q).split(/\s+/).filter((t) => {
    const w = t.replace(/[^A-Za-z]/g, '');
    return w.length >= 3 && /^[A-Za-z]+$/.test(w) && /[aeiouy]/i.test(w) && !/;/.test(t);
  }).length;
}

// ---------------------------------------------------------------------------
// Detectors
// ---------------------------------------------------------------------------

// HARD: Tamil-transliteration OCR that cannot be read and cannot be salvaged.
// Verified against the live corpus: 106 rows, ALL Tamil, 0 non-Tamil, 0 LaTeX.
function glyphGarbage(q) {
  if (LATEX_RE.test(q)) return null;
  if (internalSemis(q) >= 5 && cleanEnglishWords(q) < 5) {
    return `glyph-garbage (${internalSemis(q)} tamil-OCR clusters, no salvageable text)`;
  }
  return null;
}

// HARD: pure instruction/cover text with no real question attached.
const FURNITURE_RE = /\b(answer all (the )?questions|all questions carry equal marks|pattern of the test|general instructions|read the following instructions|do not open|rough work|this (booklet|paper) contains|maximum marks|time allowed)\b/i;
function furniture(q) {
  if (!FURNITURE_RE.test(q) || LATEX_RE.test(q)) return null;
  // Only when the instruction DOMINATES: short, or barely any real words beyond it.
  if (q.trim().length < 70 || cleanEnglishWords(q) < 8) return 'furniture (pure instruction text)';
  return null;
}

// HARD: empty / stub.
function tooShort(q) {
  const t = q.trim();
  return t.length < 15 ? `too-short (${t.length} chars)` : null;
}

// FLAG (not demote): the question references a figure. Conservative — only
// genuine visual references, never statement-list "given below" language.
const FIGURE_RE = /\b(in the (figure|diagram|circuit|graph)|figure (shows|shown|below|above|given)|the (adjoining|given|following|above|below) (figure|diagram|graph|circuit)|shown in the (figure|diagram|circuit|graph|arrangement)|refer to the (figure|diagram|graph)|from the (graph|figure)|as shown in (the )?(figure|fig|diagram))\b/i;
function figureDependent(q) {
  return FIGURE_RE.test(q) ? 'figure-dependent' : null;
}

// SOFT (report only): options merged into the question by an OCR paragraph flatten.
function optionBleed(q, answerText) {
  if (!answerText) return null;
  const pieces = String(answerText).split('|').map((s) => s.trim()).filter((s) => s.length > 6);
  const hits = pieces.filter((p) => q.includes(p)).length;
  return hits >= 2 ? `option-bleed (${hits})` : null;
}

// ---------------------------------------------------------------------------

async function fetchAll() {
  const PAGE = 1000;
  const cols = 'id,exam,year,question_text,options,answer_text,answer_source,needs_figure';
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${URL}/rest/v1/pyq_questions?select=${cols}&order=id.asc`, {
      headers: { ...H, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!r.ok) throw new Error(`fetch failed ${r.status}: ${await r.text()}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

async function patchDemote(row) {
  const src = String(row.answer_source || '');
  if (/-demoted$/.test(src) || /quality-demoted/.test(src)) return 'skipped';
  const r = await fetch(`${URL}/rest/v1/pyq_questions?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ answer_source: `${src}|quality-demoted` }),
  });
  if (!r.ok) throw new Error(`demote ${row.id} failed ${r.status}: ${await r.text()}`);
  return 'demoted';
}

async function patchFigureFlag(row) {
  if (row.needs_figure === true) return 'skipped';
  const r = await fetch(`${URL}/rest/v1/pyq_questions?id=eq.${encodeURIComponent(row.id)}`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=minimal' },
    body: JSON.stringify({ needs_figure: true }),
  });
  if (!r.ok) throw new Error(`flag ${row.id} failed ${r.status}: ${await r.text()}`);
  return 'flagged';
}

(async () => {
  console.log(`PYQ quality sweep — ${APPLY ? 'APPLY (will write)' : 'DRY RUN (no writes)'}\n`);
  const rows = await fetchAll();
  console.log(`Fetched ${rows.length} rows.\n`);

  const demote = [];   // HARD
  const figures = [];  // FLAG
  const soft = [];     // report only
  const tally = {};

  for (const row of rows) {
    const q = String(row.question_text || '');
    const hard = [glyphGarbage(q), furniture(q), tooShort(q)].filter(Boolean);
    const fig = figureDependent(q);
    const sft = [optionBleed(q, row.answer_text)].filter(Boolean);

    for (const r of [...hard, ...(fig ? [fig] : []), ...sft]) {
      const k = r.split(' (')[0];
      tally[k] = (tally[k] || 0) + 1;
    }
    if (hard.length) demote.push({ ...row, _reasons: hard });
    else if (fig) figures.push({ ...row, _reasons: [fig] }); // don't figure-flag a row we're demoting
    if (sft.length && !hard.length) soft.push({ ...row, _reasons: sft });
  }

  console.log('Flag tally:');
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(18)} ${String(v).padStart(6)}`);
  }

  const byExam = (arr) => {
    const m = {};
    arr.forEach((r) => { m[r.exam] = (m[r.exam] || 0) + 1; });
    return JSON.stringify(m);
  };
  console.log(`\nHARD demote: ${demote.length}   by exam ${byExam(demote)}`);
  console.log(`FIGURE flag: ${figures.length}   by exam ${byExam(figures)}`);
  console.log(`SOFT report: ${soft.length}`);

  console.log('\nSample demotions:');
  demote.slice(0, 10).forEach((r) => {
    console.log(`  [${r.exam} ${r.year}] ${r._reasons.join('; ')}`);
    console.log(`     ${JSON.stringify(String(r.question_text).slice(0, 80))}`);
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(__dirname, '../recovery');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `pyq-demote-${stamp}.json`), JSON.stringify(demote, null, 2));
  fs.writeFileSync(path.join(outDir, `pyq-figures-${stamp}.json`), JSON.stringify(figures, null, 2));
  fs.writeFileSync(path.join(outDir, `pyq-soft-${stamp}.json`), JSON.stringify(soft, null, 2));
  console.log(`\nBackups written to recovery/pyq-{demote,figures,soft}-${stamp}.json`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing written. Re-run with --apply.');
    return;
  }

  console.log(`\nDemoting ${demote.length}...`);
  let d = 0;
  for (const row of demote) { if (await patchDemote(row) === 'demoted') d++; }
  console.log(`  demoted ${d}`);

  console.log(`Flagging ${figures.length} figure rows...`);
  let f = 0;
  for (const row of figures) { if (await patchFigureFlag(row) === 'flagged') f++; }
  console.log(`  flagged ${f}`);

  console.log('\nDone. Demoted rows are excluded by the live gate; figure rows are marked needs_figure.');
})().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
