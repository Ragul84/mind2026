// MindGains PRO subscription screen
// Rebuilt to actually follow DESIGN.md: one accent color (teal), milky-white
// surfaces, no decorative-only motion, one primary action. The previous
// version had invented its own palette per section (gold/orange for annual,
// purple/pink gradient meters, floating sparkles, a "holographic stage") —
// exactly the kind of per-screen reinvention DESIGN.md exists to prevent.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AIUsageService, type AIFeatureUsage } from '@/services/aiUsageService';
import { IAP_PRODUCTS, IAPService, PAYWALL_PLANS } from '@/services/iapService';
import { RewardService, type SubscriptionTier } from '@/services/rewardService';
import HapticService from '@/utils/hapticService';
import { V2026 } from '@/theme/v2026-tokens';
import { showBrandAlert } from '@/components/ui/BrandAlert';
import { MotiView } from 'moti';

const subscriptionHeroImage = require('@/assets/images/subscription_hero.png');

const BENEFITS = [
  { icon: 'chatbubbles' as const, title: 'MIGA tutor capacity', text: 'More room for doubts, voice practice, math help, and regional-language tutoring.' },
  { icon: 'library' as const, title: 'Study Lab generation', text: 'Turn your sources into notes, flashcards, quizzes, and revision material.' },
  { icon: 'mic' as const, title: 'Podcast credits', text: 'Create short audio revision sessions from chapters and study material.' },
  { icon: 'map' as const, title: 'Lesson blueprints', text: 'Build structured paths for topics that need more than a quick explanation.' },
];

// Oct 2026 pricing. Every id below needs a matching Play Console product and a
// RevenueCat entitlement mapping before release (see docs/pricing-2026.md).
type PlanTier = 'plus' | 'pro';
type PlanId =
  | typeof PAYWALL_PLANS.plus.monthly | typeof PAYWALL_PLANS.plus.annual
  | typeof PAYWALL_PLANS.pro.monthly | typeof PAYWALL_PLANS.pro.annual
  | typeof PAYWALL_PLANS.examWeek;

const TIER_FEATURES: Record<'free' | PlanTier, string[]> = {
  free: ['Daily exam path and streaks', 'Unlimited verified PYQs', '1 mock test a week', '10 MIGA chats a day', 'Textbook mode with page citations'],
  plus: ['Everything in Free', 'All mocks and test series', '60 MIGA chats a day', '20 Study Lab generations a day', 'Rank predictor and PYQ trends'],
  pro: ['Everything in Plus', 'MIGA voice tutor (200 calls/day)', 'AI mains answer evaluation', '50 Study Lab generations + podcasts', 'Highest limits on every AI tool'],
};

export default function SubscriptionScreen() {
  const [tier, setTier] = useState<SubscriptionTier>('free');
  const [usage, setUsage] = useState<AIFeatureUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyProduct, setBusyProduct] = useState<string | null>(null);
  const [selectedTier, setSelectedTier] = useState<PlanTier>('pro');
  const [selectedPlan, setSelectedPlan] = useState<PlanId>(PAYWALL_PLANS.pro.annual);
  const pickTier = (t: PlanTier) => {
    HapticService.selection();
    setSelectedTier(t);
    setSelectedPlan(selectedPlan.includes('monthly') ? PAYWALL_PLANS[t].monthly : PAYWALL_PLANS[t].annual);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const stats = await RewardService.getUserStats();
      const currentTier = stats?.subscription_tier || 'free';
      setTier(currentTier);
      const rows = await AIUsageService.getBatchUsage(currentTier);
      setUsage(rows);
    } catch {
      showBrandAlert({ title: 'Plan unavailable', message: 'Could not load your current plan. Please try again.', icon: 'alert-circle-outline' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => {
    const used = usage.reduce((sum, item) => sum + item.used, 0);
    const limit = usage.reduce((sum, item) => sum + item.limit, 0);
    const remaining = usage.reduce((sum, item) => sum + item.remaining, 0);
    return { used, limit, remaining, pct: limit ? Math.min(100, (used / limit) * 100) : 0 };
  }, [usage]);

  const handleSubscribe = async (productId: string) => {
    if (Platform.OS === 'web') {
      showBrandAlert({ title: 'Use the app to subscribe', message: 'Subscriptions are handled through Google Play Billing in the Android app.', icon: 'phone-portrait-outline' });
      return;
    }
    setBusyProduct(productId);
    HapticService.selection();
    try {
      const result = await IAPService.subscribe(productId);
      if (!result.success) {
        showBrandAlert({ title: 'Subscription failed', message: result.error || 'Please try again.', icon: 'alert-circle-outline' });
        return;
      }
      HapticService.success();
      showBrandAlert({
        title: IAP_PRODUCTS[productId]?.tier === 'plus' ? "You're on Plus" : "You're on Pro",
        message: 'Your higher daily limits are active now.',
        icon: 'checkmark-circle-outline',
        buttons: [{ text: 'Continue', onPress: () => router.back() }],
      });
      await load();
    } catch (e: any) {
      showBrandAlert({ title: 'Subscription error', message: e.message || 'Verification failed.', icon: 'alert-circle-outline' });
    } finally {
      setBusyProduct(null);
    }
  };

  const restore = async () => {
    if (Platform.OS === 'web') { await load(); return; }
    setBusyProduct('restore');
    HapticService.selection();
    try {
      const result = await IAPService.restorePurchases();
      if (!result.success) {
        showBrandAlert({ title: 'Nothing to restore', message: result.error || 'No active subscription was found.', icon: 'refresh-outline' });
        return;
      }
      await load();
      showBrandAlert({ title: 'Plan restored', message: 'Your subscription status has been refreshed.', icon: 'checkmark-circle-outline' });
    } finally {
      setBusyProduct(null);
    }
  };

  const isActivePlan = tier === 'pro' || (tier === 'plus' && selectedTier === 'plus' && selectedPlan !== PAYWALL_PLANS.examWeek);

  const renderPlanCard = (productId: PlanId) => {
    const product = IAP_PRODUCTS[productId];
    const isAnnual = product.period === 'year';
    const isWeek = product.period === 'week';
    const isSelected = selectedPlan === productId;
    const monthly = isAnnual ? `₹${Math.round(product.priceAmount / 12)}` : `₹${product.priceAmount}`;
    const monthlyCounterpart = isAnnual ? IAP_PRODUCTS[PAYWALL_PLANS[product.tier || 'pro'].monthly] : null;
    const savePct = monthlyCounterpart
      ? Math.round((1 - product.priceAmount / (monthlyCounterpart.priceAmount * 12)) * 100)
      : 0;
    const billingText = isWeek ? 'One-time ₹19 · 7 days of Pro' : isAnnual ? `Billed as ${product.priceText}` : `Billed as ${product.priceText}`;

    return (
      <TouchableOpacity
        key={productId}
        style={[styles.planCard, isSelected && styles.planCardSelected]}
        onPress={() => { HapticService.selection(); setSelectedPlan(productId); }}
        activeOpacity={0.9}
        disabled={tier === 'pro'}
      >
        {isAnnual && (
          <View style={styles.bestValueTag}>
            <Text style={styles.bestValueText}>BEST VALUE</Text>
          </View>
        )}
        <View style={styles.planCardHeader}>
          <View style={[styles.radioOuter, isSelected && styles.radioOuterSelected]}>
            {isSelected && <View style={styles.radioInner} />}
          </View>
          <View style={styles.planTitleContainer}>
            <Text style={styles.planTitleText}>{isWeek ? 'Exam-Week Pass' : isAnnual ? 'Annual' : 'Monthly'}</Text>
            <Text style={styles.planSubTitleText}>{isWeek ? 'Pro for your exam week, no auto-renew' : isAnnual ? 'For the whole prep year' : 'Flexible, cancel anytime'}</Text>
          </View>
          <View style={styles.planPriceContainer}>
            <Text style={styles.planPriceBig}>{isWeek ? '₹19' : monthly}</Text>
            <Text style={styles.planPriceSub}>{isWeek ? '/week' : '/month'}</Text>
          </View>
        </View>
        <Text style={styles.planBillingDesc}>
          {billingText}
          {isAnnual && savePct > 0 ? <Text style={styles.highlightText}>{` · Save ${savePct}%`}</Text> : null}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderTierTabs = () => (
    <View style={styles.tierTabs}>
      {(['plus', 'pro'] as PlanTier[]).map((t) => {
        const on = selectedTier === t;
        return (
          <TouchableOpacity key={t} style={[styles.tierTab, on && styles.tierTabOn]} onPress={() => pickTier(t)} activeOpacity={0.9}>
            <Text style={[styles.tierTabTitle, on && styles.tierTabTitleOn]}>{t === 'plus' ? 'Plus' : 'Pro'}</Text>
            <Text style={styles.tierTabPrice}>{t === 'plus' ? 'from ₹42/mo' : 'from ₹108/mo'}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderCompare = () => (
    <View style={styles.compareRow}>
      {(['free', 'plus', 'pro'] as const).map((t) => (
        <View key={t} style={[styles.compareCol, t === selectedTier && styles.compareColOn]}>
          <Text style={styles.compareTitle}>{t === 'free' ? 'Free' : t === 'plus' ? 'Plus' : 'Pro'}</Text>
          <Text style={styles.comparePrice}>{t === 'free' ? '₹0' : t === 'plus' ? '₹79/mo' : '₹199/mo'}</Text>
          {TIER_FEATURES[t].map((f) => (
            <Text key={f} style={styles.compareItem}>• {f}</Text>
          ))}
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()} activeOpacity={0.8}>
            <Ionicons name="close" size={22} color={V2026.colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>MindGains Plans</Text>
          <TouchableOpacity onPress={restore} disabled={!!busyProduct} style={styles.restoreHeaderBtn} activeOpacity={0.7}>
            <Text style={styles.restoreHeaderText}>Restore</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={V2026.colors.primary} />
            <Text style={styles.loaderText}>Checking your plan...</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <View style={styles.heroSection}>
                <View style={styles.heroImageWrap}>
                  <View style={styles.heroGlow} />
                  <MotiView
                    from={{ opacity: 0, scale: 0.9, translateY: 10 }}
                    animate={{ opacity: 1, scale: 1, translateY: 0 }}
                    transition={{ type: 'spring', damping: 14 }}
                    style={styles.heroImageInner}
                  >
                    <Image source={subscriptionHeroImage} style={styles.heroImage} resizeMode="contain" />
                  </MotiView>
                </View>
                <Text style={styles.heroTitle}>Study without limits.</Text>
                <Text style={styles.heroSubText}>
                  Keep your daily AI tools available for deeper lessons, voice tutoring, podcasts, blueprints, and quiz practice.
                </Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Choose your plan</Text>
                {renderTierTabs()}
                <View style={styles.planStack}>
                  {renderPlanCard(PAYWALL_PLANS[selectedTier].annual)}
                  {renderPlanCard(PAYWALL_PLANS[selectedTier].monthly)}
                  {selectedTier === 'pro' && renderPlanCard(PAYWALL_PLANS.examWeek)}
                </View>
                {renderCompare()}
              </View>

              <View style={styles.card}>
                <View style={styles.walletHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.walletKicker}>Daily limits</Text>
                    <Text style={styles.walletTitle}>Available today</Text>
                  </View>
                  <View style={styles.walletBadge}>
                    <Text style={styles.walletBadgeText}>{tier.toUpperCase()}</Text>
                  </View>
                </View>

                <View style={styles.walletBarRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.walletLargeNum}>{totals.remaining}</Text>
                    <Text style={styles.walletSubText}>of {totals.limit} daily actions left</Text>
                  </View>
                  <Text style={[styles.gaugeText, totals.pct > 80 && styles.gaugeTextWarn]}>{Math.round(totals.pct)}% used</Text>
                </View>

                <View style={styles.meterTrack}>
                  <View style={[styles.meterFill, { width: `${totals.pct}%`, backgroundColor: totals.pct > 80 ? V2026.colors.error : V2026.colors.primary }]} />
                </View>
                <Text style={styles.walletHintText}>Daily limits reset automatically at midnight IST.</Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.breakdownHeader}>Usage by tool</Text>
                {usage.map((item) => {
                  const pct = item.limit ? Math.min(100, (item.used / item.limit) * 100) : 100;
                  const depleted = !item.allowed;
                  return (
                    <View key={item.feature} style={styles.breakdownRow}>
                      <View style={styles.breakdownRowTop}>
                        <Text style={styles.breakdownRowLabel}>{item.label}</Text>
                        <Text style={[styles.breakdownRowMeta, depleted && styles.breakdownRowMetaDepleted]}>
                          {item.used} / {item.limit} used
                        </Text>
                      </View>
                      <View style={styles.breakdownProgressTrack}>
                        <View style={[styles.breakdownProgressFill, { width: `${pct}%`, backgroundColor: depleted ? V2026.colors.error : V2026.colors.primary }]} />
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>What PRO helps with</Text>
                <View style={styles.benefitGrid}>
                  {BENEFITS.map((item) => (
                    <View key={item.title} style={styles.benefitCard}>
                      <View style={styles.benefitIconWrapper}>
                        <Ionicons name={item.icon} size={16} color={V2026.colors.primaryDeep} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.benefitTitle}>{item.title}</Text>
                        <Text style={styles.benefitDesc}>{item.text}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              <Text style={styles.legalText}>
                Payments are handled by Google Play Billing in the Android app. Subscription status is verified server-side.
              </Text>
              <View style={styles.footerSpacing} />
            </ScrollView>

            <View style={styles.stickyActionBar}>
              <LinearGradient
                colors={['rgba(248, 250, 252, 0)', 'rgba(248, 250, 252, 0.94)', V2026.colors.background]}
                style={StyleSheet.absoluteFillObject}
                pointerEvents="none"
              />
              <View style={styles.checkoutButtonContainer}>
                <TouchableOpacity
                  style={[styles.primaryCheckoutButton, (busyProduct !== null || isActivePlan) && styles.primaryCheckoutButtonDisabled]}
                  onPress={() => handleSubscribe(selectedPlan)}
                  activeOpacity={0.88}
                  disabled={busyProduct !== null || isActivePlan}
                >
                  <LinearGradient
                    colors={tier === 'pro' ? ['#94A3B8', '#94A3B8'] : ['#00D4C7', '#22B8F0']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.checkoutButtonGradient}
                  >
                    {busyProduct && busyProduct !== 'restore' ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <View style={styles.buttonContent}>
                        {tier === 'pro' && <MaterialCommunityIcons name="crown" size={16} color="#FFFFFF" style={{ marginRight: 6 }} />}
                        <Text style={styles.checkoutButtonText}>
                          {tier === 'pro' ? "You're on Pro" : isActivePlan ? "You're on Plus"
                            : selectedPlan === PAYWALL_PLANS.examWeek ? 'Get Exam-Week Pass · ₹19'
                            : `Continue with ${selectedTier === 'plus' ? 'Plus' : 'Pro'} ${IAP_PRODUCTS[selectedPlan].period === 'year' ? 'Annual' : 'Monthly'} · ${IAP_PRODUCTS[selectedPlan].priceText}`}
                        </Text>
                      </View>
                    )}
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  tierTabs: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  tierTab: { flex: 1, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.08)', backgroundColor: '#FFFFFF', alignItems: 'center' },
  tierTabOn: { borderColor: '#00D4C7', backgroundColor: 'rgba(0, 212, 199, 0.08)' },
  tierTabTitle: { fontSize: 16, fontWeight: '800', color: '#334155' },
  tierTabTitleOn: { color: '#0F766E' },
  tierTabPrice: { fontSize: 12, color: '#64748B', marginTop: 2 },
  compareRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  compareCol: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(15, 23, 42, 0.06)' },
  compareColOn: { borderColor: '#00D4C7' },
  compareTitle: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  comparePrice: { fontSize: 12, fontWeight: '700', color: '#0F766E', marginBottom: 6 },
  compareItem: { fontSize: 11, lineHeight: 16, color: '#475569' },
  root: { flex: 1, backgroundColor: V2026.colors.background },
  safe: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: V2026.radius.sm, backgroundColor: V2026.colors.surface,
    alignItems: 'center', justifyContent: 'center', ...V2026.shadows.milky,
  },
  headerTitle: { fontSize: 17, fontFamily: 'Poppins-Bold', color: V2026.colors.text, letterSpacing: -0.3 },
  restoreHeaderBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  restoreHeaderText: { fontSize: 13, fontFamily: 'Poppins-SemiBold', color: V2026.colors.primaryDeep },

  loader: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loaderText: { fontSize: 13, fontFamily: 'Inter-Medium', color: V2026.colors.textMuted },

  content: {
    paddingHorizontal: 20, paddingTop: 8, paddingBottom: 130, gap: 22,
    maxWidth: 600, width: '100%', alignSelf: 'center',
  },

  heroSection: { alignItems: 'center', width: '100%' },
  heroImageWrap: { width: '100%', height: 200, justifyContent: 'center', alignItems: 'center', marginBottom: 4 },
  heroGlow: {
    position: 'absolute', width: 200, height: 200, borderRadius: 100,
    backgroundColor: 'rgba(0, 212, 199, 0.10)',
  },
  heroImageInner: { width: '100%', height: '100%', justifyContent: 'center', alignItems: 'center' },
  heroImage: { width: '100%', height: '90%' },
  heroTitle: {
    fontSize: 24, fontFamily: 'Poppins-Bold', color: V2026.colors.text,
    textAlign: 'center', letterSpacing: -0.5, marginBottom: 8,
  },
  heroSubText: {
    fontSize: 13.5, fontFamily: 'Inter-Regular', color: V2026.colors.textMuted,
    textAlign: 'center', lineHeight: 19, paddingHorizontal: 8,
  },

  section: { width: '100%' },
  sectionLabel: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: V2026.colors.textMuted, letterSpacing: 0.3, marginBottom: 10 },

  planStack: { width: '100%', gap: 10 },
  planCard: {
    width: '100%', borderRadius: V2026.radius.md, padding: 16,
    backgroundColor: V2026.colors.surface, position: 'relative', overflow: 'hidden',
    ...V2026.shadows.milky,
  },
  planCardSelected: { backgroundColor: 'rgba(0, 212, 199, 0.06)' },
  bestValueTag: {
    position: 'absolute', top: 12, right: 12,
    backgroundColor: 'rgba(0, 212, 199, 0.14)', borderRadius: V2026.radius.sm,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  bestValueText: { fontSize: 9, fontFamily: 'Poppins-Bold', color: V2026.colors.primaryDeep, letterSpacing: 0.4 },
  planCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  radioOuter: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#CBD5E1',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  radioOuterSelected: { borderColor: V2026.colors.primary },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: V2026.colors.primary },
  planTitleContainer: { flex: 1 },
  planTitleText: { fontSize: 15, fontFamily: 'Poppins-SemiBold', color: V2026.colors.text },
  planSubTitleText: { fontSize: 11, fontFamily: 'Inter-Regular', color: V2026.colors.textMuted, marginTop: 1 },
  planPriceContainer: { flexDirection: 'row', alignItems: 'baseline' },
  planPriceBig: { fontSize: 20, fontFamily: 'Poppins-Bold', color: V2026.colors.text },
  planPriceSub: { fontSize: 11, fontFamily: 'Inter-Regular', color: V2026.colors.textMuted },
  planBillingDesc: { fontSize: 12, fontFamily: 'Inter-Regular', color: V2026.colors.textMuted, paddingLeft: 32 },
  highlightText: { color: V2026.colors.text, fontFamily: 'Inter-SemiBold' },

  card: {
    borderRadius: V2026.radius.lg, padding: 18,
    backgroundColor: V2026.colors.surface, ...V2026.shadows.milky,
  },
  walletHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  walletKicker: { fontSize: 11, fontFamily: 'Inter-SemiBold', color: V2026.colors.textMuted, marginBottom: 2 },
  walletTitle: { fontSize: 16, fontFamily: 'Poppins-SemiBold', color: V2026.colors.text },
  walletBadge: { backgroundColor: 'rgba(0, 212, 199, 0.12)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: V2026.radius.sm },
  walletBadgeText: { fontSize: 10, fontFamily: 'Poppins-Bold', color: V2026.colors.primaryDeep },
  walletBarRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 },
  walletLargeNum: { fontSize: 36, fontFamily: 'Poppins-Bold', color: V2026.colors.text, lineHeight: 40 },
  walletSubText: { fontSize: 12, fontFamily: 'Inter-Regular', color: V2026.colors.textMuted, marginTop: 1 },
  gaugeText: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: V2026.colors.primaryDeep },
  gaugeTextWarn: { color: V2026.colors.error },
  meterTrack: { height: 8, borderRadius: V2026.radius.full, backgroundColor: V2026.colors.background, overflow: 'hidden', marginBottom: 10 },
  meterFill: { height: '100%', borderRadius: V2026.radius.full },
  walletHintText: { fontSize: 11, fontFamily: 'Inter-Regular', color: V2026.colors.textFaint },

  breakdownHeader: { fontSize: 11, fontFamily: 'Inter-SemiBold', color: V2026.colors.textMuted, marginBottom: 8 },
  breakdownRow: { paddingVertical: 9 },
  breakdownRowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  breakdownRowLabel: { fontSize: 13.5, fontFamily: 'Poppins-SemiBold', color: V2026.colors.text },
  breakdownRowMeta: { fontSize: 12, fontFamily: 'Inter-Regular', color: V2026.colors.textMuted },
  breakdownRowMetaDepleted: { color: V2026.colors.error, fontFamily: 'Inter-SemiBold' },
  breakdownProgressTrack: { height: 6, borderRadius: V2026.radius.full, backgroundColor: V2026.colors.background, overflow: 'hidden' },
  breakdownProgressFill: { height: '100%', borderRadius: V2026.radius.full },

  benefitGrid: { gap: 10, marginTop: 4 },
  benefitCard: {
    width: '100%', borderRadius: V2026.radius.md, backgroundColor: V2026.colors.surface,
    padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14, ...V2026.shadows.milky,
  },
  benefitIconWrapper: {
    width: 34, height: 34, borderRadius: V2026.radius.sm, backgroundColor: 'rgba(0, 212, 199, 0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  benefitTitle: { fontSize: 14, fontFamily: 'Poppins-SemiBold', color: V2026.colors.text },
  benefitDesc: { marginTop: 2, fontSize: 12, fontFamily: 'Inter-Regular', color: V2026.colors.textMuted, lineHeight: 17 },

  legalText: { textAlign: 'center', fontSize: 11, fontFamily: 'Inter-Regular', color: V2026.colors.textFaint, lineHeight: 16, paddingHorizontal: 8, marginTop: 2 },
  footerSpacing: { height: 60 },

  stickyActionBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 110, justifyContent: 'flex-end' },
  checkoutButtonContainer: { paddingHorizontal: 20, paddingBottom: 22 },
  primaryCheckoutButton: { width: '100%', height: 56, borderRadius: V2026.radius.full, overflow: 'hidden', ...V2026.shadows.primary },
  primaryCheckoutButtonDisabled: { opacity: 0.75 },
  checkoutButtonGradient: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  checkoutButtonText: { fontSize: 15, fontFamily: 'Poppins-SemiBold', color: '#FFFFFF', letterSpacing: 0.2 },
});
