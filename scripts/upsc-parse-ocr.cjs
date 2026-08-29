/**
 * Deterministic OCR -> structured questions (NO LLM — aiand/OpenRouter are dead).
 *
 * UPSC prelims OCR has a regular shape: a question-number line "N. ...", stem
 * lines, then four option markers "(a)…(b)…(c)…(d)…" (each may wrap across lines).
 * OCR frequently mangles the marker letter (e.g. reads "(d)" as "(a)", "(c)" as
 * "(c}") — so options are assigned by POSITION (1st=a … 4th=d), never by the
 * OCR'd letter. Question boundaries are tracked by an expected running counter so
 * a statement list "1./2./3." inside a stem is not mistaken for a new question.
 *
 *   node scripts/upsc-parse-ocr.cjs --year 2015
 * Reads tmp-pyq/upsc/<year>-ocr.txt (or extracts text-layer), writes
 * <year>-questions.json. Prints which question numbers are missing/garbled.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };
const YEAR = parseInt(arg('year', '0'), 10);
const NITEMS = parseInt(arg('items', '100'), 10);
const DIR = path.resolve(__dirname, '../tmp-pyq/upsc');
if (!YEAR) { console.error('need --year'); process.exit(1); }

function pdftotextBin() { for (const c of [process.env.PDFTOTEXT, 'C:/Program Files/Git/mingw64/bin/pdftotext.exe', '/mingw64/bin/pdftotext'].filter(Boolean)) { try { if (fs.existsSync(c)) return c; } catch { /* */ } } return 'pdftotext'; }
function loadText() {
  const cache = path.join(DIR, `${YEAR}-ocr.txt`);
  if (fs.existsSync(cache)) return fs.readFileSync(cache, 'utf8');
  const pdf = path.join(DIR, `${YEAR}-gs1-paper.pdf`);
  return execFileSync(pdftotextBin(), ['-layout', pdf, '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
// keep mostly-ASCII (English) lines
const isEnglish = (t) => { if (!t.trim()) return false; const a = (t.match(/[\x20-\x7E]/g) || []).length; return a / t.length > 0.75; };

// canonical option marker at line start? returns true/false
const OPT_RE = /^\s*[\(\{\[fi]?\s*[a-dA-D]\s*[\)\}\]]\s*\S/;   // (a) {b) (c} [d) fa) etc.
const stripOptMarker = (s) => s.replace(/^\s*[\(\{\[fi]?\s*[a-dA-D]\s*[\)\}\]]\s*/, '');
const QNUM_RE = /^\s*(\d{1,3})\س?[.\)]\s+\S/; // "12. ..." (guard against odd chars)
function qnumAtStart(line) { const m = line.match(/^\s*(\d{1,3})[.\)]\s+(\S.*)$/); return m ? { n: parseInt(m[1], 10), rest: m[2] } : null; }

function parse(lines) {
  const questions = {};
  let lastN = 0, cur = null, mode = 'stem';
  const flush = () => {
    if (!cur) return;
    const stem = cur.stemLines.join(' ').replace(/\s+/g, ' ').trim();
    const opts = cur.opts.map((a) => a.join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (stem.length > 10 && opts.length >= 4 && !questions[cur.n]) questions[cur.n] = { number: cur.n, q: stem, options: opts.slice(0, 4), startLine: cur.startLine };
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const qs = qnumAtStart(line);
    if (qs && qs.n > lastN && qs.n <= lastN + 18 && (cur ? cur.opts.length >= 4 : true)) {
      let markers = 0;
      for (let j = i + 1; j < Math.min(lines.length, i + 30); j++) {
        const nx = qnumAtStart(lines[j]);
        if (nx && nx.n > lastN && nx.n <= lastN + 18 && nx.n !== qs.n) break;
        if (OPT_RE.test(lines[j])) markers++;
      }
      if (markers >= 2) { flush(); cur = { n: qs.n, stemLines: [qs.rest], opts: [], startLine: i }; mode = 'stem'; lastN = qs.n; continue; }
    }
    if (!cur) continue;
    if (OPT_RE.test(line) && cur.opts.length < 4) { cur.opts.push([stripOptMarker(line)]); mode = 'options'; }
    else if (mode === 'options' && cur.opts.length && cur.opts.length < 4) cur.opts[cur.opts.length - 1].push(line.trim());
    else if (mode === 'stem') cur.stemLines.push(line.trim());
  }
  flush();
  return questions;
}

const text = loadText();
const lines = text.split('\n').map((l) => l.replace(/\s+$/, '')).filter(isEnglish);
const q = parse(lines);
const nums = Object.keys(q).map(Number).sort((a, b) => a - b);
const missing = []; for (let n = 1; n <= NITEMS; n++) if (!q[n]) missing.push(n);
const arr = nums.map((n) => { const { startLine, ...rest } = q[n]; return rest; });
// Write to a SEPARATE file so the deterministic parse can be MERGED with the LLM
// structuring as a fallback (union maximises coverage toward 100%).
fs.writeFileSync(path.join(DIR, `${YEAR}-questions-parser.json`), JSON.stringify(arr, null, 2));
console.log(`${YEAR}: parsed ${arr.length}/${NITEMS} questions -> ${YEAR}-questions.json`);
console.log(`missing (${missing.length}): ${missing.join(', ') || 'none'}`);

// Dump raw OCR blocks for the missing questions so they can be transcribed by hand.
if (process.argv.includes('--dump-missing') && missing.length) {
  const accepted = nums.map((n) => q[n].startLine).sort((a, b) => a - b);
  const out = [];
  for (const mn of missing) {
    // find the raw OCR region: from the first English line matching "<mn>." to the
    // next accepted question's start (or +40 lines).
    let s = -1;
    for (let i = 0; i < lines.length; i++) { const qq = qnumAtStart(lines[i]); if (qq && qq.n === mn && lines.slice(i, i + 15).some((l) => OPT_RE.test(l))) { s = i; break; } }
    if (s < 0) { out.push(`\n===== Q${mn}: (number not found in OCR — read paper image) =====`); continue; }
    const nextStart = accepted.find((a) => a > s);
    const e = Math.min(lines.length, nextStart != null ? nextStart : s + 40, s + 40);
    out.push(`\n===== Q${mn} =====\n${lines.slice(s, e).join('\n')}`);
  }
  fs.writeFileSync(path.join(DIR, `${YEAR}-missing.txt`), out.join('\n'));
  console.log(`Dumped ${missing.length} raw blocks -> ${YEAR}-missing.txt`);
}
