// Direct test of the deployed miga_sprint_generate (the Sprint card generator).
// node --use-system-ca scripts/test-sprint.mjs "Fundamental Rights"
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
const URL = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const topic = process.argv[2] || 'Fundamental Rights';
const res = await fetch(`${URL}/functions/v1/miga_sprint_generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}`, apikey: ANON },
  body: JSON.stringify({ topic, reason: 'Missed 2 questions in a quiz', exam: 'TNPSC' }),
});
console.log('HTTP', res.status);
const data = await res.json().catch(() => null);
if (!data?.success) { console.log('response:', JSON.stringify(data)); process.exit(0); }
const s = data.sprint;
console.log(`\nTOPIC: ${s.topic}\n`);
s.cards.forEach((c, i) => {
  console.log(`CARD ${i + 1}: ${c.heading}`);
  (c.points || []).forEach((p) => console.log(`   - ${p}`));
  if (c.insight) console.log(`   * insight: ${c.insight}`);
  console.log('');
});
if (s.checkpoint) {
  console.log(`CHECKPOINT: ${s.checkpoint.question}`);
  s.checkpoint.options.forEach((o, i) => console.log(`   ${i === s.checkpoint.answerIndex ? '✓' : ' '} ${o}`));
  console.log(`   explanation: ${s.checkpoint.explanation}`);
}
