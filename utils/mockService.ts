/**
 * mockService.ts — assemble and score exam-accurate full-length mocks (Phase 1).
 *
 * assembleMock(examId) pulls questions from the live Redis pools per the exam's
 * MockConfig; scoreMock(paper, answers) grades it exactly like the real exam,
 * including per-exam negative marking and a section-wise breakdown. Pure logic —
 * the timed runner UI and the rank/percentile service build on top of these.
 */

import RedisService from './redisService';
import type { RedisQuestion } from './redisService';
import { getMockConfig, MockConfig, MockSection } from './mockConfig';

export interface MockQuestion extends RedisQuestion {
  sectionId: string;
  /** Stable 0-based position across the whole paper, in section order. */
  index: number;
}

export interface AssembledSection extends MockSection {
  questions: MockQuestion[];
}

export interface MockPaper {
  config: MockConfig;
  sections: AssembledSection[];
  questions: MockQuestion[]; // flat, in section order (index === position)
  totalQuestions: number;
  maxMarks: number;
  assembledAt: number;
}

/** answers[question.index] = selected option index, or null/undefined = skipped. */
export type MockAnswers = Record<number, number | null | undefined>;

export interface SectionResult {
  id: string;
  name: string;
  total: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  score: number;
  maxMarks: number;
}

export interface MockResult {
  sections: SectionResult[];
  total: number;
  attempted: number;
  correct: number;
  wrong: number;
  skipped: number;
  /** Net score after negative marking. */
  score: number;
  maxMarks: number;
  /** correct / attempted, 0–1 (0 when nothing attempted). */
  accuracy: number;
  /** score / maxMarks, 0–1. */
  percentage: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const scorable = (q: RedisQuestion): boolean =>
  typeof q.answer_index === 'number' && Array.isArray(q.options) && q.options.length >= 2;

/** Build a full mock paper for an exam from its live pools. Returns null if the
 *  exam has no configured pattern. */
export async function assembleMock(examId: string): Promise<MockPaper | null> {
  const config = getMockConfig(examId);
  if (!config) return null;

  const sections: AssembledSection[] = [];
  const flat: MockQuestion[] = [];
  let cursor = 0;

  for (const sec of config.sections) {
    const perPool = Math.ceil((sec.count / sec.pools.length) * 1.6); // over-fetch for dedup/filter headroom
    const seen = new Set<string>();
    const gathered: RedisQuestion[] = [];

    for (const pool of sec.pools) {
      const qs = await RedisService.getQuestions(pool, perPool);
      for (const q of qs) {
        if (!scorable(q)) continue;
        const key = (q.question || q.question_text || q.prompt || '').trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        gathered.push(q);
      }
    }

    const chosen = shuffle(gathered).slice(0, sec.count);
    const withMeta: MockQuestion[] = chosen.map((q) => {
      const mq: MockQuestion = { ...q, sectionId: sec.id, index: cursor++ };
      flat.push(mq);
      return mq;
    });
    sections.push({ ...sec, questions: withMeta });
  }

  const totalQuestions = flat.length;
  return {
    config,
    sections,
    questions: flat,
    totalQuestions,
    maxMarks: totalQuestions * config.marksPerQuestion,
    assembledAt: Date.now(),
  };
}

/** Grade a submitted mock with the exam's real marking scheme. */
export function scoreMock(paper: MockPaper, answers: MockAnswers): MockResult {
  const { marksPerQuestion: marks, negativeMark: neg } = paper.config;

  const sections: SectionResult[] = paper.sections.map((sec) => {
    let correct = 0, wrong = 0, skipped = 0;
    for (const q of sec.questions) {
      const a = answers[q.index];
      if (a === null || a === undefined) { skipped++; continue; }
      if (a === q.answer_index) correct++;
      else wrong++;
    }
    const attempted = correct + wrong;
    return {
      id: sec.id,
      name: sec.name,
      total: sec.questions.length,
      attempted,
      correct,
      wrong,
      skipped,
      score: correct * marks - wrong * neg,
      maxMarks: sec.questions.length * marks,
    };
  });

  const agg = sections.reduce(
    (t, s) => ({
      total: t.total + s.total,
      attempted: t.attempted + s.attempted,
      correct: t.correct + s.correct,
      wrong: t.wrong + s.wrong,
      skipped: t.skipped + s.skipped,
      score: t.score + s.score,
      maxMarks: t.maxMarks + s.maxMarks,
    }),
    { total: 0, attempted: 0, correct: 0, wrong: 0, skipped: 0, score: 0, maxMarks: 0 },
  );

  return {
    sections,
    ...agg,
    accuracy: agg.attempted > 0 ? agg.correct / agg.attempted : 0,
    percentage: agg.maxMarks > 0 ? agg.score / agg.maxMarks : 0,
  };
}
