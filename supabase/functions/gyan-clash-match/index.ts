import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type RedisQuestion = {
  id?: string;
  question?: string;
  question_text?: string;
  options?: string[];
  answer_index?: number;
  correct_answer?: number;
  explanation?: string;
  difficulty?: string;
};

type GyanQuestion = {
  id: string;
  subject: string;
  prompt: string;
  choices: { id: string; text: string }[];
  correctChoiceId: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
};

const SUBJECT_KEYS = ["polity", "history", "geography", "science", "economics", "maths", "english", "tamil"];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "create");

    if (action === "create") {
      const questions = await buildQuestionSet(15);
      const matchId = crypto.randomUUID();
      await redisPost(["SET", matchKey(matchId), JSON.stringify({ questions, createdAt: Date.now() }), "EX", "3600"]);
      return json({ success: true, matchId, questions: questions.map(publicQuestion) });
    }

    if (action === "submit") {
      const matchId = String(body.matchId || "");
      const questionId = String(body.questionId || "");
      const selectedChoiceId = String(body.selectedChoiceId || "");
      if (!matchId || !questionId || !selectedChoiceId) return json({ success: false, error: "Invalid answer" }, 400);

      const raw = await redisGet(matchKey(matchId));
      if (!raw) return json({ success: false, error: "Match expired" }, 404);
      const match = JSON.parse(raw);
      const questions = Array.isArray(match.questions) ? match.questions as GyanQuestion[] : [];
      const question = questions.find((item) => item.id === questionId);
      if (!question) return json({ success: false, error: "Question not in match" }, 400);

      const correct = selectedChoiceId === question.correctChoiceId;
      return json({
        success: true,
        correct,
        correctChoiceId: question.correctChoiceId,
        scoreDelta: correct ? 100 : 0,
        damage: correct ? 14 : 0,
      });
    }

    return json({ success: false, error: "Unknown action" }, 400);
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
});

async function buildQuestionSet(count: number): Promise<GyanQuestion[]> {
  const shuffledKeys = shuffle(SUBJECT_KEYS);
  const batches = await Promise.all(shuffledKeys.map(async (key) => {
    const raw = await redisPost<string[]>(["LRANGE", `quiz:subject:${key}`, "0", "-1"]);
    const parsed = (raw || []).map(parseQuestion).filter(Boolean) as RedisQuestion[];
    return shuffle(parsed).slice(0, 4).map((question, index) => toGyanQuestion(question, key, index)).filter(Boolean) as GyanQuestion[];
  }));
  const questions = shuffle(batches.flat()).slice(0, count);
  if (questions.length === 0) throw new Error("No Redis questions available");
  return questions;
}

function publicQuestion(question: GyanQuestion): Omit<GyanQuestion, "correctChoiceId"> {
  const { correctChoiceId: _hidden, ...safeQuestion } = question;
  return safeQuestion;
}

function toGyanQuestion(q: RedisQuestion, subject: string, index: number): GyanQuestion | null {
  const prompt = String(q.question_text || q.question || "").trim();
  const options = Array.isArray(q.options) ? q.options.map(String).filter(Boolean).slice(0, 4) : [];
  if (!prompt || options.length < 2) return null;
  const rawIndex = typeof q.correct_answer === "number" ? q.correct_answer : typeof q.answer_index === "number" ? q.answer_index : 0;
  const correctIndex = Math.max(0, Math.min(options.length - 1, rawIndex));
  const difficulty = q.difficulty === "hard" || q.difficulty === "medium" ? q.difficulty : "easy";
  return {
    id: String(q.id || `${subject}-${index}-${hashText(prompt)}`),
    subject,
    prompt,
    choices: options.map((text, choiceIndex) => ({ id: String.fromCharCode(97 + choiceIndex), text })),
    correctChoiceId: String.fromCharCode(97 + correctIndex),
    explanation: String(q.explanation || ""),
    difficulty,
  };
}

function parseQuestion(raw: string): RedisQuestion | null {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as RedisQuestion;
  } catch {
    return null;
  }
}

async function redisGet(key: string): Promise<string | null> {
  return await redisPost<string>(["GET", key]);
}

async function redisPost<T>(command: (string | number)[]): Promise<T | null> {
  const url = Deno.env.get("UPSTASH_REDIS_REST_URL") || Deno.env.get("EXPO_PUBLIC_UPSTASH_REDIS_REST_URL");
  const token = Deno.env.get("UPSTASH_REDIS_REST_TOKEN") || Deno.env.get("EXPO_PUBLIC_UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) throw new Error("Upstash Redis is not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const jsonBody = await res.json();
  return jsonBody.result ?? null;
}

function matchKey(matchId: string) {
  return `gyan_clash:match:${matchId}`;
}

function shuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

function hashText(text: string): string {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(16);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
