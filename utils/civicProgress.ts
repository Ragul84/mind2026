// 🏅 Civic engagement progress + badges for the "Know Your India" explorer.
// Self-contained: tracks actions locally (AsyncStorage) and awards real XP through
// the existing XPService when a badge unlocks. Never throws to callers.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { XPService } from './xpService';
import { SupabaseService } from './supabaseService';

const KEY = '@civic_progress_v1';

export type CivicState = {
  states: string[];      // distinct state names explored
  panchayats: string[];  // distinct gram-panchayat LGD codes viewed
  lessons: string[];     // distinct civics lessons read
  records: number;       // official records / actions opened
  reminders: number;     // gram-sabha reminders set
  badges: string[];      // unlocked badge ids
};

const DEFAULT: CivicState = { states: [], panchayats: [], lessons: [], records: 0, reminders: 0, badges: [] };

export type Badge = {
  id: string;
  name: string;
  icon: string;
  desc: string;
  xp: number;
  progress: (s: CivicState) => { cur: number; goal: number };
};

export const BADGES: Badge[] = [
  { id: 'first_step', name: 'First Step', icon: 'footsteps', desc: 'Open your first place on the map', xp: 20, progress: (s) => ({ cur: Math.min(1, s.states.length + s.panchayats.length), goal: 1 }) },
  { id: 'explorer', name: 'Nation Explorer', icon: 'earth', desc: 'Explore 8 states', xp: 40, progress: (s) => ({ cur: s.states.length, goal: 8 }) },
  { id: 'cartographer', name: 'Cartographer', icon: 'map', desc: 'Explore 18 states', xp: 80, progress: (s) => ({ cur: s.states.length, goal: 18 }) },
  { id: 'grassroots', name: 'Grassroots', icon: 'leaf', desc: 'View 10 gram panchayats', xp: 50, progress: (s) => ({ cur: s.panchayats.length, goal: 10 }) },
  { id: 'scholar', name: 'Constitution Scholar', icon: 'book', desc: 'Read a civics lesson', xp: 30, progress: (s) => ({ cur: s.lessons.length, goal: 1 }) },
  { id: 'active_citizen', name: 'Active Citizen', icon: 'shield-checkmark', desc: 'Open an official record or action', xp: 30, progress: (s) => ({ cur: Math.min(s.records, 1), goal: 1 }) },
  { id: 'gram_sabha_ready', name: 'Gram Sabha Ready', icon: 'calendar', desc: 'Set a Gram Sabha reminder', xp: 40, progress: (s) => ({ cur: Math.min(s.reminders, 1), goal: 1 }) },
];

const isUnlocked = (b: Badge, s: CivicState) => { const p = b.progress(s); return p.cur >= p.goal; };

async function load(): Promise<CivicState> {
  try { const r = await AsyncStorage.getItem(KEY); return r ? { ...DEFAULT, ...JSON.parse(r) } : { ...DEFAULT }; }
  catch { return { ...DEFAULT }; }
}
async function save(s: CivicState) { try { await AsyncStorage.setItem(KEY, JSON.stringify(s)); } catch {} }

export async function getCivicProgress(): Promise<CivicState> { return load(); }

export type CivicAction = 'state' | 'panchayat' | 'lesson' | 'record' | 'reminder';

// Returns the updated state + any badges newly unlocked by this action.
export async function recordCivicAction(action: CivicAction, key?: string): Promise<{ state: CivicState; newly: Badge[]; xp: number }> {
  try {
    const s = await load();
    let xp = 0; // engagement XP for genuinely-new actions (not per-tap spam)
    if (action === 'state' && key) { if (!s.states.includes(key)) { s.states.push(key); xp += 5; } }
    else if (action === 'panchayat' && key) { if (!s.panchayats.includes(key)) { s.panchayats.push(key); xp += 5; } }
    else if (action === 'lesson' && key) { if (!s.lessons.includes(key)) { s.lessons.push(key); xp += 10; } }
    else if (action === 'record') { s.records += 1; }
    else if (action === 'reminder') { s.reminders += 1; xp += 5; }

    const newly: Badge[] = [];
    for (const b of BADGES) { if (!s.badges.includes(b.id) && isUnlocked(b, s)) { s.badges.push(b.id); newly.push(b); xp += b.xp; } }
    await save(s);

    if (xp > 0) {
      try {
        const user = await SupabaseService.getCurrentUser();
        if (user?.id) await XPService.awardXP(user.id, xp, 'civic'); // → user_stats.total_xp (profile XP)
      } catch {}
    }
    return { state: s, newly, xp };
  } catch {
    return { state: { ...DEFAULT }, newly: [], xp: 0 };
  }
}
