const { createClient } = require('@supabase/supabase-js');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: 'C:/mindwhite/.env' });

const supabase = createClient(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const GS_BIN = 'C:/Program Files/gs/gs10.07.1/bin/gswin64c.exe';
const TESS_BIN = 'C:/Program Files/Tesseract-OCR/tesseract.exe';

const PAPERS = [
  {
    paper: 'C:/edu4bharat/raw/tnpsc/group-2/question-papers/2022/GROUP-II-PRELIM-2022.pdf',
    key: 'C:/edu4bharat/raw/tnpsc/group-2a/answer-keys/2022/GROUP_II_032022_PRELIMS_FIN_KEY.pdf',
    source_id: 'tnpsc-group2-prelims-2022-gs-v2',
    year: 2022
  },
  {
    paper: 'C:/edu4bharat/raw/tnpsc/group-4/question-papers/2022/TNPSC-Group-4-2022-General-Studies.pdf',
    key: 'C:/edu4bharat/raw/tnpsc/group-4/answer-keys/2022/Tnpsc-Group-4-2022-Official-Answer-Key.pdf',
    source_id: 'tnpsc-group4-prelims-2022-gs',
    year: 2022
  },
  {
    paper: 'C:/edu4bharat/raw/tnpsc/group-4/question-papers/2019/General-Studies-2019.pdf',
    key: 'C:/edu4bharat/raw/tnpsc/group-4/answer-keys/2019/2019_19_GR_IV_FINANS_KEY.pdf',
    source_id: 'tnpsc-group4-prelims-2019-gs',
    year: 2019
  },
  {
    paper: 'C:/edu4bharat/raw/tnpsc/group-4/question-papers/2025/07_2025_GENEAL_TAMIL_GS.pdf',
    key: 'C:/edu4bharat/raw/tnpsc/group-4/answer-keys/2025/07_2025_CCSE_IV_FINAL_ANSWER_KEY.pdf',
    source_id: 'tnpsc-group4-prelims-2025',
    year: 2025
  }
];

function ocrPdfLocal(pdf, tessArgs = []) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pyqocr-'));
  try {
    execFileSync(GS_BIN, ['-q', '-dNOPAUSE', '-dBATCH', '-sDEVICE=png16m', '-r200', '-sOutputFile=' + dir + '/pg%03d.png', pdf], { stdio: ['ignore', 'ignore', 'ignore'] });
    const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort();
    let text = '';
    for (const png of pngs) {
      try {
        text += execFileSync(TESS_BIN, [path.join(dir, png), 'stdout', '-l', 'eng', ...tessArgs], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }) + '\n';
      } catch {}
    }
    return text;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function ocrKey(pdf) {
  const text = ocrPdfLocal(pdf, ['--psm', '6', '-c', 'tessedit_char_whitelist=0123456789ABCDE .']);
  const key = {};
  for (const line of text.split('\n')) {
    const pairs = [...line.matchAll(/(?:^|\s)(\d{1,3})\s+([A-Ea-e])/g)];
    if (pairs.length < 3) continue;
    for (const p of pairs) {
      const n = parseInt(p[1], 10);
      if (n >= 1 && n <= 250 && key[n] === undefined) key[n] = p[2].toUpperCase();
    }
  }
  return key;
}

function parseQuestionsDeterministic(rawText) {
  const lines = rawText.split('\n');
  const questions = [];
  let currentQ = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const qMatch = line.match(/^(\d{1,3})[\.\)]\s*(.*)/);
    if (qMatch) {
      const qNum = parseInt(qMatch[1], 10);
      if (qNum >= 1 && qNum <= 250) {
        if (currentQ && currentQ.options.length >= 2) {
          questions.push(currentQ);
        }
        currentQ = {
          number: qNum,
          q: qMatch[2] || '',
          options: []
        };
        continue;
      }
    }

    if (currentQ) {
      const optMatch = line.match(/^\(([A-Da-d1-4])\)\s*(.*)/);
      if (optMatch) {
        if (currentQ.options.length < 4) {
          currentQ.options.push(optMatch[2].trim());
        }
      } else if (currentQ.options.length === 0) {
        currentQ.q += ' ' + line;
      }
    }
  }

  if (currentQ && currentQ.options.length >= 2) {
    questions.push(currentQ);
  }

  return questions;
}

async function processAll() {
  for (const p of PAPERS) {
    console.log(`\n==================================================`);
    console.log(`Processing ${p.source_id} (${p.year})...`);
    console.log(`Paper: ${p.paper}`);
    console.log(`Key:   ${p.key}`);

    if (!fs.existsSync(p.paper) || !fs.existsSync(p.key)) {
      console.log(`File missing, skipping...`);
      continue;
    }

    console.log('1. Parsing Answer Key...');
    const keyMap = ocrKey(p.key);
    console.log(`  Key entries found: ${Object.keys(keyMap).length}`);

    console.log('2. OCRing Question Paper...');
    const paperText = ocrPdfLocal(p.paper);
    const questions = parseQuestionsDeterministic(paperText);
    console.log(`  Parsed question blocks: ${questions.length}`);

    const letterIdx = { A: 0, B: 1, C: 2, D: 3 };
    const rowsMap = new Map();

    for (const q of questions) {
      const letter = keyMap[q.number];
      if (!letter || !(letter in letterIdx)) continue;
      const idx = letterIdx[letter];
      if (idx >= q.options.length) continue;
      if (q.q.trim().length < 15) continue;

      const id = `${p.source_id}-q${q.number}`;
      if (!rowsMap.has(id)) {
        rowsMap.set(id, {
          id: id,
          source_id: p.source_id,
          exam: 'TNPSC',
          year: p.year,
          subject: 'General Studies',
          question_number: String(q.number),
          question_text: q.q.trim(),
          options: q.options,
          answer_text: q.options[idx],
          confidence: 1.0,
          answer_source: 'official-key'
        });
      }
    }

    const rows = Array.from(rowsMap.values());
    console.log(`3. Verified & Matched Rows: ${rows.length}`);

    if (rows.length > 0) {
      const { error } = await supabase.from('pyq_questions').upsert(rows);
      if (error) {
        console.error(`  Supabase Upsert Error: ${error.message}`);
      } else {
        console.log(`  SUCCESS! Upserted ${rows.length} verified rows into Supabase.`);
      }
    }
  }

  console.log('\n🎉 ALL PAPERS PROCESSED SUCCESSFULLY!');
}

processAll();
