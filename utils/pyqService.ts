/**
 * pyqService.ts — Verified Previous-Year Question browser (Phase 1 #4).
 *
 * Reads the strict "verified clean" PYQ layer (official-key / cross-verified
 * sources only, confidence >= 0.7, real 4-option MCQs) exposed by the
 * pyq_analytics_views migration:
 *   pyq_exam_summary      — one row per exam (totals, year range)
 *   pyq_year_distribution — exam × year × subject counts
 *   pyq_verified_clean    — the serveable questions themselves
 *
 * A "paper" here = an exam + year set of verified questions (partial until PYQ
 * ingestion completes a full 100-Q paper — counts are shown honestly).
 * Every call fails soft (returns []) if the views aren't deployed or offline.
 */

import { supabase } from './supabaseService';

export interface PyqExam {
  exam: string;
  total_questions: number;
  from_year: number | null;
  to_year: number | null;
  years_covered: number;
  subjects_covered: number;
}

export interface PyqYear {
  year: number;
  question_count: number;
}

export interface PyqQuestion {
  id: string;
  question_number: number | null;
  question_text: string;
  options: string[];
  answer_text: string;
  subject: string | null;
  topic: string | null;
  /** True when TNPSC officially nullified this question (multi-correct or grace). */
  nullified: boolean;
  /** All options TNPSC accepts as correct. For a normal question this is just [answer_text]. */
  accepted_answers: string[];
}

export const PyqService = {
  /** Exams that have verified PYQs, most first. */
  async getExams(): Promise<PyqExam[]> {
    try {
      const { data, error } = await supabase
        .from('pyq_exam_summary')
        .select('exam,total_questions,from_year,to_year,years_covered,subjects_covered')
        .order('total_questions', { ascending: false });
      if (error || !data) return [];
      return data as PyqExam[];
    } catch { return []; }
  },

  /** Years (papers) available for an exam, newest first, with question counts. */
  async getYears(exam: string): Promise<PyqYear[]> {
    try {
      const { data, error } = await supabase
        .from('pyq_year_distribution')
        .select('year,question_count')
        .eq('exam', exam);
      if (error || !data) return [];
      const byYear: Record<number, number> = {};
      for (const r of data as any[]) {
        if (r.year != null) byYear[r.year] = (byYear[r.year] || 0) + (r.question_count || 0);
      }
      return Object.entries(byYear)
        .map(([y, c]) => ({ year: Number(y), question_count: c }))
        .sort((a, b) => b.year - a.year);
    } catch { return []; }
  },

  /** All verified questions for an exam + year, in paper order. */
  async getPaper(exam: string, year: number): Promise<PyqQuestion[]> {
    try {
      const { data, error } = await supabase
        .from('pyq_verified_clean')
        .select('id,question_number,question_text,options,answer_text,subject,topic,nullified,accepted_answers')
        .eq('exam', exam)
        .eq('year', year)
        .order('question_number', { ascending: true });
      if (error || !data) return [];
      return (data as any[]).map((r) => ({
        id: r.id,
        question_number: r.question_number,
        question_text: r.question_text,
        options: Array.isArray(r.options) ? r.options : [],
        answer_text: r.answer_text,
        subject: r.subject,
        topic: r.topic,
        nullified: !!r.nullified,
        // Normal questions accept only the single answer; nullified ones accept the full set.
        accepted_answers: Array.isArray(r.accepted_answers) && r.accepted_answers.length
          ? r.accepted_answers
          : [r.answer_text],
      }));
    } catch { return []; }
  },
};

export default PyqService;
