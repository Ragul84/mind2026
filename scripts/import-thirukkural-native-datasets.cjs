const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SOURCE_BASE = 'https://tirukkural.in';

function twoLineEnglish(value) {
  const text = String(value || '').trim();
  const punctuationSplit = text.split(/;\s*/).map((line) => line.trim()).filter(Boolean);
  if (punctuationSplit.length === 2) return punctuationSplit.join('\n');
  const words = text.split(/\s+/).filter(Boolean);
  const midpoint = Math.ceil(words.length / 2);
  return `${words.slice(0, midpoint).join(' ')}\n${words.slice(midpoint).join(' ')}`;
}

const CONFIG = {
  en: {
    lines: (row) => twoLineEnglish(row.pope_couplet),
    sections: ['Virtue', 'Wealth', 'Love'],
  },
  hi: {
    lines: (row) => `${row.hindi1}\n${row.hindi2}`,
    sections: ['धर्म', 'अर्थ', 'प्रेम'],
  },
  te: {
    lines: (row) => `${row.telugu1}\n${row.telugu2}`,
    sections: ['ధర్మం', 'సంపద', 'ప్రేమ'],
  },
  kn: {
    lines: (row) => `${row.kannada1}\n${row.kannada2}`,
    sections: ['ಧರ್ಮ', 'ಸಂಪತ್ತು', 'ಪ್ರೀತಿ'],
  },
  ml: {
    lines: (row) => `${row.malayalam1}\n${row.malayalam2}`,
    sections: ['ധർമ്മം', 'സമ്പത്ത്', 'സ്നേഹം'],
  },
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

async function checkedFetch(url, options, label) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${label}: ${response.status} ${await response.text()}`);
  return response;
}

async function fetchBaseRows(url, key) {
  const fields = [
    'kural_number',
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
  const result = [];
  for (let offset = 0; offset < 1330; offset += 500) {
    const response = await checkedFetch(
      `${url}/rest/v1/thirukkural?select=${fields}&order=kural_number.asc&limit=500&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
      `base:${offset}`,
    );
    result.push(...await response.json());
  }
  return new Map(result.map((row) => [row.kural_number, row]));
}

function sectionFor(config, kuralNumber) {
  if (kuralNumber <= 380) return config.sections[0];
  if (kuralNumber <= 1080) return config.sections[1];
  return config.sections[2];
}

async function upsert(url, key, rows) {
  const response = await checkedFetch(
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

async function main() {
  const env = loadEnv();
  const url = env.EXPO_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase credentials');

  const requested = (process.argv[2] || Object.keys(CONFIG).join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const baseRows = await fetchBaseRows(url, key);
  const titles = await (
    await checkedFetch(`${SOURCE_BASE}/athikaram-titles.json`, {}, 'chapter-titles')
  ).json();

  for (const lang of requested) {
    const config = CONFIG[lang];
    if (!config) throw new Error(`Unsupported language: ${lang}`);
    const payload = await (
      await checkedFetch(`${SOURCE_BASE}/thirukkural-${lang}.json`, {}, `dataset:${lang}`)
    ).json();
    const verses = payload.kural || payload;
    if (!Array.isArray(verses) || verses.length !== 1330) {
      throw new Error(`${lang} dataset expected 1330 rows, received ${verses?.length || 0}`);
    }

    const rows = verses.map((verseRow) => {
      const kuralNumber = Number(verseRow.Number);
      const base = baseRows.get(kuralNumber);
      const chapterNumber = Math.ceil(kuralNumber / 10);
      if (!base) throw new Error(`Missing base Kural ${kuralNumber}`);
      const verse = config.lines(verseRow).trim();
      if (!verse || verse.split(/\r?\n/).filter(Boolean).length !== 2) {
        throw new Error(`Invalid ${lang} verse at Kural ${kuralNumber}`);
      }
      return {
        kural_number: kuralNumber,
        language_code: lang,
        chapter_title: titles?.[lang]?.[String(chapterNumber)] || titles?.en?.[String(chapterNumber)],
        section_title: sectionFor(config, kuralNumber),
        verse,
        meaning: lang === 'en' ? base.meaning_english : base[`meaning_${lang}`],
        explanation_modern: lang === 'en'
          ? base.explanation_modern
          : base[`explanation_modern_${lang}`] || base.explanation_modern,
        life_application: lang === 'en'
          ? base.life_application
          : base[`life_application_${lang}`] || base.life_application,
        source: 'tirukkural.in-native-v2',
        translation_version: 2,
        updated_at: new Date().toISOString(),
      };
    });

    for (let index = 0; index < rows.length; index += 200) {
      await upsert(url, key, rows.slice(index, index + 200));
      console.log(`[thirukkural.native_import] lang=${lang} done=${Math.min(index + 200, rows.length)}/1330`);
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
