// Generates a coaching-level "revision sprint" for one weak topic: a few crisp
// revision cards + one checkpoint MCQ, grounded in why the topic is weak.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const cleanJSON = (text: string) => {
  let t = String(text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("{"); const e = t.lastIndexOf("}");
  return s !== -1 && e !== -1 && e > s ? t.slice(s, e + 1) : t;
};

const SYSTEM = `You are a senior UPSC/TNPSC coaching-centre faculty running a fast revision sprint.
TASK: For the given weak topic, produce a tight, high-yield revision set.
RULES:
- Coaching quality: precise, exam-relevant, no filler, no motivational lines.
- 3 revision cards. Each card: a short heading, 2 to 3 crisp bullet points (full, exam-ready facts), and one "insight" line (the exam angle, a common trap, or a memory hook).
- Bold nothing; return plain text (the app styles it).
- Then ONE checkpoint MCQ that can be answered ONLY from the cards above. 4 options, exactly one correct.
- Keep it factual and current. Do not invent citations, page numbers, or fake data.
OUTPUT: STRICT JSON ONLY, no prose:
{
  "topic": "TOPIC",
  "cards": [
    { "heading": "…", "points": ["…","…"], "insight": "…" }
  ],
  "checkpoint": { "question": "…", "options": ["…","…","…","…"], "answerIndex": 0, "explanation": "…" }
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) return json({ success: false, error: "Not configured" }, 500);
    const { topic, reason, exam = "UPSC" } = await req.json().catch(() => ({}));
    if (!topic || !String(topic).trim()) return json({ success: false, error: "topic required" }, 400);

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://mindgains.ai",
        "X-Title": "MindGains Sprint",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENROUTER_MODEL") || "google/gemini-2.0-flash-001",
        temperature: 0.5,
        max_tokens: 1200,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: `WEAK TOPIC: ${topic}\nTARGET EXAM: ${exam}\nWHY WEAK: ${reason || "missed related questions"}\n\nReturn ONLY the JSON.` },
        ],
      }),
    });
    if (!res.ok) return json({ success: false, error: `LLM ${res.status}` }, 502);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return json({ success: false, error: "empty" }, 502);

    let parsed: any;
    try { parsed = JSON.parse(cleanJSON(content)); } catch { return json({ success: false, error: "bad json" }, 502); }

    const cards = Array.isArray(parsed?.cards) ? parsed.cards.slice(0, 4).map((c: any) => ({
      heading: String(c?.heading || "Key point"),
      points: Array.isArray(c?.points) ? c.points.map((p: any) => String(p)).slice(0, 4) : [],
      insight: c?.insight ? String(c.insight) : "",
    })) : [];
    const cp = parsed?.checkpoint || {};
    const checkpoint = Array.isArray(cp?.options) && cp.options.length >= 2 ? {
      question: String(cp.question || "Which statement is correct?"),
      options: cp.options.map((o: any) => String(o)).slice(0, 4),
      answerIndex: Number.isInteger(cp.answerIndex) ? cp.answerIndex : 0,
      explanation: String(cp.explanation || ""),
    } : null;

    if (cards.length === 0) return json({ success: false, error: "no cards" }, 502);
    return json({ success: true, sprint: { topic: String(parsed?.topic || topic), cards, checkpoint } });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
});
