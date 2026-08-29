// Quiz Rooms Tab (4th tab · "Rooms") — StudyLab design language:
// milky-white notebook card + list rows, teal accents, tactile depth.
import React, { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Alert,
  ScrollView, StatusBar, ActivityIndicator, RefreshControl,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import { useAuthContext } from '@/components/AuthProvider';
import { QuizRoomsService, QuizRoom } from '@/utils/quizRoomsService';
import { V2026 } from '@/theme/v2026-tokens';

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  waiting:   { bg: '#FEF3C7', text: '#D97706', label: 'WAITING' },
  active:    { bg: '#D1FAE5', text: '#059669', label: 'LIVE' },
  completed: { bg: '#F1F5F9', text: '#94A3B8', label: 'ENDED' },
};

export default function QuizRoomsTab() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();

  const [myRooms, setMyRooms] = useState<QuizRoom[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadRooms = useCallback(async (opts?: { force?: boolean }) => {
    if (!user?.id) return;
    try {
      const rooms = await QuizRoomsService.getMyRooms(opts);
      setMyRooms(rooms || []);
    } catch (e) {
      // silently fail
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { loadRooms(); }, [loadRooms]));

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setJoining(true);
    try {
      const room = await QuizRoomsService.getRoomByCode(code);
      if (!room) { Alert.alert('Not Found', 'No quiz room with that code. Double-check and try again.'); return; }
      if (room.status === 'completed') { Alert.alert('Quiz Ended', 'This quiz has already ended.'); return; }
      router.push(`/quiz-rooms/${room.id}` as any);
    } catch {
      Alert.alert('Error', 'Could not find that room. Please try again.');
    } finally {
      setJoining(false);
    }
  };

  const activeRooms = myRooms.filter(r => r.status !== 'completed');
  const pastRooms   = myRooms.filter(r => r.status === 'completed').slice(0, 3);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Quiz Rooms</Text>
          <Text style={styles.headerSub}>Host or join a live multiplayer quiz</Text>
        </View>
        <TouchableOpacity style={styles.historyBtn} onPress={() => router.push('/quiz-rooms' as any)} activeOpacity={0.8}>
          <Ionicons name="time-outline" size={20} color="#0A7A72" />
        </TouchableOpacity>
      </View>
      <View style={styles.headerSep} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadRooms({ force: true }); }} />}
      >
        {/* Play with friends — notebook card + list rows (StudyLab) */}
        <MotiView from={{ opacity: 0, translateY: 12 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 250 }} style={styles.notebookCard}>
          {/* Start a room */}
          <View style={styles.notebookSection}>
            <Text style={styles.notebookSectionHeading}>Start a room</Text>
            <View style={styles.listWrap}>
              <TouchableOpacity
                activeOpacity={0.82}
                style={[styles.listItem, { borderBottomWidth: 0 }]}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/quiz-rooms/create' as any); }}
              >
                <LinearGradient colors={['#8B5CF6', '#6D28D9']} style={styles.listIconBg}>
                  <FontAwesome5 name="rocket" size={16} color="#FFFFFF" solid />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>Host a Quiz Room</Text>
                  <Text style={styles.itemSubtitle}>AI questions · coin prizes · shareable code</Text>
                </View>
                <View style={styles.chev}><Ionicons name="chevron-forward" size={15} color="#94A3B8" /></View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Join with a code */}
          <View style={[styles.notebookSection, { borderBottomWidth: 0, paddingBottom: 2 }]}>
            <Text style={styles.notebookSectionHeading}>Join with a code</Text>
            <View style={styles.joinRow}>
              <TextInput
                style={styles.joinInput}
                placeholder="Enter code"
                placeholderTextColor="#94A3B8"
                value={joinCode}
                onChangeText={t => setJoinCode(t.toUpperCase())}
                maxLength={8}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={[styles.joinBtn, (!joinCode.trim() || joining) && { opacity: 0.5 }]}
                onPress={handleJoin}
                disabled={!joinCode.trim() || joining}
                activeOpacity={0.85}
              >
                {joining ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Text style={styles.joinBtnText}>Join</Text>
                    <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </MotiView>

        {/* Active rooms */}
        {loading ? (
          <ActivityIndicator size="large" color="#00AFA5" style={{ marginTop: 32 }} />
        ) : activeRooms.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>YOUR ACTIVE ROOMS</Text>
            <View style={styles.listWrap}>
              {activeRooms.map((room, i) => (
                <RoomRow key={room.id} room={room} last={i === activeRooms.length - 1} onPress={() => router.push(`/quiz-rooms/${room.id}` as any)} />
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.emptyBox}>
            <Ionicons name="albums-outline" size={34} color="#CBD5E1" />
            <Text style={styles.emptyText}>No active rooms yet</Text>
            <Text style={styles.emptySub}>Host one above or join with a code</Text>
          </View>
        )}

        {/* Recent */}
        {pastRooms.length > 0 && (
          <View style={[styles.section, { marginTop: 8 }]}>
            <Text style={styles.sectionLabel}>RECENT</Text>
            <View style={styles.listWrap}>
              {pastRooms.map((room, i) => (
                <RoomRow key={room.id} room={room} last={i === pastRooms.length - 1} onPress={() => router.push(`/quiz-rooms/${room.id}` as any)} />
              ))}
            </View>
          </View>
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
}

function RoomRow({ room, last, onPress }: { room: QuizRoom; last: boolean; onPress: () => void }) {
  const cfg = STATUS_COLORS[room.status] || STATUS_COLORS.waiting;
  return (
    <TouchableOpacity style={[styles.listItem, last && { borderBottomWidth: 0 }]} onPress={onPress} activeOpacity={0.82}>
      <LinearGradient colors={[cfg.text, cfg.text]} style={styles.listIconBg}>
        <FontAwesome5 name="users" size={15} color="#FFFFFF" solid />
      </LinearGradient>
      <View style={{ flex: 1 }}>
        <View style={styles.roomTopRow}>
          <Text style={styles.itemTitle} numberOfLines={1}>{room.title || room.topic || 'Quiz Room'}</Text>
          <View style={[styles.statusBadge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.statusText, { color: cfg.text }]}>{cfg.label}</Text>
          </View>
        </View>
        <Text style={styles.itemSubtitle}>
          {(room.question_count ?? '?')} Qs · {(room.participant_count ?? 0)} joined{room.join_code ? ` · ${room.join_code}` : ''}
        </Text>
      </View>
      <View style={styles.chev}><Ionicons name="chevron-forward" size={15} color="#94A3B8" /></View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },

  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14 },
  headerTitle: { fontSize: 26, fontFamily: 'Poppins-Bold', color: '#0F172A', letterSpacing: -0.6, lineHeight: 31 },
  headerSub: { fontSize: 13, fontFamily: 'Inter-Medium', color: '#7A8398', marginTop: 3, letterSpacing: 0.1 },
  historyBtn: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#F0FDFA', borderWidth: 1, borderColor: '#CCFBF1', alignItems: 'center', justifyContent: 'center' },
  headerSep: { height: 1, backgroundColor: '#EBEFF4', marginBottom: 4 },

  scroll: { paddingHorizontal: 18, paddingTop: 18 },

  // notebook card + list rows — same recipe as StudyLab
  notebookCard: { borderRadius: 26, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)', padding: 14, gap: 12, marginBottom: 22, ...V2026.shadows.milky },
  notebookHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)', paddingBottom: 12 },
  notebookTitle: { fontSize: 18, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  notebookSub: { fontSize: 11.5, fontFamily: 'Inter-Medium', color: '#64748B', marginTop: 1 },
  headerCoin: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#F0FDFA', borderWidth: 1, borderColor: '#CCFBF1', alignItems: 'center', justifyContent: 'center' },
  notebookSection: { borderBottomWidth: 1, borderBottomColor: 'rgba(0,0,0,0.04)', paddingBottom: 14, gap: 8 },
  notebookSectionHeading: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  listWrap: { backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)', overflow: 'hidden', marginTop: 8, ...V2026.shadows.milky },
  listItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(15,23,42,0.06)' },
  listIconBg: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  itemTitle: { fontSize: 14.5, fontFamily: 'Poppins-Bold', color: '#1E293B', flex: 1 },
  itemSubtitle: { marginTop: 2, fontSize: 11.3, color: '#64748B', fontFamily: 'Inter-Medium', lineHeight: 15 },
  chev: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: 'rgba(0,0,0,0.02)', marginLeft: 8 },

  // join row + Duolingo JOIN button
  joinRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  joinInput: { flex: 1, height: 50, backgroundColor: '#F8FAFC', borderRadius: 14, paddingHorizontal: 16, fontSize: 17, fontFamily: 'Poppins-Bold', color: '#0F172A', borderWidth: 1.5, borderColor: '#E7EEF4', letterSpacing: 2 },
  // Copied from the daily-dose card button: solid accent + darker bottom edge.
  joinBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, minWidth: 106, paddingHorizontal: 20, borderRadius: 14, backgroundColor: '#00AFA5', borderBottomWidth: 3, borderBottomColor: 'rgba(0,0,0,0.18)' },
  joinBtnText: { color: '#FFFFFF', fontFamily: 'Poppins-Bold', fontSize: 15, letterSpacing: 0.3 },

  section: { marginBottom: 12 },
  sectionLabel: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#334155', letterSpacing: 1.35, textTransform: 'uppercase', opacity: 0.92, marginLeft: 4, marginBottom: 12 },

  roomTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  statusBadge: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 9.5, fontFamily: 'Poppins-Bold', letterSpacing: 0.6 },

  emptyBox: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 34, alignItems: 'center', gap: 8, borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)', ...V2026.shadows.milky },
  emptyText: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#64748B', marginTop: 6 },
  emptySub: { fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#94A3B8' },
});
