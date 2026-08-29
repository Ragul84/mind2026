import AsyncStorage from '@react-native-async-storage/async-storage';
import { weakAreasService } from '@/services/weakAreasService';

export type QuizMistakeEntry = {
  id?: string;
  question: string;
  options: string[];
  explanation?: string;
  selected_index: number;
  correct_index: number;
  difficulty?: string;
  timed_out?: boolean;
  sourceTitle?: string;
  sourceType?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  attempts: number;
};

export type QuizMistakeSession = {
  id: string;
  createdAt: string;
  title: string;
  mistakes: QuizMistakeEntry[];
};

const MAX_MISTAKES = 250;
const sessionKey = (sessionId: string) => `quiz_mistakes:${sessionId}`;
const notebookKey = (userId?: string | null) => `quiz_mistake_notebook:${userId || 'guest'}`;

const stableKey = (entry: Pick<QuizMistakeEntry, 'id' | 'question'>) =>
  String(entry.id || entry.question || '').trim().toLowerCase();

export const QuizMistakeNotebook = {
  async saveSession(params: {
    userId?: string | null;
    sessionId: string;
    title: string;
    sourceType?: string;
    mistakes: Array<Omit<QuizMistakeEntry, 'firstSeenAt' | 'lastSeenAt' | 'attempts' | 'sourceTitle' | 'sourceType'>>;
  }) {
    const now = new Date().toISOString();
    const normalized: QuizMistakeEntry[] = params.mistakes.map((item) => ({
      ...item,
      sourceTitle: params.title,
      sourceType: params.sourceType,
      firstSeenAt: now,
      lastSeenAt: now,
      attempts: 1,
    }));

    const session: QuizMistakeSession = {
      id: params.sessionId,
      createdAt: now,
      title: params.title,
      mistakes: normalized,
    };

    await AsyncStorage.setItem(sessionKey(params.sessionId), JSON.stringify(session));

    const existing = await this.getNotebook(params.userId);
    const byId = new Map<string, QuizMistakeEntry>();
    existing.forEach((item) => byId.set(stableKey(item), item));
    normalized.forEach((item) => {
      const key = stableKey(item);
      const previous = byId.get(key);
      byId.set(key, previous
        ? {
            ...previous,
            ...item,
            firstSeenAt: previous.firstSeenAt,
            lastSeenAt: now,
            attempts: (previous.attempts || 1) + 1,
          }
        : item
      );
    });

    const next = [...byId.values()]
      .sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt))
      .slice(0, MAX_MISTAKES);
    await AsyncStorage.setItem(notebookKey(params.userId), JSON.stringify(next));

    // Single choke point: feed the weak-areas engine so these wrong answers
    // become spaced-repetition weak topics for the Sprint Session. Daily Dose,
    // Quiz Hub and Chat all flow through saveSession, so this captures all three.
    if (params.mistakes.length && String(params.title || '').trim().length > 2) {
      const src = params.sourceType === 'chat' ? 'chat' : 'quiz';
      const n = params.mistakes.length;
      void weakAreasService.recordWrong(
        params.title,
        'General',
        `Missed ${n} question${n > 1 ? 's' : ''} here`,
        src,
      );
    }
    return session;
  },

  async getSession(sessionId: string): Promise<QuizMistakeSession | null> {
    const raw = await AsyncStorage.getItem(sessionKey(sessionId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as QuizMistakeSession;
    } catch {
      return null;
    }
  },

  async getNotebook(userId?: string | null): Promise<QuizMistakeEntry[]> {
    const raw = await AsyncStorage.getItem(notebookKey(userId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async clearNotebook(userId?: string | null) {
    await AsyncStorage.removeItem(notebookKey(userId));
  },
};
