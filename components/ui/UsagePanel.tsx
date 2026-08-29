import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import {
  MessageCircle, Phone, Sparkles, Headphones, Map, Swords,
  ChevronRight, type LucideIcon,
} from 'lucide-react-native';
import { AIUsageService, type AIFeature, type AIFeatureUsage } from '@/services/aiUsageService';
import { formatResetIn } from '@/utils/aiLimitPrompt';
import { ContentPlaceholder } from '@/components/ui/SkeletonLoader';

// One row per metered AI feature, in the order they matter to a student.
const ROWS: { feature: AIFeature; label: string; icon: LucideIcon; color: string }[] = [
  { feature: 'miga_message', label: 'Chat messages', icon: MessageCircle, color: '#0F766E' },
  { feature: 'miga_call', label: 'Voice replies', icon: Phone, color: '#1CB0F6' },
  { feature: 'study_lab_generation', label: 'Study Lab', icon: Sparkles, color: '#A560E8' },
  { feature: 'study_lab_podcast', label: 'Podcasts', icon: Headphones, color: '#FF9600' },
  { feature: 'blueprint_generate', label: 'Blueprints', icon: Map, color: '#58CC02' },
  { feature: 'quiz_room_generate', label: 'Quiz rooms', icon: Swords, color: '#F43F5E' },
];

const LOW_AT = 3;

function barColor(u: AIFeatureUsage, base: string): string {
  if (u.limit <= 0) return '#CBD5E1';        // locked / not on this tier
  if (u.remaining <= 0) return '#EF4444';    // spent
  if (u.remaining <= LOW_AT) return '#F59E0B'; // running low
  return base;
}

/**
 * Duolingo-style daily usage card for the profile: one rounded panel, a coloured
 * meter per feature, live remaining counts, reset countdown, and a tap-through to
 * the plan. Replaces the per-page usage pills, which felt bolted onto each screen.
 */
export default function UsagePanel() {
  const [rows, setRows] = useState<AIFeatureUsage[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const all = await Promise.all(ROWS.map((r) => AIUsageService.getUsage(r.feature)));
      setRows(all);
      // Only clear the skeleton once we have real rows — an empty result
      // during the loading window previously rendered every feature as if it
      // were a locked PRO feature (locked = !u), which is misleading for a
      // free user's own already-available features.
      setLoading(false);
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => AIUsageService.subscribe(() => { void load(); }), [load]);

  const tier = rows.find((r) => r.tier === 'pro') ? 'pro' : 'free';
  const resetIn = formatResetIn(rows.map((r) => r.resetAt).find(Boolean) ?? null);

  return (
    <Pressable style={styles.card} onPress={() => router.push('/subscription' as any)}>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Daily usage</Text>
          {loading ? (
            <ContentPlaceholder lines={1} width={90} height={11} style={{ marginTop: 4 }} />
          ) : (
            <Text style={styles.sub}>{resetIn ? `Resets in ${resetIn}` : 'Resets every day'}</Text>
          )}
        </View>
        {!loading && (
          <View style={[styles.tier, tier === 'pro' ? styles.tierPro : styles.tierFree]}>
            <Text style={[styles.tierText, tier === 'pro' ? styles.tierTextPro : styles.tierTextFree]}>
              {tier.toUpperCase()}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.rows}>
        {ROWS.map((meta, i) => {
          if (loading) {
            return (
              <View key={meta.feature} style={styles.row}>
                <View style={[styles.coin, { backgroundColor: '#F1F5F9' }]} />
                <View style={styles.rowBody}>
                  <ContentPlaceholder lines={1} width="100%" height={7} />
                </View>
              </View>
            );
          }
          const u = rows[i];
          const locked = !u || u.limit <= 0;
          const pct = u && u.limit > 0 ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
          const fill = u ? barColor(u, meta.color) : '#CBD5E1';
          return (
            <View key={meta.feature} style={styles.row}>
              <View style={[styles.coin, { backgroundColor: locked ? '#E2E8F0' : meta.color }]}>
                <meta.icon size={13} color={locked ? '#94A3B8' : '#FFFFFF'} strokeWidth={2.6} />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}>
                  <Text style={styles.rowLabel}>{meta.label}</Text>
                  <Text style={[styles.rowCount, locked && styles.rowCountLocked]}>
                    {locked ? 'PRO' : `${u.remaining}/${u.limit}`}
                  </Text>
                </View>
                <View style={styles.track}>
                  {!locked && <View style={[styles.fill, { width: `${pct}%`, backgroundColor: fill }]} />}
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {!loading && (
        <View style={styles.footer}>
          <Text style={styles.footerText}>{tier === 'pro' ? 'Manage plan' : 'Upgrade for higher limits'}</Text>
          <ChevronRight size={16} color="#0F766E" strokeWidth={2.4} />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18,
    borderWidth: 1, borderColor: '#EEF3F7',
  },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  title: { fontFamily: 'Poppins-Bold', fontSize: 16, color: '#0B2540', letterSpacing: -0.2 },
  sub: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: '#64748B', marginTop: 2 },
  tier: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  tierFree: { backgroundColor: '#F1F5F9' },
  tierPro: { backgroundColor: '#CCFBF1' },
  tierText: { fontFamily: 'Inter-Bold', fontSize: 10.5, letterSpacing: 0.6 },
  tierTextFree: { color: '#64748B' },
  tierTextPro: { color: '#0F766E' },

  rows: { gap: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  coin: {
    width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowLabel: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: '#0B2540' },
  rowCount: { fontFamily: 'Inter-Bold', fontSize: 12.5, color: '#0B2540', fontVariant: ['tabular-nums'] },
  rowCountLocked: { color: '#94A3B8', letterSpacing: 0.4 },
  track: { height: 7, borderRadius: 999, backgroundColor: '#EEF2F6', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3,
    marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: '#F1F5F9',
  },
  footerText: { fontFamily: 'Inter-Bold', fontSize: 13, color: '#0F766E' },
});
