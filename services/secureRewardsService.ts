import { supabase } from '@/utils/supabaseService';

export type SecureRewardResult = {
  success: boolean;
  totalXP?: number;
  xpGained?: number;
  duplicate?: boolean;
  error?: string;
};

export class SecureRewardsService {
  static async adjustBalance(params: {
    amount: number;
    reason: string;
    claimKey: string;
    metadata?: Record<string, any>;
  }): Promise<SecureRewardResult> {
    try {
      const { data, error } = await supabase.functions.invoke('secure-rewards', {
        body: {
          amount: params.amount,
          reason: params.reason,
          claimKey: params.claimKey,
          metadata: params.metadata || {},
        },
      });

      if (error || !data?.success) {
        return { success: false, error: error?.message || data?.error || 'Reward failed' };
      }

      return {
        success: true,
        totalXP: Number(data.reward?.total_xp || 0),
        xpGained: Number(data.reward?.amount || params.amount),
        duplicate: Boolean(data.reward?.duplicate),
      };
    } catch (error: any) {
      return { success: false, error: error?.message || 'Reward failed' };
    }
  }

  static claimKey(parts: Array<string | number | null | undefined>) {
    return parts
      .map((part) => String(part ?? 'none').replace(/[^a-zA-Z0-9:_-]/g, '-'))
      .join(':')
      .slice(0, 160);
  }
}
