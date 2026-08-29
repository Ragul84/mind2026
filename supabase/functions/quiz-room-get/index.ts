import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json({ success: false, error: "Not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const id = body.id ? String(body.id) : null;
    const code = body.code ? String(body.code).toUpperCase().trim() : null;
    if (!id && !code) return json({ success: false, error: "Room id or code required" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    let query = admin.from("quiz_rooms").select("*");
    query = id ? query.eq("id", id) : query.eq("join_code", code);
    const { data, error } = await query.maybeSingle();

    if (error || !data) return json({ success: false, error: "Room not found" }, 404);

    const questions = Array.isArray(data.questions_data) ? data.questions_data : [];
    const sanitized = questions.map((question: any) => ({
      ...question,
      question: question.question || question.question_text || question.prompt || question.passage || "Sample Question",
      options: Array.isArray(question.options) ? question.options : undefined,
      answer_index: typeof question.answer_index === "number" ? question.answer_index : undefined,
      answer_key: Array.isArray(question.answer_key) ? question.answer_key : undefined,
      question_type: question.question_type || question.type || undefined,
    }));

    return json({
      success: true,
      room: {
        ...data,
        questions_data: sanitized,
      },
    });
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
