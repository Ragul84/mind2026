const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const LANGUAGE_NAMES = {
  en: 'natural English',
  hi: 'natural Hindi in Devanagari script',
  te: 'natural Telugu in Telugu script',
  kn: 'natural Kannada in Kannada script',
  ml: 'natural Malayalam in Malayalam script',
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

async function requestWithRetry(url, options, label, attempts = 6) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url, options).catch(() => null);
    if (response?.ok) return response;
    const body = response ? await response.text() : 'network error';
    if (attempt === attempts || (response && response.status < 429 && response.status !== 408)) {
      throw new Error(`${label}: ${response?.status || 0} ${body}`);
    }
    const wait = Math.min(60000, attempt * 5000);
    console.log(`[thirukkural.openrouter.retry] ${label} attempt=${attempt} wait_ms=${wait}`);
    await sleep(wait);
  }
  throw new Error(`${label}: retries exhausted`);
}

function readJsonObject(text) {
  const cleaned = String(text || '').replace(/```json|```/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model response');
  return JSON.parse(cleaned.slice(start, end + 1));
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
  const rows = [];
  for (let offset = 0; offset < 1330; offset += 500) {
    const response = await requestWithRetry(
      `${url}/rest/v1/thirukkural_localizations?select=kural_number,source&language_code=eq.${lang}&order=kural_number.asc&limit=500&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
      `fetch-localized:${lang}:${offset}`,
    );
    rows.push(...await response.json());
  }
  return new Map(rows.map((row) => [row.kural_number, row.source]));
}

async function upsertRows(url, key, rows) {
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

async function translateBatch(batch, lang, env, model) {
  const target = LANGUAGE_NAMES[lang];
  const input = batch.map((row) => ({
    kural_number: row.kural_number,
    tamil_verse: row.kural_tamil,
    english_meaning_for_context: row.meaning_english,
    chapter: row.chapter_english,
    section: row.section_english,
  }));
  const prompt = [
    `Translate each classical Tamil Thirukkural into ${target}.`,
    'Be faithful to the supplied English meaning, but translate the Tamil verse itself.',
    'The verse must be readable in the target language, not Tamil and not transliteration.',
    'Keep each verse as exactly two complete poetic lines separated by \\n.',
    'Translate chapter_title and section_title into the same target language.',
    'Return every input kural_number exactly once and in the same order.',
    'Return only JSON: {"translations":[{"kural_number":1,"verse":"line 1\\nline 2","chapter_title":"","section_title":""}]}',
    JSON.stringify(input),
  ].join('\n');

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await requestWithRetry(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://mindgains.app',
          'X-Title': 'MindGains Thirukkural Localization',
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 16000,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'You are a precise Indian literary translator. Output valid JSON only.',
            },
            { role: 'user', content: prompt },
          ],
        }),
      },
      `openrouter:${lang}`,
    );
    const payload = await response.json();
    try {
      const parsed = readJsonObject(payload?.choices?.[0]?.message?.content);
      const translations = Array.isArray(parsed.translations) ? parsed.translations : [];
      const byNumber = new Map(translations.map((item) => [Number(item.kural_number), item]));
      const ordered = batch.map((row) => byNumber.get(row.kural_number));
      const valid = ordered.every((item) => (
        item
        && String(item.verse || '').trim()
        && String(item.chapter_title || '').trim()
        && String(item.section_title || '').trim()
      ));
      if (valid) return ordered;
      throw new Error(`Incomplete batch: expected ${batch.length}, received ${translations.length}`);
    } catch (error) {
      if (attempt === 4) throw error;
      console.log(`[thirukkural.openrouter.json_retry] lang=${lang} attempt=${attempt}`);
      await sleep(1500 * attempt);
    }
  }
  throw new Error(`Unable to translate ${lang} batch`);
}

function buildLocalization(row, translation, lang, model) {
  const meaning = lang === 'en' ? row.meaning_english : row[`meaning_${lang}`];
  const modern = lang === 'en'
    ? row.explanation_modern
    : row[`explanation_modern_${lang}`] || row.explanation_modern;
  const application = lang === 'en'
    ? row.life_application
    : row[`life_application_${lang}`] || row.life_application;
  return {
    kural_number: row.kural_number,
    language_code: lang,
    chapter_title: String(translation.chapter_title).trim(),
    section_title: String(translation.section_title).trim(),
    verse: String(translation.verse).trim(),
    meaning,
    explanation_modern: modern,
    life_application: application,
    source: `openrouter-${model.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-v1`,
    translation_version: 1,
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const env = loadEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !env.OPENROUTER_API_KEY) {
    throw new Error('Missing Supabase or OpenRouter credentials');
  }

  const requested = (process.argv[2] || Object.keys(LANGUAGE_NAMES).join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const model = process.argv[3] || env.OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash';
  const batchSize = Number(process.argv[4] || 150);
  const allRows = await fetchAllBaseRows(url, key);

  for (const lang of requested) {
    if (!LANGUAGE_NAMES[lang]) throw new Error(`Unsupported language: ${lang}`);
    const completed = await fetchCompleted(url, key, lang);
    const pending = allRows.filter((row) => (
      !completed.has(row.kural_number)
      || completed.get(row.kural_number) === 'canonical-transliteration'
    ));
    console.log(`[thirukkural.openrouter.start] lang=${lang} pending=${pending.length}`);

    for (let index = 0; index < pending.length; index += batchSize) {
      const batch = pending.slice(index, index + batchSize);
      const translations = await translateBatch(batch, lang, env, model);
      await upsertRows(
        url,
        key,
        batch.map((row, itemIndex) => buildLocalization(row, translations[itemIndex], lang, model)),
      );
      console.log(
        `[thirukkural.openrouter.progress] lang=${lang} done=${Math.min(index + batch.length, pending.length)}/${pending.length}`,
      );
    }
    console.log(`[thirukkural.openrouter.complete] lang=${lang} rows=${pending.length}`);
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
