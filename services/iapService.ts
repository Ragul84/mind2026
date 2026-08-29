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
}

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
  'mindgains_pro_monthly': {
    id: 'mindgains_pro_monthly',
    title: 'MindGains PRO Monthly',
    description: 'Higher daily limits for MIGA, Study Lab, podcasts, blueprints, and quiz rooms.',
    priceText: '₹349/month',
    priceAmount: 349,
    type: 'subscription',
  },
  'mindgains_pro_annual': {
    id: 'mindgains_pro_annual',
    title: 'MindGains PRO Annual',
    description: 'Best value for students who use MindGains every week.',
    priceText: '₹999/year',
    priceAmount: 999,
    type: 'subscription',
  },
};

const REVENUECAT_ANDROID_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY;
const PRO_ENTITLEMENT_ID = 'pro';

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

  private static hasActivePro(customerInfo: any): boolean {
    return Boolean(customerInfo?.entitlements?.active?.[PRO_ENTITLEMENT_ID]);
  }

  private static async syncRevenueCatEntitlement(): Promise<{ success: boolean; tier?: string; error?: string }> {
    const { data, error } = await supabase.functions.invoke('revenuecat-sync', {
      body: { entitlementId: PRO_ENTITLEMENT_ID },
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
      const purchase = await Purchases.purchaseProduct(productId, null, PURCHASE_TYPE.SUBS);
      if (!IAPService.hasActivePro(purchase.customerInfo)) {
        throw new Error('Purchase completed, but Pro entitlement is not active yet.');
      }

      const sync = await IAPService.syncRevenueCatEntitlement();
      if (!sync.success || sync.tier !== 'pro') {
        throw new Error(sync.error || 'Could not verify Pro entitlement.');
      }

      HapticService.success();
      console.log(`[IAP] User ${user.id} upgraded to PRO`);
      return { success: true };

    } catch (e: any) {
      console.error('[IAP] Subscription error:', e);
      HapticService.error();
      return { success: false, error: e.message || 'Subscription payment failed.' };
    }
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
