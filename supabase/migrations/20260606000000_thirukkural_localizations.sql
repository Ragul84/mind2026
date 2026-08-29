-- Canonical multilingual storage for every Thirukkural.
-- One row represents one Kural in one supported language.
CREATE TABLE IF NOT EXISTS public.thirukkural_localizations (
  kural_number INTEGER NOT NULL
    REFERENCES public.thirukkural(kural_number) ON DELETE CASCADE,
  language_code TEXT NOT NULL
    CHECK (language_code IN ('ta', 'en', 'hi', 'te', 'kn', 'ml')),
  chapter_title TEXT,
  section_title TEXT,
  verse TEXT NOT NULL,
  meaning TEXT NOT NULL,
  explanation_modern TEXT,
  life_application TEXT,
  source TEXT NOT NULL DEFAULT 'curated',
  translation_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kural_number, language_code),
  CHECK (length(btrim(verse)) > 0),
  CHECK (length(btrim(meaning)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_thirukkural_localizations_language
  ON public.thirukkural_localizations(language_code, kural_number);

ALTER TABLE public.thirukkural_localizations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "thirukkural_localizations_read" ON public.thirukkural_localizations;
CREATE POLICY "thirukkural_localizations_read"
  ON public.thirukkural_localizations
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.thirukkural_localizations TO anon, authenticated;

-- Seed the two source languages from the canonical table.
INSERT INTO public.thirukkural_localizations (
  kural_number,
  language_code,
  chapter_title,
  section_title,
  verse,
  meaning,
  explanation_modern,
  life_application,
  source
)
SELECT
  kural_number,
  'ta',
  chapter_tamil,
  section_tamil,
  kural_tamil,
  meaning_tamil,
  explanation_modern,
  life_application,
  'canonical'
FROM public.thirukkural
WHERE length(btrim(kural_tamil)) > 0
  AND length(btrim(meaning_tamil)) > 0
ON CONFLICT (kural_number, language_code) DO UPDATE SET
  chapter_title = EXCLUDED.chapter_title,
  section_title = EXCLUDED.section_title,
  verse = EXCLUDED.verse,
  meaning = EXCLUDED.meaning,
  explanation_modern = EXCLUDED.explanation_modern,
  life_application = EXCLUDED.life_application,
  source = EXCLUDED.source,
  updated_at = now();

-- English meaning is already curated. Retain the transliteration until the
-- prefill job replaces it with the stored English rendering.
INSERT INTO public.thirukkural_localizations (
  kural_number,
  language_code,
  chapter_title,
  section_title,
  verse,
  meaning,
  explanation_modern,
  life_application,
  source
)
SELECT
  t.kural_number,
  'en',
  t.chapter_english,
  t.section_english,
  t.kural_transliteration,
  t.meaning_english,
  t.explanation_modern,
  t.life_application,
  'canonical-transliteration'
FROM public.thirukkural t
WHERE length(btrim(t.meaning_english)) > 0
ON CONFLICT (kural_number, language_code) DO UPDATE SET
  chapter_title = EXCLUDED.chapter_title,
  section_title = EXCLUDED.section_title,
  verse = EXCLUDED.verse,
  meaning = EXCLUDED.meaning,
  explanation_modern = EXCLUDED.explanation_modern,
  life_application = EXCLUDED.life_application,
  source = EXCLUDED.source,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.get_thirukkural_localized(
  p_kural_number INTEGER,
  p_language_code TEXT DEFAULT 'en'
)
RETURNS TABLE (
  kural_number INTEGER,
  chapter_tamil TEXT,
  chapter_english TEXT,
  section_tamil TEXT,
  section_english TEXT,
  kural_tamil TEXT,
  kural_transliteration TEXT,
  meaning_tamil TEXT,
  meaning_english TEXT,
  language_code TEXT,
  chapter_title TEXT,
  section_title TEXT,
  verse TEXT,
  meaning TEXT,
  explanation_modern TEXT,
  life_application TEXT,
  translation_source TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.kural_number,
    t.chapter_tamil::TEXT,
    t.chapter_english::TEXT,
    t.section_tamil::TEXT,
    t.section_english::TEXT,
    t.kural_tamil,
    t.kural_transliteration,
    t.meaning_tamil,
    t.meaning_english,
    l.language_code,
    l.chapter_title,
    l.section_title,
    l.verse,
    l.meaning,
    l.explanation_modern,
    l.life_application,
    l.source
  FROM public.thirukkural t
  JOIN public.thirukkural_localizations l
    ON l.kural_number = t.kural_number
   AND l.language_code = p_language_code
  WHERE t.kural_number = p_kural_number;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_thirukkural_localized(
  p_date DATE DEFAULT CURRENT_DATE,
  p_language_code TEXT DEFAULT 'en',
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  kural_number INTEGER,
  chapter_tamil TEXT,
  chapter_english TEXT,
  section_tamil TEXT,
  section_english TEXT,
  kural_tamil TEXT,
  kural_transliteration TEXT,
  meaning_tamil TEXT,
  meaning_english TEXT,
  language_code TEXT,
  chapter_title TEXT,
  section_title TEXT,
  verse TEXT,
  meaning TEXT,
  explanation_modern TEXT,
  life_application TEXT,
  translation_source TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  selected_id INTEGER;
  selected_number INTEGER;
  total_count INTEGER;
  selected_offset INTEGER;
BEGIN
  IF p_language_code NOT IN ('ta', 'en', 'hi', 'te', 'kn', 'ml') THEN
    RAISE EXCEPTION 'Unsupported language code: %', p_language_code;
  END IF;

  SELECT count(*)::INTEGER INTO total_count FROM public.thirukkural;
  IF total_count = 0 THEN
    RETURN;
  END IF;

  IF p_offset = 0 THEN
    SELECT d.kural_id INTO selected_id
    FROM public.daily_thirukkural_selection d
    WHERE d.date = p_date;

    IF selected_id IS NULL THEN
      selected_offset := (extract(doy FROM p_date)::INTEGER - 1) % total_count;
      SELECT t.id, t.kural_number INTO selected_id, selected_number
      FROM public.thirukkural t
      ORDER BY t.kural_number
      OFFSET selected_offset
      LIMIT 1;

      INSERT INTO public.daily_thirukkural_selection(date, kural_id, theme)
      VALUES (p_date, selected_id, 'Daily Wisdom')
      ON CONFLICT (date) DO NOTHING;

      SELECT d.kural_id INTO selected_id
      FROM public.daily_thirukkural_selection d
      WHERE d.date = p_date;
    END IF;

    SELECT t.kural_number INTO selected_number
    FROM public.thirukkural t
    WHERE t.id = selected_id;
  ELSE
    selected_offset := (
      (extract(doy FROM p_date)::INTEGER - 1 + p_offset) % total_count + total_count
    ) % total_count;
    SELECT t.kural_number INTO selected_number
    FROM public.thirukkural t
    ORDER BY t.kural_number
    OFFSET selected_offset
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT * FROM public.get_thirukkural_localized(selected_number, p_language_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_thirukkural_localized(INTEGER, TEXT)
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_thirukkural_localized(DATE, TEXT, INTEGER)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_thirukkural_localization_coverage()
RETURNS TABLE (
  language_code TEXT,
  translated_count BIGINT,
  expected_count BIGINT,
  is_complete BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH languages(language_code) AS (
    VALUES ('ta'), ('en'), ('hi'), ('te'), ('kn'), ('ml')
  ),
  expected AS (
    SELECT count(*)::BIGINT AS count FROM public.thirukkural
  )
  SELECT
    languages.language_code,
    count(l.kural_number)::BIGINT,
    expected.count,
    count(l.kural_number)::BIGINT = expected.count
  FROM languages
  CROSS JOIN expected
  LEFT JOIN public.thirukkural_localizations l
    ON l.language_code = languages.language_code
  GROUP BY languages.language_code, expected.count
  ORDER BY languages.language_code;
$$;

GRANT EXECUTE ON FUNCTION public.get_thirukkural_localization_coverage()
  TO authenticated;
