const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const LANGUAGES = {
  en: 'en-IN',
  hi: 'hi-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function requestWithRetry(url, options, label) {
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const response = await fetch(url, options).catch(() => null);
    if (response?.ok) return response;

    const body = response ? await response.text() : 'network error';
    const retryable = !response || response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 8) {
      throw new Error(`${label}: ${response?.status || 0} ${body}`);
    }
    const wait = Math.min(90000, attempt * 5000);
    console.log(`[thirukkural.backfill.retry] ${label} attempt=${attempt} wait_ms=${wait}`);
    await sleep(wait);
  }
  throw new Error(`${label}: retries exhausted`);
}

async function translate(text, target, sarvamKey) {
  if (!text?.trim()) return '';
  const response = await requestWithRetry(
    'https://api.sarvam.ai/translate',
    {
      method: 'POST',
      headers: {
        'api-subscription-key': sarvamKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: text,
        source_language_code: 'ta-IN',
        target_language_code: target,
        model: 'mayura:v1',
        enable_preprocessing: true,
      }),
    },
    `translate:${target}`,
  );
  const payload = await response.json();
  return String(payload.translated_text || '').trim();
}

async function fetchAllBaseRows(url, key) {
  const fields = [
    'kural_number',
    'chapter_english',
    'section_english',
    'kural_tamil',
    'meaning_english',
    'meaning_hi',
    'meaning_te',
    'meaning_kn',
    'meaning_ml',
    'explanation_modern',
    'explanation_modern_hi',
    'explanation_modern_te',
    'explanation_modern_kn',
    'explanation_modern_ml',
    'life_application',
    'life_application_hi',
    'life_application_te',
    'life_application_kn',
    'life_application_ml',
  ].join(',');
  const rows = [];
  for (let offset = 0; offset < 1330; offset += 500) {
    const response = await requestWithRetry(
      `${url}/rest/v1/thirukkural?select=${fields}&order=kural_number.asc&limit=500&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
      `fetch-base:${offset}`,
    );
    rows.push(...await response.json());
  }
  return rows;
}

async function fetchCompleted(url, key, lang) {
  const response = await requestWithRetry(
    `${url}/rest/v1/thirukkural_localizations?select=kural_number,source&language_code=eq.${lang}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    `fetch-localized:${lang}`,
  );
  return new Map((await response.json()).map((row) => [row.kural_number, row.source]));
}

async function upsertRows(url, key, rows) {
  if (!rows.length) return;
  const response = await requestWithRetry(
    `${url}/rest/v1/thirukkural_localizations?on_conflict=kural_number,language_code`,
    {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
    `upsert:${rows[0].language_code}`,
  );
  await response.text();
}

async function mapConcurrent(items, concurrency, worker) {
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

async function main() {
  const env = loadEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const sarvamKey = env.SARVAM_API_KEY;
  if (!url || !key || !sarvamKey) throw new Error('Missing Supabase or Sarvam credentials');

  const requested = (process.argv[2] || Object.keys(LANGUAGES).join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const rows = await fetchAllBaseRows(url, key);

  for (const lang of requested) {
    const target = LANGUAGES[lang];
    if (!target) throw new Error(`Unsupported language: ${lang}`);

    const completed = await fetchCompleted(url, key, lang);
    const pending = rows.filter((row) => (
      !completed.has(row.kural_number)
      || completed.get(row.kural_number) === 'canonical-transliteration'
    ));
    console.log(`[thirukkural.backfill.start] lang=${lang} pending=${pending.length}`);

    let buffer = [];
    let finished = 0;
    let writeChain = Promise.resolve();

    await mapConcurrent(pending, 8, async (row) => {
      const verse = await translate(row.kural_tamil, target, sarvamKey);
      if (!verse) throw new Error(`Empty verse: ${lang} Kural ${row.kural_number}`);

      const meaning = lang === 'en' ? row.meaning_english : row[`meaning_${lang}`];
      const modern = lang === 'en'
        ? row.explanation_modern
        : row[`explanation_modern_${lang}`] || row.explanation_modern;
      const application = lang === 'en'
        ? row.life_application
        : row[`life_application_${lang}`] || row.life_application;

      const localized = {
        kural_number: row.kural_number,
        language_code: lang,
        chapter_title: row.chapter_english,
        section_title: row.section_english,
        verse,
        meaning,
        explanation_modern: modern,
        life_application: application,
        source: 'sarvam-mayura-v1',
        translation_version: 1,
        updated_at: new Date().toISOString(),
      };

      buffer.push(localized);
      if (buffer.length >= 25) {
        const batch = buffer;
        buffer = [];
        writeChain = writeChain.then(() => upsertRows(url, key, batch));
      }

      finished += 1;
      if (finished % 50 === 0 || finished === pending.length) {
        console.log(`[thirukkural.backfill.progress] lang=${lang} done=${finished}/${pending.length}`);
      }
    });

    await writeChain;
    await upsertRows(url, key, buffer);
    console.log(`[thirukkural.backfill.complete] lang=${lang} rows=${finished}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
