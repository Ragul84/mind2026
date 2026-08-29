import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  ImageBackground,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import LottieView from 'lottie-react-native';

import { useAuthContext } from '@/components/AuthProvider';
import {
  getMissionPayload,
  getUserProtocol,
  MissionPayload
} from '@/utils/protocolService';
import HapticService from '@/utils/hapticService';
import { SupabaseService } from '@/utils/supabaseService';
import { Aurora } from '@/theme/aurora-tokens';

const cleanMissionTitle = (title?: string | null) => {
  const value = String(title || '').replace(/\s+/g, ' ').trim();
  return value.replace(/\s*\((?:Days?|Day)\s+\d+\s*(?:[-–]\s*\d+)?\)\s*$/i, '').trim();
};

type PhaseStatus = 'locked' | 'current' | 'completed';

interface PhaseConfig {
  id: number;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  gradient: [string, string];
  type: 'snapshot' | 'flashcards' | 'videos' | 'quiz' | 'current_affairs';
}

const PHASES: PhaseConfig[] = [
  {
    id: 1,
    title: 'Reading Notes',
    subtitle: 'Full topic learning section',
    icon: 'book',
    gradient: ['#2563EB', '#06B6D4'],
    type: 'snapshot',
  },
  {
    id: 2,
    title: 'Recall Cards',
    subtitle: 'Exam-focused active recall',
    icon: 'albums',
    gradient: ['#7C5CFC', '#4F46E5'],
    type: 'flashcards',
  },
  {
    id: 3,
    title: 'Video Lessons',
    subtitle: 'Curated reference tutorials',
    icon: 'play',
    gradient: ['#F59E0B', '#F97316'],
    type: 'videos',
  },
  {
    id: 4,
    title: 'Exam Practice',
    subtitle: 'Timed questions from today',
    icon: 'create',
    gradient: ['#10B981', '#059669'],
    type: 'quiz',
  },
  {
    id: 5,
    title: 'Current Affairs',
    subtitle: 'Daily news quiz on the latest exam topics',
    icon: 'newspaper',
    gradient: ['#06B6D4', '#0284C7'],
    type: 'current_affairs',
  },
];

export default function DailyMissionScreen() {
  const router = useRouter();
  const { user } = useAuthContext();

  const [loading, setLoading] = useState(true);
  const [missionData, setMissionData] = useState<{
    payload: MissionPayload | null;
    topicTitle: string | null;
    currentPhase: number;
  }>({
    payload: null,
    topicTitle: null,
    currentPhase: 1,
  });
  const [weakFocus, setWeakFocus] = useState<{ topic: string; recommendation: string } | null>(null);

  const loadMission = useCallback(async (silent = false) => {
    if (!user?.id) return;
    if (!silent) setLoading(true);
    try {
      const protocol = await getUserProtocol(user.id);
      if (protocol) {
        const { payload, topicTitle } = await getMissionPayload(
          protocol.track_id,
          protocol.current_day_number
        );
        setMissionData({
          payload,
          topicTitle,
          currentPhase: protocol.progress_phase || 1,
        });
      }

      const studyPlan = await SupabaseService.getPersonalizedStudyPlan(user.id);
      const topWeakArea = studyPlan?.weakAreas?.[0];
      setWeakFocus(
        topWeakArea
          ? {
              topic: topWeakArea.topic,
              recommendation: topWeakArea.recommendation,
            }
          : null
      );
    } catch (error) {
      console.error('Failed to load mission:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  const hasLoadedRef = useRef(false);
  // Reload on every focus so a phase completed in the reader unlocks the next
  // card the moment the user lands back here (silently after first load).
  useFocusEffect(
    useCallback(() => {
      loadMission(hasLoadedRef.current);
      hasLoadedRef.current = true;
    }, [loadMission])
  );

  const handlePhasePress = (phase: PhaseConfig) => {
    const status = getPhaseStatus(phase.id);
    if (status === 'locked') {
      HapticService.error();
      return;
    }

    HapticService.medium();

    router.push({
      pathname: '/daily-mission/reader',
      params: {
        phaseId: phase.id,
        phaseType: phase.type,
        topicTitle: missionData.topicTitle || 'Daily Lesson'
      }
    });
  };

  const getPhaseStatus = (phaseId: number): PhaseStatus => {
    if (phaseId < missionData.currentPhase) return 'completed';
    if (phaseId === missionData.currentPhase) return 'current';
    return 'locked';
  };

  const completedCount = PHASES.filter(p => getPhaseStatus(p.id) === 'completed').length;
  const dayNumber = missionData.payload?.day_number || 1;
  const topic = cleanMissionTitle(missionData.topicTitle) || 'Loading…';
  const currentPhaseTitle =
    PHASES.find((phase) => phase.id === missionData.currentPhase)?.title || 'Reading Notes';

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <LottieView
          source={require('@/assets/lotties/loadingscreen.json')}
          autoPlay
          loop
          style={styles.loadingLottie}
        />
        <Text style={styles.loadingTitle}>Loading your daily lesson…</Text>
        <Text style={styles.loadingCopy}>Preparing one clean study flow for today.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={[...Aurora.gradient.canvas]} style={StyleSheet.absoluteFill} pointerEvents="none" />

      <SafeAreaView style={styles.safeArea}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Ionicons name="arrow-back" size={20} color={Aurora.color.ink} />
          </TouchableOpacity>
          <Text style={styles.topBarLabel}>Daily Dose</Text>
          <View style={styles.dayChip}>
            <Ionicons name="flame" size={13} color={Aurora.color.indigo} />
            <Text style={styles.dayChipText}>Day {dayNumber}</Text>
          </View>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Hero — gradient mission briefing */}
          <MotiView
            from={{ opacity: 0, translateY: -12 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: 'timing', duration: 420 }}
          >
            <ImageBackground
              source={require('@/assets/banners/dailydose.png')}
              style={styles.heroCard}
              imageStyle={styles.heroCardImage}
              resizeMode="cover"
            >
              <LinearGradient
                colors={['rgba(17,15,42,0.12)', 'rgba(17,15,42,0.34)', 'rgba(17,15,42,0.60)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <View style={styles.heroTopRow}>
                <View style={styles.heroKickerPill}>
                  <View style={styles.heroKickerDot} />
                  <Text style={styles.heroKickerText}>TODAY'S TOPIC</Text>
                </View>
                <View style={styles.heroFractionPill}>
                  <Text style={styles.heroFractionText}>
                    {completedCount}<Text style={styles.heroFractionOf}>/{PHASES.length}</Text>
                  </Text>
                </View>
              </View>

              <Text style={styles.heroTitle} numberOfLines={3}>{topic}</Text>

              <View style={styles.heroSpacer} />

              <View style={styles.progressTrackRow}>
                {PHASES.map((phase) => {
                  const s = getPhaseStatus(phase.id);
                  return (
                    <View
                      key={phase.id}
                      style={[
                        styles.progressSegment,
                        s === 'completed' && styles.progressSegmentDone,
                        s === 'current' && styles.progressSegmentCurrent,
                      ]}
                    />
                  );
                })}
              </View>
              <View style={styles.progressMetaRow}>
                <Text style={styles.progressMetaLabel}>CURRENT PHASE</Text>
                <Text style={styles.progressMetaValue}>{currentPhaseTitle}</Text>
              </View>
            </ImageBackground>
          </MotiView>

          {/* Phases */}
          <Text style={styles.sectionLabel}>YOUR MISSION</Text>
          <View style={styles.phaseList}>
            {PHASES.map((phase, idx) => {
              const status = getPhaseStatus(phase.id);
              return (
                <MotiView
                  key={`${phase.id}-${status}`}
                  from={{ opacity: 0, translateY: 16 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  transition={{ type: 'timing', duration: 360, delay: 140 + idx * 60 }}
                >
                  <PhaseCard
                    phase={phase}
                    status={status}
                    onPress={() => handlePhasePress(phase)}
                  />
                </MotiView>
              );
            })}
          </View>

          {/* Weak focus — compact colored recommendation */}
          {weakFocus && (
            <MotiView
              from={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'timing', duration: 360, delay: 520 }}
            >
              <LinearGradient
                colors={[...Aurora.gradient.focus]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.focusCard}
              >
                <View style={styles.focusHeader}>
                  <Ionicons name="bulb" size={13} color="#FFFFFF" />
                  <Text style={styles.focusLabel}>FOCUS AREA</Text>
                </View>
                <Text style={styles.focusTopic} numberOfLines={1}>{weakFocus.topic}</Text>
                <Text style={styles.focusRec} numberOfLines={2}>{weakFocus.recommendation}</Text>
              </LinearGradient>
            </MotiView>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const PhaseCard = ({ phase, status, onPress }: {
  phase: PhaseConfig;
  status: PhaseStatus;
  onPress: () => void;
}) => {
  const isCurrent = status === 'current';
  const isLocked = status === 'locked';

  const card = (
    <TouchableOpacity
      activeOpacity={isLocked ? 1 : 0.82}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${phase.title}. ${phase.subtitle}`}
      accessibilityState={{ disabled: isLocked }}
      style={[
        styles.phaseCard,
        isCurrent && styles.phaseCardCurrent,
        status === 'completed' && styles.phaseCardDone,
        isLocked && styles.phaseCardLocked,
      ]}
    >
      <View
        style={[
          styles.phaseAccent,
          { backgroundColor: isLocked ? '#CBD5E1' : phase.gradient[0] },
        ]}
      />

      <LinearGradient
        colors={isLocked ? ['#E2E8F0', '#CBD5E1'] : phase.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.phaseIcon, isCurrent && styles.phaseIconCurrent]}
      >
        <Ionicons
          name={status === 'completed' ? 'checkmark' : phase.icon}
          size={isCurrent ? 19 : 16}
          color={isLocked ? '#94A3B8' : '#FFFFFF'}
        />
      </LinearGradient>

      <View style={styles.phaseContent}>
        <Text style={[styles.phaseTitle, isLocked && styles.phaseTitleLocked]}>
          {phase.title}
        </Text>
        {!isLocked && <Text style={styles.phaseSub}>{phase.subtitle}</Text>}
      </View>

      {isCurrent && (
        <LinearGradient
          colors={['#2563EB', '#06B6D4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.startPill}
        >
          <Text style={styles.startPillText}>Start</Text>
          <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
        </LinearGradient>
      )}
      {status === 'completed' && (
        <View style={styles.donePill}>
          <Ionicons name="checkmark" size={13} color="#059669" />
          <Text style={styles.donePillText}>Done</Text>
        </View>
      )}
      {isLocked && (
        <View style={styles.lockBadge}>
          <Ionicons name="lock-closed" size={13} color="#94A3B8" />
        </View>
      )}
    </TouchableOpacity>
  );

  if (!isCurrent) return card;

  // Springy unlock jiggle — replays whenever this card becomes the current one
  // (the list keys cards by status, so completing a phase remounts this).
  return (
    <MotiView
      from={{ scale: 0.9, rotate: '-2deg' }}
      animate={{ scale: 1, rotate: '0deg' }}
      transition={{ type: 'spring', damping: 6, stiffness: 220, mass: 0.8, delay: 350 }}
    >
      {card}
    </MotiView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Aurora.color.background },
  safeArea: { flex: 1 },

  // Loading
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Aurora.color.background,
    paddingHorizontal: 28,
  },
  loadingLottie: { width: 184, height: 184 },
  loadingTitle: {
    marginTop: 4,
    fontFamily: 'Poppins-Bold',
    fontSize: 20,
    color: Aurora.color.ink,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  loadingCopy: {
    marginTop: 6,
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    lineHeight: 19,
    color: Aurora.color.inkMuted,
    textAlign: 'center',
  },

  // Top bar
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 12,
    gap: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Aurora.color.hairline,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarLabel: {
    flex: 1,
    fontFamily: 'Poppins-SemiBold',
    fontSize: 15,
    color: Aurora.color.ink,
    letterSpacing: 0.2,
  },
  dayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Aurora.color.surfaceTint,
    borderWidth: 1,
    borderColor: 'rgba(79, 70, 229, 0.18)',
  },
  dayChipText: {
    fontFamily: 'Poppins-Bold',
    fontSize: 12,
    color: Aurora.color.indigo,
    letterSpacing: 0.3,
  },

  // Scroll
  scroll: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 24,
  },

  // Hero — gradient mission briefing
  heroCard: {
    borderRadius: 26,
    padding: 18,
    marginBottom: 18,
    minHeight: 198,
    overflow: 'hidden',
    backgroundColor: '#EDEAFB',
    borderWidth: 1,
    borderColor: Aurora.color.hairline,
  },
  heroCardImage: {
    borderRadius: 25,
  },
  heroSpacer: {
    flex: 1,
    minHeight: 14,
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  heroKickerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  heroKickerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Aurora.color.indigo,
  },
  heroKickerText: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 10,
    color: Aurora.color.indigo,
    letterSpacing: 1.1,
  },
  heroFractionPill: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.78)',
  },
  heroFractionText: {
    fontFamily: 'Poppins-Bold',
    fontSize: 13,
    color: '#2B2659',
  },
  heroFractionOf: {
    fontFamily: 'Poppins-Medium',
    fontSize: 12,
    color: Aurora.color.inkMuted,
  },
  heroTitle: {
    fontFamily: 'Poppins-Bold',
    fontSize: 17,
    lineHeight: 23,
    color: '#FFFFFF',
    letterSpacing: -0.2,
    marginBottom: 4,
  },
  progressTrackRow: {
    flexDirection: 'row',
    gap: 7,
  },
  progressSegment: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  progressSegmentDone: {
    backgroundColor: Aurora.color.indigo,
  },
  progressSegmentCurrent: {
    backgroundColor: Aurora.color.cyan,
  },
  progressMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    gap: 12,
  },
  progressMetaLabel: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 9.5,
    color: 'rgba(255,255,255,0.72)',
    letterSpacing: 1,
  },
  progressMetaValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: 'Poppins-SemiBold',
    fontSize: 13,
    color: '#FFFFFF',
  },

  // Section label
  sectionLabel: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 11,
    color: Aurora.color.inkMuted,
    letterSpacing: 1.3,
    marginBottom: 10,
    paddingLeft: 4,
  },

  // Phase list
  phaseList: { gap: 10 },
  phaseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Aurora.color.hairline,
  },
  phaseCardCurrent: {
    backgroundColor: '#F3F7FF',
    borderColor: 'rgba(37, 99, 235, 0.28)',
  },
  phaseCardDone: {
    backgroundColor: '#F4FBF8',
    borderColor: 'rgba(5, 150, 105, 0.18)',
  },
  phaseCardLocked: {
    opacity: 0.62,
    backgroundColor: '#F8FAFC',
  },
  phaseAccent: {
    width: 4,
    alignSelf: 'stretch',
    borderRadius: 999,
    marginRight: -1,
  },
  phaseIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  phaseIconCurrent: {
    width: 48,
    height: 48,
    borderRadius: 17,
  },
  phaseContent: { flex: 1 },
  phaseTitle: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 14.5,
    color: Aurora.color.ink,
    letterSpacing: -0.1,
  },
  phaseTitleLocked: { color: '#64748B' },
  phaseSub: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: Aurora.color.inkMuted,
    marginTop: 1,
  },
  startPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
  },
  startPillText: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  donePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(5, 150, 105, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(5, 150, 105, 0.18)',
  },
  donePillText: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 11,
    color: '#059669',
  },
  lockBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EEF1F7',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Focus card — compact colored recommendation
  focusCard: {
    padding: 16,
    borderRadius: 20,
    marginTop: 16,
  },
  focusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  focusLabel: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 10,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 1.1,
  },
  focusTopic: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 14,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  focusRec: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    lineHeight: 17,
    color: 'rgba(255,255,255,0.82)',
  },
});
