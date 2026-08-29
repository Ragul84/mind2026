/**
 * Direct test of miga_stream edge function.
 * Verifies:
 *   1. Concept questions → prose answer (NOT pyqset cards)
 *   2. Explicit PYQ request → pyqset cards (still works)
 *   3. "PYQ-style reasoning" phrase → prose (no longer hijacked)
 *
 * Run: node --use-system-ca scripts/test-miga-stream.mjs
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
const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/miga_stream`;

async function askMiga(question, label) {
  const body = JSON.stringify({
    user_id: 'test-user',
    mode: 'chat',
    messages: [{ role: 'user', content: question }],
  });

  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ANON_KEY}`,
      'apikey': ANON_KEY,
    },
    body,
  });

  if (!res.ok) {
    return `[HTTP ${res.status}: ${await res.text()}]`;
  }

  // SSE stream — collect tokens
  const text = await res.text();
  const tokens = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('data:') && !line.includes('[DONE]')) {
      try {
        const json = JSON.parse(line.slice(5).trim());
        if (json.token) tokens.push(json.token);
      } catch {}
    }
  }
  return tokens.join('');
}

const TESTS = [
  {
    label: '1. CONCEPT — Pallava king (should be prose, NOT pyqset)',
    question: 'TNPSC Group 1 (History)\nWhich Pallava king is credited with introducing rock-cut cave temple architecture in Tamil Nadu?\nA) Narasimhavarman I\nB) Mahendravarman I\nC) Nandivarman II\nD) Simhavishnu',
    expectPyqset: false,
  },
  {
    label: '2. CONCEPT — Abolition of untouchability (should be prose)',
    question: 'UPSC Polity\nWhich Article of the Constitution deals with the abolition of untouchability?',
    expectPyqset: false,
  },
  {
    label: '3. CONCEPT — Repo Rate (should be prose)',
    question: 'TNPSC Economy\nWhat does the term "Repo Rate" mean in the context of the Reserve Bank of India?',
    expectPyqset: false,
  },
  {
    label: '4. CONCEPT — PYQ-style reasoning phrase (should be prose, not triggered by "PYQ")',
    question: 'Cross-topic (PYQ-style reasoning)\nThe Fundamental Duties were added to the Constitution based on the recommendations of which committee?',
    expectPyqset: false,
  },
  {
    label: '5. CONCEPT — Why does sky appear blue (should be prose)',
    question: 'Why does the sky appear blue during the daytime?',
    expectPyqset: false,
  },
  {
    label: '6. REAL PYQ REQUEST — should return pyqset cards (still working)',
    question: 'Give me 3 previous year questions from TNPSC on History',
    expectPyqset: true,
  },
  {
    label: '7. REAL PYQ REQUEST — UPSC polity PYQs (should return pyqset)',
    question: 'Give me 5 PYQs from UPSC on Fundamental Rights',
    expectPyqset: true,
  },
];

let passed = 0, failed = 0;

for (const test of TESTS) {
  process.stdout.write(`\n${'─'.repeat(70)}\n${test.label}\n`);
  process.stdout.write(`Q: "${test.question.slice(0, 80).replace(/\n/g, ' ')}..."\n`);

  let response;
  try {
    response = await askMiga(test.question, test.label);
  } catch (e) {
    process.stdout.write(`ERROR: ${e.message}\n`);
    failed++;
    continue;
  }

  const hasPyqset = response.includes('```pyqset') || response.includes('pyqset\n');
  const hasQuiz   = response.includes('```quiz');
  const isCard    = hasPyqset || hasQuiz;

  const preview = response.slice(0, 200).replace(/\n/g, ' ');
  process.stdout.write(`Response (first 200 chars): ${preview}\n`);

  const ok = test.expectPyqset ? isCard : !isCard;
  if (ok) {
    passed++;
    process.stdout.write(`✅ PASS — ${test.expectPyqset ? 'got pyqset card as expected' : 'got prose answer (no pyqset leak)'}\n`);
  } else {
    failed++;
    process.stdout.write(`❌ FAIL — ${test.expectPyqset ? 'expected pyqset card but got prose' : 'got pyqset card when prose was expected (BUG STILL PRESENT)'}\n`);
    // Show more of the response on failure
    process.stdout.write(`Full response: ${response.slice(0, 500)}\n`);
  }
}

process.stdout.write(`\n${'═'.repeat(70)}\nRESULT: ${passed}/${TESTS.length} passed, ${failed} failed\n`);
if (failed === 0) {
  process.stdout.write('🎉 All tests passed — fix is confirmed live!\n');
} else {
  process.stdout.write('⚠️  Some tests failed — review the output above.\n');
}
