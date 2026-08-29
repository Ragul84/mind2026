import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { AIUsageService, type AIFeature, type AIFeatureUsage } from '@/services/aiUsageService';

type Props = {
  feature: AIFeature;
  /** Count-only, no label. Use where space is tight (a composer header). */
  compact?: boolean;
  /** Short label override for the full variant (the default label can be long). */
  label?: string;
  /** Hide the pill entirely while the count is healthy (ChatGPT-style quiet). */
  onlyWhenLow?: boolean;
};

type State = 'ok' | 'low' | 'depleted' | 'locked';

// "Running low" once the last few uses remain. A small absolute threshold reads
// the same whether the cap is 10 or 200: it means "about to run out".
const LOW_AT = 3;

function stateFor(usage: AIFeatureUsage): State {
  if (usage.limit <= 0) return 'locked';       // not available on this tier (e.g. free podcasts)
  if (usage.remaining <= 0) return 'depleted';
  if (usage.remaining <= LOW_AT) return 'low';
  return 'ok';
}

/**
 * Always-visible usage pill (Duolingo-style): shows remaining/limit and shifts
 * green -> amber -> red as it drains, or a PRO lock when the tier has no access.
 * Tapping opens the subscription screen. Refreshes on focus and the instant any
 * feature is consumed, via the AIUsageService change feed.
 */
export default function AIUsageLimitChip({ feature, compact = false, label, onlyWhenLow = false }: Props) {
  const [usage, setUsage] = useState<AIFeatureUsage | null>(null);

  const load = useCallback(async () => {
    try {
      setUsage(await AIUsageService.getUsage(feature));
    } catch {
      setUsage(null);
    }
  }, [feature]);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Live update when this (or any) feature is consumed elsewhere in the app.
  useEffect(() => AIUsageService.subscribe((changed) => {
    if (changed === null || changed === feature) void load();
  }), [feature, load]);

  if (!usage) return null;

  const state = stateFor(usage);
  if (onlyWhenLow && (state === 'ok')) return null;

  const palette = STATE_STYLES[state];
  const goUpgrade = () => router.push('/subscription' as any);

  if (state === 'locked') {
    return (
      <Pressable onPress={goUpgrade} style={[styles.base, compact ? styles.compact : styles.full, palette.box]} hitSlop={6}>
        <Lock size={11} color={palette.fg.color} strokeWidth={2.4} />
        <Text style={[styles.pro, palette.fg]}>PRO</Text>
      </Pressable>
    );
  }

  const count = `${usage.remaining}/${usage.limit}`;
  return (
    <Pressable onPress={goUpgrade} style={[styles.base, compact ? styles.compact : styles.full, palette.box]} hitSlop={6}>
      {!compact && <Text style={[styles.label, palette.fg]} numberOfLines={1}>{label ?? usage.label}</Text>}
      <Text style={[styles.value, palette.fg]}>{count}</Text>
    </Pressable>
  );
}

const STATE_STYLES: Record<State, { box: object; fg: { color: string } }> = {
  ok: { box: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' }, fg: { color: '#0F766E' } },
  low: { box: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' }, fg: { color: '#B45309' } },
  depleted: { box: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }, fg: { color: '#B91C1C' } },
  locked: { box: { backgroundColor: '#F5F3FF', borderColor: '#DDD6FE' }, fg: { color: '#6D28D9' } },
};

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, gap: 4 },
  full: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6 },
  compact: { borderRadius: 999, paddingHorizontal: 10, height: 26, justifyContent: 'center', gap: 3 },
  label: {
    fontFamily: 'Inter-Bold', fontSize: 10, letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  value: { fontFamily: 'Inter-Bold', fontSize: 12, fontVariant: ['tabular-nums'] },
  pro: { fontFamily: 'Inter-Bold', fontSize: 11, letterSpacing: 0.6 },
});
