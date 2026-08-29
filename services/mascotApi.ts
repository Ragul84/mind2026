import { supabase, supabaseUrl, supabaseAnonKey } from '@/utils/supabase';
import { resolveStoryBaseUrlCandidates } from '@/utils/storyBaseUrl';

const fetchStoryWithFallback = async (path: string, init: RequestInit) => {
  const candidates = resolveStoryBaseUrlCandidates();
  let lastErr: any = null;
  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);
      if (response.ok) return { response, baseUrl };
      lastErr = new Error(`HTTP ${response.status} for ${baseUrl}${path}`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`Unable to reach story backend for ${path}`);
};

export interface MascotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isLoading?: boolean;
}

export interface MathProblemChoice {
  id: string;
  display: string;
  type?: string;
  confidence?: number;
}

export interface MathBoardStep {
  title: string;
  boardLines: string[];
  spokenExplanation: string;
  highlight?: string;
}

export interface PaperAnswer {
  q: string;
  question: string;
  options: string[];
  answer: string;
  answerText: string;
  reason: string;
  confidence?: number;
}

// Thrown when the user's daily AI cost budget is exhausted (HTTP 402).
export class AIBudgetError extends Error {
  constructor(message = 'Daily free AI limit reached') {
    super(message);
    this.name = 'AIBudgetError';
  }
}

export interface MathSolution {
  problem: string;
  answer: string;
  steps: MathBoardStep[];
  checkQuestion?: {
    question: string;
    answer: string;
  };
}

const normalizeImageMimeType = (imageType?: string) => {
  const value = String(imageType || '').trim().toLowerCase();
  if (value.startsWith('image/')) return value;
  if (value === 'png') return 'image/png';
  if (value === 'webp') return 'image/webp';
  if (value === 'heic' || value === 'heif') return `image/${value}`;
  return 'image/jpeg';
};

const toImageDataUrl = (imageData: string, imageType?: string) => {
  const cleaned = String(imageData || '').trim();
  if (cleaned.startsWith('data:image/')) return cleaned;
  return `data:${normalizeImageMimeType(imageType)};base64,${cleaned}`;
};

const fetchWithTimeout = async (url: string, init: RequestInit, timeoutMs = 8000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result as string);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const INDIAN_SPEECH_CODES = new Set([
  'ta-in', 'hi-in', 'te-in', 'kn-in', 'ml-in',
]);

const TAMIL_SPEECH_SKIP = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'has', 'have',
  'he', 'her', 'his', 'i', 'in', 'is', 'it', 'of', 'on', 'or', 'our', 'she',
  'that', 'the', 'their', 'them', 'there', 'this', 'to', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'who', 'why', 'with', 'you',
  'tamil', 'india', 'indian', 'english', 'hindi', 'telugu', 'kannada', 'malayalam',
  'science', 'mathematics', 'maths', 'physics', 'chemistry', 'biology', 'history',
  'geography', 'economy', 'polity', 'constitution', 'government', 'article',
]);

const SMART_LATIN_WORD = /\b([A-Za-z][A-Za-z0-9'-]*)\b/g;

const normalizeAcronym = (word: string) => {
  if (/^[A-Z]{2,}$/.test(word)) return word.split('').join(' ');
  if (/^[a-z]{2,}$/.test(word) && /(?:[A-Z].*){2,}/.test(word)) {
    return word.replace(/([a-z])([A-Z])/g, '$1 $2');
  }
  return word;
};

const makeSpeechFriendlyLatinWord = (word: string, languageCode: string) => {
  const clean = word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
  if (!clean) return word;

  const lower = clean.toLowerCase();
  if (TAMIL_SPEECH_SKIP.has(lower)) return word;
  if (clean.length <= 2) return word;

  const code = String(languageCode || '').toLowerCase();
  if (code.startsWith('ta')) {
    const stem = clean.replace(/sis$/i, 'si');
    const spoken = `${stem}-ai`;
    return word === clean ? spoken : word.replace(clean, spoken);
  }

  // For other Indian language voices, keep the term readable and
  // add soft pauses instead of forcing a Tamil-style suffix.
  const readable = clean
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([a-z])([0-9])/gi, '$1 $2');
  return word === clean ? readable : word.replace(clean, readable);
};

const normalizeSpokenYears = (text: string, languageCode: string) => {
  const code = String(languageCode || '').toLowerCase();
  if (!INDIAN_SPEECH_CODES.has(code)) return text;
  return String(text || '').replace(/\b(1[0-9]{3}|20[0-9]{2})\b/g, (year) => year.split('').join(' '));
};

const prepareSpeechText = (text: string, languageCode: string) => {
  const code = String(languageCode || '').toLowerCase();
  if (INDIAN_SPEECH_CODES.has(code)) {
    return normalizeSpokenYears(String(text || ''), code).replace(SMART_LATIN_WORD, (match) => {
      const normalized = normalizeAcronym(match);
      return makeSpeechFriendlyLatinWord(normalized, code);
    });
  }
  return text;
};

export const mascotApi = {
  /**
   * Stream a chat response from the backend.
   * Uses OpenRouter only (HuggingFace/PersonaPlex removed for simplicity)
   */
  async streamChat(
    userId: string,
    messages: { role: string; content: string }[],
    mode: 'chat' | 'study' = 'chat',
    onToken: (token: string) => void,
    onDone: (fullText: string) => void,
    onError: (err: any) => void,
    options?: {
      languageCode?: string;
      languageLabel?: string;
      attachments?: Array<{ dataUrl: string; mimeType?: string }>;
      signal?: AbortSignal;
      onEvidence?: (payload: { schemaVersion: number; evidence: any[] }) => void;
    }
  ) {
    const { data: { session } } = await supabase.auth.getSession();
    const baseUrl = supabaseUrl;
    const anonKey = supabaseAnonKey;

    // React Native's built-in fetch cannot stream the response body (no getReader),
    // so it buffers the whole reply and dumps it at once. expo/fetch DOES support
    // streaming, giving real token-by-token delivery like ChatGPT.
    let streamFetch: typeof fetch = fetch;
    try {
      const ef = require('expo/fetch');
      if (ef?.fetch) streamFetch = ef.fetch as typeof fetch;
    } catch {}

    try {

      const response = await streamFetch(`${baseUrl}/functions/v1/miga_stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({
          user_id: userId,
          messages,
          mode,
          language_code: options?.languageCode || 'en-IN',
          language_label: options?.languageLabel || 'English',
          attachments: options?.attachments || [],
          provider: 'openrouter' // Always use OpenRouter
        }),
        signal: options?.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error(`❌ Stream Error ${response.status}:`, errorText);
        throw new Error(`Stream error ${response.status}: ${errorText}`);
      }

      // 🔄 REACT NATIVE STREAMING FALLBACK
      if (!response.body || typeof (response.body as any).getReader !== 'function') {
        const text = await response.text();
        
        // Check if it's a direct JSON error or non-streamed response
        try {
            const directJson = JSON.parse(text);
            if (directJson.error) throw new Error(directJson.error);
            // If it's a simple text response (unlikely for stream, but possible)
            if (typeof directJson.content === 'string') {
                onToken(directJson.content);
                onDone(directJson.content);
                return;
            }
        } catch (e) {
            // Not a direct JSON object, proceed to parse stream chunks
        }

        const lines = text.split("\n");
        let fullContent = "";
        
        let eventType = 'message';
        for (const line of lines) {
          if (line.trim().startsWith('event:')) { eventType = line.trim().slice(6).trim(); continue; }
          if (line.trim().startsWith("data: ")) {
            const dataStr = line.trim().slice(6).trim();
            if (dataStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(dataStr);
              if (eventType === 'evidence' && Array.isArray(parsed.evidence)) {
                options?.onEvidence?.(parsed);
              } else if (parsed.token) {
                fullContent += parsed.token;
                onToken(parsed.token);
              }
            } catch (e) {
                // If chunk is partial, we might need more complex buffering, 
                // but for now, we assume lines are complete in fallback mode.
            }
          }
        }
        
        // If content is still empty, it might be that the server returned raw text without 'data:' prefix
        if (!fullContent && text.length > 0 && !text.includes("data: ")) {
            fullContent = text;
            onToken(text);
        }

        onDone(fullContent);
        return;
      }

      const reader = (response.body as any).getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let buffer = ""; // holds an incomplete trailing line between chunks
      let eventType = 'message';

      // Process one complete SSE line.
      const handleLine = (rawLine: string) => {
        const line = rawLine.trim();
        if (!line) return;
        if (line.startsWith('event:')) { eventType = line.slice(6).trim(); return; }
        if (!line.startsWith("data:")) return;
        const dataStr = line.replace(/^data:\s?/, "").trim();
        if (!dataStr || dataStr === "[DONE]") return;
        try {
          const parsed = JSON.parse(dataStr);
          if (eventType === 'evidence' && Array.isArray(parsed.evidence)) {
            options?.onEvidence?.(parsed);
          } else if (parsed.token) {
            fullContent += parsed.token;
            onToken(parsed.token);
          }
        } catch {
          // malformed/partial JSON — skip (should not happen now that lines are whole)
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // stream:true keeps multi-byte UTF-8 chars (e.g. Tamil) intact across chunk
        // boundaries; buffering keeps each `data:` line whole so no tokens are lost.
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // last item may be a partial line — keep it
        for (const line of lines) handleLine(line);
      }
      // Flush any trailing decoded bytes + final buffered line.
      buffer += decoder.decode();
      if (buffer) buffer.split("\n").forEach(handleLine);

      onDone(fullContent);

    } catch (err: any) {
      // User pressed Stop → fetch was aborted. This is not an error: the partial
      // text is already in the caller's buffer (appended via onToken), so finish
      // cleanly instead of surfacing a "connection hiccup".
      if (err?.name === 'AbortError' || options?.signal?.aborted) {
        onDone('');
        return;
      }
      console.error("Mascot API Stream Error:", err);
      onError(err);
    }
  },

  /**
   * Get TTS audio for a text.
   */
  async getTTS(text: string, languageCode: string = 'en-IN'): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    const anonKey = supabaseAnonKey;
    const speechText = prepareSpeechText(text, languageCode);

    const railwayCandidates = resolveStoryBaseUrlCandidates();
    let railwayError = '';
    for (const baseUrl of railwayCandidates) {
      try {
        const response = await fetchWithTimeout(`${baseUrl}/edge_tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: speechText,
            speaker: languageCode,
            speed: 1,
          }),
        }, 10000);

        if (response.ok) {
          return await blobToDataUrl(await response.blob());
        }
        railwayError = `${baseUrl}/edge_tts returned ${response.status}`;
      } catch (err) {
        railwayError = `${baseUrl}/edge_tts failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    }

    if (process.env.EXPO_PUBLIC_ENABLE_SUPABASE_TTS_FALLBACK !== 'true') {
      throw new Error(`Railway TTS unavailable. ${railwayError}`);
    }

    const response = await fetchWithTimeout(`${supabaseUrl}/functions/v1/miga_tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || anonKey}`,
        'apikey': anonKey,
      },
      body: JSON.stringify({ text: speechText, language_code: languageCode }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown TTS error');
      throw new Error(`Cloud TTS failure ${response.status}: ${errorText}`);
    }

    return await blobToDataUrl(await response.blob());
  },

  /**
   * Start a world-class Pipecat session (WebRTC)
   */
  async startPipecatSession(userId: string): Promise<{ room_url: string; token: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    const baseUrl = supabaseUrl;
    const anonKey = supabaseAnonKey;

    try {
      const response = await fetch(`${baseUrl}/functions/v1/miga_pipecat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || anonKey}`,
          'apikey': anonKey,
        },
        body: JSON.stringify({ user_id: userId })
      });

      if (!response.ok) throw new Error(`Pipecat init failed ${response.status}`);
      return await response.json();
    } catch (err) {
      console.error("Pipecat Session Error:", err);
      throw err;
    }
  },

  /**
   * Upload a document for Story Mode RAG.
   */
  async uploadStoryDoc(file: any, sessionId?: string, title?: string): Promise<{ upload_id: string; status: string }> {
    try {
      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name || 'upload.pdf',
        type: file.mimeType || 'application/pdf',
      } as any);
      if (sessionId) formData.append('session_id', sessionId);
      if (title) formData.append('title', title);

      const { response, baseUrl } = await fetchStoryWithFallback('/upload_story_doc', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Upload failed ${response.status}: ${errText}`);
      }

      return await response.json();
    } catch (err) {
      console.error("Doc Upload Error:", err);
      throw err;
    }
  },

  async uploadStoryUrl(url: string, urlType: 'youtube' | 'web' = 'youtube', sessionId?: string): Promise<{ upload_id: string; status: string }> {
    try {
      const { response, baseUrl } = await fetchStoryWithFallback('/upload_story_url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, url_type: urlType, session_id: sessionId }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`URL Upload failed ${response.status}: ${errText}`);
      }
      return await response.json();
    } catch (err) {
      console.error("URL Upload Error:", err);
      throw err;
    }
  },

  async uploadStudyText(text: string, title: string, sessionId?: string): Promise<{ upload_id: string; status: string }> {
    try {
      const { response, baseUrl } = await fetchStoryWithFallback('/upload_study_text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, title, session_id: sessionId }),
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Text Upload failed ${response.status}: ${errText}`);
      }
      return await response.json();
    } catch (err) {
      console.error('Text Upload Error:', err);
      throw err;
    }
  },

  async generateStudyLabArtifact(request: {
    sessionId?: string;
    uploadId?: string | null;
    query: string;
    artifactType: 'podcast' | 'flashcards' | 'quiz' | 'summary' | 'mind_map';
    languageCode?: string;
    difficulty?: string;
    title?: string;
    sessionTitle?: string;
  }): Promise<{ success: boolean; artifact_type: string; data: any }> {
    const { data: { session } } = await supabase.auth.getSession();
    const { response, baseUrl } = await fetchStoryWithFallback('/study_lab_generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        session_id: request.sessionId,
        upload_id: request.uploadId,
        query: request.query,
        artifact_type: request.artifactType,
        language_code: request.languageCode,
        difficulty: request.difficulty,
        title: request.title,
        session_title: request.sessionTitle,
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Study Lab generation failed ${response.status}: ${errText}`);
    }
    return await response.json();
  },

  /**
   * Generate a story segment from RAG context.
   */
  async generateStorySegment(
    uploadId: string | null,
    query: string,
    languageCode: string = 'auto',
    sessionId?: string
  ): Promise<{ text: string; audio_url: string; anim_cues: any[]; choices?: string[]; visemes?: { time_ms: number; open: number; form: number; value?: string }[] }> {
    try {
      const payload: any = { query, language_code: languageCode };
      if (uploadId) payload.upload_id = uploadId;
      if (sessionId) payload.session_id = sessionId;
      const { response, baseUrl } = await fetchStoryWithFallback('/generate_story_segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`Generation failed ${response.status}: ${errText}`);
      }
      return await response.json();
    } catch (err) {
      console.error("Story Generation Error:", err);
      throw err;
    }
  },

  async generateStudyLabArtifactAsync(request: {
    sessionId?: string;
    uploadId?: string | null;
    uploadIds?: string[];
    query: string;
    artifactType: 'podcast' | 'flashcards' | 'quiz' | 'summary' | 'mind_map';
    languageCode?: string;
    difficulty?: string;
    title?: string;
    sessionTitle?: string;
  }): Promise<{ success: boolean; task_id: string; status: string; milestone: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    const { response, baseUrl } = await fetchStoryWithFallback('/study_lab_generate/async', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({
        session_id: request.sessionId,
        upload_id: request.uploadId,
        upload_ids: request.uploadIds,
        query: request.query,
        artifact_type: request.artifactType,
        language_code: request.languageCode,
        difficulty: request.difficulty,
        title: request.title,
        session_title: request.sessionTitle,
      }),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Async Study Lab generation failed ${response.status}: ${errText}`);
    }
    return await response.json();
  },

  async getGenerationStatus(taskId: string): Promise<{
    task_id: string;
    status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
    milestone: 'ingesting' | 'segmenting' | 'analyzing' | 'synthesizing' | 'ready' | 'cancelled' | 'failed';
    progress: number;
    error?: string;
    result?: { success: boolean; artifact_type: string; data: any };
  }> {
    const { response, baseUrl } = await fetchStoryWithFallback(`/generation_status/${taskId}`, {
      method: 'GET',
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to fetch generation status ${response.status}: ${errText}`);
    }
    return await response.json();
  },

  async cancelGeneration(taskId: string): Promise<{ success: boolean; task_id: string; status: string }> {
    const { response, baseUrl } = await fetchStoryWithFallback(`/cancel_generation/${taskId}`, {
      method: 'POST',
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Failed to cancel generation ${response.status}: ${errText}`);
    }
    return await response.json();
  },

  async extractMathProblems(imageData: string, imageType: string, languageCode = 'en-IN'): Promise<{ problems: MathProblemChoice[]; rawText?: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    const normalizedImageType = normalizeImageMimeType(imageType);
    const response = await fetch(`${supabaseUrl}/functions/v1/miga_math_solve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        mode: 'extract',
        imageData: toImageDataUrl(imageData, normalizedImageType),
        imageType: normalizedImageType,
        languageCode,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Math scan failed ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return {
      problems: Array.isArray(data.problems) ? data.problems : [],
      rawText: data.rawText,
    };
  },

  async solveMathProblem(problem: string, languageCode = 'en-IN'): Promise<MathSolution> {
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${supabaseUrl}/functions/v1/miga_math_solve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        mode: 'solve',
        problem,
        languageCode,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Math solve failed ${response.status}: ${errText}`);
    }

    const data = await response.json();
    if (!data?.solution?.steps?.length) {
      throw new Error('Math solution was empty');
    }
    return data.solution;
  },

  /**
   * Scan a photographed question paper (any subject) and answer every question.
   * Free feature — bounded by the per-user daily AI cost budget server-side.
   */
  async solveQuestionPaper(
    imageData: string,
    imageType: string,
    languageCode = 'en-IN',
  ): Promise<{ answers: PaperAnswer[]; note?: string }> {
    const { data: { session } } = await supabase.auth.getSession();
    const normalizedImageType = normalizeImageMimeType(imageType);
    const response = await fetch(`${supabaseUrl}/functions/v1/miga_math_solve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || supabaseAnonKey}`,
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({
        mode: 'paper',
        imageData: toImageDataUrl(imageData, normalizedImageType),
        imageType: normalizedImageType,
        languageCode,
      }),
    });

    if (response.status === 402) {
      throw new AIBudgetError();
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Paper scan failed ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return {
      answers: Array.isArray(data.answers) ? data.answers : [],
      note: data.note,
    };
  }
};
