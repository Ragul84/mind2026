/**
 * Dump untagged PYQ rows to a JSON file so an agent can classify them.
 *
 * Only reads. Emits [{id, year, question_number, question_text, options}] for
 * rows matching the filters, sorted by year then question_number.
 *
 *   node scripts/pyq-dump-untagged.cjs --exam UPSC --answer-source official-key --years 2011-2015 --out tmp.json
 *   node scripts/pyq-dump-untagged.cjs --exam UPSC --answer-source official-key --out all.json   # all years
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');

const BASE = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: SR, Authorization: `Bearer ${SR}` };
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : d; };

const EXAM = arg('exam', 'UPSC');
const ASRC = arg('answer-source', 'official-key');
const YEARS = arg('years', ''); // "2011-2015" or "2019,2021" or "" for all
const OUT = arg('out', path.resolve(__dirname, `../tmp-pyq/untagged-${EXAM}.json`));

function yearFilter() {
  if (!YEARS) return '';
  if (YEARS.includes('-')) { const [a, b] = YEARS.split('-').map(Number); return `&year=gte.${a}&year=lte.${b}`; }
  const list = YEARS.split(',').map((s) => s.trim()).filter(Boolean);
  return `&year=in.(${list.join(',')})`;
}

(async () => {
  const cols = 'id,year,question_number,question_text,options';
  let filter = `&exam=eq.${encodeURIComponent(EXAM)}&subject=is.null`;
  if (ASRC) filter += `&answer_source=eq.${encodeURIComponent(ASRC)}`;
  filter += yearFilter();
  const PAGE = 1000; const rows = [];
  for (let from = 0; ; from += PAGE) {
    const r = await fetch(`${BASE}/rest/v1/pyq_questions?select=${cols}${filter}&order=year.asc,question_number.asc`, { headers: { ...H, Range: `${from}-${from + PAGE - 1}` } });
    if (!r.ok) { console.error(`fetch ${r.status}: ${(await r.text()).slice(0, 160)}`); process.exit(1); }
    const b = await r.json(); rows.push(...b);
    if (b.length < PAGE) break;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
  const byYear = {};
  for (const r of rows) byYear[r.year] = (byYear[r.year] || 0) + 1;
  console.log(`Dumped ${rows.length} untagged ${EXAM} rows (answer_source=${ASRC || 'any'}${YEARS ? `, years ${YEARS}` : ''}) -> ${OUT}`);
  console.log('By year:', JSON.stringify(byYear));
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
