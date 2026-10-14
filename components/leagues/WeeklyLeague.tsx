import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Image, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { fetchMyLeague, TIER_META, timeLeftLabel, zoneFor, type LeagueMember, type MyLeague } from '@/services/leagueService';
import { V2026 } from '@/theme/v2026-tokens';
import UniversalNavigation from '@/utils/universalNavigation';

/** Duolingo-style weekly league: tier strip, countdown, ranked cohort with zones. */
export function WeeklyLeague() {
  const [league, setLeague] = useState<MyLeague | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setLeague(await fetchMyLeague());
    } catch (e: any) {
      setError(e?.message || 'Could not load your league.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={V2026.colors.primary} /></View>;
  }
  if (error || !league) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{error || 'League unavailable.'}</Text>
        <TouchableOpacity onPress={() => { setLoading(true); void load(); }} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const meta = TIER_META[league.tier] ?? TIER_META.bronze;
  const size = league.members.length;

  const renderRow = ({ item }: { item: LeagueMember }) => {
    const zone = zoneFor(item.rank, size, league);
    const showPromoLine = league.promote_count > 0 && item.rank === league.promote_count && size > league.promote_count;
    const showDemoteLine = zone !== 'demote' && league.demote_count > 0 && size > 10 && item.rank === size - league.demote_count;
    return (
      <View>
        <View style={[styles.row, item.is_me && styles.rowMe]}>
          <Text style={[styles.rank, zone === 'promote' && { color: '#059669' }, zone === 'demote' && { color: '#DC2626' }]}>{item.rank}</Text>
          {item.avatar_url
            ? <Image source={{ uri: item.avatar_url }} style={styles.avatar} />
            : <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text></View>}
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{item.is_me ? `${item.name} (you)` : item.name}</Text>
            {item.state ? <Text style={styles.sub} numberOfLines={1}>{item.state}</Text> : null}
          </View>
          <Text style={styles.xp}>{item.weekly_xp} XP</Text>
        </View>
        {showPromoLine && <ZoneLine label="Promotion zone" color="#059669" icon="arrow-up" />}
        {showDemoteLine && <ZoneLine label="Demotion zone" color="#DC2626" icon="arrow-down" />}
      </View>
    );
  };

  return (
    <FlatList
      data={league.members}
      keyExtractor={(m) => m.user_id}
      renderItem={renderRow}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      contentContainerStyle={{ paddingBottom: 140 }}
      ListHeaderComponent={
        <View>
          <View style={styles.tierStrip}>
            {league.tiers.map((t, i) => {
              const m = TIER_META[t];
              const reached = i + 1 <= league.tier_index;
              return (
                <View key={t} style={[styles.tierDot, { backgroundColor: reached ? m.color : '#E2E8F0' }, t === league.tier && styles.tierDotCurrent]}>
                  <Ionicons name="shield" size={t === league.tier ? 18 : 12} color="#FFFFFF" />
                </View>
              );
            })}
          </View>
          <View style={[styles.hero, { backgroundColor: meta.soft }]}>
            <Text style={[styles.heroTitle, { color: meta.color }]}>{meta.label} League</Text>
            <Text style={styles.heroSub}>
              {league.promote_count > 0 ? `Top ${league.promote_count} move up` : 'Top league: hold your place'}
              {league.demote_count > 0 ? ` · bottom ${league.demote_count} move down` : ''}
            </Text>
            <View style={styles.timer}>
              <Ionicons name="time-outline" size={14} color="#475569" />
              <Text style={styles.timerText}>{timeLeftLabel(league.week_ends_at)}</Text>
            </View>
            {league.last_outcome && league.last_outcome !== 'stayed' ? (
              <Text style={styles.outcome}>
                {league.last_outcome === 'promoted' ? 'You were promoted last week!' : 'You dropped a league last week. Win it back.'}
              </Text>
            ) : null}
          </View>
          {!league.joined && (
            <View style={styles.joinCard}>
              <Text style={styles.joinTitle}>Earn XP to join this week&apos;s league</Text>
              <Text style={styles.muted}>Finish one lesson or quiz and you&apos;ll be placed with up to 29 other learners.</Text>
              <TouchableOpacity style={styles.joinBtn} onPress={() => UniversalNavigation.navigateTo('/(tabs)/home')}>
                <Text style={styles.joinBtnText}>Start a lesson</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      }
    />
  );
}

const ZoneLine = ({ label, color, icon }: { label: string; color: string; icon: 'arrow-up' | 'arrow-down' }) => (
  <View style={styles.zone}>
    <View style={[styles.zoneRule, { backgroundColor: color }]} />
    <Ionicons name={icon} size={12} color={color} />
    <Text style={[styles.zoneText, { color }]}>{label}</Text>
    <View style={[styles.zoneRule, { backgroundColor: color }]} />
  </View>
);

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  muted: { color: '#64748B', fontSize: 13, textAlign: 'center' },
  retry: { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 12, backgroundColor: V2026.colors.primary },
  retryText: { color: '#FFFFFF', fontWeight: '700' },
  tierStrip: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  tierDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tierDotCurrent: { width: 40, height: 40, borderRadius: 20 },
  hero: { marginHorizontal: 16, borderRadius: 18, padding: 16, alignItems: 'center' },
  heroTitle: { fontSize: 22, fontWeight: '900' },
  heroSub: { fontSize: 13, color: '#475569', marginTop: 4, textAlign: 'center' },
  timer: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  timerText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  outcome: { marginTop: 8, fontSize: 13, fontWeight: '700', color: '#0F172A' },
  joinCard: { margin: 16, padding: 16, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center' },
  joinTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginBottom: 4 },
  joinBtn: { marginTop: 12, backgroundColor: V2026.colors.primary, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14 },
  joinBtnText: { color: '#FFFFFF', fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 14, backgroundColor: '#FFFFFF' },
  rowMe: { borderWidth: 2, borderColor: V2026.colors.primary },
  rank: { width: 24, fontSize: 15, fontWeight: '900', color: '#334155', textAlign: 'center' },
  avatar: { width: 36, height: 36, borderRadius: 18 },
  avatarFallback: { backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '800', color: '#475569' },
  name: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  sub: { fontSize: 11, color: '#64748B' },
  xp: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  zone: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20, marginTop: 10 },
  zoneRule: { flex: 1, height: 1 },
  zoneText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
});

export default WeeklyLeague;
