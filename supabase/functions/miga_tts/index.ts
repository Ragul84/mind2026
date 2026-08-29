import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TTSRequest {
  text: string;
  voice_id?: string;
  language_code?: string;
}

const INDIAN_LANGUAGE_CODES = new Set(["ta-IN", "hi-IN", "te-IN", "kn-IN", "ml-IN"]);

const toBytesFromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const chooseSarvamSpeaker = (languageCode: string) => {
  const byLanguage: Record<string, string> = {
    "ta-IN": "gokul",
    "hi-IN": "anushka",
    "te-IN": "abhilash",
    "kn-IN": "mani",
    "ml-IN": "vidya",
  };
  return byLanguage[languageCode] || "shubh";
};

const buildCacheKey = (text: string, providerSignature: string) => `${text}::${providerSignature}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { text, voice_id, language_code } = (await req.json()) as TTSRequest;
    if (!text) throw new Error("Text is required");

    const normalizedLanguageCode = String(language_code || "en-IN").trim() || "en-IN";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") || Deno.env.get("OPENAI_KEY") || "";
    const openaiModel = Deno.env.get("OPENAI_TTS_MODEL") || "gpt-4o-mini-tts-2025-12-15";
    const openaiVoice = voice_id || Deno.env.get("OPENAI_TTS_VOICE") || "coral";

    const sarvamKey = Deno.env.get("SARVAM_API_KEY") || "";
    const sarvamModel = Deno.env.get("SARVAM_TTS_MODEL") || "bulbul:v2";
    const sarvamPace = Number(Deno.env.get("SARVAM_TTS_PACE") || "1.0");
    const sarvamTemperature = Number(Deno.env.get("SARVAM_TTS_TEMPERATURE") || "0.4");
    const sarvamSampleRate = Number(Deno.env.get("SARVAM_TTS_SAMPLE_RATE") || "22050");
    const sarvamCodec = Deno.env.get("SARVAM_TTS_CODEC") || "mp3";

    const useSarvam = INDIAN_LANGUAGE_CODES.has(normalizedLanguageCode) && !!sarvamKey;
    const providerSignature = useSarvam
      ? `sarvam:${sarvamModel}:${chooseSarvamSpeaker(normalizedLanguageCode)}:${normalizedLanguageCode}`
      : `openai:${openaiModel}:${openaiVoice}:${normalizedLanguageCode}`;

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const msgUint8 = new TextEncoder().encode(buildCacheKey(text, providerSignature));
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    const fileName = `${hashHex}.mp3`;

    const { data: existingFile } = await supabaseClient.storage.from("mascot_audio_cache").getPublicUrl(fileName);
    const headResponse = await fetch(existingFile.publicUrl, { method: "HEAD" });
    if (headResponse.ok) {
      console.log("[miga_tts] cache hit", { fileName, providerSignature });
      return new Response(JSON.stringify({ url: existingFile.publicUrl, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let audioBlob: Blob;
    if (useSarvam) {
      console.log("[miga_tts] cache miss -> Sarvam", { language: normalizedLanguageCode, model: sarvamModel });
      const response = await fetch("https://api.sarvam.ai/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-subscription-key": sarvamKey,
        },
        body: JSON.stringify({
          text,
          target_language_code: normalizedLanguageCode,
          model: sarvamModel,
          speaker: chooseSarvamSpeaker(normalizedLanguageCode),
          pace: sarvamPace,
          temperature: sarvamTemperature,
          speech_sample_rate: sarvamSampleRate,
          output_audio_codec: sarvamCodec,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("[miga_tts] Sarvam error", err);
        throw new Error(`Sarvam API Error: ${response.status} ${err}`);
      }

      const data = await response.json();
      const audioBase64 = data?.audios?.[0];
      if (!audioBase64) throw new Error("Sarvam returned empty audio");
      audioBlob = new Blob([toBytesFromBase64(audioBase64)], { type: "audio/mpeg" });
    } else {
      console.log("[miga_tts] cache miss -> OpenAI", { model: openaiModel, voice: openaiVoice, language: normalizedLanguageCode });
      if (!openaiKey) throw new Error("Missing OPENAI_API_KEY in Edge Function Secrets");

      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: openaiModel,
          input: text,
          voice: openaiVoice,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("[miga_tts] OpenAI error", err);
        throw new Error(`OpenAI API Error: ${response.status} ${err}`);
      }

      audioBlob = await response.blob();
    }

    (async () => {
      try {
        await supabaseClient.storage.from("mascot_audio_cache").upload(fileName, audioBlob, {
          contentType: "audio/mpeg",
          upsert: true,
        });
        console.log("[miga_tts] cache write ok", { fileName });
      } catch (error) {
        console.error("[miga_tts] cache write failed", error);
      }
    })();

    return new Response(audioBlob, {
      headers: {
        ...corsHeaders,
        "Content-Type": "audio/mpeg",
        "X-Cached": "false",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
