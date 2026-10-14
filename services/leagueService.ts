// Weekly leagues: reads the caller's cohort via the get_my_league() RPC.
// XP flows in automatically (trigger on user_stats.total_xp); the client never writes.

import { supabase } from '@/utils/supabaseService';

export type LeagueTier =
  | 'bronze' | 'silver' | 'gold' | 'sapphire' | 'ruby'
  | 'emerald' | 'amethyst' | 'pearl' | 'obsidian' | 'diamond';

export type LeagueMember = {
  user_id: string;
  rank: number;
  weekly_xp: number;
  name: string;
  avatar_url: string | null;
  state: string | null;
  is_me: boolean;
};

export type MyLeague = {
  week_start: string;
  week_ends_at: string;
  tier: LeagueTier;
  tier_index: number;
  tiers: LeagueTier[];
  best_tier: LeagueTier;
  last_outcome: 'promoted' | 'stayed' | 'demoted' | null;
  joined: boolean;
  promote_count: number;
  demote_count: number;
  members: LeagueMember[];
};

export const TIER_META: Record<LeagueTier, { label: string; color: string; soft: string }> = {
  bronze: { label: 'Bronze', color: '#B45309', soft: '#FEF3C7' },
  silver: { label: 'Silver', color: '#64748B', soft: '#F1F5F9' },
  gold: { label: 'Gold', color: '#CA8A04', soft: '#FEF9C3' },
  sapphire: { label: 'Sapphire', color: '#2563EB', soft: '#DBEAFE' },
  ruby: { label: 'Ruby', color: '#DC2626', soft: '#FEE2E2' },
  emerald: { label: 'Emerald', color: '#059669', soft: '#D1FAE5' },
  amethyst: { label: 'Amethyst', color: '#7C3AED', soft: '#EDE9FE' },
  pearl: { label: 'Pearl', color: '#DB2777', soft: '#FCE7F3' },
  obsidian: { label: 'Obsidian', color: '#1F2937', soft: '#E5E7EB' },
  diamond: { label: 'Diamond', color: '#0891B2', soft: '#CFFAFE' },
};

export async function fetchMyLeague(): Promise<MyLeague> {
  const { data, error } = await supabase.rpc('get_my_league');
  if (error) throw new Error(error.message);
  return data as MyLeague;
}

/** Zone for a rank: promotion (top N), demotion (bottom N, cohorts > 10 only), or safe. */
export function zoneFor(rank: number, size: number, league: Pick<MyLeague, 'promote_count' | 'demote_count'>): 'promote' | 'demote' | 'safe' {
  if (league.promote_count > 0 && rank <= league.promote_count) return 'promote';
  if (league.demote_count > 0 && size > 10 && rank > size - league.demote_count) return 'demote';
  return 'safe';
}

export function timeLeftLabel(endsAtIso: string, now: Date = new Date()): string {
  const ms = new Date(endsAtIso).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 'Ending now';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  return `${h}h ${Math.floor((ms % 3_600_000) / 60_000)}m left`;
}
