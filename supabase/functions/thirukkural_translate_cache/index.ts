import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TranslateCacheRequest = {
  kural_number: number;
  target_language_code: string; // e.g. ta-IN, hi-IN
  lang: string; // app language code e.g. ta, hi
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = (await req.json()) as TranslateCacheRequest;
    const authHeader = req.headers.get('Authorization') ?? '';

    if (!body?.kural_number || !body?.target_language_code || !body?.lang) {
      return new Response(JSON.stringify({ error: 'Missing parameters' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // 1) Return the permanent localization if it already exists.
    const { data: cached } = await supabaseAdmin
      .from('thirukkural_localizations')
      .select('*')
      .eq('kural_number', body.kural_number)
      .eq('language_code', body.lang)
      .maybeSingle();

    if (cached?.verse) {
      return new Response(JSON.stringify({ success: true, cached: true, data: cached }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2) Fetch base content from thirukkural table
    const { data: base, error: baseError } = await supabaseAdmin
      .from('thirukkural')
      .select('kural_tamil, chapter_english, section_english, meaning_english, explanation_modern, life_application')
      .eq('kural_number', body.kural_number)
      .maybeSingle();

    if (baseError || !base) {
      return new Response(JSON.stringify({ error: 'Kural not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const sarvamKey = Deno.env.get('SARVAM_API_KEY');
    if (!sarvamKey) {
      return new Response(JSON.stringify({ error: 'Missing SARVAM_API_KEY' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const translate = async (
      text: string | null,
      sourceLanguageCode = 'en-IN',
      targetLanguageCode = body.target_language_code,
    ) => {
      if (!text?.trim()) return '';
      const res = await fetch('https://api.sarvam.ai/translate', {
        method: 'POST',
        headers: {
          'api-subscription-key': sarvamKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input: text,
          source_language_code: sourceLanguageCode,
          target_language_code: targetLanguageCode,
          model: 'mayura:v1',
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const payload = await res.json();
      return payload.translated_text || '';
    };

    const verseTarget = body.lang === 'ta'
      ? base.kural_tamil
      : body.lang === 'en'
        ? base.kural_transliteration
        : null;

    const [chapter, section, translatedVerse, meaning, modern, application] = await Promise.all([
      translate(base.chapter_english),
      translate(base.section_english),
      verseTarget ?? translate(base.kural_tamil, 'ta-IN', body.target_language_code),
      translate(base.meaning_english),
      translate(base.explanation_modern),
      translate(base.life_application),
    ]);

    const insertPayload = {
      kural_number: body.kural_number,
      language_code: body.lang,
      chapter_title: chapter,
      section_title: section,
      verse: translatedVerse,
      meaning,
      explanation_modern: modern,
      life_application: application,
      source: 'sarvam-mayura-v1',
      translation_version: 1,
      updated_at: new Date().toISOString(),
    };

    const { data: saved } = await supabaseAdmin
      .from('thirukkural_localizations')
      .upsert(insertPayload, { onConflict: 'kural_number,language_code' })
      .select('*')
      .maybeSingle();

    return new Response(JSON.stringify({ success: true, cached: false, data: saved || insertPayload }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Unexpected error', details: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
