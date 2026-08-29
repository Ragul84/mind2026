// Read-only sweep of master_content_vault: finds lesson pages with
//  (a) truncated text blocks (ending in "..." / "…"),
//  (b) enumerated lists that stop short of the range promised in the title
//      e.g. title says "(1–12)" but items stop at 11,
//  (c) cryptic shorthand tokens students won't parse.
// Usage: node scripts/sweep-vault.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const env = {};
for (const file of ['.env', '.env.local']) {
  try {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
  } catch {}
}
const supabase = createClient(env.EXPO_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const SHORTHAND = /\b(RS Seats|Sched Areas|Sched Tribes|Amdt|Govt\.|w\/|b\/w|imp\.|defn)\b/i;

// page through all rows
const PAGE = 200;
let from = 0;
const rows = [];
for (;;) {
  const { data, error } = await supabase
    .from('master_content_vault')
    .select('track_id, day_number, topic_title, content_json')
    .range(from, from + PAGE - 1)
    .order('track_id', { ascending: true })
    .order('day_number', { ascending: true });
  if (error) { console.error(error); process.exit(1); }
  rows.push(...data);
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log(`Scanned rows: ${rows.length}`);

const findings = [];

const maxEnumeratedNum = (text) => {
  let max = 0;
  const re = /(^|[^0-9])(\d{1,2})\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) max = Math.max(max, parseInt(m[2], 10));
  return max;
};

for (const row of rows) {
  let json;
  try {
    json = typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json;
  } catch { findings.push({ ...loc(row), page: '-', reason: 'content_json unparseable' }); continue; }

  const pages = json?.lesson_pages || [];
  pages.forEach((page, pi) => {
    const texts = [page.intro || '', ...(page.blocks || []).map((b) => [b.title, b.text].filter(Boolean).join(' — '))];
    const title = String(page.title || '');

    texts.forEach((t) => {
      const text = String(t || '');
      if (!text) return;

      if (/(\.\.\.|…)\s*$/.test(text)) {
        findings.push({ ...loc(row), page: `${pi}: ${title}`, reason: 'TRUNCATED (ends with …)', sample: text.slice(-90) });
      }

      const rangeMatch = (title + ' ' + text).match(/\(\s*1\s*[-–]\s*(\d{1,2})\s*\)/);
      const maxNum = maxEnumeratedNum(text);
      if (rangeMatch && maxNum > 0 && maxNum < parseInt(rangeMatch[1], 10)) {
        findings.push({ ...loc(row), page: `${pi}: ${title}`, reason: `LIST SHORT: promises 1–${rangeMatch[1]}, stops at ${maxNum}`, sample: text.slice(0, 90) });
      }

      const sh = text.match(SHORTHAND);
      if (sh) {
        findings.push({ ...loc(row), page: `${pi}: ${title}`, reason: `SHORTHAND: "${sh[0]}"`, sample: text.slice(Math.max(0, sh.index - 30), sh.index + 50) });
      }
    });
  });
}

function loc(row) { return { track: row.track_id, day: row.day_number, topic: row.topic_title }; }

// Report
const byKey = new Map();
for (const f of findings) {
  const k = `${f.track} day ${f.day} — ${f.topic}`;
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(f);
}
console.log(`\nRows with findings: ${byKey.size}, total findings: ${findings.length}\n`);
for (const [k, list] of byKey) {
  console.log(`■ ${k}`);
  for (const f of list) console.log(`   [${f.reason}] page ${f.page}\n      …${(f.sample || '').replace(/\s+/g, ' ')}`);
}

writeFileSync('scripts/vault-sweep-report.json', JSON.stringify(findings, null, 2));
console.log('\nFull report: scripts/vault-sweep-report.json');
