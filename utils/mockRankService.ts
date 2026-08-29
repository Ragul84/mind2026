/**
 * mockRankService.ts — persist a mock attempt and fetch its All-India Rank.
 *
 * Records the submitted mock and returns the rank/percentile computed server-side
 * (SECURITY DEFINER RPC submit_mock_attempt — see the 20260808 migration). Rank is
 * over each user's best score for the exam. Fails soft: returns null when the user
 * is signed out or offline, so the results screen still shows the local score.
 */

import { supabase } from './supabaseService';
import type { MockResult } from './mockService';

export interface MockRank {
  attemptId?: string;
  rank: number;
  total: number;
  /** Percentage of test-takers this score beat (0–100). */
  percentile: number;
}

export async function submitMockAttempt(
  examId: string,
  configName: string,
  result: MockResult,
  durationSec: number,
): Promise<MockRank | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data, error } = await supabase.rpc('submit_mock_attempt', {
      p_exam_id: examId,
      p_config_name: configName,
      p_total: result.total,
      p_attempted: result.attempted,
      p_correct: result.correct,
      p_wrong: result.wrong,
      p_skipped: result.skipped,
      p_score: result.score,
      p_max_marks: result.maxMarks,
      p_accuracy: result.accuracy,
      p_percentage: result.percentage,
      p_duration_sec: Math.max(0, Math.round(durationSec)),
      p_sections: result.sections,
    });

    if (error || !data) {
      if (error) console.warn('[mockRank] submit failed:', error.message);
      return null;
    }
    return {
      attemptId: (data as any).attempt_id,
      rank: (data as any).rank ?? 0,
      total: (data as any).total ?? 0,
      percentile: Number((data as any).percentile ?? 0),
    };
  } catch (e) {
    console.warn('[mockRank] submit error:', e);
    return null;
  }
}
