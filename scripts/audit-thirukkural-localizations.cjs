const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function countedHead(url, key, table, query = '') {
  const response = await fetch(
    `${url}/rest/v1/${table}?select=kural_number${query ? `&${query}` : ''}`,
    {
      method: 'HEAD',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact',
      },
    },
  );
  if (!response.ok) throw new Error(`${table}: ${response.status} ${await response.text()}`);
  const range = response.headers.get('content-range') || '';
  return Number(range.split('/')[1] || 0);
}

async function main() {
  const env = loadEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');

  console.log(`base_total=${await countedHead(url, key, 'thirukkural')}`);
  for (const lang of ['ta', 'en', 'hi', 'te', 'kn', 'ml']) {
    const localized = await countedHead(
      url,
      key,
      'thirukkural_localizations',
      `language_code=eq.${lang}`,
    );
    const meaningColumn = lang === 'ta'
      ? 'meaning_tamil'
      : lang === 'en'
        ? 'meaning_english'
        : `meaning_${lang}`;
    const baseMeanings = await countedHead(
      url,
      key,
      'thirukkural',
      `${meaningColumn}=not.is.null`,
    );
    console.log(`${lang}: localized=${localized}, base_meanings=${baseMeanings}`);
  }

  const sourceRows = [];
  for (let offset = 0; offset < 7980; offset += 1000) {
    const response = await fetch(
      `${url}/rest/v1/thirukkural_localizations?select=language_code,source&order=language_code.asc,kural_number.asc&limit=1000&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!response.ok) throw new Error(`source audit: ${response.status} ${await response.text()}`);
    sourceRows.push(...await response.json());
  }
  const sourceCounts = {};
  for (const row of sourceRows) {
    const name = `${row.language_code}:${row.source}`;
    sourceCounts[name] = (sourceCounts[name] || 0) + 1;
  }
  for (const [name, count] of Object.entries(sourceCounts)) {
    console.log(`${name}=${count}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
