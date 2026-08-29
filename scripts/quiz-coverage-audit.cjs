#!/usr/bin/env node
/**
 * quiz-coverage-audit.cjs — Phase 0 regression gate.
 *
 * Verifies the QuizHub's question pools against reality so no surfaced subject
 * can silently become a dead end. LLENs every base `quiz:subject:{key}` pool on
 * Upstash and cross-checks it against the POPULATED_KEYS allowlist that
 * utils/redisService.ts uses to decide what is live vs "Coming soon".
 *
 *   node scripts/quiz-coverage-audit.cjs
 *
 * Exit 1 (fails CI) if any key we PROMISE is populated is actually empty —
 * that's a real regression. Empty keys that are correctly gated as coming-soon
 * are reported as info, not failures.
 *
 * Keep the two lists below in sync with utils/redisService.ts (POPULATED_KEYS
 * and the union of redisKeys referenced by DEFAULT_SUBJECTS / DEFAULT_TOPICS).
 */
require('dotenv').config();

const URL =
  process.env.EXPO_PUBLIC_UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.UPSTASH_REST_URL;
const TOKEN =
  process.env.EXPO_PUBLIC_UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.UPSTASH_REST_TOKEN;

// Source of truth mirror — pools redisService POPULATED_KEYS promises are live.
const POPULATED = [
  'tamil', 'history', 'maths', 'polity', 'economics', 'geography', 'science', 'english',
  'reasoning', 'banking', 'computer', 'physics', 'chemistry', 'biology', 'general_intelligence',
  'current_affairs',
];
// Every base pool key the app can reference. Anything here but not in POPULATED
// is expected to be gated as "Coming soon" in the UI.
const ALL_KEYS = [
  ...POPULATED,
  'child_development',
];

async function llen(key) {
  const res = await fetch(`${URL}/LLEN/${encodeURIComponent(`quiz:subject:${key}`)}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const json = await res.json();
  return typeof json.result === 'number' ? json.result : 0;
}

(async () => {
  if (!URL || !TOKEN) {
    console.error('✖ Missing Upstash REST env (EXPO_PUBLIC_UPSTASH_REDIS_REST_URL / _TOKEN). Add them to .env.');
    process.exit(2);
  }

  const counts = {};
  await Promise.all(ALL_KEYS.map(async (k) => { counts[k] = await llen(k); }));

  const promisedButEmpty = [];
  const comingSoon = [];

  console.log('\n  QuizHub pool coverage  (quiz:subject:{key})');
  console.log('  ' + '─'.repeat(46));
  for (const key of ALL_KEYS) {
    const n = counts[key];
    const promised = POPULATED.includes(key);
    let mark;
    if (n > 0) mark = '✓ live   ';
    else if (promised) { mark = '✖ EMPTY! '; promisedButEmpty.push(key); }
    else { mark = '· soon   '; comingSoon.push(key); }
    console.log(`  ${mark} ${key.padEnd(20)} ${String(n).padStart(6)} Q`);
  }
  console.log('  ' + '─'.repeat(46));

  if (comingSoon.length) {
    console.log(`\n  Coming-soon (gated, safe): ${comingSoon.join(', ')}`);
    console.log('  → Phase 0 fill list. Add each to POPULATED_KEYS once seeded.');
  }

  if (promisedButEmpty.length) {
    console.error(`\n  ✖ REGRESSION: promised-live pools are EMPTY: ${promisedButEmpty.join(', ')}`);
    console.error('    Either seed them or move them out of POPULATED_KEYS.\n');
    process.exit(1);
  }

  console.log('\n  ✓ No dead ends: every promised-live pool has questions.\n');
})();
