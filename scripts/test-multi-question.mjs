/**
 * Tests the exact multi-question paste that was broken.
 * Run: node --use-system-ca scripts/test-multi-question.mjs
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
const FUNCTION_URL = `${env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/miga_stream`;
const ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

async function askMiga(question) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}`, 'apikey': ANON_KEY },
    body: JSON.stringify({ user_id: 'test-user', mode: 'chat', messages: [{ role: 'user', content: question }] }),
  });
  const text = await res.text();
  const tokens = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data:') && !line.includes('[DONE]')) {
      try { const j = JSON.parse(line.slice(5).trim()); if (j.token) tokens.push(j.token); } catch {}
    }
  }
  return tokens.join('');
}

// THE EXACT MULTI-QUESTION PASTE THAT WAS BROKEN
const MULTI_Q = `TNPSC Group 1 (History)
Which Pallava king is credited with introducing rock-cut cave temple architecture in Tamil Nadu?
A) Narasimhavarman I B) Mahendravarman I C) Nandivarman II D) Simhavishnu

UPSC Polity
Which Article of the Constitution deals with the abolition of untouchability?

TNPSC Geography
The soil predominantly found in the Cauvery Delta region of Tamil Nadu is:
A) Black Soil B) Red Soil C) Alluvial Soil D) Laterite Soil

UPSC Environment
What is the primary objective of the Ramsar Convention?

TNPSC Economy
What does the term "Repo Rate" mean in the context of the Reserve Bank of India?

UPSC Modern History
Who founded the Servants of India Society?

Cross-topic (PYQ-style reasoning)
The Fundamental Duties were added to the Constitution based on the recommendations of which committee?`;

console.log('Testing the EXACT multi-question paste that was broken...');
console.log('(This message contains "PYQ-style reasoning" which was the trigger)\n');

const response = await askMiga(MULTI_Q);

const hasPyqset = response.includes('```pyqset') || response.includes('```quiz');
const hasNumberedAnswers = /\*?\*?1[\.\)]/m.test(response) || /answer.*mahendra|mahendra.*answer/i.test(response) || /article\s+17/i.test(response);

console.log('Response (first 600 chars):');
console.log(response.slice(0, 600));
console.log('\n---');

if (hasPyqset) {
  console.log('❌ STILL BROKEN — got pyqset card instead of answering all questions');
} else {
  console.log('✅ FIXED — got prose answers (no pyqset leak)');
  if (hasNumberedAnswers || response.length > 200) {
    console.log('✅ Response looks like multi-question answers (numbered/prose)');
  }
}

// Also verify pyq requests still work
console.log('\n--- Verifying explicit PYQ requests still work ---');
const pyqRes = await askMiga('Give me 3 PYQs from UPSC on History');
const pyqWorks = pyqRes.includes('```pyqset');
console.log(pyqWorks ? '✅ Explicit "PYQs" request still returns pyqset cards' : '❌ BROKEN — explicit PYQ request not returning cards');
console.log('PYQ response preview:', pyqRes.slice(0, 150));
