import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { MotiView } from 'moti';
import { KnowledgeHeistGameService } from '@/services/knowledgeHeistService';
import { supabase } from '@/utils/supabaseService';
import { useAuthContext } from '@/components/AuthProvider';
import { V2026 } from '@/theme/v2026-tokens';
import { WeeklyLeague } from '@/components/leagues/WeeklyLeague';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface StateData {
  name: string;
  code: string;
  totalXP: number;
  activeUsers: number;
  badge: string;
}

const MOCK_STATES: StateData[] = [
  { name: 'Maharashtra', code: 'MH', totalXP: 125750, activeUsers: 2847, badge: '🌆' },
  { name: 'Karnataka', code: 'KA', totalXP: 118920, activeUsers: 2156, badge: '💻' },
  { name: 'Tamil Nadu', code: 'TN', totalXP: 112430, activeUsers: 2894, badge: '🏺' },
  { name: 'Gujarat', code: 'GJ', totalXP: 98650, activeUsers: 1753, badge: '🧵' },
  { name: 'Delhi', code: 'DL', totalXP: 89750, activeUsers: 1429, badge: '🏛️' },
  { name: 'Uttar Pradesh', code: 'UP', totalXP: 88120, activeUsers: 2490, badge: '🕌' },
  { name: 'West Bengal', code: 'WB', totalXP: 76250, activeUsers: 1198, badge: '🐅' },
];

type StateIconName = keyof typeof Ionicons.glyphMap;
type StateIconConfig = { name: StateIconName; bg: string; color: string };

const STATE_ICON_MAP: Record<string, StateIconConfig> = {
  AP: { name: 'water', bg: '#E0F2FE', color: '#0369A1' },
  AR: { name: 'trail-sign', bg: '#ECFDF5', color: '#047857' },
  AS: { name: 'leaf', bg: '#ECFDF5', color: '#15803D' },
  BR: { name: 'document-text', bg: '#FEF3C7', color: '#B45309' },
  CG: { name: 'leaf', bg: '#DCFCE7', color: '#166534' },
  DL: { name: 'business', bg: '#E0E7FF', color: '#3730A3' },
  GA: { name: 'sunny', bg: '#FEF3C7', color: '#B45309' },
  GJ: { name: 'color-palette', bg: '#FFE4E6', color: '#BE123C' },
  HR: { name: 'nutrition', bg: '#FEF9C3', color: '#A16207' },
  HP: { name: 'triangle', bg: '#E0F2FE', color: '#075985' },
  JH: { name: 'hammer', bg: '#E5E7EB', color: '#374151' },
  KA: { name: 'hardware-chip', bg: '#DBEAFE', color: '#1D4ED8' },
  KL: { name: 'leaf', bg: '#D1FAE5', color: '#047857' },
  MP: { name: 'compass', bg: '#FCE7F3', color: '#BE185D' },
  MH: { name: 'podium', bg: '#FFEDD5', color: '#C2410C' },
  MN: { name: 'musical-notes', bg: '#EDE9FE', color: '#6D28D9' },
  ML: { name: 'cloud', bg: '#E0F2FE', color: '#0284C7' },
  MZ: { name: 'radio', bg: '#F5F3FF', color: '#7C3AED' },
  NL: { name: 'shield', bg: '#FEE2E2', color: '#B91C1C' },
  OD: { name: 'aperture', bg: '#F3E8FF', color: '#7E22CE' },
  PB: { name: 'flash', bg: '#FEF9C3', color: '#A16207' },
  RJ: { name: 'diamond', bg: '#FEE2E2', color: '#DC2626' },
  SK: { name: 'snow', bg: '#E0F2FE', color: '#0369A1' },
  TN: { name: 'library', bg: '#FEF3C7', color: '#92400E' },
  TS: { name: 'sparkles', bg: '#E0E7FF', color: '#4338CA' },
  TR: { name: 'git-branch', bg: '#DCFCE7', color: '#15803D' },
  UP: { name: 'school', bg: '#FAE8FF', color: '#A21CAF' },
  UK: { name: 'triangle', bg: '#E0F2FE', color: '#075985' },
  WB: { name: 'color-filter', bg: '#FFE4E6', color: '#BE123C' },
};

const getStateIcon = (state: StateData): StateIconConfig =>
  STATE_ICON_MAP[state.code] || { name: 'trophy', bg: '#F1F5F9', color: '#334155' };

const formatXP = (xp: number) => {
  if (xp >= 100000) return `${(xp / 1000).toFixed(0)}K`;
  return xp.toLocaleString();
};

function StateLeaderboard() {
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const [selectedFilter, setSelectedFilter] = useState<'weekly' | 'monthly' | 'alltime'>('monthly');
  const [stateLeaderboard, setStateLeaderboard] = useState<StateData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [userState, setUserState] = useState<string | null>(null);
  const channelRef = useRef<any>(null);

  const fetchLeaderboard = useCallback(async () => {
    try {
      // Cached below (30s TTL) — only show the spinner on a genuinely empty
      // first load, not on every refocus once data is already on screen.
      if (stateLeaderboard.length === 0) setIsLoading(true);
      const results = await KnowledgeHeistGameService.getStateLeaderboard();
      if (results && results.length) {
        setStateLeaderboard(
          results.map((s: any) => ({
            name: s.name,
            code: s.code,
            totalXP: s.xp,
            activeUsers: s.activeUsers || 0,
            badge: s.badge || '',
          }))
        );
      } else {
        setStateLeaderboard(MOCK_STATES);
      }
    } catch {
      setStateLeaderboard(MOCK_STATES);
    } finally {
      setIsLoading(false);
    }
  }, [stateLeaderboard.length]);

  // Fetch user's own state for highlight
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('user_profiles')
      .select('state')
      .eq('id', user.id)
      .single()
      .then(({ data }) => setUserState(data?.state || null));
  }, [user?.id]);

  // Realtime — re-fetch whenever any user's total_xp changes
  useEffect(() => {
    channelRef.current = supabase
      .channel('state-leaderboard-realtime')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_profiles' },
        () => { fetchLeaderboard(); }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [fetchLeaderboard]);

  useFocusEffect(
    useCallback(() => {
      fetchLeaderboard();
    }, [fetchLeaderboard])
  );

  const displayStates = useMemo(() => {
    const list = [...stateLeaderboard];
    if (selectedFilter === 'weekly') {
      return list.sort((a, b) => b.activeUsers - a.activeUsers || b.totalXP - a.totalXP);
    }
    if (selectedFilter === 'alltime') {
      return list.sort((a, b) => b.totalXP - a.totalXP || b.activeUsers - a.activeUsers);
    }
    return list.sort((a, b) => b.totalXP - a.totalXP || b.activeUsers - a.activeUsers);
  }, [stateLeaderboard, selectedFilter]);

  const topThree = displayStates.slice(0, 3);
  const restOfList = displayStates.slice(3);

  const summary = useMemo(() => {
    const totalXP = displayStates.reduce((sum, item) => sum + item.totalXP, 0);
    const totalLearners = displayStates.reduce((sum, item) => sum + item.activeUsers, 0);
    const leader = displayStates[0]?.name || '-';
    return { totalXP, totalLearners, leader };
  }, [displayStates]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={['#FFFFFF', '#F5F7FB']} style={StyleSheet.absoluteFill} />

      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top - 4, 4) }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>State Leaderboard</Text>
            {userState && (
              <View style={styles.yourStateBadge}>
                <View style={styles.liveDoc} />
                <Text style={styles.yourStateText}>Your state: {userState}</Text>
              </View>
            )}
          </View>
          <View style={styles.headerBadge}>
            <Ionicons name="trophy" size={18} color="#0F172A" />
          </View>
        </View>

        <View style={styles.filterContainer}>
          <View style={styles.filterSurface}>
            {(['weekly', 'monthly', 'alltime'] as const).map((filter) => {
              const active = selectedFilter === filter;
              return (
                <TouchableOpacity
                  key={filter}
                  activeOpacity={1}
                  onPress={() => setSelectedFilter(filter)}
                  style={[styles.filterTab, active && styles.filterTabActive]}
                >
                  <Text style={[styles.filterText, active && styles.filterTextActive]}>
                    {filter === 'alltime' ? 'All' : filter === 'monthly' ? 'Month' : 'Week'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {isLoading ? (
          <LeaderboardSkeleton />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 150, paddingHorizontal: 18 }}>
            <CompactPodium states={topThree} userState={userState} />

            <View style={styles.statStrip}>
              <View style={styles.statItem}><Text style={styles.statVal} numberOfLines={1}>{summary.leader}</Text><Text style={styles.statLbl}>Leader</Text></View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}><Text style={styles.statVal}>{summary.totalLearners.toLocaleString()}</Text><Text style={styles.statLbl}>Learners</Text></View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}><Text style={styles.statVal}>{formatXP(summary.totalXP)}</Text><Text style={styles.statLbl}>Total XP</Text></View>
            </View>

            <Text style={styles.sectionHeader}>All states</Text>
            <View style={styles.rankingsSection}>
              {restOfList.map((state, idx) => {
                const icon = getStateIcon(state);
                const rank = idx + 4;
                const isYourState = userState === state.name;
                return (
                  <MotiView
                    key={state.code}
                    from={{ opacity: 0, translateY: 10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'timing', duration: 300, delay: 120 + idx * 45 }}
                    style={[styles.rankRow, isYourState && styles.rankRowHighlight]}
                  >
                    <Text style={[styles.rowRank, isYourState && { color: '#00D4C7' }]}>{rank}</Text>
                    <LinearGradient colors={[icon.color + '26', icon.color + '12']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.rankNumberContainer}>
                      <Ionicons name={icon.name} size={17} color={icon.color} />
                    </LinearGradient>
                    <View style={styles.stateInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.stateName}>{state.name}</Text>
                        {isYourState && (
                          <View style={styles.youBadge}><Text style={styles.youBadgeText}>YOU</Text></View>
                        )}
                      </View>
                      <Text style={styles.stateUsers}>{state.activeUsers.toLocaleString()} learners</Text>
                    </View>
                    <Text style={styles.xpValue}>{formatXP(state.totalXP)}<Text style={styles.xpUnit}> XP</Text></Text>
                  </MotiView>
                );
              })}
            </View>
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}

const CompactPodium = ({ states, userState }: { states: StateData[]; userState?: string | null }) => {
  const order = [
    { s: states[1], rank: 2, grad: ['#E2E8F0', '#94A3B8'] as const, tint: 'rgba(148,163,184,0.12)', h: 118 },
    { s: states[0], rank: 1, grad: ['#FFD23F', '#F59E0B'] as const, tint: 'rgba(245,158,11,0.13)', h: 146 },
    { s: states[2], rank: 3, grad: ['#FDBA74', '#E8915A'] as const, tint: 'rgba(232,145,90,0.12)', h: 100 },
  ].filter((x) => x.s);
  return (
    <View style={styles.podium}>
      {order.map(({ s, rank, grad, tint, h }, i) => {
        const me = userState === s.name;
        return (
          <MotiView
            key={s.code}
            from={{ opacity: 0, translateY: 18, scale: 0.94 }}
            animate={{ opacity: 1, translateY: 0, scale: 1 }}
            transition={{ type: 'spring', damping: 14, stiffness: 140, delay: 80 + i * 100 }}
            style={styles.podColWrap}
          >
            {rank === 1 && <Ionicons name="star" size={15} color="#F59E0B" style={{ marginBottom: 3 }} />}
            <View style={[styles.podCard, { height: h, backgroundColor: tint, borderColor: me ? '#00D4C7' : 'rgba(15,23,42,0.05)' }]}>
              <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.podMedal}>
                <Text style={styles.podMedalNum}>{rank}</Text>
              </LinearGradient>
              <Text style={styles.podName} numberOfLines={1}>{s.name}</Text>
              <Text style={styles.podXp}>{formatXP(s.totalXP)} XP</Text>
              {me && <View style={styles.podYou}><Text style={styles.podYouText}>YOU</Text></View>}
            </View>
          </MotiView>
        );
      })}
    </View>
  );
};

const Shimmer = ({ style }: { style?: any }) => (
  <MotiView
    from={{ opacity: 0.36 }}
    animate={{ opacity: 0.72 }}
    transition={{ type: 'timing', duration: 900, loop: true }}
    style={[styles.shimmer, style]}
  />
);

const LeaderboardSkeleton = () => (
  <View style={styles.skeletonWrap}>
    <View style={styles.skeletonSummary}>
      <Shimmer style={styles.skeletonSummaryChip} />
      <Shimmer style={styles.skeletonSummaryChip} />
      <Shimmer style={styles.skeletonSummaryChip} />
    </View>
    <View style={styles.skeletonPodium}>
      <Shimmer style={styles.skeletonPodiumCol} />
      <Shimmer style={styles.skeletonPodiumColTall} />
      <Shimmer style={styles.skeletonPodiumCol} />
    </View>
    <Shimmer style={styles.skeletonSectionTitle} />
    {[0, 1, 2, 3, 4].map((i) => (
      <View key={`row-skel-${i}`} style={styles.skeletonRow}>
        <Shimmer style={styles.skeletonRowRank} />
        <View style={{ flex: 1 }}>
          <Shimmer style={styles.skeletonTitle} />
          <Shimmer style={styles.skeletonSubtitle} />
        </View>
        <Shimmer style={styles.skeletonXp} />
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  bgBandTop: {
    position: 'absolute',
    top: -100,
    left: -40,
    right: -40,
    height: 220,
    backgroundColor: 'rgba(14, 165, 233, 0.08)',
    transform: [{ rotate: '-6deg' }],
  },
  bgBandBottom: {
    position: 'absolute',
    bottom: -90,
    left: -60,
    right: -60,
    height: 220,
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
    transform: [{ rotate: '6deg' }],
  },
  bgGrid: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.18,
    right: -18,
    width: SCREEN_WIDTH * 0.54,
    height: SCREEN_HEIGHT * 0.26,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.04)',
    overflow: 'hidden',
    opacity: 0.5,
  },
  bgGridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.05)',
  },
  bgGridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.045)',
  },
  heroStrip: {
    marginBottom: 12,
  },
  heroStripInner: {
    minHeight: 128,
    borderRadius: 24,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  heroStripCopy: {
    flex: 1,
    paddingRight: 16,
  },
  heroStripBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  heroStripDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34D399',
  },
  heroStripBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins-SemiBold',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  heroStripTitle: {
    fontSize: 19,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    lineHeight: 24,
    maxWidth: 210,
  },
  heroStripSubtitle: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: 'rgba(255,255,255,0.76)',
    lineHeight: 17,
    maxWidth: 220,
  },
  heroStripVisual: {
    width: 92,
    height: 92,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPulseRing: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  heroPulseCore: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F172A',
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  heroMiniChipTop: {
    position: 'absolute',
    top: 2,
    right: 0,
    minWidth: 68,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroMiniChipBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    minWidth: 68,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  heroMiniChipValue: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
  },
  heroMiniChipLabel: {
    marginTop: 1,
    fontSize: 9,
    fontFamily: 'Inter-Medium',
    color: 'rgba(255,255,255,0.72)',
  },
  header: {
    paddingHorizontal: 18,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  yourStateBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  liveDoc: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#22C55E',
  },
  yourStateText: {
    fontSize: 12,
    fontFamily: 'Poppins-Medium',
    color: '#64748B',
  },

  eyebrow: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 25,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    letterSpacing: -0.5,
    marginTop: 1,
  },
  subtitle: {
    display: 'none',
    marginTop: 0,
    fontSize: 0,
    fontFamily: 'Inter-Medium',
    color: 'transparent',
  },
  headerBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterContainer: {
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  filterSurface: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderRadius: 18,
    padding: 4,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  filterTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
  },
  filterTabActive: {
    backgroundColor: 'rgba(0,212,199,0.14)',
  },
  filterText: {
    fontSize: 13,
    fontFamily: 'Poppins-SemiBold',
    color: '#64748B',
  },
  filterTextActive: {
    color: '#0D9488',
  },
  summaryCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    marginBottom: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  summaryChip: {
    flex: 1,
    minHeight: 62,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    lineHeight: 18,
  },
  summaryLabel: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
  },
  podium: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 6, marginBottom: 14 },
  podColWrap: { flex: 1, alignItems: 'center' },
  podCard: {
    width: '100%', borderRadius: 20, borderWidth: 1,
    alignItems: 'center', paddingTop: 16, paddingHorizontal: 6, overflow: 'hidden',
  },
  podMedal: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  podMedalNum: { fontFamily: 'Poppins-Bold', fontSize: 15, color: '#FFFFFF' },
  podName: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5, color: '#0F172A', maxWidth: '100%' },
  podXp: { fontFamily: 'Inter-SemiBold', fontSize: 10.5, color: '#475569', marginTop: 2 },
  podYou: { marginTop: 7, backgroundColor: '#00D4C7', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 1 },
  podYouText: { fontFamily: 'Poppins-Bold', fontSize: 8.5, color: '#FFFFFF', letterSpacing: 0.5 },
  statStrip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)', paddingVertical: 13, marginBottom: 16,
  },
  rowRank: { width: 22, textAlign: 'center', fontFamily: 'Poppins-Bold', fontSize: 13, color: '#94A3B8', marginRight: 4 },
  xpUnit: { fontFamily: 'Inter-SemiBold', fontSize: 11, color: '#94A3B8' },
  statItem: { flex: 1, alignItems: 'center', paddingHorizontal: 6 },
  statVal: { fontFamily: 'Poppins-Bold', fontSize: 14, color: '#0F172A' },
  statLbl: { fontFamily: 'Inter-Medium', fontSize: 10, color: '#64748B', marginTop: 2 },
  statDivider: { width: 1, height: 28, backgroundColor: 'rgba(15,23,42,0.08)' },
  prideCard: {
    borderRadius: 26,
    padding: 14,
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    overflow: 'hidden',
    ...V2026.shadows.milky,
  },
  pridePodium: {
    height: 230,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
  },
  prideColumnWrap: {
    flex: 1,
    alignItems: 'center',
  },
  prideIconBubble: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    marginBottom: 8,
    ...V2026.shadows.milky,
  },
  prideColumn: {
    width: '100%',
    minHeight: 70,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: 'hidden',
    justifyContent: 'flex-start',
    alignItems: 'center',
    borderWidth: 1,
    backgroundColor: 'rgba(248,250,252,0.8)',
  },
  prideColumnCap: {
    width: '100%',
    height: 5,
  },
  prideRank: {
    marginTop: 12,
    fontSize: 18,
    fontFamily: 'Poppins-Bold',
  },
  prideXp: {
    marginTop: 2,
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#475569',
  },
  pridePillarGlow: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 10,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  prideColumnAura: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 6,
    height: 20,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.22)',
    opacity: 0.7,
  },
  prideName: {
    marginTop: 8,
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
    maxWidth: '100%',
  },
  sectionHeader: {
    fontSize: 18,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    marginBottom: 12,
    marginLeft: 2,
  },
  rankingsSection: {
    gap: 10,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 13,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  rankRowHighlight: {
    borderColor: '#00D4C7',
    borderWidth: 1.5,
    backgroundColor: 'rgba(0, 212, 199, 0.04)',
  },
  youBadge: {
    backgroundColor: '#00D4C7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  youBadgeText: {
    fontSize: 9,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },

  rankNumberContainer: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  stateInfo: {
    flex: 1,
  },
  stateName: {
    fontSize: 15,
    fontFamily: 'Poppins-SemiBold',
    color: '#0F172A',
  },
  stateUsers: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
  },
  rankMeta: {
    alignItems: 'flex-end',
  },
  rankNumber: {
    fontSize: 12,
    fontFamily: 'Poppins-SemiBold',
    color: '#64748B',
  },
  xpValue: {
    marginTop: 2,
    fontSize: 15,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  shimmer: {
    backgroundColor: 'rgba(15, 23, 42, 0.07)',
    borderRadius: 12,
  },
  skeletonWrap: {
    paddingHorizontal: 18,
    paddingTop: 6,
    gap: 10,
  },
  skeletonSummary: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  skeletonSummaryChip: {
    flex: 1,
    height: 62,
    borderRadius: 16,
  },
  skeletonPodium: {
    flexDirection: 'row',
    gap: 10,
    height: 218,
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  skeletonPodiumCol: {
    flex: 1,
    height: 108,
    borderRadius: 20,
  },
  skeletonPodiumColTall: {
    flex: 1,
    height: 168,
    borderRadius: 20,
  },
  skeletonSectionTitle: {
    width: 108,
    height: 18,
    marginTop: 8,
    marginBottom: 2,
  },
  skeletonRow: {
    height: 66,
    borderRadius: 18,
    padding: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.07)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skeletonRowRank: {
    width: 34,
    height: 34,
    borderRadius: 17,
  },
  skeletonTitle: {
    width: '64%',
    height: 14,
    marginBottom: 8,
  },
  skeletonSubtitle: {
    width: '42%',
    height: 10,
  },
  skeletonXp: {
    width: 58,
    height: 20,
  },
});


// ── Ranks screen: weekly leagues (default) + the existing state leaderboard ──
export default function RanksScreen() {
  const [mode, setMode] = useState<'league' | 'states'>('league');
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: '#F5F7FB' }}>
      <View style={[ranksStyles.switchWrap, { paddingTop: insets.top + 6 }]}>
        {(['league', 'states'] as const).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => setMode(m)}
            style={[ranksStyles.switchBtn, mode === m && ranksStyles.switchBtnOn]}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === m }}
          >
            <Text style={[ranksStyles.switchText, mode === m && ranksStyles.switchTextOn]}>
              {m === 'league' ? 'Weekly League' : 'States'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={{ flex: 1 }}>{mode === 'league' ? <WeeklyLeague /> : <StateLeaderboard />}</View>
    </View>
  );
}

const ranksStyles = StyleSheet.create({
  switchWrap: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 6, backgroundColor: '#FFFFFF' },
  switchBtn: { flex: 1, paddingVertical: 9, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center' },
  switchBtnOn: { backgroundColor: V2026.colors.primary },
  switchText: { fontWeight: '800', color: '#475569', fontSize: 13 },
  switchTextOn: { color: '#FFFFFF' },
});
