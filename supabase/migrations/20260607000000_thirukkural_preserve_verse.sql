-- Preserve the original couplet identity in every localized row.
-- Meaning stays translated; verse is always the couplet text itself.

UPDATE public.thirukkural_localizations l
SET
  verse = CASE
    WHEN l.language_code = 'ta' THEN t.kural_tamil
    ELSE t.kural_transliteration
  END,
  updated_at = now()
FROM public.thirukkural t
WHERE t.kural_number = l.kural_number
  AND l.verse IS DISTINCT FROM CASE
    WHEN l.language_code = 'ta' THEN t.kural_tamil
    ELSE t.kural_transliteration
  END;

