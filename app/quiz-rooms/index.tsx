import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  StatusBar,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView, AnimatePresence } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuizRoomsService, QuizRoom } from '@/utils/quizRoomsService';
import HapticService from '@/utils/hapticService';
import { V2026 } from '@/theme/v2026-tokens';

const { width: W } = Dimensions.get('window');

export default function QuizRoomsHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [myRooms, setMyRooms] = useState<QuizRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    // Only show the loading spinner on a genuinely empty first load — a cached
    // re-fetch on refocus should feel instant, not flash a spinner.
    if (myRooms.length === 0) setLoading(true);
    try {
      const rooms = await QuizRoomsService.getMyRooms(opts);
      setMyRooms(rooms);
    } catch {}
    setLoading(false);
  }, [myRooms.length]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleJoin = async () => {
    if (!joinCode.trim()) return;
    HapticService.medium();
    setJoining(true);
    try {
      const room = await QuizRoomsService.getRoomByCode(joinCode.trim());
      if (!room) { Alert.alert('Not found', 'No quiz room with that code. Check and try again.'); return; }
      if (room.status === 'completed') { Alert.alert('Ended', 'This quiz has already ended.'); return; }
      router.push(`/quiz-rooms/${room.id}`);
    } catch {
      Alert.alert('Error', 'Could not find that room. Try again.');
    } finally {
      setJoining(false);
    }
  };

  const statusColor = (s: QuizRoom['status']) =>
    s === 'waiting' ? '#10B981' : s === 'active' ? '#F59E0B' : '#94A3B8';
  const statusLabel = (s: QuizRoom['status']) =>
    s === 'waiting' ? 'WAITING' : s === 'active' ? 'LIVE' : 'ENDED';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={['#F8FAFC', '#FFFFFF']} style={StyleSheet.absoluteFill} />

      {/* Ambient glow */}
      <View style={styles.glow1} />
      <View style={styles.glow2} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={20} color="#0F172A" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.headerTitle}>Quiz Rooms</Text>
          <Text style={styles.headerSub}>Host or join a private quiz challenge</Text>
        </View>
      </View>
      <View style={styles.headerSep} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* Play with friends — StudyLab notebook card with list rows */}
          <MotiView from={{ opacity: 0, translateY: 14 }} animate={{ opacity: 1, translateY: 0 }} style={styles.notebookCard}>
            <View style={styles.notebookHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.notebookTitle}>Play with friends</Text>
                <Text style={styles.notebookSub}>Host a private room or join with a code</Text>
              </View>
              <View style={styles.headerCoin}><Ionicons name="people" size={19} color="#0A7A72" /></View>
            </View>

            {/* Start a room */}
            <View style={styles.notebookSection}>
              <Text style={styles.notebookSectionHeading}>Start a room</Text>
              <View style={styles.listWrap}>
                <TouchableOpacity activeOpacity={0.82} style={[styles.listItem, { borderBottomWidth: 0 }]} onPress={() => { HapticService.medium(); router.push('/quiz-rooms/create'); }}>
                  <LinearGradient colors={['#8B5CF6', '#6D28D9']} style={styles.listIconBg}>
                    <Ionicons name="rocket" size={17} color="#FFFFFF" />
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>Host a Quiz Room</Text>
                    <Text style={styles.itemSubtitle}>AI questions · coin prizes · shareable link</Text>
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
                  onChangeText={(t) => setJoinCode(t.toUpperCase())}
                  autoCapitalize="characters"
                  maxLength={8}
                />
                <TouchableOpacity
                  style={[styles.joinBtn, (!joinCode.trim() || joining) && { opacity: 0.5 }]}
                  onPress={handleJoin}
                  disabled={!joinCode.trim() || joining}
                  activeOpacity={0.85}
                >
                  <LinearGradient colors={['#00D4C7', '#0EA5E9']} style={styles.joinBtnGrad}>
                    <Text style={styles.joinBtnText}>{joining ? '…' : 'JOIN'}</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </View>
          </MotiView>

          {/* My Rooms */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>MY ROOMS</Text>
            {loading ? (
              <View style={styles.emptyBox}><Text style={styles.emptyText}>Loading…</Text></View>
            ) : myRooms.length === 0 ? (
              <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} style={styles.emptyBox}>
                <Ionicons name="albums-outline" size={34} color="#CBD5E1" />
                <Text style={styles.emptyText}>No rooms yet. Host your first!</Text>
              </MotiView>
            ) : (
              <View style={styles.listWrap}>
                {myRooms.map((room, i) => (
                  <TouchableOpacity
                    key={room.id}
                    activeOpacity={0.82}
                    style={[styles.listItem, i === myRooms.length - 1 && { borderBottomWidth: 0 }]}
                    onPress={() => { HapticService.selection(); router.push(`/quiz-rooms/dashboard/${room.id}`); }}
                  >
                    <LinearGradient colors={[statusColor(room.status), statusColor(room.status)]} style={styles.listIconBg}>
                      <Ionicons name="people" size={16} color="#FFFFFF" />
                    </LinearGradient>
                    <View style={{ flex: 1 }}>
                      <View style={styles.roomTopRow}>
                        <Text style={styles.itemTitle} numberOfLines={1}>{room.title}</Text>
                        <View style={[styles.statusBadge, { backgroundColor: statusColor(room.status) + '18', borderColor: statusColor(room.status) + '55' }]}>
                          <View style={[styles.statusDot, { backgroundColor: statusColor(room.status) }]} />
                          <Text style={[styles.statusText, { color: statusColor(room.status) }]}>{statusLabel(room.status)}</Text>
                        </View>
                      </View>
                      <Text style={styles.itemSubtitle}>Code {room.join_code} · {room.prize_pool > 0 ? 'Prize pool' : 'No prize pool'}</Text>
                    </View>
                    <View style={styles.chev}><Ionicons name="chevron-forward" size={15} color="#94A3B8" /></View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  glow1: { position: 'absolute', top: -80, right: -80, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(0,212,199,0.07)' },
  glow2: { position: 'absolute', bottom: 100, left: -60, width: 180, height: 180, borderRadius: 90, backgroundColor: 'rgba(14,165,233,0.06)' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 14 },
  backBtn: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF6' },
  headerTitle: { fontSize: 22, fontFamily: 'Poppins-Bold', color: '#0F172A', letterSpacing: -0.5 },
  headerSub: { fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#7A8398', marginTop: 1 },
  headerSep: { height: 1, backgroundColor: '#EBEFF4', marginBottom: 4 },

  scroll: { paddingHorizontal: 20, paddingTop: 18 },

  // Notebook card + list rows — same recipe as StudyLab's study tools
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
  itemTitle: { fontSize: 14.5, fontFamily: 'Poppins-Bold', color: '#1E293B' },
  itemSubtitle: { marginTop: 1, fontSize: 11.3, color: '#64748B', fontFamily: 'Inter-Medium', lineHeight: 15 },
  chev: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: 'rgba(0,0,0,0.02)' },

  // Join code input row (inside the notebook card) + Duolingo JOIN button
  joinRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  joinInput: { flex: 1, height: 50, backgroundColor: '#F8FAFC', borderRadius: 14, paddingHorizontal: 16, fontSize: 17, fontFamily: 'Poppins-Bold', color: '#0F172A', borderWidth: 1.5, borderColor: '#E7EEF4', letterSpacing: 2 },
  joinBtn: { borderRadius: 14, overflow: 'hidden', borderBottomWidth: 4, borderBottomColor: '#0A7C9E' },
  joinBtnGrad: { height: 50, paddingHorizontal: 22, justifyContent: 'center', alignItems: 'center' },
  joinBtnText: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#FFFFFF', letterSpacing: 1 },

  section: { marginBottom: 12 },
  sectionTitle: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#334155', letterSpacing: 1.35, textTransform: 'uppercase', opacity: 0.92, marginLeft: 4, marginBottom: 12 },

  emptyBox: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 32, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)', ...V2026.shadows.milky },
  emptyText: { fontSize: 14, fontFamily: 'Inter-Medium', color: '#94A3B8', textAlign: 'center' },

  roomTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2, gap: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontSize: 9, fontFamily: 'Poppins-Bold', letterSpacing: 0.8 },
});
