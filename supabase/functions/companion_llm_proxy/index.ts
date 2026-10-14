import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildTextbookSystemPrompt,
  citationsUsed,
  lastUserText,
  normaliseScope,
  retrieveTextbookPages,
  type TextbookCitation,
} from "../_shared/textbookRetrieval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Only the models this app's Companion/chat-titling features are actually
// built around. This proxy exists so the OpenRouter key never ships in the
// client bundle (it previously did, via EXPO_PUBLIC_OPENROUTER_API_KEY, in
// services/companion/modelRouter.ts and components/ui/MigaChat.tsx) — an
// open model allow-list here would just move the same "anyone can spend our
// OpenRouter credits" risk one hop, not remove it.
const ALLOWED_MODELS = new Set([
  "deepseek/deepseek-v4-flash",
  "google/gemini-2.0-flash-lite:free",
  "google/gemini-2.0-flash-001",
]);
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const MAX_TOKENS_CEILING = 4000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !openRouterKey) {
      return json({ success: false, error: "Server LLM proxy is not configured." }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return json({ success: false, error: "Authentication required." }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) {
      return json({ success: false, error: "Invalid session." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || messages.length === 0) {
      return json({ success: false, error: "messages[] is required." }, 400);
    }

    const model = ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
    const maxTokens = Math.min(Number(body.max_tokens) || 2500, MAX_TOKENS_CEILING);
    let temperature = typeof body.temperature === "number" ? body.temperature : 0.8;

    // Textbook-aware mode: retrieve page-level passages from the student's own
    // board/class and force book/chapter/page citations. Scope comes from the
    // request, falling back to the student's saved profile.
    let finalMessages = messages;
    let citations: TextbookCitation[] = [];
    const textbookMode = body.textbook_mode === true;
    if (textbookMode) {
      try {
        let scope = normaliseScope(body.textbook_scope);
        if (!scope.board || !scope.classLevel) {
          const { data: profile } = await authClient
            .from("user_profiles")
            .select("textbook_board, textbook_class, textbook_language")
            .eq("id", authData.user.id)
            .maybeSingle();
          scope = {
            board: scope.board ?? profile?.textbook_board ?? null,
            classLevel: scope.classLevel ?? profile?.textbook_class ?? null,
            subject: scope.subject ?? null,
            language: scope.language ?? profile?.textbook_language ?? null,
          };
        }
        const query = typeof body.textbook_query === "string" && body.textbook_query.trim()
          ? body.textbook_query
          : lastUserText(messages);
        citations = await retrieveTextbookPages(authClient, query, scope);
        finalMessages = [{ role: "system", content: buildTextbookSystemPrompt(citations) }, ...messages];
        temperature = Math.min(temperature, 0.3);
      } catch (e) {
        console.error("[companion_llm_proxy] textbook retrieval failed", e instanceof Error ? e.message : e);
      }
    }

    const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openRouterKey}`,
        "HTTP-Referer": "https://mindgains.app",
        "X-Title": "MindGains Companion",
      },
      body: JSON.stringify({ model, messages: finalMessages, max_tokens: maxTokens, temperature }),
    });

    if (!completion.ok) {
      const errText = await completion.text().catch(() => "");
      return json({ success: false, error: `OpenRouter request failed (${completion.status}): ${errText.slice(0, 300)}` }, 502);
    }

    const payload = await completion.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return json({ success: false, error: "Empty response from model." }, 502);
    }

    return json({
      success: true,
      content,
      ...(textbookMode ? { textbook_mode: true, citations: citationsUsed(content, citations) } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return json({ success: false, error: message }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
