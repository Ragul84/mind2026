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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ success: false, error: "Not configured" }, 500);

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ success: false, error: "Authentication required" }, 401);

    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ success: false, error: "Invalid session" }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId ?? "");
    const questionId = String(body.questionId ?? "");
    const selectedIndex = Number(body.selectedIndex);
    const timeTaken = Math.max(0, Math.min(Number(body.timeTaken) || 0, 30));

    if (!sessionId || !questionId || !Number.isInteger(selectedIndex)) {
      return json({ success: false, error: "Invalid answer" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: session, error: sessionError } = await admin
      .from("game_sessions")
      .select("id, question_ids, status")
      .eq("id", sessionId)
      .maybeSingle();
    if (sessionError || !session) return json({ success: false, error: "Session not found" }, 404);

    const questionIds = Array.isArray(session.question_ids) ? session.question_ids.map(String) : [];
    if (!questionIds.includes(questionId)) return json({ success: false, error: "Question not in session" }, 400);

    const { data: participant, error: participantError } = await admin
      .from("game_participants")
      .select("id, score, answers, finished_at")
      .eq("game_session_id", sessionId)
      .eq("user_id", authData.user.id)
      .maybeSingle();
    if (participantError || !participant) return json({ success: false, error: "Participant not found" }, 404);
    if (participant.finished_at) return json({ success: false, error: "Session already finished" }, 409);

    const existingAnswers = Array.isArray(participant.answers) ? participant.answers : [];
    if (existingAnswers.some((answer: any) => String(answer.question_id) === questionId)) {
      return json({ success: true, duplicate: true, score: Number(participant.score) || 0 });
    }

    const { data: question, error: questionError } = await admin
      .from("vault_questions")
      .select("id, correct_answer")
      .eq("id", questionId)
      .maybeSingle();
    if (questionError || !question) return json({ success: false, error: "Question not found" }, 404);

    const isCorrect = selectedIndex === Number(question.correct_answer);
    const points = isCorrect ? 100 : 0;
    const nextScore = (Number(participant.score) || 0) + points;
    const answer = {
      question_id: questionId,
      selected_index: selectedIndex,
      is_correct: isCorrect,
      time_taken: timeTaken,
      points,
      submitted_at: new Date().toISOString(),
    };

    const { error: updateError } = await admin
      .from("game_participants")
      .update({
        score: nextScore,
        answers: [...existingAnswers, answer],
      })
      .eq("id", participant.id);
    if (updateError) return json({ success: false, error: updateError.message }, 500);

    return json({ success: true, score: nextScore, answer });
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
