// MindGains store purchases.
// Subscriptions use RevenueCat, which uses Google Play Billing underneath on Android.
// Supabase only grants Pro after server-side RevenueCat entitlement verification.

import { Platform } from 'react-native';
import { supabase } from '@/utils/supabaseService';
import { SupabaseService } from '@/utils/supabaseService';
import HapticService from '@/utils/hapticService';

export interface IAPProduct {
  id: string;
  title: string;
  description: string;
  priceText: string;
  priceAmount: number;
  type: 'consumable' | 'subscription';
  coinsAwarded?: number;
  /** Entitlement this product unlocks in RevenueCat. */
  tier?: 'plus' | 'pro';
  period?: 'week' | 'month' | 'year';
  /** Old price point, kept only for restore. Hidden on the paywall. */
  legacy?: boolean;
}

/** Products shown on the paywall, in display order. */
export const PAYWALL_PLANS = {
  plus: { monthly: 'mindgains_plus_monthly', annual: 'mindgains_plus_annual' },
  pro: { monthly: 'mindgains_pro_monthly_2026', annual: 'mindgains_pro_annual_2026' },
  examWeek: 'mindgains_exam_week',
} as const;

export const IAP_PRODUCTS: Record<string, IAPProduct> = {
  'mindgains_coins_100': {
    id: 'mindgains_coins_100',
    title: '100 Study Coins',
    description: 'Perfect for scanning a few textbook chapters or hosting study battles.',
    priceText: '₹49',
    priceAmount: 49,
    type: 'consumable',
    coinsAwarded: 100,
  },
  'mindgains_coins_500': {
    id: 'mindgains_coins_500',
    title: '500 Study Coins',
    description: 'Bulk coins for extensive AI research, blueprints, and custom lobbies.',
    priceText: '₹199',
    priceAmount: 199,
    type: 'consumable',
    coinsAwarded: 500,
  },
  // ── Legacy plans (₹349/mo, ₹999/yr). Kept so existing subscribers can still
  //    restore; no longer shown on the paywall.
  'mindgains_pro_monthly': {
    id: 'mindgains_pro_monthly',
    title: 'MindGains PRO Monthly (legacy)',
    description: 'Higher daily limits for MIGA, Study Lab, podcasts, blueprints, and quiz rooms.',
    priceText: '₹349/month',
    priceAmount: 349,
    type: 'subscription',
    tier: 'pro',
    legacy: true,
  },
  'mindgains_pro_annual': {
    id: 'mindgains_pro_annual',
    title: 'MindGains PRO Annual (legacy)',
    description: 'Best value for students who use MindGains every week.',
    priceText: '₹999/year',
    priceAmount: 999,
    type: 'subscription',
    tier: 'pro',
    legacy: true,
  },
  // ── Oct 2026 pricing. ⚠️ NEW STORE PRODUCTS: these IDs must be created in
  //    Google Play Console (subscriptions + base plans) and attached in the
  //    RevenueCat dashboard to entitlements 'plus' / 'pro' before release.
  //    See docs/pricing-2026.md.
  'mindgains_plus_monthly': {
    id: 'mindgains_plus_monthly',
    title: 'MindGains Plus Monthly',
    description: 'Unlimited practice, all mocks, rank predictor and more MIGA every day.',
    priceText: '₹79/month',
    priceAmount: 79,
    type: 'subscription',
    tier: 'plus',
    period: 'month',
  },
  'mindgains_plus_annual': {
    id: 'mindgains_plus_annual',
    title: 'MindGains Plus Annual',
    description: 'Plus for a full year of preparation.',
    priceText: '₹499/year',
    priceAmount: 499,
    type: 'subscription',
    tier: 'plus',
    period: 'year',
  },
  'mindgains_pro_monthly_2026': {
    id: 'mindgains_pro_monthly_2026',
    title: 'MindGains Pro Monthly',
    description: 'Everything in Plus, MIGA voice tutor, AI answer evaluation and textbook mode at Pro limits.',
    priceText: '₹199/month',
    priceAmount: 199,
    type: 'subscription',
    tier: 'pro',
    period: 'month',
  },
  'mindgains_pro_annual_2026': {
    id: 'mindgains_pro_annual_2026',
    title: 'MindGains Pro Annual',
    description: 'Pro for a full year of preparation.',
    priceText: '₹1,299/year',
    priceAmount: 1299,
    type: 'subscription',
    tier: 'pro',
    period: 'year',
  },
  'mindgains_exam_week': {
    id: 'mindgains_exam_week',
    title: 'Exam-Week Pass',
    description: '7 days of Pro right before your exam. Does not auto-renew.',
    priceText: '₹19/week',
    priceAmount: 19,
    // Google Play prepaid base plan (1 week, no auto-renew) -> entitlement 'pro'.
    type: 'subscription',
    tier: 'pro',
    period: 'week',
  },
};

const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
const PRO_ENTITLEMENT_ID = 'pro';
const PLUS_ENTITLEMENT_ID = 'plus';

const getRevenueCat = () => {
  if (Platform.OS !== 'android') {
    throw new Error('Subscriptions are currently enabled for Android Play Billing only.');
  }
  return require('react-native-purchases');
};

export class IAPService {
  private static configuredUserId: string | null = null;

  private static async configureRevenueCat(userId: string): Promise<void> {
    if (Platform.OS !== 'android') {
      throw new Error('Subscriptions are currently enabled for Android Play Billing only.');
    }

    if (!REVENUECAT_ANDROID_API_KEY) {
      throw new Error('RevenueCat Android API key is missing.');
    }

    if (IAPService.configuredUserId === userId) return;

    const { default: Purchases, LOG_LEVEL } = getRevenueCat();
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.WARN);
    Purchases.configure({
      apiKey: REVENUECAT_ANDROID_API_KEY,
      appUserID: userId,
    });
    IAPService.configuredUserId = userId;
  }

  private static hasActiveEntitlement(customerInfo: any, entitlementId: string): boolean {
    const active = customerInfo?.entitlements?.active ?? {};
    // Pro includes everything in Plus.
    if (entitlementId === PLUS_ENTITLEMENT_ID) return Boolean(active[PLUS_ENTITLEMENT_ID] || active[PRO_ENTITLEMENT_ID]);
    return Boolean(active[entitlementId]);
  }

  private static async syncRevenueCatEntitlement(entitlementId: string = PRO_ENTITLEMENT_ID): Promise<{ success: boolean; tier?: string; error?: string }> {
    const { data, error } = await supabase.functions.invoke('revenuecat-sync', {
      body: { entitlementId },
    });

    if (error || !data?.success) {
      return { success: false, error: data?.error || error?.message || 'Subscription sync failed.' };
    }

    return { success: true, tier: data.tier || 'free' };
  }
  
  // ── Purchase Consumable Coin Pack ──────────────────────────────────────────
  static async purchaseCoinPack(productId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const product = IAP_PRODUCTS[productId];
      if (!product || product.type !== 'consumable') {
        return { success: false, error: 'Invalid product selection' };
      }

      const user = await SupabaseService.getCurrentUser();
      if (!user) return { success: false, error: 'Please log in to make a purchase' };

      HapticService.selection();
      throw new Error('Coin packs are disabled until consumable purchase verification is enabled.');

    } catch (e: any) {
      console.error('[IAP] Purchase error:', e);
      HapticService.error();
      return { success: false, error: e.message || 'Payment processing failed. Try again.' };
    }
  }

  // ── Purchase Premium Subscription (PRO Pass) ──────────────────────────────
  static async subscribeToPro(productId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const product = IAP_PRODUCTS[productId];
      if (!product || product.type !== 'subscription') {
        return { success: false, error: 'Invalid subscription selection' };
      }

      const user = await SupabaseService.getCurrentUser();
      if (!user) return { success: false, error: 'Please log in to subscribe' };

      HapticService.selection();
      await IAPService.configureRevenueCat(user.id);

      const { default: Purchases, PURCHASE_TYPE } = getRevenueCat();
      const entitlementId = product.tier === 'plus' ? PLUS_ENTITLEMENT_ID : PRO_ENTITLEMENT_ID;
      const purchase = await Purchases.purchaseProduct(productId, null, PURCHASE_TYPE.SUBS);
      if (!IAPService.hasActiveEntitlement(purchase.customerInfo, entitlementId)) {
        throw new Error(`Purchase completed, but the ${entitlementId} entitlement is not active yet.`);
      }

      const sync = await IAPService.syncRevenueCatEntitlement(entitlementId);
      if (!sync.success || (sync.tier !== 'pro' && sync.tier !== entitlementId)) {
        throw new Error(sync.error || 'Could not verify your subscription.');
      }

      HapticService.success();
      return { success: true };

    } catch (e: any) {
      console.error('[IAP] Subscription error:', e);
      HapticService.error();
      return { success: false, error: e.message || 'Subscription payment failed.' };
    }
  }

  /** Subscribe to any paywall plan (Plus, Pro or the exam-week pass). */
  static async subscribe(productId: string): Promise<{ success: boolean; error?: string }> {
    return IAPService.subscribeToPro(productId);
  }

  // ── Restore Past Purchases ──────────────────────────────────────────────────
  static async restorePurchases(): Promise<{ success: boolean; tier?: string; error?: string }> {
    try {
      const user = await SupabaseService.getCurrentUser();
      if (!user) return { success: false, error: 'Please log in' };

      console.log(`[IAP] Restoring purchases for: ${user.id}`);

      await IAPService.configureRevenueCat(user.id);
      const { default: Purchases } = getRevenueCat();
      await Purchases.restorePurchases();

      const sync = await IAPService.syncRevenueCatEntitlement();
      if (!sync.success) throw new Error(sync.error || 'No active purchases found to restore.');

      HapticService.success();
      return { 
        success: true, 
        tier: sync.tier || 'free',
      };

    } catch (e: any) {
      console.error('[IAP] Restore error:', e);
      return { success: false, error: 'No active purchases found to restore.' };
    }
  }
}
