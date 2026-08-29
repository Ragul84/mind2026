require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Usage: node scripts/ocr-paper.cjs <imageDir> <startPage> <endPage> <startQ> <outBatchFile>
// imageDir must contain paper_pNN.png files (2 questions per page, English on top half, Tamil below)
const [,,imageDir,startPageS,endPageS,startQS,outFile] = process.argv;
const startPage = +startPageS, endPage = +endPageS, startQ = +startQS;

const API_KEY = (process.env.OPENROUTER_API_KEYS || '').split(',')[0]?.trim() || process.env.OPENROUTER_API_KEY;
const MODEL = 'google/gemini-2.5-flash';

const PROMPT = `You are transcribing an English-medium TNPSC exam page (bilingual paper; ONLY transcribe the ENGLISH portion, ignore Tamil text below it).

Extract every numbered MCQ visible on this page. For each question return:
- n: the question number (integer)
- subj: best-guess subject label (General Science, History, Indian Polity, Indian Economy, Indian Geography, Aptitude & Mental Ability, Current Affairs, Science & Technology, Indian Culture)
- q: the exact English question text (preserve wording verbatim; for "Match the following" questions inline the list items and options like "(a) X (b) Y | 1. P 2. Q")
- o: array of exactly 4 option strings in A,B,C,D order as printed (if the page uses a 2-column layout with A/C on the left and B/D on the right, still output them in A,B,C,D order)

Do NOT include any answer/correct option — only the question and options, verbatim from the page. Do NOT guess or invent text you cannot read clearly; if a question is unreadable, omit it entirely.

Return ONLY a JSON array, no markdown fences, no commentary. Example:
[{"n":12,"subj":"General Science","q":"...","o":["...","...","...","..."]}]`;

async function ocrPage(imgPath) {
  const b64 = fs.readFileSync(imgPath).toString('base64');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
      temperature: 0,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API error ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  let text = data.choices?.[0]?.message?.content || '';
  text = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(text);
  } catch (e) {
    console.log(`  PARSE FAIL on ${path.basename(imgPath)}: ${e.message}`);
    console.log('  raw:', text.slice(0, 500));
    return [];
  }
}

(async () => {
  if (!imageDir || !startPage || !endPage || !startQ || !outFile) {
    console.log('args: <imageDir> <startPage> <endPage> <startQ> <outBatchFile>');
    return;
  }
  if (!API_KEY) { console.log('OPENROUTER_API_KEY missing from .env'); return; }

  const all = [];
  for (let p = startPage; p <= endPage; p++) {
    const fname = `paper_p${String(p).padStart(2, '0')}.png`;
    const fpath = path.join(imageDir, fname);
    if (!fs.existsSync(fpath)) { console.log(`  SKIP missing ${fname}`); continue; }
    process.stdout.write(`  OCR ${fname} ... `);
    try {
      const qs = await ocrPage(fpath);
      const kept = qs.filter(q => q.n >= startQ && Array.isArray(q.o) && q.o.length === 4 && q.q);
      all.push(...kept);
      console.log(`${kept.length} questions`);
    } catch (e) {
      console.log('ERROR', e.message);
    }
  }
  all.sort((a, b) => a.n - b.n);
  fs.writeFileSync(outFile, JSON.stringify(all, null, 2));
  console.log(`\nWrote ${all.length} questions to ${outFile}`);
  console.log('Q#s:', all.map(q => q.n).join(','));
})();
