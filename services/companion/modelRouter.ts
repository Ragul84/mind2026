import { supabase } from '@/utils/supabaseService';

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

const DEFAULT_MAX_TOKENS = 2500;
const DEFAULT_TEMPERATURE = 0.8;

export type ModelRouterOptions = {
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, unknown>;
};

// Routed through the companion_llm_proxy edge function so the OpenRouter key
// never ships in the client bundle — it previously did (EXPO_PUBLIC_OPENROUTER_API_KEY),
// meaning anyone decompiling the app could extract it and spend our OpenRouter
// credits directly, bypassing every daily usage limit in the app entirely.
async function callOpenRouter(
  messages: ChatMessage[],
  options: ModelRouterOptions,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('companion_llm_proxy', {
    body: {
      messages,
      max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    },
  });

  if (error || !data?.success) {
    console.error('[ModelRouter] companion_llm_proxy error', error || data?.error);
    throw new Error('LLM routing failed');
  }

  if (!data.content) throw new Error('Invalid response from LLM');
  return data.content;
}

export const modelRouter = {
  async generate(
    messages: ChatMessage[],
    options: ModelRouterOptions = {},
  ): Promise<string> {
    return callOpenRouter(messages, options);
  },
};

export type RoutedPrompt = {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
};

export async function runRoutedPrompt(prompt: RoutedPrompt): Promise<string> {
  return modelRouter.generate(
    [
      { role: 'system', content: prompt.systemPrompt },
      { role: 'user', content: prompt.userPrompt },
    ],
    {
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    },
  );
}
