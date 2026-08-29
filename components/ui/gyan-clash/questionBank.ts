import { GyanClashQuestion, SubjectFilter } from './types';
import { supabase } from '@/utils/supabaseService';
import { RedisService, RedisQuestion } from '@/utils/redisService';

export const FALLBACK_GYAN_CLASH_QUESTIONS: GyanClashQuestion[] = [
  {
    id: 'polity-preamble',
    subject: 'Polity',
    prompt: 'Which word was added to the Preamble by the 42nd Amendment?',
    choices: [
      { id: 'a', text: 'Republic' },
      { id: 'b', text: 'Socialist' },
      { id: 'c', text: 'Justice' },
      { id: 'd', text: 'Liberty' },
    ],
    correctChoiceId: 'b',
    explanation: 'The 42nd Amendment added Socialist, Secular and Integrity.',
    difficulty: 'easy',
  },
  {
    id: 'history-delhi-sultanate',
    subject: 'History',
    prompt: 'Who founded the Slave dynasty in Delhi?',
    choices: [
      { id: 'a', text: 'Iltutmish' },
      { id: 'b', text: 'Balban' },
      { id: 'c', text: 'Qutb-ud-din Aibak' },
      { id: 'd', text: 'Alauddin Khalji' },
    ],
    correctChoiceId: 'c',
    explanation: 'Qutb-ud-din Aibak founded the Mamluk or Slave dynasty.',
    difficulty: 'easy',
  },
  {
    id: 'geography-monsoon',
    subject: 'Geography',
    prompt: 'The southwest monsoon normally reaches Kerala around which date?',
    choices: [
      { id: 'a', text: '1 June' },
      { id: 'b', text: '15 July' },
      { id: 'c', text: '26 January' },
      { id: 'd', text: '2 October' },
    ],
    correctChoiceId: 'a',
    explanation: 'The normal onset date over Kerala is around 1 June.',
    difficulty: 'easy',
  },
  {
    id: 'economy-cpi',
    subject: 'Economy',
    prompt: 'CPI inflation in India is primarily targeted by which institution?',
    choices: [
      { id: 'a', text: 'SEBI' },
      { id: 'b', text: 'RBI' },
      { id: 'c', text: 'NITI Aayog' },
      { id: 'd', text: 'Finance Commission' },
    ],
    correctChoiceId: 'b',
    explanation: 'RBI targets retail inflation under the monetary policy framework.',
    difficulty: 'medium',
  },
  {
    id: 'science-newton',
    subject: 'Physics',
    prompt: 'Which law explains recoil of a gun?',
    choices: [
      { id: 'a', text: 'Newton first law' },
      { id: 'b', text: 'Newton second law' },
      { id: 'c', text: 'Newton third law' },
      { id: 'd', text: 'Law of gravitation' },
    ],
    correctChoiceId: 'c',
    explanation: 'Recoil is an action-reaction pair, explained by Newton third law.',
    difficulty: 'easy',
  },
  {
    id: 'environment-ramsar',
    subject: 'Environment',
    prompt: 'Ramsar Convention is related to conservation of what?',
    choices: [
      { id: 'a', text: 'Wetlands' },
      { id: 'b', text: 'Deserts' },
      { id: 'c', text: 'Mountains' },
      { id: 'd', text: 'Coral only' },
    ],
    correctChoiceId: 'a',
    explanation: 'The Ramsar Convention focuses on wetlands of international importance.',
    difficulty: 'easy',
  },
];

const SUBJECT_MAP: Record<string, string[]> = {
  history:   ['History', 'Ancient India', 'Medieval India', 'Modern India'],
  geography: ['Geography', 'Physical Geography', 'Indian Geography'],
  polity:    ['Polity', 'Indian Constitution', 'Civics'],
  science:   ['Science', 'Physics', 'Chemistry', 'Biology'],
  economy:   ['Economy', 'Economics', 'Indian Economy'],
  physics:   ['Physics'],
  biology:   ['Biology'],
};

export function getDailyQuestionSet(seed = new Date().toISOString().slice(0, 10), subject = 'mix'): GyanClashQuestion[] {
  let pool = FALLBACK_GYAN_CLASH_QUESTIONS;
  if (subject !== 'mix' && SUBJECT_MAP[subject]) {
    const subjects = SUBJECT_MAP[subject];
    const filtered = pool.filter(q => subjects.some(s => q.subject.toLowerCase().includes(s.toLowerCase())));
    if (filtered.length >= 5) pool = filtered;
  }
  const offset = seed.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % pool.length;
  return [...pool.slice(offset), ...pool.slice(0, offset)];
}

export type GyanClashServerMatch = {
  matchId: string;
  questions: GyanClashQuestion[];
};

export async function createGyanClashServerMatch(count = 15, subject = 'mix'): Promise<GyanClashServerMatch> {
  const { data, error } = await supabase.functions.invoke('gyan-clash-match', {
    body: { action: 'create', count, subject },
  });
  if (error || !data?.success || !Array.isArray(data.questions)) {
    throw new Error(error?.message || data?.error || 'Could not create Gyan Clash match');
  }
  return { matchId: String(data.matchId), questions: data.questions.slice(0, count) };
}

export async function submitGyanClashAnswer(params: {
  matchId: string;
  questionId: string;
  selectedChoiceId: string;
}): Promise<{ correct: boolean; correctChoiceId: string; scoreDelta: number; damage: number }> {
  const { data, error } = await supabase.functions.invoke('gyan-clash-match', {
    body: { action: 'submit', ...params },
  });
  if (error || !data?.success) {
    throw new Error(error?.message || data?.error || 'Could not validate answer');
  }
  return {
    correct: !!data.correct,
    correctChoiceId: String(data.correctChoiceId),
    scoreDelta: Number(data.scoreDelta) || 0,
    damage: Number(data.damage) || 0,
  };
}

// ── Redis quizhub integration ───────────────────────────────────────────────
// Pulls the *real* quizhub questions seeded in Upstash Redis under
// `quiz:subject:{key}` and converts them into the Gyan Clash battle shape.

const CHOICE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Maps a battle SubjectFilter to the Redis subject keys used by the quiz hub. */
const SUBJECT_REDIS_KEYS: Record<SubjectFilter, string[]> = {
  mix:       ['polity', 'history', 'geography', 'science', 'economics', 'physics', 'biology'],
  history:   ['history'],
  geography: ['geography'],
  polity:    ['polity'],
  science:   ['science', 'physics', 'chemistry', 'biology'],
  economy:   ['economics'],
  physics:   ['physics'],
  biology:   ['biology'],
};

function normaliseDifficulty(value?: string): GyanClashQuestion['difficulty'] {
  const d = String(value || '').toLowerCase();
  if (d === 'hard' || d === 'tough' || d === 'difficult') return 'hard';
  if (d === 'easy' || d === 'basic') return 'easy';
  return 'medium';
}

/** Convert one Redis question into a Gyan Clash question, or null if unusable. */
function convertRedisQuestion(q: RedisQuestion, fallbackSubject: string): GyanClashQuestion | null {
  const prompt = String(q.question || q.question_text || q.prompt || '').trim();
  const options = Array.isArray(q.options) ? q.options.map(o => String(o ?? '').trim()).filter(Boolean) : [];
  const answerIndex = typeof q.answer_index === 'number' ? q.answer_index : -1;
  // The battle needs a prompt, 2-4 real choices and a known correct answer.
  if (!prompt || options.length < 2 || options.length > CHOICE_LETTERS.length) return null;
  if (answerIndex < 0 || answerIndex >= options.length) return null;

  const choices = options.map((text, i) => ({ id: CHOICE_LETTERS[i], text }));
  return {
    id: String(q.id || `${fallbackSubject}-${prompt.slice(0, 24)}-${answerIndex}`),
    subject: String(q.subject || fallbackSubject || 'General'),
    prompt,
    choices,
    correctChoiceId: CHOICE_LETTERS[answerIndex],
    explanation: String(q.explanation || ''),
    difficulty: normaliseDifficulty(q.difficulty),
  };
}

function dedupeById(list: GyanClashQuestion[]): GyanClashQuestion[] {
  const seen = new Set<string>();
  const out: GyanClashQuestion[] = [];
  for (const q of list) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

function shuffleArr<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Load battle questions for a subject straight from the quiz-hub Redis bank.
 * Falls back to (and tops up with) the static set so a match can always start.
 */
export async function loadGyanClashQuestions(
  subject: SubjectFilter = 'mix',
  count = 30,
  difficulty?: 'easy' | 'medium' | 'hard',
): Promise<GyanClashQuestion[]> {
  const keys = SUBJECT_REDIS_KEYS[subject] || SUBJECT_REDIS_KEYS.mix;
  const perKey = Math.max(6, Math.ceil((count * 1.8) / keys.length));

  let fetched: GyanClashQuestion[] = [];
  try {
    const batches = await Promise.all(
      keys.map(key =>
        RedisService.getQuestions(key, perKey, difficulty)
          .then(rows => (rows || []).map(r => convertRedisQuestion(r, key)).filter(Boolean) as GyanClashQuestion[])
          .catch(() => [] as GyanClashQuestion[]),
      ),
    );
    // Interleave across subjects so a "mix" match feels varied, not clustered.
    const maxLen = Math.max(0, ...batches.map(b => b.length));
    for (let i = 0; i < maxLen; i++) {
      for (const batch of batches) {
        if (batch[i]) fetched.push(batch[i]);
      }
    }
    fetched = dedupeById(fetched);
  } catch {
    fetched = [];
  }

  // Top up with the static bank if Redis was thin/unavailable.
  if (fetched.length < Math.min(count, 8)) {
    const filler = shuffleArr(getDailyQuestionSet(undefined, subject));
    fetched = dedupeById([...fetched, ...filler]);
  }

  return fetched.slice(0, count);
}
