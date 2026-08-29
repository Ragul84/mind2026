// Builds assets/data/mla_2026.json from Wikipedia "Results by constituency" tables
// for the 5 states that held assembly elections in 2026 (ECI portal is bot-blocked).
import { writeFileSync, mkdirSync } from 'node:fs';
const API = 'https://en.wikipedia.org/w/api.php';
const enc = encodeURIComponent;

const STATES = [
  { state: 'Tamil Nadu', page: '2026 Tamil Nadu Legislative Assembly election', seats: 234 },
  { state: 'Kerala', page: '2026 Kerala Legislative Assembly election', seats: 140 },
  { state: 'West Bengal', page: '2026 West Bengal Legislative Assembly election', seats: 294 },
  { state: 'Assam', page: '2026 Assam Legislative Assembly election', seats: 126 },
  { state: 'Puducherry', page: '2026 Puducherry Legislative Assembly election', seats: 30 },
];

const ABBR = {
  'Tamilaga Vettri Kazhagam': 'TVK', 'Dravida Munnetra Kazhagam': 'DMK',
  'All India Anna Dravida Munnetra Kazhagam': 'AIADMK', 'Indian National Congress': 'INC',
  'Bharatiya Janata Party': 'BJP', 'Communist Party of India (Marxist)': 'CPI(M)',
  'Communist Party of India': 'CPI', 'Viduthalai Chiruthaigal Katchi': 'VCK',
  'Pattali Makkal Katchi': 'PMK', 'Marumalarchi Dravida Munnetra Kazhagam': 'MDMK',
  'Indian Union Muslim League': 'IUML', 'All India Trinamool Congress': 'TMC',
  'All India United Democratic Front': 'AIUDF', 'Asom Gana Parishad': 'AGP',
  'Revolutionary Socialist Party': 'RSP', 'Kerala Congress (M)': 'KC(M)', 'Kerala Congress': 'KC',
  'Janata Dal (Secular)': 'JD(S)', 'Nationalist Congress Party': 'NCP', 'Independent': 'IND',
  'United Democratic Party': 'UDP', 'Bodoland People’s Front': 'BPF', 'United People’s Party Liberal': 'UPPL',
};
const REVERSE = Object.fromEntries(Object.entries(ABBR).map(([k, v]) => [v, k]));
const norm = (s) => (s || '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)/g, ' ').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, '').trim();
const clean = (h) => h.replace(/<[^>]+>/g, '').replace(/&#?\w+;/g, ' ').replace(/\[\w+\]/g, '').replace(/\s+/g, ' ').trim();

async function findSection(page) {
  const r = await fetch(`${API}?action=parse&page=${enc(page)}&prop=sections&format=json&origin=*`);
  const j = await r.json();
  const secs = j.parse?.sections || [];
  const s = secs.find((x) => /results by constituency/i.test(x.line)) || secs.find((x) => /constituenc/i.test(x.line));
  return s ? s.index : null;
}
async function sectionHtml(page, idx) {
  const r = await fetch(`${API}?action=parse&page=${enc(page)}&section=${idx}&prop=text&format=json&origin=*`);
  const j = await r.json();
  return j.parse?.text?.['*'] || '';
}
function parseRows(html) {
  const out = [];
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  for (const row of rows) {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => clean(m[1]));
    const noIdx = cells.findIndex((c) => /^\d{1,3}$/.test(c) && +c >= 1 && +c <= 400);
    if (noIdx < 0) continue;
    const name = cells[noIdx + 1], candidate = cells[noIdx + 2];
    if (!name || !candidate || /\d/.test(name) || !/[a-z]/.test(candidate)) continue; // real names have lowercase; party codes don't
    // party abbreviation = first short alpha cell after the candidate (always present)
    let abbr = null;
    for (let i = noIdx + 3; i < cells.length; i++) { const c = cells[i]; if (c && /^[A-Za-z][A-Za-z().+&-]{0,14}$/.test(c)) { abbr = c; break; } }
    if (!abbr) continue;
    const dsv = [...row.matchAll(/data-sort-value="([^"]+)"/g)].map((m) => m[1]);
    const partyFull = dsv[0] || REVERSE[abbr] || abbr;
    out.push({ ac: name, winner: candidate, party: partyFull, abbr: ABBR[partyFull] || abbr });
  }
  return out;
}

const out = {};
const report = [];
for (const { state, page, seats } of STATES) {
  try {
    const idx = await findSection(page);
    if (idx == null) { report.push(`${state}: NO results section`); continue; }
    const html = await sectionHtml(page, idx);
    const rows = parseRows(html);
    // dedupe by AC name (table may repeat header-ish rows)
    const seen = new Set();
    let n = 0;
    for (const r of rows) {
      const k = `${norm(state)}::${norm(r.ac)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out[k] = { ...r, state };
      n++;
    }
    report.push(`${state}: parsed ${n}/${seats}`);
  } catch (e) { report.push(`${state}: ERR ${String(e).slice(0, 60)}`); }
}
mkdirSync('assets/data', { recursive: true });
writeFileSync('assets/data/mla_2026.json', JSON.stringify(out));
console.log(report.join('\n'));
console.log('total rows:', Object.keys(out).length);
// samples
const ks = Object.keys(out).slice(0, 4);
ks.forEach((k) => console.log(' ', k, '->', JSON.stringify(out[k])));
