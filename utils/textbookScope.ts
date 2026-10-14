// The student's textbook scope (board + class + language) for textbook-aware AI.
// Saved on user_profiles (textbook_board / textbook_class / textbook_language)
// and mirrored to AsyncStorage so MIGA can read it without a round trip.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utils/supabaseService';

export type TextbookBoard = { id: string; label: string; short: string; boardType: 'ncert' | 'state'; stateCode?: string };

export const TEXTBOOK_BOARDS: TextbookBoard[] = [
  { id: 'ncert', label: 'NCERT / CBSE', short: 'NCERT', boardType: 'ncert' },
  { id: 'samacheer', label: 'Tamil Nadu (Samacheer Kalvi)', short: 'TN', boardType: 'state', stateCode: 'TN' },
  { id: 'maharashtra', label: 'Maharashtra (Balbharati)', short: 'MH', boardType: 'state', stateCode: 'MH' },
  { id: 'kerala', label: 'Kerala (SCERT)', short: 'KL', boardType: 'state', stateCode: 'KL' },
  { id: 'karnataka', label: 'Karnataka (KTBS)', short: 'KA', boardType: 'state', stateCode: 'KA' },
  { id: 'telangana', label: 'Telangana (SCERT)', short: 'TS', boardType: 'state', stateCode: 'TS' },
  { id: 'andhra', label: 'Andhra Pradesh (SCERT)', short: 'AP', boardType: 'state', stateCode: 'AP' },
  { id: 'up', label: 'Uttar Pradesh (UPMSP)', short: 'UP', boardType: 'state', stateCode: 'UP' },
];

export const TEXTBOOK_CLASSES = [6, 7, 8, 9, 10, 11, 12] as const;

export type TextbookScope = {
  board: string | null;
  classLevel: number | null; // null = all classes (aspirants revising 6-12)
  language: string | null;
};

const STORAGE_KEY = 'textbook_scope_v1';
const MODE_KEY = 'textbook_mode_v1';

export const EMPTY_SCOPE: TextbookScope = { board: null, classLevel: null, language: null };

export function boardLabel(id: string | null | undefined): string {
  if (!id) return 'Any board';
  return TEXTBOOK_BOARDS.find((b) => b.id === id)?.short ?? id.toUpperCase();
}

export function scopeLabel(scope: TextbookScope): string {
  const cls = scope.classLevel ? `Class ${scope.classLevel}` : 'Classes 6-12';
  return `${boardLabel(scope.board)} · ${cls}`;
}

export async function loadTextbookScope(userId?: string | null): Promise<TextbookScope> {
  try {
    const cached = await AsyncStorage.getItem(STORAGE_KEY);
    if (cached) return { ...EMPTY_SCOPE, ...JSON.parse(cached) };
  } catch {}
  if (!userId) return EMPTY_SCOPE;
  try {
    const { data } = await supabase
      .from('user_profiles')
      .select('textbook_board, textbook_class, textbook_language')
      .eq('id', userId)
      .maybeSingle();
    const scope: TextbookScope = {
      board: data?.textbook_board ?? null,
      classLevel: data?.textbook_class ?? null,
      language: data?.textbook_language ?? null,
    };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(scope)).catch(() => {});
    return scope;
  } catch {
    return EMPTY_SCOPE;
  }
}

export async function saveTextbookScope(userId: string | null | undefined, scope: TextbookScope): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(scope)).catch(() => {});
  if (!userId) return;
  const { error } = await supabase
    .from('user_profiles')
    .update({
      textbook_board: scope.board,
      textbook_class: scope.classLevel,
      textbook_language: scope.language,
    })
    .eq('id', userId);
  if (error) console.warn('[textbookScope] save failed', error.message);
}

export async function loadTextbookMode(): Promise<boolean> {
  try { return (await AsyncStorage.getItem(MODE_KEY)) === '1'; } catch { return false; }
}

export async function saveTextbookMode(on: boolean): Promise<void> {
  await AsyncStorage.setItem(MODE_KEY, on ? '1' : '0').catch(() => {});
}

/** Page-level citation returned by companion_llm_proxy / miga_stream in textbook mode. */
export type TextbookCitation = {
  ref: number;
  chunkId: string;
  bookTitle: string;
  board: string;
  classLevel: number;
  subject: string;
  chapterNumber: number | null;
  chapterTitle: string | null;
  page: number;
  similarity: number;
  excerpt: string;
};

export function citationChipLabel(c: TextbookCitation): string {
  const ch = c.chapterNumber != null ? `Ch ${c.chapterNumber}` : 'Ch –';
  return `${boardLabel(c.board)} ${c.classLevel} · ${c.bookTitle} · ${ch} · p.${c.page}`;
}
