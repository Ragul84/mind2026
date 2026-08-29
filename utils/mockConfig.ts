/**
 * mockConfig.ts — exam-accurate full-length mock patterns (Phase 1).
 *
 * Each config encodes the REAL exam pattern (section split, question count,
 * duration, sectional timing, marks and negative marking) verified against the
 * official patterns, and maps every section to the live quiz:subject:{key}
 * pools (see utils/redisService.ts POPULATED_KEYS). The mock engine assembles a
 * paper from these pools and scores it exactly like the real exam.
 *
 * Patterns are the standard/typical form of each exam; tune per notification.
 */

export interface MockSection {
  id: string;
  name: string;
  /** How many questions this section contributes to the paper. */
  count: number;
  /** Redis subject pool key(s) to draw from — mixed evenly when more than one. */
  pools: string[];
  /** Optional sectional time limit in minutes (e.g. IBPS). Omit = no lock. */
  durationMin?: number;
}

export interface MockConfig {
  examId: string;
  /** Human label, e.g. "SSC CGL — Tier 1". */
  name: string;
  sections: MockSection[];
  /** Overall time limit in minutes. */
  durationMin: number;
  /** Marks awarded per correct answer. */
  marksPerQuestion: number;
  /** Marks deducted per wrong answer (absolute). 0 = no negative marking. */
  negativeMark: number;
  /** True when each section is separately timed (IBPS-style). */
  sectionalTiming: boolean;
  /** Provenance of the pattern, shown in the UI. */
  source: string;
}

// General-awareness / general-studies pools, mixed for GA & GS sections.
const GA = ['history', 'polity', 'geography', 'economics', 'science', 'current_affairs'];

export const MOCK_CONFIGS: Record<string, MockConfig> = {
  // UPSC Prelims GS Paper-I — 100Q, 2 marks each, 1/3 negative (0.66), 120 min.
  upsc: {
    examId: 'upsc',
    name: 'UPSC Prelims — GS Paper I',
    sections: [{ id: 'gs', name: 'General Studies', count: 100, pools: GA }],
    durationMin: 120,
    marksPerQuestion: 2,
    negativeMark: 0.66,
    sectionalTiming: false,
    source: 'Standard UPSC CSE Prelims GS-I pattern',
  },

  // SSC CGL Tier-1 — 4×25 = 100Q, 2 marks each, 0.50 negative, 60 min.
  ssc: {
    examId: 'ssc',
    name: 'SSC CGL — Tier 1',
    sections: [
      { id: 'reasoning', name: 'General Intelligence & Reasoning', count: 25, pools: ['reasoning'] },
      { id: 'ga', name: 'General Awareness', count: 25, pools: GA },
      { id: 'quant', name: 'Quantitative Aptitude', count: 25, pools: ['maths'] },
      { id: 'english', name: 'English Comprehension', count: 25, pools: ['english'] },
    ],
    durationMin: 60,
    marksPerQuestion: 2,
    negativeMark: 0.5,
    sectionalTiming: false,
    source: 'Standard SSC CGL Tier-1 pattern',
  },

  // RRB NTPC CBT-1 — 100Q (Maths 30, Reasoning 30, GA 40), 1 mark, 1/3 neg, 90 min.
  rrb: {
    examId: 'rrb',
    name: 'RRB NTPC — CBT 1',
    sections: [
      { id: 'maths', name: 'Mathematics', count: 30, pools: ['maths'] },
      { id: 'reasoning', name: 'General Intelligence & Reasoning', count: 30, pools: ['reasoning'] },
      { id: 'ga', name: 'General Awareness', count: 40, pools: GA },
    ],
    durationMin: 90,
    marksPerQuestion: 1,
    negativeMark: 0.33,
    sectionalTiming: false,
    source: 'Standard RRB NTPC CBT-1 pattern',
  },

  // TNPSC Group 4 — 200Q (GS 75, Aptitude 25, Tamil 100), 1.5 marks, NO negative, 180 min.
  tnpsc: {
    examId: 'tnpsc',
    name: 'TNPSC Group 4',
    sections: [
      { id: 'gs', name: 'General Studies', count: 75, pools: GA },
      { id: 'aptitude', name: 'Aptitude & Mental Ability', count: 25, pools: ['maths'] },
      { id: 'tamil', name: 'Tamil (Eligibility-cum-Scoring)', count: 100, pools: ['tamil'] },
    ],
    durationMin: 180,
    marksPerQuestion: 1.5,
    negativeMark: 0,
    sectionalTiming: false,
    source: 'Standard TNPSC Group 4 pattern',
  },

  // IBPS PO Prelims — 100Q, sectional 20 min each, 1 mark, 0.25 neg. (Exam is
  // currently gated "Coming soon"; config is ready for when it's surfaced.)
  bank: {
    examId: 'bank',
    name: 'IBPS PO — Prelims',
    sections: [
      { id: 'english', name: 'English Language', count: 30, pools: ['english'], durationMin: 20 },
      { id: 'reasoning', name: 'Reasoning Ability', count: 35, pools: ['reasoning'], durationMin: 20 },
      { id: 'quant', name: 'Quantitative Aptitude', count: 35, pools: ['maths'], durationMin: 20 },
    ],
    durationMin: 60,
    marksPerQuestion: 1,
    negativeMark: 0.25,
    sectionalTiming: true,
    source: 'Standard IBPS PO Prelims pattern',
  },
};

export function getMockConfig(examId: string): MockConfig | null {
  return MOCK_CONFIGS[examId] ?? null;
}
