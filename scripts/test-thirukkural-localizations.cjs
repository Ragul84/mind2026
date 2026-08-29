const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SCRIPT_PATTERN = {
  ta: /[\u0B80-\u0BFF]/u,
  en: /[A-Za-z]/,
  hi: /[\u0900-\u097F]/u,
  te: /[\u0C00-\u0C7F]/u,
  kn: /[\u0C80-\u0CFF]/u,
  ml: /[\u0D00-\u0D7F]/u,
};

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return env;
}

async function rpc(url, key, name, body) {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${name}: ${response.status} ${await response.text()}`);
  return response.json();
}

function assertRow(row, lang, expectedNumber) {
  if (!row) throw new Error(`${lang}: missing Kural ${expectedNumber}`);
  if (Number(row.kural_number) !== expectedNumber) {
    throw new Error(`${lang}: expected Kural ${expectedNumber}, received ${row.kural_number}`);
  }
  if (!SCRIPT_PATTERN[lang].test(row.verse)) {
    throw new Error(`${lang}: Kural ${expectedNumber} is not written in the selected script`);
  }
  if (row.verse.split(/\r?\n/).filter(Boolean).length !== 2) {
    throw new Error(`${lang}: Kural ${expectedNumber} does not have exactly two stored lines`);
  }
  if (!SCRIPT_PATTERN[lang].test(String(row.meaning || ''))) {
    throw new Error(`${lang}: Kural ${expectedNumber} meaning is not in the selected language`);
  }
  if (!SCRIPT_PATTERN[lang].test(String(row.chapter_title || ''))) {
    throw new Error(`${lang}: Kural ${expectedNumber} chapter is not in the selected language`);
  }
}

async function main() {
  const env = loadEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');

  const coverage = await rpc(url, key, 'get_thirukkural_localization_coverage', {});
  for (const row of coverage) {
    if (Number(row.translated_count) !== 1330 || !row.is_complete) {
      throw new Error(`Incomplete coverage for ${row.language_code}: ${row.translated_count}/1330`);
    }
  }

  for (const lang of Object.keys(SCRIPT_PATTERN)) {
    for (const number of [1, 391, 1330]) {
      const rows = await rpc(url, key, 'get_thirukkural_localized', {
        p_kural_number: number,
        p_language_code: lang,
      });
      assertRow(rows[0], lang, number);
    }

    const today = await rpc(url, key, 'get_daily_thirukkural_localized', {
      p_date: new Date().toISOString().slice(0, 10),
      p_language_code: lang,
      p_offset: 0,
    });
    assertRow(today[0], lang, Number(today[0]?.kural_number));
    console.log(`${lang}: PASS daily=${today[0].kural_number}`);
  }

  console.log('THIRUKKURAL_LOCALIZATIONS_PASS coverage=7980/7980');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
