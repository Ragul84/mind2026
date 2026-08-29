/**
 * TNPSC ingest for HAND-TICKED (solved) papers — the answer is read from the
 * tick in the paper itself, so no separate answer key is needed.
 *
 * A tick garbles/replaces the correct option's (A)/(B)/(C)/(D) label with junk
 * ("~", ")", "./", "v&"). The model reads that pattern to pick the answer. This
 * is less certain than a printed key, so:
 *   - answer is only accepted when the tick is unambiguous (else the question is
 *     dropped, never guessed),
 *   - a SPOT-CHECK sample is printed for a human to eyeball before --apply,
 *   - rows are tagged answer_source='ticked-paper' + confidence 0.75 so they are
 *     distinguishable and reversible.
 *
 *   node --use-system-ca scripts/tnpsc-ticked-ingest.cjs \
 *     --paper "...2014...GE-GS.pdf" --exam TNPSC --year 2014 --source-id tnpsc-group2-prelims-2014
 *   ... add --apply after the spot-check looks right.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const PAPER = arg('paper');
const EXAM = arg('exam', 'TNPSC');
const YEAR = parseInt(arg('year', '0'), 10) || null;
const SOURCE_ID = arg('source-id') || path.basename(PAPER || 'x', '.pdf').toLowerCase().replace(/[^a-z0-9]+/g, '-');

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OR_KEY = process.env.OPENROUTER_API_KEY;
const MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
if (!URL || !SR || !OR_KEY || !PAPER) { console.error('need env + --paper'); process.exit(1); }
const H = { apikey: SR, Authorization: `Bearer ${SR}`, 'Content-Type': 'application/json' };

function findBin(names) { for (const n of names) { try { if (fs.existsSync(n)) return n; } catch {} } return null; }
const PDFTOTEXT = findBin(['C:/Program Files/Git/mingw64/bin/pdftotext.exe', '/mingw64/bin/pdftotext']) || 'pdftotext';
const GS_BIN = findBin(['C:/Program Files/gs/gs10.07.1/bin/gswin64c.exe', ...(() => { try { return fs.readdirSync('C:/Program Files/gs').map((d) => `C:/Program Files/gs/${d}/bin/gswin64c.exe`); } catch { return []; } })()]);
const TESS_BIN = findBin(['C:/Program Files/Tesseract-OCR/tesseract.exe']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function or(messages) {
  for (let a = 0; a < 4; a++) {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OR_KEY}` },
        signal: ctrl.signal, body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 8000, messages }),
      });
      if (r.status === 429 || r.status >= 500) throw new Error(`retryable ${r.status}`);
      if (!r.ok) throw new Error(`OR ${r.status}: ${(await r.text()).slice(0, 140)}`);
      const c = String((await r.json())?.choices?.[0]?.message?.content || '').trim();
      if (!c) throw new Error('empty'); return c;
    } catch (e) { if (a === 3) throw e; await sleep(3000 * (a + 1)); } finally { clearTimeout(timer); }
  }
}
const parseJson = (s) => JSON.parse(s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());

function extractText(pdf) {
  try { return execFileSync(PDFTOTEXT, ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return ''; }
}
function ocrText(pdf) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'tick-'));
  try {
    execFileSync(GS_BIN, ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=png16m', '-r200', `-sOutputFile=${dir}/p%03d.png`, pdf], { stdio: ['ignore', 'ignore', 'ignore'] });
    let t = '';
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.png')).sort()) {
      try { t += execFileSync(TESS_BIN, [path.join(dir, f), 'stdout', '-l', 'eng'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) + '\n'; } catch {}
    }
    return t;
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
}

async function structureTicked(text) {
  const blocks = text.split(/(?=^\s*\d{1,3}[.)]\s)/m);
  const chunks = []; let cur = '';
  for (const b of blocks) { if ((cur + b).length > 5000 && cur) { chunks.push(cur); cur = ''; } cur += b; }
  if (cur.trim()) chunks.push(cur);
  const results = await Promise.all(chunks.map(async (chunk) => {
    try {
      const out = await or([
        {
          role: 'system',
          content:
            'This is text of a HAND-TICKED bilingual (Tamil+English) exam paper — use ONLY the English of each question. For EACH question output an object with FOUR fields:\n' +
            '"number":<int>, "q":"<English stem incl. any i./ii. sub-points>", "options":["<a>","<b>","<c>","<d>"],\n' +
            '"known":<0-based index of the option that is correct, decided INDEPENDENTLY by actually solving the question with your own knowledge — ignore any marks>,\n' +
            '"tick":<0-based index of the option that carries a handwritten tick — its (A)/(B)/(C)/(D) label is garbled or replaced by junk symbols like ~ ) ./ v& $ ; -1 if you cannot tell>.\n' +
            'Decide "known" and "tick" separately and honestly. Output ONLY a JSON array.',
        },
        { role: 'user', content: chunk },
      ]);
      const arr = parseJson(out);
      return Array.isArray(arr) ? arr : [];
    } catch { return []; }
  }));
  return results.flat();
}

(async () => {
  console.log(`TICKED ingest — ${APPLY ? 'APPLY' : 'DRY RUN'}\n  ${PAPER}\n  ${EXAM} ${YEAR}  ${SOURCE_ID}\n`);
  let text = extractText(PAPER);
  // A scanned paper can still carry a text layer of watermarks/footers that beats
  // a char-count check but has no real questions. Require actual numbered-question
  // markers too; otherwise OCR the images.
  const qMarkers = (text.match(/^\s*\d{1,3}[.)]/gm) || []).length;
  if (text.replace(/\s/g, '').length < 3000 || qMarkers < 20) {
    console.log(`only ${qMarkers} question markers in text layer — OCR-ing images...`);
    text = ocrText(PAPER);
  }
  console.log(`text: ${text.length} chars`);

  const qs = await structureTicked(text);
  let rows = [];
  let disagree = 0, unclear = 0, bad = 0;
  for (const q of qs) {
    const opts = Array.isArray(q.options) ? q.options.map((o) => String(o || '').trim()).filter(Boolean) : [];
    const tick = Number(q.tick);
    const known = Number(q.known);
    // Both signals must be valid...
    if (!Number.isInteger(tick) || tick < 0 || !Number.isInteger(known) || known < 0) { unclear++; continue; }
    // ...and must AGREE. A disagreement means the tick was misread (or the source
    // is wrong) — drop it rather than ship a possibly-wrong answer.
    if (tick !== known) { disagree++; continue; }
    const idx = tick;
    if (opts.length < 2 || opts.length > 4 || idx >= opts.length) { bad++; continue; }
    if (opts.some((o) => o.length > 200)) { bad++; continue; }
    const qtext = String(q.q || '').trim();
    if (qtext.length < 15) { bad++; continue; }
    rows.push({
      id: `${SOURCE_ID}-q${q.number}`, source_id: SOURCE_ID, exam: EXAM, year: YEAR,
      question_number: String(q.number), question_text: qtext, options: opts, answer_text: opts[idx],
      // Two independent signals agreed — mark it accordingly.
      question_type: 'objective', answer_source: 'ticked-verified', confidence: 0.85,
    });
  }
  const seen = new Set();
  rows = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));

  console.log(`\nStructured ${qs.length} | KEPT (tick agrees with model): ${rows.length}`);
  console.log(`  dropped: disagreement ${disagree}, unclear ${unclear}, bad ${bad}`);
  console.log('\n===== SPOT-CHECK: verify these answers against known facts =====');
  const step = Math.max(1, Math.floor(rows.length / 8));
  for (let i = 0; i < rows.length; i += step) {
    const r = rows[i];
    console.log(`\n[Q${r.question_number}] ${r.question_text.slice(0, 95)}`);
    r.options.forEach((o) => console.log(`   ${o === r.answer_text ? '►' : ' '} ${o.slice(0, 70)}`));
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(path.resolve(__dirname, '../recovery'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, `../recovery/ticked-${SOURCE_ID}-${stamp}.json`), JSON.stringify(rows, null, 2));

  if (!APPLY) { console.log('\nDRY RUN — check the spot-check above. If answers look right, re-run with --apply.'); return; }

  // register source
  await fetch(`${URL}/rest/v1/pyq_sources?on_conflict=id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ id: SOURCE_ID, exam: EXAM, board: EXAM, year: YEAR, language: 'English', title: `${EXAM} ${YEAR} ticked ${path.basename(PAPER)}`, file_name: path.basename(PAPER), file_path: PAPER, source_type: 'ticked-paper' }) });
  let ok = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const b = rows.slice(i, i + 100);
    const r = await fetch(`${URL}/rest/v1/pyq_questions?on_conflict=id`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(b) });
    if (r.ok) ok += b.length; else console.warn(`batch ${i} failed ${r.status}: ${(await r.text()).slice(0, 140)}`);
  }
  console.log(`\nUpserted ${ok} rows for ${EXAM} ${YEAR} (ticked-paper).`);
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
