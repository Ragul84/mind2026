import { supabase } from '@/utils/supabaseService';

export const THIRUKKURAL_LANGUAGES = ['ta', 'en', 'hi', 'te', 'kn', 'ml'] as const;
export type ThirukkuralLanguage = typeof THIRUKKURAL_LANGUAGES[number];

export type LocalizedThirukkural = {
  kural_number: number;
  chapter_tamil: string;
  chapter_english: string;
  section_tamil: string;
  section_english: string;
  kural_tamil: string;
  kural_transliteration: string;
  meaning_tamil: string;
  meaning_english: string;
  language_code: ThirukkuralLanguage;
  chapter_title: string;
  section_title: string;
  verse: string;
  meaning: string;
  explanation_modern: string;
  life_application: string;
  translation_source: string;
};

export function normalizeThirukkuralText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeThirukkuralVerse(text: string): string {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeThirukkuralText(line))
    .filter(Boolean);
  if (lines.length >= 2) return lines.slice(0, 2).join('\n');
  return lines[0] || normalizeThirukkuralText(text);
}

export function getThirukkuralVerseText(
  row: Pick<LocalizedThirukkural, 'verse' | 'kural_tamil' | 'kural_transliteration' | 'language_code'>,
): string {
  const verse = normalizeThirukkuralVerse(row.verse || '');
  if (verse) return verse;

  if (row.language_code === 'en') {
    return normalizeThirukkuralVerse(row.kural_transliteration || row.kural_tamil || '');
  }

  if (row.language_code === 'ta') {
    return normalizeThirukkuralVerse(row.kural_tamil || row.kural_transliteration || '');
  }

  return normalizeThirukkuralVerse(row.kural_transliteration || row.kural_tamil || '');
}

export function getThirukkuralMeaningText(
  row: Pick<LocalizedThirukkural, 'meaning'>,
): string {
  return normalizeThirukkuralText(row.meaning || '');
}

export function splitThirukkuralLines(verse: string): string[] {
  const normalizedVerse = normalizeThirukkuralVerse(verse);
  const explicitLines = normalizedVerse
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (explicitLines.length >= 2) return explicitLines.slice(0, 2);

  const words = normalizedVerse.split(' ').filter(Boolean);
  if (words.length <= 4) return words.length ? [words.join(' ')] : [];

  const firstLineCount = Math.ceil(words.length / 2);
  return [
    words.slice(0, firstLineCount).join(' '),
    words.slice(firstLineCount).join(' '),
  ].filter(Boolean);
}

const toLocalDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const requireLocalizedRow = (
  rows: LocalizedThirukkural[] | LocalizedThirukkural | null,
  language: ThirukkuralLanguage,
) => {
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row?.verse?.trim() || !row?.meaning?.trim()) {
    throw new Error(`Thirukkural localization is unavailable for ${language}`);
  }
  return {
    ...row,
    verse: normalizeThirukkuralVerse(row.verse),
    meaning: normalizeThirukkuralText(row.meaning),
    explanation_modern: normalizeThirukkuralText(row.explanation_modern || ''),
    life_application: normalizeThirukkuralText(row.life_application || ''),
  };
};

export async function getLocalizedThirukkural(
  kuralNumber: number,
  language: ThirukkuralLanguage,
): Promise<LocalizedThirukkural> {
  const { data, error } = await supabase.rpc('get_thirukkural_localized', {
    p_kural_number: kuralNumber,
    p_language_code: language,
  });
  if (error) throw error;
  return requireLocalizedRow(data as LocalizedThirukkural[] | null, language);
}

export async function getDailyLocalizedThirukkural(
  language: ThirukkuralLanguage,
  offset = 0,
  date = new Date(),
): Promise<LocalizedThirukkural> {
  const { data, error } = await supabase.rpc('get_daily_thirukkural_localized', {
    p_date: toLocalDate(date),
    p_language_code: language,
    p_offset: offset,
  });
  if (error) throw error;
  return requireLocalizedRow(data as LocalizedThirukkural[] | null, language);
}
