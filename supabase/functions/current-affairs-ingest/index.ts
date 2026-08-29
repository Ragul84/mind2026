import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const INDIA_TIME_ZONE = 'Asia/Kolkata';
const FRESHNESS_HOURS = 72;
const QUESTION_COUNT = 10;

type FeedSource = {
  id: string;
  name: string;
  url: string;
  category: string;
};

type SourceArticle = {
  source_id: string;
  source_name: string;
  category: string;
  title: string;
  summary: string;
  url: string;
  published_at: string;
};

type GeneratedQuestion = {
  question: string;
  options: string[];
  answer_index: number;
  explanation: string;
  difficulty?: string;
  source_url: string;
  source_title: string;
  published_at: string;
  category?: string;
};

const FEEDS: FeedSource[] = [
  {
    id: 'pib',
    name: 'Press Information Bureau',
    url: 'https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3',
    category: 'Government',
  },
  {
    id: 'rbi',
    name: 'Reserve Bank of India',
    url: 'https://rbi.org.in/pressreleases_rss.xml',
    category: 'Economy',
  },
  {
    id: 'sebi',
    name: 'Securities and Exchange Board of India',
    url: 'https://www.sebi.gov.in/sebirss.xml',
    category: 'Economy',
  },
];

const LOW_VALUE_TITLE = /\b(tender|vacancy|recruitment|penalt(?:y|ies)|auction result|money market operations|underwriting auction|office order|corrigendum)\b/i;

const decodeXml = (value: string) => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

const cleanText = (value: string) => decodeXml(value)
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const tagValue = (block: string, tags: string[]) => {
  for (const tag of tags) {
    const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match?.[1]) return cleanText(match[1]);
  }
  return '';
};

const linkValue = (block: string) => {
  const direct = tagValue(block, ['link', 'guid']);
  if (/^https?:\/\//i.test(direct)) return direct;
  const atom = block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || '';
  return decodeXml(atom).trim();
};

const parseFeed = (xml: string, source: FeedSource): SourceArticle[] => {
  const blocks = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []),
  ];

  return blocks.map((block) => {
    const rawDate = tagValue(block, ['pubDate', 'published', 'updated', 'dc:date']);
    const parsedDate = new Date(rawDate);
    return {
      source_id: source.id,
      source_name: source.name,
      category: source.category,
      title: tagValue(block, ['title']),
      summary: tagValue(block, ['description', 'summary', 'content:encoded', 'content']).slice(0, 1400),
      url: linkValue(block),
      published_at: Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString(),
    };
  }).filter((article) => article.title && article.url);
};

const getIndiaDateKey = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: INDIA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);

const readJsonObject = (value: string) => {
  const stripped = value.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Model returned no JSON object');
  return JSON.parse(stripped.slice(start, end + 1));
};

const compact = (value: string, maxLength: number) => {
  const text = cleanText(value);
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trim()}…`;
};

const stableNumber = (value: string) => Array.from(value)
  .reduce((total, character) => ((total * 31) + character.charCodeAt(0)) >>> 0, 2166136261);

const rotate = <T,>(values: T[], offset: number) => {
  if (!values.length) return values;
  const normalized = offset % values.length;
  return [...values.slice(normalized), ...values.slice(0, normalized)];
};

const generateDeterministicQuestions = (articles: SourceArticle[]): GeneratedQuestion[] => {
  const usable = articles.filter((article) => article.summary || article.title);
  return usable.slice(0, QUESTION_COUNT).map((article, index) => {
    const otherTitles = rotate(
      usable.filter((candidate) => candidate.url !== article.url),
      stableNumber(article.url) % Math.max(1, usable.length - 1),
    ).slice(0, 3).map((candidate) => compact(candidate.title, 92));

    const correctTitle = compact(article.title, 92);
    const insertAt = stableNumber(`${article.url}:${index}`) % 4;
    const options = [...otherTitles];
    options.splice(insertAt, 0, correctTitle);

    while (options.length < 4) {
      options.push(`None of the other listed official releases ${options.length + 1}`);
    }

    const context = compact(article.summary || article.title, 220);
    return {
      question: `Which official release best matches this update?\n“${context}”`,
      options: options.slice(0, 4),
      answer_index: insertAt,
      explanation: `${article.source_name} published “${article.title}”. Open the official source below for the complete release.`,
      difficulty: index < 3 ? 'easy' : index < 7 ? 'medium' : 'hard',
      source_url: article.url,
      source_title: article.title,
      published_at: article.published_at,
      category: article.category,
    };
  });
};

const fetchFeed = async (source: FeedSource) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-IN,en;q=0.9',
        Referer: new URL(source.url).origin,
      },
    });
    if (!response.ok) throw new Error(`${source.id} feed returned ${response.status}`);
    return parseFeed(await response.text(), source);
  } finally {
    clearTimeout(timeout);
  }
};

const collectFreshArticles = async () => {
  const settled = await Promise.allSettled(FEEDS.map(fetchFeed));
  const cutoff = Date.now() - (FRESHNESS_HOURS * 60 * 60 * 1000);
  const seen = new Set<string>();
  const sourceErrors: string[] = [];

  const articles = settled.flatMap((result, index) => {
    if (result.status === 'rejected') {
      sourceErrors.push(`${FEEDS[index].id}: ${String(result.reason)}`);
      return [];
    }
    return result.value;
  }).filter((article) => {
    const timestamp = new Date(article.published_at).getTime();
    if (timestamp < cutoff || LOW_VALUE_TITLE.test(article.title)) return false;
    const key = `${article.title.toLowerCase()}|${article.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => (
    new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  ));

  return { articles: articles.slice(0, 24), sourceErrors };
};

const generateQuestions = async (articles: SourceArticle[]) => {
  const apiKey = Deno.env.get('OPENROUTER_API_KEY');
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not configured');

  const allowedUrls = new Set(articles.map((article) => article.url));
  const sourcePacket = articles.map((article, index) => ({
    id: index + 1,
    source: article.source_name,
    category: article.category,
    title: article.title,
    summary: article.summary,
    url: article.url,
    published_at: article.published_at,
  }));

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://mindgains.ai',
      'X-Title': 'MindGains Daily Current Affairs',
    },
    body: JSON.stringify({
      model: Deno.env.get('OPENROUTER_MODEL') || 'meta-llama/llama-3.1-8b-instruct',
      temperature: 0.1,
      max_tokens: 4800,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You create factual current-affairs MCQs for Indian exam aspirants.
Use only the supplied official-source articles. Never use outside knowledge to invent a fact.
Generate exactly ${QUESTION_COUNT} useful questions when enough source material exists.
Avoid trivial wording, publicity claims, tenders, penalties, and administrative notices.
Every question must be answerable from its cited article.
Return only valid JSON:
{"questions":[{"question":"","options":["","","",""],"answer_index":0,"explanation":"","difficulty":"easy|medium|hard","source_url":"","source_title":"","published_at":"","category":""}]}`,
        },
        {
          role: 'user',
          content: `Create today's source-grounded quiz from these official releases:\n${JSON.stringify(sourcePacket)}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }

  const result = await response.json();
  const parsed = readJsonObject(result?.choices?.[0]?.message?.content || '');
  const rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];

  const questions = rawQuestions.filter((question: GeneratedQuestion) => (
    question &&
    typeof question.question === 'string' &&
    Array.isArray(question.options) &&
    question.options.length === 4 &&
    Number.isInteger(question.answer_index) &&
    question.answer_index >= 0 &&
    question.answer_index < 4 &&
    typeof question.explanation === 'string' &&
    allowedUrls.has(question.source_url)
  )).slice(0, QUESTION_COUNT);

  if (questions.length < 6) {
    throw new Error(`Only ${questions.length} valid source-grounded questions were generated`);
  }

  return questions;
};

const writeRedis = async (dateKey: string, questions: GeneratedQuestion[]) => {
  const redisUrl = Deno.env.get('UPSTASH_REDIS_REST_URL') ||
    Deno.env.get('EXPO_PUBLIC_UPSTASH_REDIS_REST_URL');
  const redisToken = Deno.env.get('UPSTASH_REDIS_REST_TOKEN') ||
    Deno.env.get('EXPO_PUBLIC_UPSTASH_REDIS_REST_TOKEN');
  if (!redisUrl || !redisToken) throw new Error('Upstash Redis secrets are not configured');

  const response = await fetch(redisUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify([
      'SET',
      `daily:current_affairs:${dateKey}`,
      JSON.stringify(questions),
      'EX',
      '691200',
    ]),
  });
  if (!response.ok) throw new Error(`Upstash returned ${response.status}`);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: JSON_HEADERS });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const dateKey = getIndiaDateKey(now);
    const adminSecret = Deno.env.get('CURRENT_AFFAIRS_CRON_SECRET') || '';
    const suppliedSecret = req.headers.get('x-cron-secret') || '';
    const isAdmin = Boolean(adminSecret && suppliedSecret === adminSecret);
    const utcHour = now.getUTCHours();

    // The unauthenticated cron route is intentionally narrow and idempotent:
    // 00:00-00:59 UTC is 05:30-06:29 IST, around the Daily Dose unlock.
    if (!isAdmin && (utcHour !== 0 || body?.force === true)) {
      return new Response(JSON.stringify({ error: 'Outside scheduled ingestion window' }), {
        status: 401,
        headers: JSON_HEADERS,
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') || '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    );

    const { data: existing } = await supabase
      .from('current_affairs_daily_sets')
      .select('date_key, status, question_count')
      .eq('date_key', dateKey)
      .maybeSingle();

    if (existing?.status === 'ready' && body?.force !== true) {
      return new Response(JSON.stringify({ success: true, reused: true, set: existing }), {
        headers: JSON_HEADERS,
      });
    }

    const startedAt = Date.now();
    const { articles, sourceErrors } = await collectFreshArticles();
    if (articles.length < 4) {
      throw new Error(`Insufficient fresh official articles (${articles.length})`);
    }

    let generationMode = 'openrouter';
    let questions: GeneratedQuestion[];
    try {
      questions = await generateQuestions(articles);
    } catch (modelError) {
      console.warn('[current_affairs_ingest.model_fallback]', modelError);
      generationMode = 'deterministic';
      questions = generateDeterministicQuestions(articles);
    }

    if (questions.length < 6) {
      throw new Error(`Only ${questions.length} source-grounded questions could be created`);
    }

    const { error: articleError } = await supabase
      .from('current_affairs_articles')
      .upsert(articles, { onConflict: 'url' });
    if (articleError) throw articleError;

    const { error: setError } = await supabase
      .from('current_affairs_daily_sets')
      .upsert({
        date_key: dateKey,
        status: 'ready',
        questions,
        question_count: questions.length,
        source_count: new Set(questions.map((question) => question.source_url)).size,
        source_errors: sourceErrors,
        generated_at: new Date().toISOString(),
        generation_ms: Date.now() - startedAt,
        generation_mode: generationMode,
      }, { onConflict: 'date_key' });
    if (setError) throw setError;

    const lead = articles[0];
    await supabase.from('current_affairs_daily').upsert({
      date_key: dateKey,
      headline: lead.title,
      summary: lead.summary || 'Today’s official-source current affairs set is ready.',
      published_at: lead.published_at,
      tag: lead.category,
      source_url: lead.url,
      source_name: lead.source_name,
    }, { onConflict: 'date_key' });

    await writeRedis(dateKey, questions);

    console.log('[current_affairs_ingest.ready]', JSON.stringify({
      date_key: dateKey,
      articles: articles.length,
      questions: questions.length,
      generation_mode: generationMode,
      source_errors: sourceErrors,
      elapsed_ms: Date.now() - startedAt,
    }));

    return new Response(JSON.stringify({
      success: true,
      date_key: dateKey,
      articles: articles.length,
      questions: questions.length,
      generation_mode: generationMode,
      source_errors: sourceErrors,
    }), { headers: JSON_HEADERS });
  } catch (error) {
    console.error('[current_affairs_ingest.failed]', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }), { status: 500, headers: JSON_HEADERS });
  }
});
