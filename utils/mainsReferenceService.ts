/**
 * mainsReferenceService.ts — fetch a curated Mains/descriptive model answer to
 * grade against (Phase 2 quality lift for answer-eval). Fails soft: returns null
 * when the corpus is empty or offline, so answer-eval falls back to textbook-RAG
 * grounding. As references are ingested, evaluation quality auto-improves.
 */

import { supabase } from './supabaseService';

export interface MainsReference {
  id: string;
  exam: string;
  topic: string | null;
  question: string;
  model_answer: string;
  key_points: string[];
  source: string | null;
}

export const MainsReferenceService = {
  /** Best-effort match for a reference answer by exam + a salient keyword. */
  async findReference(exam: string, questionText: string): Promise<MainsReference | null> {
    try {
      const kw = (questionText || '')
        .split(/\s+/)
        .map((w) => w.replace(/[^a-zA-Z]/g, ''))
        .filter((w) => w.length > 4)
        .slice(0, 1)[0];

      let query = supabase.from('mains_reference_answers').select('*').ilike('exam', exam).limit(1);
      if (kw) query = supabase.from('mains_reference_answers').select('*').ilike('exam', exam).ilike('question', `%${kw}%`).limit(1);

      const { data, error } = await query;
      if (error || !data?.length) return null;
      const r = data[0] as any;
      return {
        id: r.id, exam: r.exam, topic: r.topic ?? null, question: r.question,
        model_answer: r.model_answer, source: r.source ?? null,
        key_points: Array.isArray(r.key_points) ? r.key_points : [],
      };
    } catch {
      return null;
    }
  },
};

export default MainsReferenceService;
