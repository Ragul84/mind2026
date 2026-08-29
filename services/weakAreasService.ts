/**
 * Weak Areas engine (client).
 * ------------------------------------------------------------------
 * Real spaced-repetition tracking of weak topics, backing the Sprint Session.
 *  - recordWrong(): a wrong answer creates/strengthens a weak topic (due now).
 *  - getDueTopics(): topics that are due to resurface (newest-wrong first),
 *    excluding mastered ones and anything revised recently (not yet due).
 *  - markRevised(): advances the spaced-repetition schedule; masters at box 5.
 *
 * Every call is defensive: if the table/RPC isn't there yet, it no-ops so the
 * rest of the app keeps working.
 */

import { supabase } from '@/utils/supabase';
import { AIUsageService } from '@/services/aiUsageService';

export interface WeakTopic {
  id: string;
  subject: string;
  topic: string;
  reason: string | null;
  strength: number;      // 0..5 mastery box
  times_wrong: number;
  times_revised: number;
  status: 'active' | 'mastered' | 'archived';
  last_wrong_at: string;
  next_due_at: string;
}

export interface SprintCard {
  heading: string;
  points: string[];
  insight: string;
}
export interface SprintCheckpoint {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}
export interface SprintContent {
  topic: string;
  cards: SprintCard[];
  checkpoint: SprintCheckpoint | null;
}

// Due topics don't change from moment to moment — re-entering the study-plan
// screen (tab switches, back navigation) shouldn't re-query every time. Short
// TTL since recordWrong()/markRevised() can change the due set during a
// session; those two call invalidateDueTopicsCache() so a genuine change still
// shows up immediately.
let dueTopicsCache: { limit: number; data: WeakTopic[]; at: number } | null = null;
const DUE_TOPICS_CACHE_TTL_MS = 30_000;

export const weakAreasService = {
  invalidateDueTopicsCache(): void {
    dueTopicsCache = null;
  },

  // Record a wrong answer as a weak topic (or strengthen an existing one).
  async recordWrong(topic: string, subject = 'General', reason?: string, source = 'quiz'): Promise<void> {
    if (!topic?.trim()) return;
    try {
      await supabase.rpc('record_weak_topic', {
        p_topic: topic.trim(),
        p_subject: subject,
        p_reason: reason ?? null,
        p_source: source,
      });
      this.invalidateDueTopicsCache();
    } catch {
      /* non-fatal */
    }
  },

  // Topics due for revision right now — newest-wrong first. Excludes mastered
  // and not-yet-due (recently revised) topics automatically.
  async getDueTopics(limit = 5, opts?: { force?: boolean }): Promise<WeakTopic[]> {
    if (
      !opts?.force &&
      dueTopicsCache &&
      dueTopicsCache.limit === limit &&
      Date.now() - dueTopicsCache.at < DUE_TOPICS_CACHE_TTL_MS
    ) {
      return dueTopicsCache.data;
    }
    try {
      const { data, error } = await supabase
        .from('weak_topics')
        .select('id, subject, topic, reason, strength, times_wrong, times_revised, status, last_wrong_at, next_due_at')
        .eq('status', 'active')
        .lte('next_due_at', new Date().toISOString())
        .order('last_wrong_at', { ascending: false })
        .limit(limit);
      if (error) return [];
      const result = (data as WeakTopic[]) ?? [];
      dueTopicsCache = { limit, data: result, at: Date.now() };
      return result;
    } catch {
      return [];
    }
  },

  // All active weak topics (for a dashboard / count), due or not.
  async getAllActive(limit = 50): Promise<WeakTopic[]> {
    try {
      const { data, error } = await supabase
        .from('weak_topics')
        .select('id, subject, topic, reason, strength, times_wrong, times_revised, status, last_wrong_at, next_due_at')
        .eq('status', 'active')
        .order('next_due_at', { ascending: true })
        .limit(limit);
      if (error) return [];
      return (data as WeakTopic[]) ?? [];
    } catch {
      return [];
    }
  },

  // Advance spaced repetition after a topic is revised in a sprint.
  async markRevised(topicId: string): Promise<void> {
    if (!topicId) return;
    try {
      await supabase.rpc('mark_topic_revised', { p_id: topicId });
      this.invalidateDueTopicsCache();
    } catch {
      /* non-fatal */
    }
  },

  // Generate a coaching-level revision sprint (cards + checkpoint) for one weak
  // topic, grounded in why it's weak. Backed by the miga_sprint_generate function.
  async generateSprint(topic: string, reason?: string | null, exam = 'UPSC'): Promise<SprintContent | null> {
    if (!topic?.trim()) return null;
    // Was previously ungated (no client or server check), a real unbounded
    // OpenRouter cost on every sprint. Mirrors the quiz-room-create pattern:
    // throw a LIMIT_REACHED-prefixed error the caller can show as a real
    // popup, instead of the old silent-skip-to-next-topic behavior.
    const usage = await AIUsageService.check('quiz_sprint_generate');
    if (!usage.allowed) {
      throw new Error(`LIMIT_REACHED:${AIUsageService.limitMessage(usage)}`);
    }
    try {
      const { data, error } = await supabase.functions.invoke('miga_sprint_generate', {
        body: { topic: topic.trim(), reason: reason ?? undefined, exam },
      });
      if (error || !data?.success || !data?.sprint) return null;
      await AIUsageService.consume('quiz_sprint_generate');
      return data.sprint as SprintContent;
    } catch {
      return null;
    }
  },

  // Let the user add their own focus topic when nothing is due.
  async addManual(topic: string, subject = 'General'): Promise<void> {
    await this.recordWrong(topic, subject, 'Added by you', 'manual');
  },
};
