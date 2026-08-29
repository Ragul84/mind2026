import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { topic, count } = await req.json();
    
    // Cognitive Engine System Prompt for Quizzes
    const QUIZ_PROMPT = `
    You are the "Evaluator Engine" of India's top competitive coaching API.
    Your task is to generate a **High-Cognitive Load Quiz** on the given topic.
    
    RULES:
    - Questions must test **Application & Analysis** (not just Rote Memory).
    - Options must be tricky (distractors).
    - "explain_short" must cut to the core concept instantly.
    
    OUTPUT JSON FORMAT:
    {
      "questions": [
        {
          "q": "Question text...",
          "options": ["A","B","C","D"],
          "answer_index": 0, // 0-3
          "explain_short": "1-line crisp reason."
        }
      ]
    }
    `;

    // Call OpenRouter
    const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? Deno.env.get('EXPO_PUBLIC_OPENROUTER_API_KEY');
    
    if (!OPENROUTER_API_KEY) {
        // Fallback Mock
        return new Response(JSON.stringify({ 
            topic, 
            questions: Array.from({ length: count || 3 }).map((_, i) => ({
                q: `Mock Cognitive Question ${i + 1} on ${topic}?`,
                options: ["Theory A", "Theory B", "Theory C", "Theory D"],
                answer_index: 0,
                explain_short: "Mock explanation."
            })), 
            quiz_id: crypto.randomUUID() 
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // google/gemini-2.5-flash is already proven reliable via OpenRouter elsewhere
    // in this app (MIGA chat, Study Lab) — meta-llama/llama-3.1-8b-instruct here
    // had no verified track record and this function had zero error handling
    // around it, so any hiccup (bad model id, provider outage, non-JSON reply)
    // silently produced an HTTP 500 that the client swallowed into "0 questions
    // generated", which every historical quiz room then papered over with fake
    // placeholder questions and no visible error to the user.
    const model = Deno.env.get('OPENROUTER_QUIZ_MODEL') || Deno.env.get('OPENROUTER_MODEL') || "google/gemini-2.5-flash";
    const completion = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://mindgains.app",
        "X-Title": "MindGains Quiz Engine"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: QUIZ_PROMPT },
          { role: "user", content: `Generate ${count || 3} questions on: "${topic}"` }
        ],
        response_format: { type: "json_object" },
        max_tokens: 2000,
      })
    });

    if (!completion.ok) {
      const errText = await completion.text().catch(() => '');
      throw new Error(`OpenRouter request failed (${completion.status}): ${errText.slice(0, 300)}`);
    }

    const llmResponse = await completion.json();
    const rawContent = llmResponse?.choices?.[0]?.message?.content;
    if (!rawContent) {
      throw new Error(`OpenRouter returned no completion content: ${JSON.stringify(llmResponse).slice(0, 300)}`);
    }

    let quizContent: { questions?: unknown };
    try {
      quizContent = JSON.parse(rawContent);
    } catch {
      throw new Error(`Model reply was not valid JSON: ${String(rawContent).slice(0, 300)}`);
    }

    if (!Array.isArray(quizContent.questions) || quizContent.questions.length === 0) {
      throw new Error('Model reply had no usable questions array.');
    }

    return new Response(JSON.stringify({
        topic,
        questions: quizContent.questions,
        quiz_id: crypto.randomUUID()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`[miga_quiz_burst_generate] failed: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
