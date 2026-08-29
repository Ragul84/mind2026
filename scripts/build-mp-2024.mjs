// Builds assets/data/mp_2024.json by joining the 2024 results CSV (winner/party/
// margin, but NO state) onto datameet's pc_name+st_name. Reports match quality so
// we only ship confident rows; ambiguous/duplicate names fall back to live links.
import { writeFileSync, mkdirSync } from 'node:fs';

const GEO = 'https://cdn.jsdelivr.net/gh/datameet/maps@master/parliamentary-constituencies/india_pc_2019_simplified.geojson';
const CSV = 'https://raw.githubusercontent.com/TheiScale/Lok-Sabha-Election-2024-Dataset-/main/election_results_2024.csv';

const titleCase = (s) => (s || '').toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bDr\b/g, 'Dr');
const PARTY_ABBR = {
  'Bharatiya Janata Party': 'BJP', 'Indian National Congress': 'INC',
  'Dravida Munnetra Kazhagam': 'DMK', 'All India Trinamool Congress': 'TMC',
  'Samajwadi Party': 'SP', 'Telugu Desam Party': 'TDP', 'Janata Dal (United)': 'JD(U)',
  'Janata Dal  (United)': 'JD(U)', 'Aam Aadmi Party': 'AAP', 'Rashtriya Janata Dal': 'RJD',
  'Jharkhand Mukti Morcha': 'JMM', 'Indian Union Muslim League': 'IUML',
  'Communist Party of India (Marxist)': 'CPI(M)', 'Communist Party of India': 'CPI',
  'Communist Party of India (Marxist-Leninist) (Liberation)': 'CPI(ML)L',
  'Yuvajana Sramika Rythu Congress Party': 'YSRCP', 'Shiv Sena': 'SS',
  'Shiv Sena (Uddhav Balasaheb Thackeray)': 'SS(UBT)',
  'Nationalist Congress Party': 'NCP', 'Nationalist Congress Party – Sharadchandra Pawar': 'NCP(SP)',
  'Nationalist Congress Party - Sharadchandra Pawar': 'NCP(SP)',
  'Jammu & Kashmir National Conference': 'JKNC', 'Telangana Rashtra Samithi': 'BRS',
  'Bharat Rashtra Samithi': 'BRS', 'Janata Dal (Secular)': 'JD(S)', 'Lok Janshakti Party(Ram Vilas)': 'LJP(RV)',
  'Rashtriya Loktantrik Party': 'RLP', 'Rashtriya Lok Dal': 'RLD', 'Apna Dal (Soneylal)': 'AD(S)',
  'Viduthalai Chiruthaigal Katchi': 'VCK', 'Marumalarchi Dravida Munnetra Kazhagam': 'MDMK',
  'Sikkim Krantikari Morcha': 'SKM', 'Voice of the People Party': 'VPP', 'Zoram People’s Movement': 'ZPM',
  'United People’s Party, Liberal': 'UPPL', 'Asom Gana Parishad': 'AGP', 'Hindustani Awam Morcha (Secular)': 'HAM(S)',
  'Independent': 'IND', 'Aazad Samaj Party (Kanshi Ram)': 'ASP(KR)', 'Bahujan Samaj Party': 'BSP',
  'All India Majlis-E-Ittehadul Muslimeen': 'AIMIM', 'Kerala Congress': 'KC', 'Revolutionary Socialist Party': 'RSP',
};
const abbr = (p) => PARTY_ABBR[p] || PARTY_ABBR[(p || '').trim()] || p;

const norm = (s) => (s || '')
  .toUpperCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)/g, ' ')            // drop "(SC)"/"(ST)" etc
  .replace(/&/g, ' AND ')
  .replace(/[^A-Z0-9]+/g, ' ')
  .trim();

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const head = lines.shift().split(',');
  const idx = (n) => head.findIndex(h => h.trim().toLowerCase() === n);
  const ci = idx('constituency'), wi = idx('leading candidate'), pi = idx('leading party'), mi = idx('margin');
  return lines.map(l => {
    // simple split is fine: names here contain no commas
    const c = l.split(',');
    return { name: c[ci], mp: c[wi], party: c[pi], margin: c[mi] };
  }).filter(r => r.name);
}

const geo = await (await fetch(GEO)).json();
const csvText = await (await fetch(CSV)).text();
const rows = parseCSV(csvText);

// index CSV by normalized name; track collisions (same name, >1 row)
const byName = {};
for (const r of rows) {
  const k = norm(r.name);
  (byName[k] = byName[k] || []).push(r);
}

// Safe spelling-only aliases (geo pc_name -> CSV name). Same seat & boundary,
// different transliteration. Excludes Assam (2023 re-delimitation) and J&K
// Anantnag (redrawn) and duplicate names — those stay as live-link fallback.
const ALIASES = {
  'Firozepur': 'Firozpur', 'Pataliputra': 'Patliputra', 'Bahraich': 'Baharaich',
  'Cooch Behar': 'Coochbehar', 'Barrackpore': 'Barrackpur', 'Jaynagar': 'Joynagar',
  'Sreerampur': 'Srerampur', 'Janjgir': 'JANJGIR-CHAMPA', 'Mandsaur': 'MANDSOUR',
  'Hatkanangle': 'Hatkanangale', 'Peddapalli': 'Peddapalle', 'Mahabubnagar': 'Mahbubnagar',
  'Bhuvanagiri': 'Bhongir', 'Anakapalli': 'Anakapalle', 'Kurnool': 'Kurnoolu',
  'Anantapuramu': 'Ananthapur', 'Tirupati': 'Thirupathi(SC)', 'Narasaraopet': 'Narsaraopet',
  'Davangere': 'Davanagere', 'Haasan': 'Hassan', 'Mavelikara': 'Mavelikkara',
  'Thiruvallur': 'TIRUVALLUR', 'Mayiladuturai': 'MAYILADUTHURAI', 'Thoothukudi': 'THOOTHUKKUDI',
  'Kanyakumari': 'KANNIYAKUMARI', 'Dadra and Nagar Haveli': 'Dadar & Nagar Haveli',
  'Chikodi': 'Chikkodi', 'Belagavi': 'Belgaum', 'Chikballapur': 'Chikkballapur', 'Palamu': 'Palamau',
};

const pcs = geo.features.map(f => ({ pc: f.properties.pc_name, st: f.properties.st_name }));
const out = {};
let matched = 0; const ambiguous = [], unmatched = [];
for (const { pc, st } of pcs) {
  const k = norm(ALIASES[pc] || pc);
  const hits = byName[k];
  const key = `${norm(st)}::${norm(pc)}`; // keyed by GEO name — what the app looks up with
  if (!hits) { unmatched.push(`${pc} (${st})`); continue; }
  if (hits.length > 1) { ambiguous.push(`${pc} (${st})`); continue; } // can't disambiguate w/o state in CSV
  const r = hits[0];
  out[key] = { pc, state: st, mp: titleCase(r.mp), party: (r.party || '').trim(), abbr: abbr((r.party || '').trim()), margin: Number(r.margin) || null };
  matched++;
}

// leftover CSV names (not consumed by a confident single match) — to craft aliases
const consumed = new Set();
for (const { pc, st } of pcs) { const k = norm(ALIASES[pc] || pc); if (byName[k] && byName[k].length === 1) consumed.add(k); }
const leftoverCsv = [...new Set(rows.map(r => r.name))].filter(n => !consumed.has(norm(n))).sort();

mkdirSync('assets/data', { recursive: true });
writeFileSync('assets/data/mp_2024.json', JSON.stringify(out));
writeFileSync('scripts/mp-2024-report.json', JSON.stringify({ totalPCs: pcs.length, csvRows: rows.length, matched, ambiguousCount: ambiguous.length, unmatchedCount: unmatched.length, ambiguous, unmatched }, null, 2));

console.log(`PCs: ${pcs.length} | CSV rows: ${rows.length}`);
console.log(`MATCHED (confident): ${matched}`);
console.log(`AMBIGUOUS (dup name, skipped): ${ambiguous.length}`);
console.log(`UNMATCHED (skipped): ${unmatched.length}`);
if (ambiguous.length) console.log('  dup names:', ambiguous.slice(0, 40).join(', '));
if (unmatched.length) console.log('  unmatched geo:', unmatched.slice(0, 40).join(', '));
console.log('\n  leftover CSV names:', leftoverCsv.join(' | '));
