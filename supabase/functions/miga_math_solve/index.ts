import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type MathMode = "extract" | "solve" | "paper";

const INDIC_LANGUAGES = ["ta", "te", "kn", "ml", "hi"];

// google/gemini-flash-1.5 and google/gemini-2.0-flash-001 returned no OpenRouter endpoints in June 2026.
// Keep this model id periodically verified because OpenRouter Gemini availability changes quickly.
const INDIC_MATH_MODEL = "google/gemini-3.1-flash-lite";
const FOUNDER_PRO_PHONES = new Set(["8220949220", "918220949220"]);

const languageRoot = (languageCode: string) => languageCode.toLowerCase().split(/[-_]/)[0];

const getModelForLanguage = (languageCode: string) => {
  if (INDIC_LANGUAGES.includes(languageRoot(languageCode))) {
    return {
      model: INDIC_MATH_MODEL,
      maxTokens: 1700,
      temperature: 0.15,
    };
  }
  return {
    model: Deno.env.get("OPENROUTER_MATH_MODEL") || Deno.env.get("OPENROUTER_MODEL") || "deepseek/deepseek-v4-flash",
    maxTokens: 2200,
    temperature: 0.15,
  };
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const normalizePhoneDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const isFounderProPhone = (value: unknown) => FOUNDER_PRO_PHONES.has(normalizePhoneDigits(value));
const normalizeImageMimeType = (value: unknown) => {
  const text = String(value ?? "").trim().toLowerCase();
  if (text.startsWith("image/")) return text;
  if (text === "png") return "image/png";
  if (text === "webp") return "image/webp";
  if (text === "heic" || text === "heif") return `image/${text}`;
  return "image/jpeg";
};
const normalizeImageDataUrl = (imageData: unknown, imageType: unknown) => {
  const text = String(imageData ?? "").trim();
  if (!text) return "";
  if (text.startsWith("data:image/")) return text;
  return `data:${normalizeImageMimeType(imageType)};base64,${text}`;
};

const requireProMathScanAccess = async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return { allowed: false, status: 500, error: "Server subscription gate is not configured." };
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === supabaseAnonKey) {
    return { allowed: false, status: 401, error: "Sign in is required for scanning." };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return { allowed: false, status: 401, error: "Invalid session." };
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileError } = await adminClient
    .from("user_profiles")
    .select("subscription_tier, phone_number")
    .eq("id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    return { allowed: false, status: 500, error: profileError.message };
  }

  const isPro = profile?.subscription_tier === "pro" || isFounderProPhone(profile?.phone_number);
  if (!isPro) {
    return { allowed: false, status: 402, error: "PRO required for math photo scanning." };
  }

  return { allowed: true, status: 200, error: "" };
};

const readJsonObject = (text: string) => {
  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  return JSON.parse(cleaned);
};

const callOpenRouter = async (messages: any[], maxTokens = 1400, temperature = 0.15, model?: string) => {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://mindgains.ai",
      "X-Title": "MindGains",
    },
    body: JSON.stringify({
      model: model || Deno.env.get("OPENROUTER_MATH_MODEL") || Deno.env.get("OPENROUTER_MODEL") || "deepseek/deepseek-v4-flash",
      messages,
      max_tokens: maxTokens,
      temperature,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content || "");
};

const callOpenRouterText = async (messages: any[], maxTokens = 1600, temperature = 0.01, model?: string) => {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": "https://mindgains.ai",
      "X-Title": "MindGains",
    },
    body: JSON.stringify({
      model: model || Deno.env.get("OPENROUTER_SOLVE_MODEL") || "openai/gpt-5.4-mini",
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`OpenRouter ${response.status}: ${err}`);
  }

  const data = await response.json();
  return String(data?.choices?.[0]?.message?.content || "");
};

const callOpenRouterJson = async (
  messages: any[],
  options: { languageCode?: string; maxTokens?: number; model?: string; temperature?: number } = {},
) => {
  const route = getModelForLanguage(options.languageCode || "en-IN");
  const model = options.model || route.model;
  const maxTokens = options.maxTokens || route.maxTokens;
  const temperature = options.temperature ?? route.temperature;
  const startedAt = Date.now();
  const first = await callOpenRouter(messages, maxTokens, temperature, model);
  try {
    return {
      parsed: readJsonObject(first),
      retryTriggered: false,
      elapsedMs: Date.now() - startedAt,
      model,
    };
  } catch (firstError) {
    console.warn("[miga_math_solve.json_retry]", firstError);
    const retry = await callOpenRouter(messages, maxTokens, 0.1, model);
    try {
      return {
        parsed: readJsonObject(retry),
        retryTriggered: true,
        elapsedMs: Date.now() - startedAt,
        model,
      };
    } catch (retryError) {
      console.warn("[miga_math_solve.json_parse_failed]", retryError);
      try {
        const repair = await callOpenRouter([
          {
            role: "system",
            content: "You repair malformed JSON for a tutoring app. Return only one valid JSON object. No markdown. Do not add explanations.",
          },
          {
            role: "user",
            content: [
              "Fix this malformed JSON. Preserve the same data and schema as much as possible.",
              "If an array item is broken, close it safely or remove only that broken item.",
              retry,
            ].join("\n\n"),
          },
        ], maxTokens, 0, model);
        return {
          parsed: readJsonObject(repair),
          retryTriggered: true,
          repaired: true,
          elapsedMs: Date.now() - startedAt,
          model,
        };
      } catch (repairError) {
        console.warn("[miga_math_solve.json_repair_failed]", repairError);
      }
      return {
        parsed: {},
        retryTriggered: true,
        parseFailed: true,
        elapsedMs: Date.now() - startedAt,
        model,
      };
    }
  }
};

const languageName = (code: string) => {
  const normalized = code.toLowerCase();
  if (normalized.startsWith("hi")) return "Hindi";
  if (normalized.startsWith("ta")) return "Tamil";
  if (normalized.startsWith("te")) return "Telugu";
  if (normalized.startsWith("kn")) return "Kannada";
  if (normalized.startsWith("ml")) return "Malayalam";
  return "English";
};

const normalizeAnswer = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();

const inferVerifiedAnswerFromSteps = (solution: any) => {
  const steps = Array.isArray(solution?.steps) ? solution.steps : [];
  const finalishSteps = steps.filter((step: any) => {
    const title = String(step?.title || "").toLowerCase();
    return title.includes("answer") || title.includes("final") || title.includes("verify") || title.includes("days for");
  });
  const sourceSteps = finalishSteps.length ? finalishSteps : steps.slice(-2);
  const text = sourceSteps.map((step: any) => [
    step?.title,
    ...(Array.isArray(step?.boardLines) ? step.boardLines : []),
    step?.spokenExplanation,
    step?.highlight,
  ].filter(Boolean).join(" ")).join(" ");

  const candidates = new Map<string, number>();
  const patterns = [
    /(?:answer|takes|take|days for [^=]+|time taken [^=]*)\s*(?:=|is|would be|:)?\s*([0-9]+(?:\.[0-9]+)?\s*(?:days?|hours?|minutes?|years?|months?))/gi,
    /([0-9]+(?:\.[0-9]+)?\s*(?:days?|hours?|minutes?|years?|months?))/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const candidate = normalizeAnswer(match[1]);
      candidates.set(candidate, (candidates.get(candidate) || 0) + 1);
    }
  }

  let best = "";
  let bestCount = 0;
  for (const [candidate, count] of candidates.entries()) {
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  if (!best || bestCount < 2) return "";
  return best;
};

const cleanMathSteps = (steps: any[]) => {
  const forbidden = /\b(wait|maybe|seems|let'?s re-check|re-check|let me re-read|but answer is|is that correct)\b/i;
  const cleaned = steps
    .filter((step: any) => !forbidden.test([
      step?.title,
      ...(Array.isArray(step?.boardLines) ? step.boardLines : []),
      step?.spokenExplanation,
      step?.highlight,
    ].filter(Boolean).join(" ")))
    .map((step: any) => ({
      ...step,
      boardLines: Array.isArray(step?.boardLines)
        ? step.boardLines.filter((line: any) => !forbidden.test(String(line || "")))
        : [],
      spokenExplanation: String(step?.spokenExplanation || "").replace(forbidden, "").trim(),
    }));
  return cleaned.length ? cleaned : steps;
};

const isValidCheckQuestion = (checkQuestion: any) => {
  const question = String(checkQuestion?.question || "").trim();
  const answer = String(checkQuestion?.answer || "").trim();
  if (question.length < 12 || answer.length < 8) return false;
  if (/final verified answer|final answer|what is the answer/i.test(question)) return false;
  if (!/[?]/.test(question)) return false;
  return true;
};

const mathOpeningLineForLanguage = (languageCode: string) => {
  switch (languageRoot(languageCode)) {
    case "ta":
      return "சரி, இந்தக் கேள்வியை பார்க்கலாம்.";
    case "hi":
      return "ठीक है, इस सवाल को देखते हैं.";
    case "te":
      return "సరే, ఈ ప్రశ్నను చూద్దాం.";
    case "kn":
      return "ಸರಿ, ಈ ಪ್ರಶ್ನೆಯನ್ನು ನೋಡೋಣ.";
    case "ml":
      return "ശരി, ഈ ചോദ്യം നോക്കാം.";
    default:
      return "Okay, let's look into this question.";
  }
};

const solveFallback = (problem: string, languageCode = "en-IN") => {
  const opening = mathOpeningLineForLanguage(languageCode);
  return {
  problem,
  answer: "Ready to solve",
  steps: [
    {
      title: "Question",
      boardLines: [problem],
      spokenExplanation: opening,
    },
    {
      title: "First step",
      boardLines: ["Look for the operation that can be undone first."],
      spokenExplanation: "We solve math by undoing one operation at a time, neatly and slowly.",
    },
  ],
    checkQuestion: {
      question: "Should I explain this more slowly?",
      answer: "yes",
    },
  };
};

const extractFinalAnswer = (text: string) => {
  const match = text.match(/FINAL_ANSWER:\s*(.+)\s*$/im);
  return match?.[1]?.trim() || "";
};

const fallbackSolutionFromSolvedText = (problem: string, answer: string, solvedText: string, languageCode = "en-IN") => {
  const opening = mathOpeningLineForLanguage(languageCode);
  const lines = solvedText
    .replace(/FINAL_ANSWER:\s*.+/i, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && line.length < 140)
    .slice(0, 12);

  return {
    problem,
    answer: answer || "See solution",
    steps: [
      {
        title: "Understand the problem",
        boardLines: lines.slice(0, 3).length ? lines.slice(0, 3) : [problem],
        spokenExplanation: opening,
        highlight: "Do not guess a neat answer; verify it with the given condition.",
      },
      {
        title: "Solve and verify",
        boardLines: lines.slice(3, 9).length ? lines.slice(3, 9) : [`Final answer = ${answer || "see solution"}`],
        spokenExplanation: "Now we solve step by step and check the final answer by substitution.",
        highlight: "The final answer must satisfy the original condition exactly or approximately after rounding.",
      },
      {
        title: "Final answer",
        boardLines: [`Answer = ${answer || "see solution"}`],
        spokenExplanation: answer ? `The verified final answer is ${answer}.` : "Use the verified result from the board.",
        highlight: "Always trust the verified answer, not the first nice-looking number.",
      },
    ],
    checkQuestion: {
      question: "Which line verifies that the final answer satisfies the original question?",
      answer: "The substitution/check line verifies the final answer against the original condition.",
    },
  };
};

const solveWithFinalAnswerPipeline = async (problem: string, languageCode: string, teachLanguage: string) => {
  const startedAt = Date.now();
  const solveModel = Deno.env.get("OPENROUTER_SOLVE_MODEL") || "openai/gpt-5.4-mini";
  const solvedText = await callOpenRouterText([
    {
      role: "user",
      content: [
        "Solve accurately for a weak Indian student.",
        "Do not use JSON in this solve pass.",
        "Verify by substitution or a second method.",
        "If an earlier candidate fails verification, correct it.",
        "For algebra word problems, do not force neat integer answers. Use the exact formula if needed.",
        "End with exactly one final line in this format:",
        "FINAL_ANSWER: <answer>",
        "",
        `Problem: ${problem}`,
      ].join("\n"),
    },
  ], 1800, 0.01, solveModel);

  const finalAnswer = extractFinalAnswer(solvedText);
  const fallback = fallbackSolutionFromSolvedText(problem, finalAnswer, solvedText, languageCode);
  if (languageRoot(languageCode) === "en") {
    console.log("[miga_math_solve.model_benchmark]", JSON.stringify({
      language: languageRoot(languageCode),
      model: solveModel,
      elapsed: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
      json_valid: true,
      steps_count: fallback.steps.length,
      retry_triggered: false,
      pipeline: "final_answer_local_format",
    }));
    return fallback;
  }

  try {
    const formatterResult = await callOpenRouterJson([
      {
        role: "system",
        content: [
          "You format an already-solved math solution into app JSON.",
          "Do not recalculate the answer. Do not change the final answer.",
          `The answer field must be exactly: ${finalAnswer || fallback.answer}`,
          `Teaching language: ${teachLanguage}. Language code: ${languageCode}.`,
          `The first spokenExplanation must begin with: ${mathOpeningLineForLanguage(languageCode)}`,
          "For spokenExplanation, use natural teacher language in the teaching language.",
          "Keep boardLines short and readable on a phone.",
          "Return only valid JSON with this exact shape:",
          "{\"solution\":{\"problem\":\"\",\"answer\":\"\",\"steps\":[{\"title\":\"\",\"boardLines\":[\"\"],\"spokenExplanation\":\"\",\"highlight\":\"\"}],\"checkQuestion\":{\"question\":\"\",\"answer\":\"\"}}}",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          problem,
          finalAnswer: finalAnswer || fallback.answer,
          solvedText,
          instruction: "Format the solved text into 3 to 5 clear teaching steps. Preserve finalAnswer exactly in solution.answer.",
        }),
      },
    ], {
      languageCode,
      model: Deno.env.get("OPENROUTER_FORMATTER_MODEL") || "openai/gpt-4o-mini",
      maxTokens: 1600,
      temperature: 0.05,
    });

    const formatted = formatterResult.parsed?.solution;
    if (formatted && Array.isArray(formatted.steps) && formatted.steps.length > 0) {
      formatted.answer = finalAnswer || formatted.answer || fallback.answer;
      console.log("[miga_math_solve.model_benchmark]", JSON.stringify({
        language: languageRoot(languageCode),
        model: solveModel,
        formatter: formatterResult.model,
        elapsed: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
        json_valid: true,
        steps_count: formatted.steps.length,
        retry_triggered: formatterResult.retryTriggered,
        pipeline: "final_answer_then_format",
      }));
      return formatted;
    }
  } catch (formatError) {
    console.warn("[miga_math_solve.format_failed]", formatError);
  }

  console.log("[miga_math_solve.model_benchmark]", JSON.stringify({
    language: languageRoot(languageCode),
    model: solveModel,
    elapsed: Number(((Date.now() - startedAt) / 1000).toFixed(2)),
    json_valid: true,
    steps_count: fallback.steps.length,
    retry_triggered: false,
    pipeline: "final_answer_fallback",
  }));
  return fallback;
};

const auditMathSolution = async (
  problem: string,
  languageCode: string,
  teachLanguage: string,
  draftSolution: unknown,
) => {
  const auditResult = await callOpenRouterJson([
    {
      role: "system",
      content: [
        "You are a strict math solution auditor for an Indian school tutoring app.",
        "Your job is to catch and fix errors in a draft solution before it reaches a student.",
        "WHAT TO CHECK:",
        "Arithmetic: Re-compute every calculation independently. Check fractions, LCM operations, percentage calculations, and substitutions. If any number is wrong, fix the entire chain downstream.",
        "Answer field: The top-level answer must exactly match the final verified step. If they conflict, fix the answer field.",
        "Board lines: Every new formula or concept must be preceded by a meaning line in plain language. No naked formulas at the start of a new concept. Lines must be phone-readable and short.",
        "Spoken explanations: Must sound like a real teacher in the teaching language, not a word-for-word translation. One idea per explanation block.",
        "No forbidden words: wait, maybe, seems, I recall, let me re-read, no, yes exactly, actually.",
        "Highlight field: Must contain a genuine insight or common mistake warning, not a restatement of the board line.",
        "Check question: Must test the concept, not just ask for the final answer. It must be mathematically correct with a fully solved answer.",
        "Work/time problems: Must include 'Whole work = 1', daily work framing, and additive logic for combined work.",
        "Beginner clarity: Every formula must be introduced with the plain reason behind it. No step should assume the student remembers a previous class.",
        "WHAT NOT TO DO:",
        "Do not change the teaching language.",
        "Do not add new steps that were not in the draft unless something is mathematically missing.",
        "Do not add self-correction phrases.",
        "Return only valid JSON. No text before or after. No markdown fences.",
        "Use this exact shape:",
        "{\"solution\":{\"problem\":\"\",\"answer\":\"\",\"steps\":[{\"title\":\"\",\"boardLines\":[\"\"],\"spokenExplanation\":\"\",\"highlight\":\"\"}],\"checkQuestion\":{\"question\":\"\",\"answer\":\"\"}}}",
        `Teaching language: ${teachLanguage}. Language code: ${languageCode}.`,
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify({
        problem,
        draft: draftSolution,
        instruction: "Audit the draft. Fix all arithmetic errors, board line issues, spoken explanation quality, and the check question. The answer field must match the final verified result. Return only corrected JSON.",
      }),
    },
  ], { languageCode, maxTokens: 1800 });

  const parsed = auditResult.parsed;
  return parsed.solution || draftSolution;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const mode = String(body.mode || "solve") as MathMode;

    if (mode === "extract" || mode === "paper") {
      const access = await requireProMathScanAccess(req);
      if (!access.allowed) return json({ error: access.error, requiresPro: access.status === 402 }, access.status);

      const imageType = String(body.imageType || "image/jpeg");
      const imageData = normalizeImageDataUrl(body.imageData, imageType);
      const scanLanguageCode = String(body.languageCode || "en-IN");

      if (mode === "extract") {
        if (!imageData.startsWith("data:image/")) return json({ problems: [], rawText: "" });

        const extractResult = await callOpenRouterJson([
          {
            role: "system",
            content: [
              "You read photographed school math pages.",
              "Find every separate math question visible in the image.",
              "Do not solve anything.",
              "Return JSON only: {\"problems\":[{\"id\":\"p1\",\"display\":\"question text\",\"type\":\"short topic\",\"confidence\":0.0}],\"rawText\":\"brief transcription\"}.",
              "If there are many sums, keep them separate. If unclear, return the readable parts only.",
            ].join(" "),
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Image type: ${imageType}. Extract the separate math questions.` },
              { type: "image_url", image_url: { url: imageData } },
            ],
          },
        ], { languageCode: scanLanguageCode, model: INDIC_MATH_MODEL, maxTokens: 1000 });

        const parsed = extractResult.parsed;
        const problems = Array.isArray(parsed.problems)
          ? parsed.problems.map((item: any, index: number) => ({
              id: String(item.id || `p${index + 1}`),
              display: String(item.display || item.problem || "").trim(),
              type: item.type ? String(item.type) : undefined,
              confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : undefined,
            })).filter((item: any) => item.display)
          : [];

        return json({ problems, rawText: String(parsed.rawText || "") });
      }

      // mode === "paper": "Scan & Solve" — read every question on the photographed
      // page AND answer each one in a single pass, in the exact PaperAnswer[] shape
      // the client (components/ui/PaperScanModal.tsx) renders directly.
      if (!imageData.startsWith("data:image/")) return json({ answers: [], note: "Couldn't read the image." });

      const paperResult = await callOpenRouterJson([
        {
          role: "system",
          content: [
            "You are MIGA, reading a photographed question paper (any school/exam subject, not just math).",
            "Find every separate question visible in the image and answer each one.",
            "For an MCQ, choose the correct option letter. For a short-answer question, give the direct answer.",
            "Be honest about legibility: if a question or option is genuinely unreadable, still include it with your best-effort answer and a lower confidence, do not silently drop it unless nothing at all is legible.",
            "Return JSON only, no markdown: {\"answers\":[{\"q\":\"1\",\"question\":\"question text\",\"options\":[\"A) ...\",\"B) ...\"],\"answer\":\"B\",\"answerText\":\"the actual answer text/value\",\"reason\":\"one short sentence why\",\"confidence\":0.0}],\"note\":\"one short sentence overall, e.g. about image quality, or empty string\"}.",
            "options is [] for a non-MCQ question. Keep \"reason\" to one short sentence, exam-style, not a full explanation.",
          ].join(" "),
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Image type: ${imageType}. Read and answer every question on this page.` },
            { type: "image_url", image_url: { url: imageData } },
          ],
        },
      ], { languageCode: scanLanguageCode, model: INDIC_MATH_MODEL, maxTokens: 2200 });

      const parsedPaper = paperResult.parsed;
      const answers = Array.isArray(parsedPaper.answers)
        ? parsedPaper.answers.map((item: any, index: number) => ({
            q: String(item.q || `${index + 1}`),
            question: String(item.question || "").trim(),
            options: Array.isArray(item.options) ? item.options.map((o: any) => String(o)) : [],
            answer: String(item.answer || "").trim(),
            answerText: String(item.answerText || item.answer || "").trim(),
            reason: String(item.reason || "").trim(),
            confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : undefined,
          })).filter((item: any) => item.question)
        : [];

      return json({ answers, note: String(parsedPaper.note || "") });
    }

    const problem = String(body.problem || "").trim();
    const languageCode = String(body.languageCode || "en-IN");
    const teachLanguage = languageName(languageCode);
    const isEnglishRequest = languageCode.toLowerCase().startsWith("en");
    if (!problem) return json({ error: "Problem is required" }, 400);

    try {
      const solution = await solveWithFinalAnswerPipeline(problem, languageCode, teachLanguage);
      return json({ solution });
    } catch (pipelineError) {
      console.warn("[miga_math_solve.final_answer_pipeline_failed]", pipelineError);
    }

    const teacherResult = await callOpenRouterJson([
      {
        role: "system",
        content: [
          "You are MIGA's elite 1-on-1 math teacher for Indian school students and competitive exam aspirants (SSC, IBPS, NEET, Board exams).",
          "Teach like the best private tutor available at 1 AM: calm, precise, non-judgmental, and deeply clear.",
          "WHO IS YOUR STUDENT:",
          "Assume the student is a weak beginner/backbencher unless the question clearly says advanced.",
          "Never assume they know a formula. Never assume they remember yesterday's class.",
          "STRUCTURE OF EVERY SOLUTION:",
          "Every solution must have these steps in order: 1. What is this problem asking? 2. What concept does it use? 3. Solve step by step, never skipping an algebraic step. 4. Verify the answer by substituting back or using a second method. 5. Exam shortcut if one exists for SSC/IBPS style; explain why it works faster.",
          "If no shortcut is safe for a problem type, explicitly say: Standard method is safer here.",
          "BOARD LINES RULES:",
          "Board lines are written as if on a classroom blackboard or whiteboard.",
          "Keep each line short enough to read on a phone without scrolling.",
          "Use math notation for calculations.",
          "Every new concept or formula must have a plain-language meaning line immediately before the calculation line.",
          "Never start a board line with a naked formula. Always precede it with what it means.",
          "Good board line sequence example for profit/loss:",
          "CP = what the shopkeeper paid to buy the item",
          "CP = 100 (assume)",
          "MP = CP + 40% of CP",
          "MP = 100 + 40 = 140",
          "Discount = 20% of MP",
          "Discount = 20% of 140 = 28",
          "SP = MP - Discount = 140 - 28 = 112",
          "Profit = SP - CP = 112 - 100 = 12",
          "So profit of 12 -> CP is 100",
          "Actual profit = 96",
          "CP = (100 / 12) x 96 = 800",
          "WORK AND TIME PROBLEMS - MANDATORY FRAMING:",
          "Before any formula, always write: Whole job = 1 full work. If A finishes in N days -> A does 1/N work each day. Working together -> add their daily work because both portions happen on the same day.",
          "Board lines style for work problems:",
          "Whole work = 1",
          "A does 1/12 in one day",
          "B does 1/18 in one day",
          "Together in one day: 1/12 + 1/18",
          "LCM of 12 and 18 = 36",
          "1/12 = 3/36, 1/18 = 2/36",
          "Together: 3/36 + 2/36 = 5/36",
          "Days to finish = 36/5 = 7.2 days",
          "SPOKEN EXPLANATION RULES:",
          "Use natural classroom language in the teaching language.",
          "Do not translate word-by-word from English into Tamil, Telugu, Hindi, Kannada, or Malayalam.",
          "Speak like a real teacher talking to a student, not like a textbook.",
          "One clear idea per spoken explanation. Do not crowd multiple concepts into one paragraph.",
          "Tamil GOOD spoken explanation example: இந்த கணக்கில் shopkeeper எவ்வளவுக்கு வாங்கினார் என்பது தெரியல - அதை CP என்று வைச்சுக்கோம். முதல்ல 100 னு assume பண்ணி solve பண்ணுவோம், அப்புறம் actual answer கண்டுபிடிக்கலாம்.",
          "Tamil BAD spoken explanation example to avoid: கடைக்காரர் பொருளை 40% மேலே குறிப்பு விலையில் குறிக்கிறார்.",
          "Tamil style guidance: sound like a coaching-centre tutor, not a formal textbook. Prefer 'முடிக்கிறார்' over overly formal 'முடிப்பதால்' when possible. Prefer 'வைச்சுக்கலாம்', 'கூட்டணும்', 'பார்ப்போம்', 'இதுதான் trap' in spokenExplanation. Keep boardLines cleaner and more formal. Avoid repeating 'அவர்' too much; use A/B labels naturally.",
          "For Telugu/Hindi/Kannada/Malayalam, use the same principle: spokenExplanation should be natural tutor speech; boardLines can stay concise and formal.",
          "For non-English languages, keep the solution compact: maximum 5 steps, maximum 2 short spokenExplanation sentences per step, and no repeated explanation. Preserve clarity but avoid long paragraphs.",
          "HIGHLIGHT FIELD:",
          "Use the highlight field to state the single most important insight in this step, or the most common mistake students make at this step and how to avoid it.",
          "Highlight examples: Discount is always on Marked Price, never on Cost Price - exam trap. LCM makes the fractions comparable - skip this and you will get wrong addition. Assumption trick: assume CP = 100 so percentages become direct numbers.",
          "EXAM SHORTCUT RULES:",
          "For SSC/IBPS/Board problems involving percentages, profit/loss, time/work, and ratio, always include the assumption shortcut (assume base = 100) when applicable.",
          "Show why it saves time: Instead of calling CP = x and solving an equation, we work with clean numbers.",
          "Mark the shortcut step clearly in the title.",
          "Do not invent an exam shortcut for routine algebra or geometry. If there is no genuinely faster method, use the title 'No safe shortcut' and write: Standard method is safer here.",
          "CHECK QUESTION RULES:",
          "The checkQuestion must test the concept, not just repeat the answer.",
          "It should ask what changes if one number in the problem changes, or what the underlying concept is.",
          "Good checkQuestion example for profit/loss: If the discount was 25% instead of 20%, would the shopkeeper still profit? What would the new profit be on a CP of Rs. 800? Answer: MP = 1120, Discount = 280, SP = 840, Profit = 40. Yes, still profits.",
          "Good checkQuestion example for work/time: If only A worked for the first 3 days, then B joined, how many total days to finish? Answer must include the correct calculated answer.",
          "ARITHMETIC ACCURACY:",
          "The top-level answer must exactly match the final verified result in the steps.",
          "Before returning JSON, silently re-check every arithmetic operation and rewrite any inconsistent answer.",
          "Before returning JSON, silently audit your own solution: re-check every arithmetic step, verify board lines have meaning lines before formulas, verify highlight fields contain useful insights, verify checkQuestion tests a concept and not only the final answer, then fix any issues.",
          "Return only one final corrected JSON object. Do not return draft, audit notes, commentary, or markdown.",
          "Never include self-correction phrases such as wait, maybe, seems, I recall, let me re-read, no, yes exactly, or actually. Return only the polished final teaching version.",
          "The checkQuestion answer must also be mathematically correct.",
          "LANGUAGE:",
          "Supported teaching languages: English, Hindi, Tamil, Telugu, Kannada, Malayalam.",
          `Teaching language: ${teachLanguage}. Language code: ${languageCode}.`,
          "OUTPUT FORMAT:",
          "Return only valid JSON. No text before or after the JSON object. No markdown fences.",
          "Use this exact shape:",
          "{\"solution\":{\"problem\":\"\",\"answer\":\"\",\"steps\":[{\"title\":\"\",\"boardLines\":[\"\"],\"spokenExplanation\":\"\",\"highlight\":\"\"}],\"checkQuestion\":{\"question\":\"\",\"answer\":\"\"}}}",
        ].join(" "),
      },
      {
        role: "user",
        content: `Solve this as a personal tutor. Make the student understand the concept, the exact steps, and any safe exam shortcut.\n\nProblem: ${problem}`,
      },
    ], { languageCode, maxTokens: isEnglishRequest ? 2400 : 1700 });

    const parsed = teacherResult.parsed;
    let solution = parsed.solution || solveFallback(problem, languageCode);
    if (!Array.isArray(solution.steps) || solution.steps.length === 0) {
      solution.steps = solveFallback(problem, languageCode).steps;
    }
    try {
      const shouldRunSeparateAudit = false;
      if (shouldRunSeparateAudit) {
        const audited = await auditMathSolution(problem, languageCode, teachLanguage, solution);
        if (audited && Array.isArray((audited as any).steps) && (audited as any).steps.length > 0) {
          solution = audited;
        }
      }
    } catch (auditError) {
      console.warn("[miga_math_solve.audit]", auditError);
    }
    solution.steps = cleanMathSteps(solution.steps);
    const verifiedAnswer = inferVerifiedAnswerFromSteps(solution);
    if (verifiedAnswer) solution.answer = verifiedAnswer;
    if (!isValidCheckQuestion(solution.checkQuestion)) {
      solution.checkQuestion = {
        question: "Which concept or formula was most important in this solution?",
        answer: "Identify the core concept used in the steps, then apply the same idea to a changed number in the problem.",
      };
    }

    console.log("[miga_math_solve.model_benchmark]", JSON.stringify({
      language: languageRoot(languageCode),
      model: teacherResult.model,
      elapsed: Number((teacherResult.elapsedMs / 1000).toFixed(2)),
      json_valid: true,
      steps_count: Array.isArray(solution.steps) ? solution.steps.length : 0,
      retry_triggered: teacherResult.retryTriggered,
    }));

    return json({ solution });
  } catch (error) {
    console.error("[miga_math_solve]", error);
    return json({ error: error instanceof Error ? error.message : "Math help failed" }, 500);
  }
});
