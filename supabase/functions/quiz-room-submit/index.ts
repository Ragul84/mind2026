import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function inferQuestionType(question: any): string {
  if (question?.question_type) return String(question.question_type);
  if (Array.isArray(question?.pairs) && question.pairs.length > 0) return "match";
  if (Array.isArray(question?.sequence) && question.sequence.length > 0) return "sequence";
  if (Array.isArray(question?.items) && question.items.length > 0) return "sequence";
  if (question?.blank_answer || question?.answer_text) return "fill_blank";
  if (Array.isArray(question?.statements) && question.statements.length > 0) return "multi_statement";
  return "mcq";
}

function evalQuestion(question: any, raw: any) {
  const type = inferQuestionType(question);
  if (type === "fill_blank") {
    const expected = normalizeText(question?.blank_answer || question?.answer_text);
    const response = normalizeText(raw?.text || raw?.answer || raw?.value || "");
    return { isCorrect: !!expected && expected === response, selectedIndex: -1 };
  }
  if (type === "match") {
    const expected = Array.isArray(question?.answer_key) ? question.answer_key.map((x: any) => String(x)) : [];
    const selected = Array.isArray(raw?.mapping) ? raw.mapping.map((x: any) => String(x)) : [];
    const isCorrect = expected.length > 0 && expected.length === selected.length && expected.every((item, idx) => item === selected[idx]);
    return { isCorrect, selectedIndex: -1 };
  }
  if (type === "sequence") {
    const expectedSource = Array.isArray(question?.answer_key) && question.answer_key.length ? question.answer_key : question?.sequence;
    const expected = Array.isArray(expectedSource) ? expectedSource.map((x: any) => String(x)) : [];
    const selected = Array.isArray(raw?.order) ? raw.order.map((x: any) => String(x)) : [];
    const isCorrect = expected.length > 0 && expected.length === selected.length && expected.every((item, idx) => item === selected[idx]);
    return { isCorrect, selectedIndex: -1 };
  }

  const selectedIndex = Number.isInteger(raw?.selectedIndex) ? Number(raw.selectedIndex) : Number.isInteger(raw?.selected_index) ? Number(raw.selected_index) : -1;
  const correctIndex = Number.isInteger(question?.answer_index) ? Number(question.answer_index) : 0;
  return {
    isCorrect: selectedIndex === correctIndex,
    selectedIndex,
  };
}

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
    const participantId = String(body.participantId ?? "");
    const submittedAnswers = Array.isArray(body.answers) ? body.answers : [];

    if (!participantId || submittedAnswers.length === 0 || submittedAnswers.length > 100) {
      return json({ success: false, error: "Invalid submission" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: participant, error: participantError } = await admin
      .from("quiz_room_participants")
      .select("id, room_id, user_id, completed_at")
      .eq("id", participantId)
      .maybeSingle();

    if (participantError || !participant) return json({ success: false, error: "Participant not found" }, 404);
    if (participant.user_id !== authData.user.id) return json({ success: false, error: "Participant mismatch" }, 403);
    if (participant.completed_at) return json({ success: false, error: "Already submitted" }, 409);

    const { data: room, error: roomError } = await admin
      .from("quiz_rooms")
      .select("id, questions_data, question_count, time_per_question")
      .eq("id", participant.room_id)
      .maybeSingle();

    if (roomError || !room) return json({ success: false, error: "Room not found" }, 404);

    const questions = Array.isArray(room.questions_data) ? room.questions_data : [];
    const answersByIndex = new Map<number, any>();
    for (const raw of submittedAnswers) {
      const index = Number(raw.question_index);
      if (!Number.isInteger(index) || index < 0 || index >= questions.length) continue;
      if (answersByIndex.has(index)) continue;
      answersByIndex.set(index, raw);
    }

    let score = 0;
    let totalTime = 0;
    const sanitizedAnswers = [...answersByIndex.entries()]
      .sort(([a], [b]) => a - b)
      .map(([questionIndex, raw]) => {
        const question = questions[questionIndex];
        const selected = Number(raw.selected_index);
        const timeTaken = Math.max(0, Math.min(Number(raw.time_taken) || 0, Number(room.time_per_question) + 5));
        const evaluated = evalQuestion(question, raw.response ?? raw);
        const correctIndex = Number.isInteger(question?.answer_index) ? Number(question.answer_index) : 0;
        const isCorrect = !!evaluated.isCorrect;
        if (isCorrect) score += 1;
        totalTime += timeTaken;
        return {
          question_index: questionIndex,
          selected_index: Number.isInteger(selected) ? selected : evaluated.selectedIndex ?? -1,
          is_correct: isCorrect,
          time_taken: timeTaken,
          question_type: question?.question_type || null,
        };
      });

    if (sanitizedAnswers.length !== questions.length) {
      await admin.from("anticheat_events").insert({
        user_id: authData.user.id,
        event_type: "quiz_room_incomplete_submission",
        severity: "medium",
        metadata: { participantId, expected: questions.length, received: sanitizedAnswers.length },
      });
    }

    const { error: updateError } = await admin
      .from("quiz_room_participants")
      .update({
        score,
        time_taken: totalTime,
        answers: sanitizedAnswers,
        completed_at: new Date().toISOString(),
      })
      .eq("id", participantId);

    if (updateError) return json({ success: false, error: updateError.message }, 500);

    return json({ success: true, score, timeTaken: totalTime, answers: sanitizedAnswers });
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
