// MindClash Game Service
// Handles all multiplayer game logic, matchmaking, scoring, and rewards

import { supabase } from '@/utils/supabaseService';
import { RewardService, TIER_LIMITS, SubscriptionTier } from './rewardService';
import { SecureRewardsService } from './secureRewardsService';

interface Player {
  userId: string;
  userName: string;
  userState: string | null;
  userLevel: number;
  userAvatar: string;
  score?: number;
}

interface Question {
  id: string;
  question: string;
  options: string[];
  correctAnswer: number;
}

interface GameSession {
  id: string;
  vaultId: string;
  status: string;
  questionIds: string[];
  participants: Player[];
}

interface AnswerSubmission {
  questionId: string;
  selectedAnswer: number;
  timeTaken: number; // in seconds
}

interface GameResult {
  rank: number;
  score: number;
  mgEarned: number;
  xpEarned: number;
  insight: string;
}

interface LeaderboardEntry {
  rank: number;
  userId: string;
  userName: string;
  userState: string | null;
  totalScore: number;
  totalWins: number;
  winRate: number;
  userAvatar: string;
}

interface StateLeaderboardEntry {
  rank: number;
  name: string;
  code: string;
  xp: number;
  badge: string;
}

const DEFAULT_STATES: StateLeaderboardEntry[] = [
  { rank: 1, name: 'Maharashtra', code: 'MH', xp: 0, badge: '🌆' },
  { rank: 2, name: 'Karnataka', code: 'KA', xp: 0, badge: '💻' },
  { rank: 3, name: 'Tamil Nadu', code: 'TN', xp: 0, badge: '🏺' },
  { rank: 4, name: 'Gujarat', code: 'GJ', xp: 0, badge: '🧵' },
  { rank: 5, name: 'Delhi', code: 'DL', xp: 0, badge: '🏛️' },
  { rank: 6, name: 'West Bengal', code: 'WB', xp: 0, badge: '🐅' },
  { rank: 7, name: 'Rajasthan', code: 'RJ', xp: 0, badge: '🏜️' },
  { rank: 8, name: 'Uttar Pradesh', code: 'UP', xp: 0, badge: '🕌' },
  { rank: 9, name: 'Andhra Pradesh', code: 'AP', xp: 0, badge: '💎' },
  { rank: 10, name: 'Telangana', code: 'TS', xp: 0, badge: '🏗️' },
  { rank: 11, name: 'Madhya Pradesh', code: 'MP', xp: 0, badge: '🏰' },
  { rank: 12, name: 'Kerala', code: 'KL', xp: 0, badge: '🌴' },
  { rank: 13, name: 'Punjab', code: 'PB', xp: 0, badge: '🌾' },
  { rank: 14, name: 'Haryana', code: 'HR', xp: 0, badge: '🐄' },
  { rank: 15, name: 'Bihar', code: 'BR', xp: 0, badge: '☸️' },
  { rank: 16, name: 'Odisha', code: 'OR', xp: 0, badge: '🌊' },
];

export const VAULT_CONFIG: Record<string, { entryFee: number; reward: number; isPremium?: boolean }> = {
  'polity': { entryFee: 100, reward: 500 },
  'science': { entryFee: 100, reward: 350 },
  'history': { entryFee: 100, reward: 450 },
  'geography': { entryFee: 150, reward: 300 },
  'economy': { entryFee: 250, reward: 1200 },
  'current-affairs': { entryFee: 400, reward: 2500 },
  'general': { entryFee: 500, reward: 5000, isPremium: true },
};

export const VAULT_RANKING_MULTIPLIERS: Record<string, number> = {
  'polity': 1.2,
  'science': 1.0,
  'economy': 1.5,
  'history': 1.1,
  'geography': 0.9,
  'current-affairs': 1.8,
  'general': 2.5,
};

const FOUNDER_PRO_PHONES = new Set(['8220949220', '918220949220']);
const normalizePhoneDigits = (value?: string | null) => String(value || '').replace(/\D/g, '');
const isFounderProPhone = (value?: string | null) => FOUNDER_PRO_PHONES.has(normalizePhoneDigits(value));

class MindClashGameServiceClass {

  // ============================================================================
  // MATCHMAKING
  // ============================================================================

  async findMatch(vaultId: string, userId: string): Promise<{ sessionId: string | null; error?: string }> {
    try {
      const config = VAULT_CONFIG[vaultId] || VAULT_CONFIG['polity'];
      
      const { data: currentStats } = await supabase
        .from('user_profiles')
        .select('total_xp, subscription_tier, phone_number, clash_plays_today, daily_usage_date, unlocked_vaults')

        .eq('id', userId)
        .single();
      
      const currentMg = currentStats?.total_xp || 0;
      const today = new Date().toISOString().split('T')[0];
      const isFounderPro = isFounderProPhone(currentStats?.phone_number);
      const tier: SubscriptionTier = currentStats?.subscription_tier === 'pro' || isFounderPro ? 'pro' : 'free';
      const clashLimit = isFounderPro ? 999999 : (TIER_LIMITS[tier]?.heistPlays || 3);

      const unlockedVaults = currentStats?.unlocked_vaults || [];

      if ((currentStats?.clash_plays_today || 0) >= clashLimit && currentStats?.daily_usage_date === today) {
        return { sessionId: null, error: `Daily limit reached (${clashLimit} plays). Upgrade for more!` };
      }

      if (config.isPremium && !unlockedVaults.includes(vaultId)) {
        return { sessionId: null, error: 'Vault Locked. Unlock the General Vault to enter!' };
      }

      if (currentMg < config.entryFee) {
        return { sessionId: null, error: `Insufficient MG. Entry requires ${config.entryFee} MG.` };
      }

      const entryFeeResult = await SecureRewardsService.adjustBalance({
        amount: -config.entryFee,
        reason: 'clash_entry',
        claimKey: SecureRewardsService.claimKey(['clash-entry', vaultId, userId, Date.now()]),
        metadata: { vaultId },
      });
      if (!entryFeeResult.success) {
        return { sessionId: null, error: entryFeeResult.error || 'Could not charge entry fee.' };
      }
      await supabase
        .from('user_profiles')
        .update({
           clash_plays_today: currentStats?.daily_usage_date === today ? ((currentStats?.clash_plays_today || 0) + 1) : 1,
           daily_usage_date: today
        })
        .eq('id', userId);
      
      await RewardService.recordTransaction(userId, -config.entryFee, 'mg', 'clash_entry', { vaultId });


      const { data: profile } = await supabase
        .from('user_profiles')
        .select('full_name, state, level, email')
        .eq('id', userId)
        .single();

      const userName = profile?.full_name || profile?.email || 'Player';
      const userState = profile?.state || null;
      const userLevel = profile?.level || 1;

      const { data: existingSessions } = await supabase
        .from('game_sessions')
        .select('id, current_players, max_players')
        .eq('vault_id', vaultId)
        .eq('status', 'matchmaking')
        .lt('current_players', 'max_players')
        .order('created_at', { ascending: true })
        .limit(1);

      let sessionId: string;

      if (existingSessions && existingSessions.length > 0 && existingSessions[0]) {
        sessionId = existingSessions[0].id;
        const currentPlayers = existingSessions[0].current_players || 0;
        await supabase
          .from('game_sessions')
          .update({ 
            current_players: currentPlayers + 1 
          })
          .eq('id', sessionId);


      } else {
        const { data: newSession, error: sessionError } = await supabase
          .from('game_sessions')
          .insert({
            vault_id: vaultId,
            status: 'matchmaking',
            max_players: 4,
            current_players: 1,
          })
          .select()
          .single();

        if (sessionError || !newSession) return { sessionId: null, error: 'Failed to create session' };
        sessionId = newSession.id;
      }

      await supabase
        .from('game_participants')
        .insert({
          game_session_id: sessionId,
          user_id: userId,
          user_name: userName,
          user_state: userState,
          user_level: userLevel,
          user_avatar: this.getRandomAvatar(),
          score: 0
        });

      const { data: participants } = await supabase
        .from('game_participants')
        .select('user_id')
        .eq('game_session_id', sessionId);

      if (participants && participants.length >= 2) {
        await this.startGameSession(sessionId, vaultId);
      }


      return { sessionId };
    } catch (error) {
      console.error('Error in findMatch:', error);
      return { sessionId: null, error: 'Matchmaking system failure' };
    }
  }

  async unlockVault(vaultId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (vaultId !== 'general') return { success: false, error: 'This vault cannot be purchased' };
      const UNLOCK_COST = 10000;
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('total_xp, unlocked_vaults')
        .eq('id', userId)
        .single();

      if (!profile) return { success: false, error: 'Profile not found' };
      if (profile.unlocked_vaults?.includes(vaultId)) return { success: true };
      if ((profile.total_xp || 0) < UNLOCK_COST) return { success: false, error: `Insufficient MG. Need ${UNLOCK_COST} MG to unlock.` };

      const unlockCharge = await SecureRewardsService.adjustBalance({
        amount: -UNLOCK_COST,
        reason: 'vault_unlock',
        claimKey: SecureRewardsService.claimKey(['vault-unlock', vaultId, userId]),
        metadata: { vaultId },
      });
      if (!unlockCharge.success) throw new Error(unlockCharge.error || 'Vault charge failed');
      const { error } = await supabase
        .from('user_profiles')
        .update({ unlocked_vaults: [...(profile.unlocked_vaults || []), vaultId] })
        .eq('id', userId);

      if (error) throw error;
      await RewardService.recordTransaction(userId, -UNLOCK_COST, 'mg', 'vault_unlock', { vaultId });
      return { success: true };
    } catch (e) {
      return { success: false, error: 'Database error during unlock' };
    }
  }

  async startGameSession(sessionId: string, vaultId: string): Promise<void> {
    try {
      const { data: questions } = await supabase.rpc('get_vault_questions', { p_vault_id: vaultId, p_count: 15 });
      const questionIds = (questions || []).map((q: any) => q.id);
      await supabase
        .from('game_sessions')
        .update({ status: 'ready', question_ids: questionIds, started_at: new Date().toISOString() })
        .eq('id', sessionId);
      
      const { data: participants } = await supabase.from('game_participants').select('user_id').eq('game_session_id', sessionId);
      if (participants) {
        for (const p of participants) {
          await this.initializePowerUps(p.user_id);
        }
      }
    } catch (error) { console.error(error); }
  }

  async getSessionQuestions(sessionId: string): Promise<any[]> {
    try {
      const { data: session } = await supabase.from('game_sessions').select('question_ids').eq('id', sessionId).single();
      if (!session || !session.question_ids) return [];
      const { data: questions } = await supabase.from('vault_questions').select('id, question, options, insight').in('id', session.question_ids);
      if (!questions) return [];
      return session.question_ids.map((id: string) => {
        const q = questions.find((q: any) => q.id === id);
        return q ? { id: q.id, question: q.question, options: q.options, correctAnswer: -999, insight: q.insight } : null;
      }).filter(Boolean);
    } catch (error) { return []; }
  }

  private async initializePowerUps(userId: string): Promise<void> {
    const powerUps = [
      { power_up_id: 'fifty_fifty', quantity: 2 },
      { power_up_id: 'time_freeze', quantity: 1 },
      { power_up_id: 'show_insight', quantity: 1 },
      { power_up_id: 'second_chance', quantity: 0 },
    ];
    for (const pu of powerUps) {
      await supabase.from('power_ups_inventory').upsert({ user_id: userId, power_up_id: pu.power_up_id, quantity: pu.quantity }, { onConflict: 'user_id,power_up_id', ignoreDuplicates: true });
    }
  }

  async getGameSession(sessionId: string): Promise<GameSession | null> {
    try {
      const { data: session } = await supabase
        .from('game_sessions')
        .select(`id, vault_id, status, question_ids, game_participants (user_id, user_name, user_state, user_level, user_avatar, score)`)
        .eq('id', sessionId)
        .single();
      if (!session) return null;
      return {
        id: session.id,
        vaultId: session.vault_id,
        status: session.status,
        questionIds: session.question_ids || [],
        participants: session.game_participants.map((p: any) => ({
          userId: p.user_id,
          userName: p.user_name,
          userState: p.user_state,
          userLevel: p.user_level,
          userAvatar: p.user_avatar,
          score: p.score || 0
        })),
      };
    } catch (error) { return null; }
  }

  subscribeToParticipants(sessionId: string, onUpdate: (participants: any[]) => void) {
    return supabase
      .channel(`session_scores_${sessionId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'game_participants', filter: `game_session_id=eq.${sessionId}` }, async () => {
        const { data } = await supabase.from('game_participants').select('user_id, user_name, user_avatar, score').eq('game_session_id', sessionId).order('score', { ascending: false });
        if (data) onUpdate(data);
      })
      .subscribe();
  }

  async submitAnswer(sessionId: string, questionId: string, selectedIndex: number, timeTaken: number = 0): Promise<{ score: number; isCorrect: boolean } | null> {
    try {
      const { data, error } = await supabase.functions.invoke('heist-submit-answer', {
        body: { sessionId, questionId, selectedIndex, timeTaken },
      });
      if (error || !data?.success) return null;
      return { score: Number(data.score) || 0, isCorrect: Boolean(data.answer?.is_correct) };
    } catch (error) {
      return null;
    }
  }

  async updateParticipantScore(sessionId: string, userId: string, score: number): Promise<void> {
    return;
  }

  async getPowerUps(userId: string): Promise<Record<string, number>> {
    try {
      const { data } = await supabase.from('power_ups_inventory').select('power_up_id, quantity').eq('user_id', userId);
      return (data || []).reduce((acc: any, pu: any) => { acc[pu.power_up_id] = pu.quantity; return acc; }, {});
    } catch (error) { return {}; }
  }

  async usePowerUp(userId: string, powerUpId: string): Promise<boolean> {
    try {
      const { data } = await supabase.from('power_ups_inventory').select('quantity').eq('user_id', userId).eq('power_up_id', powerUpId).single();
      if (!data || data.quantity <= 0) return false;
      await supabase.from('power_ups_inventory').update({ quantity: data.quantity - 1, total_used: 1, last_used_at: new Date().toISOString() }).eq('user_id', userId).eq('power_up_id', powerUpId);
      return true;
    } catch (error) { return false; }
  }

  async completeGameSession(sessionId: string, userId: string): Promise<GameResult | null> {
    try {
      const { data, error } = await supabase.functions.invoke('heist-complete-session', {
        body: { sessionId },
      });
      if (!error && data?.success && data.result) return data.result as GameResult;
      return null;
    } catch (error) { return null; }
  }

  private async processWinnerRewards(sessionId: string) {
    try {
      const { data: winners } = await supabase.from('game_participants').select('user_id, score, final_rank').eq('game_session_id', sessionId).lte('final_rank', 3).order('final_rank', { ascending: true });
      if (!winners) return;
      for (const winner of winners) {
        const { data: profile } = await supabase.from('user_profiles').select('bags_address').eq('id', winner.user_id).single();
        if (profile?.bags_address) {
          await supabase.functions.invoke('miga_bags_rewards', { body: { action: 'gift', userId: winner.user_id, address: profile.bags_address, amount: winner.score / 10 } });
        }
      }
    } catch (e) { console.error('Rewards error:', e); }
  }

  async saveBagsAddress(userId: string, address: string | null): Promise<void> {
    await supabase.from('user_profiles').update({ bags_address: address }).eq('id', userId);
  }

  async purchaseItem(userId: string, item: any): Promise<{ success: boolean; message: string }> {
    try {
      const { data: profile } = await supabase.from('user_profiles').select('total_xp').eq('id', userId).single();
      if (!profile || (profile.total_xp || 0) < item.price) return { success: false, message: 'Insufficient XP' };
      const purchaseCharge = await SecureRewardsService.adjustBalance({
        amount: -item.price,
        reason: 'store_purchase',
        claimKey: SecureRewardsService.claimKey(['store-purchase', userId, item.id, Date.now()]),
        metadata: { itemId: item.id },
      });
      if (!purchaseCharge.success) return { success: false, message: purchaseCharge.error || 'Purchase failed' };
      const { data: inv } = await supabase.from('power_ups_inventory').select('quantity').eq('user_id', userId).eq('power_up_id', item.id).single();
      await supabase.from('power_ups_inventory').upsert({ user_id: userId, power_up_id: item.id, quantity: (inv?.quantity || 0) + (item.quantity || 1) }, { onConflict: 'user_id,power_up_id' });
      await RewardService.recordTransaction(userId, -item.price, 'mg', 'store_purchase', { item: item.id });
      return { success: true, message: 'Purchase successful!' };
    } catch (e) { return { success: false, message: 'Purchase failed' }; }
  }

  private getRandomAvatar() {
    const avatars = ['👤', '🕵️', '🥷', '💂', '🦸'];
    return avatars[Math.floor(Math.random() * avatars.length)];
  }

  async checkAndGrantDailyBoosters(userId: string): Promise<{ granted: boolean }> {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabase.from('user_profiles').select('last_booster_claim').eq('id', userId).single();
    if (data?.last_booster_claim === today) return { granted: false };
    const boosters = [{ id: 'fifty_fifty', q: 2 }, { id: 'time_freeze', q: 1 }, { id: 'show_insight', q: 1 }];
    for (const b of boosters) {
      const { data: inv } = await supabase.from('power_ups_inventory').select('quantity').eq('user_id', userId).eq('power_up_id', b.id).single();
      await supabase.from('power_ups_inventory').upsert({ user_id: userId, power_up_id: b.id, quantity: (inv?.quantity || 0) + b.q }, { onConflict: 'user_id,power_up_id' });
    }
    await supabase.from('user_profiles').update({ last_booster_claim: today }).eq('id', userId);
    return { granted: true };
  }
  async getStateLeaderboard(): Promise<StateLeaderboardEntry[]> {
    try {
      const { data, error } = await supabase.from('state_leaderboard').select('*').order('xp', { ascending: false });
      if (error || !data || data.length === 0) return DEFAULT_STATES;
      return data.map((s: any, i: number) => ({
        rank: i + 1,
        name: s.name,
        code: s.code,
        xp: s.xp || 0,
        badge: s.badge || '⭐'
      }));
    } catch (e) {
      return DEFAULT_STATES;
    }
  }
}

export const MindClashGameService = new MindClashGameServiceClass();
export const KnowledgeHeistGameService = MindClashGameService;
