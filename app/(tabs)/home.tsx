// pages/index.js (MindGainsHomePage) - updated to use LearningPathNoSvg + patched LessonBubblePopup
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StatusBar,
  Dimensions,
  StyleSheet,
  RefreshControl,
  StyleProp,
  ViewStyle,
  ScrollView,
  Platform,
  ImageBackground,
} from 'react-native';
import { Easing } from 'react-native-reanimated';
import { Svg, Circle } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import PressableScale from '@/components/ui/PressableScale';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import UniversalNavigation from '@/utils/universalNavigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
import { Ionicons } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { WebView } from 'react-native-webview';

const LIQUID_CANVAS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body { width:100%; height:100%; overflow:hidden; background:transparent; }
    canvas { display:block; width:100%; height:100%; filter: blur(10px) saturate(190%); opacity: 0.90; }
  </style>
</head>
<body>
  <canvas id="c"></canvas>
  <script>
    const canvas = document.getElementById('c');
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, t = 0;
    function resize() {
      w = canvas.width = window.innerWidth || 360;
      h = canvas.height = window.innerHeight || 80;
    }
    window.addEventListener('resize', resize);
    resize();
    function draw() {
      ctx.clearRect(0,0,w,h);
      t += 0.016;

      // Wave 1: MindGains Teal -> Emerald -> Sky Cyan -> Indigo
      const g1 = ctx.createLinearGradient(0, 0, w, 0);
      g1.addColorStop(0, 'rgba(15, 118, 110, 0.88)');    /* Deep Teal */
      g1.addColorStop(0.35, 'rgba(123, 227, 176, 0.85)'); /* Emerald */
      g1.addColorStop(0.70, 'rgba(56, 189, 248, 0.80)');  /* Sky Cyan */
      g1.addColorStop(1, 'rgba(99, 102, 241, 0.78)');    /* Indigo */

      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let x = 0; x <= w; x += 4) {
        const y = Math.sin(x * 0.008 + t) * 18 + Math.cos(x * 0.015 - t * 0.85) * 12 + 32;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, 0);
      ctx.closePath();
      ctx.fillStyle = g1;
      ctx.fill();

      // Wave 2: Counter-flowing Indigo -> Sky Cyan -> Emerald -> Teal
      const g2 = ctx.createLinearGradient(w, 0, 0, 0);
      g2.addColorStop(0, 'rgba(99, 102, 241, 0.75)');
      g2.addColorStop(0.35, 'rgba(56, 189, 248, 0.78)');
      g2.addColorStop(0.70, 'rgba(123, 227, 176, 0.82)');
      g2.addColorStop(1, 'rgba(15, 118, 110, 0.85)');

      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let x = 0; x <= w; x += 4) {
        const y = Math.cos(x * 0.010 - t * 0.95) * 16 + Math.sin(x * 0.018 + t * 0.75) * 10 + 26;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, 0);
      ctx.closePath();
      ctx.fillStyle = g2;
      ctx.fill();

      requestAnimationFrame(draw);
    }
    draw();
  </script>
</body>
</html>`;

// Services & Utils
import { useAuthContext } from '@/components/AuthProvider';
import { SupabaseService, supabase } from '@/utils/supabaseService';
import { RedisService } from '@/utils/redisService';
import HapticService from '@/utils/hapticService';
import LearningProgressService from '@/utils/learningProgressService';
import { RealDatabaseContentService, DatabaseTopic } from '@/utils/realDatabaseContentService';
import { StreakService } from '@/utils/streakService';
import { StreakCache } from '@/utils/streakCache';
import { ClearProgressCache } from '@/utils/clearProgressCache';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { RewardService } from '@/services/rewardService';
import { useUserStats } from '@/hooks/useUserStats';
import { getMissionPayload, getUserProtocol, syncProtocolForToday, getMissionCountdown } from '@/utils/protocolService';
import { practiceExamIdForStudyContext } from '@/utils/studyContext';
import {
  getDailyLocalizedThirukkural,
  getThirukkuralVerseText,
  splitThirukkuralLines,
  type LocalizedThirukkural,
  type ThirukkuralLanguage,
} from '@/utils/thirukkuralService';

type MindGainsHomePageProps = {
  showLearningPath?: boolean;
};

type KuralLanguage = ThirukkuralLanguage;
// Components
import Enhanced3DXPBar from '@/components/Enhanced3DXPBar';
import { DayStreakModal, type DayStreakMode } from '@/components/ui/DayStreakModal';
import { V2026 } from '@/theme/v2026-tokens';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const COLORS = {
  primaryBlue: '#00D4C7',
  secondaryBlue: '#00D4C7',
  backgroundDark: '#F8FAFC', // Milky White
  cardDark: '#FFFFFF',
  successMint: '#48C586',
  warmAccent: '#FFD76F',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  borders: '#E2E8F0',
};

// Professional 8px spacing grid
const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

const studyToolsConfig = [
  {
    id: 'quiz-hub',
    title: 'Quiz Hub',
    copy: 'Exam wise and subject wise practice drills.',
    icon: 'clipboard-list',
    iconType: 'FontAwesome5',
    color: '#A560E8',
    route: '/quiz-hub',
  },
  {
    id: 'pyq-papers',
    title: 'Verified PYQs',
    copy: 'Real previous-year questions, verified & browsed by exam & year.',
    icon: 'history',
    iconType: 'FontAwesome5',
    color: '#0EA5E9',
    route: '/pyq',
  },
  {
    id: 'mock-tests',
    title: 'Mock Tests',
    copy: 'Full-length, timed, exam-pattern tests with All-India Rank.',
    icon: 'stopwatch',
    iconType: 'FontAwesome5',
    color: '#00B4A6',
    route: '/mock',
  },
  {
    id: 'quick-sprint',
    title: 'Quick Sprint',
    copy: 'A 10-question rapid test for pace and pressure.',
    icon: 'flash',
    iconType: 'Ionicons',
    color: '#FF9600',
    route: '/quiz/reader?mode=quick-sprint',
  },
  {
    id: 'weak-areas',
    title: 'Practice Weak-Areas',
    copy: 'Re-attempt what you missed — from mocks, PYQs & quizzes.',
    icon: 'bullseye',
    iconType: 'FontAwesome5',
    color: '#EF4444',
    route: '/quiz/mistakes',
  },
  {
    id: 'generate-lesson',
    title: 'Build Lessons',
    copy: 'Blueprint any topic into a structured lesson path.',
    icon: 'sliders-h',
    iconType: 'FontAwesome5',
    color: '#58CC02',
    route: '/learn/blueprint',
  },
  {
    id: 'answer-writing',
    title: 'Answer Writing',
    copy: 'Write a Mains / descriptive answer — MIGA scores it on a rubric.',
    icon: 'feather-alt',
    iconType: 'FontAwesome5',
    color: '#7C3AED',
    route: '/answer-eval',
  },
  {
    id: 'study-plan',
    title: 'Study Plan',
    copy: 'Your daily plan — built from your weak areas and exam date.',
    icon: 'calendar-check',
    iconType: 'FontAwesome5',
    color: '#0F766E',
    route: '/study-plan',
  },
];

const renderToolIcon = (tool: typeof studyToolsConfig[number]) => {
  if (tool.iconType === 'Ionicons') {
    return <Ionicons name={tool.icon as any} size={20} color="#FFFFFF" />;
  }
  return <FontAwesome5 name={tool.icon} size={18} color="#FFFFFF" />;
};

// Quick Practice coins are built from the user's own exam subjects. Colours cycle
// through this palette; labels are shortened from the full subject names.
const PRACTICE_COLORS = ['#58CC02', '#FF9600', '#1CB0F6', '#A560E8', '#14B8A6', '#F43F5E', '#F59E0B', '#6366F1'];

// Shade a hex colour: amt > 0 lightens toward white, amt < 0 darkens toward
// black. Returns hex (safest for expo-linear-gradient). Builds the light-top ->
// dark-bottom gradient that gives the 3D icon coins their depth.
function shade(hex: string, amt: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const ch = (c: number) => clamp(amt > 0 ? c + (255 - c) * amt : c + c * amt);
  const r = ch((n >> 16) & 255), g = ch((n >> 8) & 255), b = ch(n & 255);
  const hx = (x: number) => x.toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

// A themed, looping idle "gesture" per subject icon (Duolingo-style): the icon
// rests, does its little motion, then rests again, on a loop. Keyframe arrays
// The home sections fade/slide in on first paint. That intro is a nice arrival,
// but replaying it every time the tab regains focus makes a screen that never
// actually refetched look like it reloaded. So it plays once per app session:
// after that, sections render already settled.
let homeIntroPlayed = false;

function introProps(delay: number, axis: 'y' | 'x' = 'y', shift = 12) {
  if (homeIntroPlayed) return {};
  const key = axis === 'y' ? 'translateY' : 'translateX';
  return {
    from: { opacity: 0, [key]: shift },
    animate: { opacity: 1, [key]: 0 },
    transition: { type: 'timing' as const, duration: 340, delay },
  };
}

// with repeated rest frames create the timed pause; per-subject durations keep
// the coins from all moving in sync.
function subjectIconLoop(id: string) {
  const loop = (duration: number) => ({ type: 'timing' as const, duration, loop: true, delay: 400 });
  switch (id) {
    case 'polity': // scales of justice tip, wobble, and balance
      return { animate: { rotate: ['0deg', '0deg', '0deg', '-16deg', '12deg', '-6deg', '2deg', '0deg', '0deg', '0deg'] }, transition: loop(3400) };
    case 'geography': // globe rotates a full turn, then rests
      return { animate: { rotate: ['0deg', '0deg', '0deg', '120deg', '240deg', '360deg', '360deg', '360deg', '360deg'] }, transition: loop(3800) };
    case 'history': // book hops like it's being stacked
      return { animate: { translateY: [0, 0, 0, -10, 1, -3, 0, 0, 0], rotate: ['0deg', '0deg', '0deg', '-6deg', '4deg', '0deg', '0deg', '0deg', '0deg'] }, transition: loop(3000) };
    case 'economy': // coin bob + flip
      return { animate: { scale: [1, 1, 1, 1.2, 0.92, 1.05, 1, 1, 1], rotate: ['0deg', '0deg', '0deg', '14deg', '-10deg', '4deg', '0deg', '0deg', '0deg'] }, transition: loop(3200) };
    case 'science': // flask swirl
      return { animate: { rotate: ['0deg', '0deg', '0deg', '18deg', '-14deg', '8deg', '-3deg', '0deg', '0deg'] }, transition: loop(3100) };
    default: // gentle heartbeat pop
      return { animate: { scale: [1, 1, 1, 1.16, 0.95, 1.04, 1, 1, 1] }, transition: loop(2900) };
  }
}

const shortSubjectLabel = (name: string) => name.split(/[&—(-]/)[0].trim();

export default function HomeTabScreen() {
  return <MindGainsHomePage showLearningPath={false} />;
}

export function AdminHomeScreen() {
  return <MindGainsHomePage showLearningPath />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  homeBandTop: {
    position: 'absolute',
    top: -120,
    left: -40,
    right: -40,
    height: 240,
    backgroundColor: 'rgba(255, 153, 51, 0.08)',
    transform: [{ rotate: '-7deg' }],
  },
  homeBandMid: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.34,
    left: -60,
    right: -60,
    height: 150,
    backgroundColor: 'rgba(14, 165, 233, 0.045)',
    transform: [{ rotate: '5deg' }],
  },
  homeBandBottom: {
    position: 'absolute',
    bottom: -90,
    left: -50,
    right: -50,
    height: 230,
    backgroundColor: 'rgba(19, 136, 8, 0.07)',
    transform: [{ rotate: '6deg' }],
  },
  homeGridPanel: {
    position: 'absolute',
    top: SCREEN_HEIGHT * 0.18,
    right: -20,
    width: SCREEN_WIDTH * 0.55,
    height: SCREEN_HEIGHT * 0.28,
    opacity: 0.45,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.04)',
    overflow: 'hidden',
  },
  homeGridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.05)',
  },
  homeGridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.045)',
  },
  commandHeader: {
    paddingHorizontal: 16,
    zIndex: 100,
  },
  headerGlassContent: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.05)',
    backgroundColor: '#F8FAFC',
    zIndex: 3,
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: 8,
    height: 44,
    justifyContent: 'center',
  },
  proActionButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },



  // Path Styles
  duolingoNodeContainer: { position: 'relative', marginBottom: 60, minHeight: 120 },
  duolingoConnectorLine: { position: 'absolute', left: '50%', top: 60, bottom: -60, width: 6, backgroundColor: '#F8FAFC', opacity: 0.2, marginLeft: -3, borderRadius: 3 },
  mascotContainer: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#F8FAFC', borderWidth: 2, borderColor: '#00D4C7', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  mascotImage: { width: 60, height: 60 },

  // Overlays
  celebrationOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  celebrationAnimation: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
  },
  trophyOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  trophyAnimation: {
    width: 200,
    height: 200,
  },
  celebrationText: {
    alignItems: 'center',
    marginTop: 20,
  },
  celebrationTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F172A',
    marginBottom: 8,
  },
  celebrationSubtitle: {
    fontSize: 18,
    color: '#FFD700',
    fontWeight: '600',
  },
  celebrationCoinContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },

  // Generic Utilities
  mainContent: { flex: 1 },
  learningPathWrapper: {
    flex: 1,
    marginTop: 0,
  },
  compactCardContainer: {
    paddingHorizontal: 12,
    marginTop: 8,
    position: 'relative',
  },
  coinContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  flyingXP: {
    position: 'absolute',
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flyingXPGradient: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  flyingXPText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '800',
  },
  flyingCoinContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sectionHeading: {
    // Use Material 3 headlineMedium
    fontSize: 28,
    fontWeight: '400',
    lineHeight: 36,
    letterSpacing: 0,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    marginTop: 8,
    marginHorizontal: 24,
  },
  sectionTitle: {
    fontSize: 12.5,
    fontFamily: 'Poppins-Bold',
    color: '#334155',
    letterSpacing: 1.35,
    marginLeft: 4,
    textTransform: 'uppercase',
    opacity: 0.92,
  },
  gameHubBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  gameHubContent: {
    width: '100%',
    borderRadius: 28,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 20,
  },
  gameHubHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  gameHubTitle: {
    color: '#0F172A',
    fontSize: 20,
    fontWeight: '800',
  },
  gameHubSubtitle: {
    color: '#475569',
    fontSize: 13,
    marginBottom: 18,
    lineHeight: 18,
  },
  gameHubDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: 16,
  },
  gameHubCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 12,
  },
  skeletonLearningCard: {
    height: 100,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  gameIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  gameText: {
    flex: 1,
  },
  gameCardTitle: {
    color: '#0F172A',
    fontFamily: 'Poppins-SemiBold',
    fontSize: 15,
  },
  gameCardSubtitle: {
    color: '#475569',
    fontSize: 12,
    marginTop: 2,
  },
  missionReminderCard: {
    marginHorizontal: 24,
    marginTop: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(0,212,199,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  missionReminderGlow: {
    position: 'absolute',
    top: -30,
    right: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(0,212,199,0.35)',
    opacity: 0.5,
  },
  missionReminderTitle: {
    color: '#0F172A',
    fontFamily: 'Poppins-SemiBold',
    fontSize: 16,
  },
  missionReminderHeadline: {
    color: '#00D4C7',
    fontFamily: 'Poppins-Bold',
    fontSize: 18,
  },
  missionReminderCopy: {
    color: '#475569',
  },

  currentAffairCard: {
    marginTop: 12,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 12,
  },
  currentAffairHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  currentAffairTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 212, 199, 0.08)',
  },
  currentAffairTagText: {
    color: '#00D4C7',
    fontWeight: '700',
    fontSize: 11,
  },
  currentAffairRefresh: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  currentAffairHeadline: {
    color: '#0F172A',
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
  },
  currentAffairSummary: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 18,
  },
  currentAffairMeta: {
    color: '#94A3B8',
    fontSize: 11,
  },
  currentAffairButton: {
    borderRadius: 16,
    paddingVertical: 12,
    marginTop: 6,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentAffairButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  currentAffairPortalCard: {
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  currentAffairPortalTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  currentAffairPortalTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(37,99,235,0.08)',
  },
  currentAffairPortalTagText: {
    fontSize: 11,
    fontFamily: 'Poppins-SemiBold',
    color: '#2563EB',
  },
  currentAffairPortalTitle: {
    color: '#0F172A',
    fontSize: 17,
    lineHeight: 23,
    fontFamily: 'Poppins-Bold',
  },
  currentAffairPortalCopy: {
    color: '#475569',
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Inter-Medium',
  },
  currentAffairPortalFooter: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  currentAffairPortalMeta: {
    color: '#94A3B8',
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
  },
  currentAffairPortalCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currentAffairPortalCtaText: {
    fontSize: 12,
    fontFamily: 'Poppins-SemiBold',
    color: '#2563EB',
  },
  whatsAppBanner: {
    marginTop: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 20,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  whatsAppBannerTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontFamily: 'Poppins-Bold',
  },
  whatsAppBannerCopy: {
    color: '#475569',
    fontSize: 12,
    lineHeight: 16,
  },
  whatsAppBannerButton: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  whatsAppBannerButtonText: {
    color: '#00D4C7',
    fontWeight: '700',
    fontSize: 12,
  },
  arenaPremiumCard: {
    marginHorizontal: 0,
    marginTop: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  arenaPremiumInner: {
    padding: 20,
    gap: 12,
  },
  arenaPremiumHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  arenaPremiumIcon: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 212, 199, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arenaPremiumTitle: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  arenaPremiumSubtitle: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    marginTop: -2,
  },
  arenaPremiumCopy: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Inter-Medium',
    color: '#475569',
  },
  arenaPremiumFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  arenaPremiumBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 212, 199, 0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  arenaPremiumBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#00D4C7',
  },
  arenaPremiumCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  arenaPremiumCtaText: {
    fontSize: 11,
    fontFamily: 'Poppins-Bold',
    color: '#00D4C7',
    letterSpacing: 0.5,
  },

  // Skeleton Loader Styles
  skeletonWrapper: {
    flex: 1,
    paddingHorizontal: 0,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 18,
  },
  skeletonHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
  },
  skeletonHeaderTiny: {
    width: 96,
    height: 11,
    borderRadius: 8,
    marginBottom: 8,
  },
  skeletonHeaderTitle: {
    width: 132,
    height: 20,
    borderRadius: 10,
  },
  skeletonIconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  skeletonXPBar: {
    width: 118,
    height: 26,
    borderRadius: 16,
  },
  skeletonQuotaRow: {
    alignItems: 'flex-end',
  },
  skeletonQuotaPill: {
    width: 150,
    height: 24,
    borderRadius: 14,
  },
  skeletonMissionCard: {
    borderRadius: 26,
    paddingVertical: 18,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    gap: 12,
    ...V2026.shadows.milky,
  },
  skeletonMissionPretitle: {
    width: 90,
    height: 10,
    borderRadius: 6,
  },
  skeletonMissionTitle: {
    width: '80%',
    height: 18,
    borderRadius: 10,
  },
  skeletonMissionMetaRow: {
    flexDirection: 'row',
    gap: 10,
  },
  skeletonMissionMetaShort: {
    width: 60,
    height: 12,
    borderRadius: 10,
  },
  skeletonMissionMetaLong: {
    width: 110,
    height: 12,
    borderRadius: 10,
  },
  skeletonMissionDesc: {
    width: '90%',
    height: 12,
    borderRadius: 8,
  },
  skeletonMissionSubtitle: {
    width: '85%',
    height: 14,
    borderRadius: 8,
  },
  skeletonMissionFooter: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  skeletonRewardChip: {
    width: 90,
    height: 32,
    borderRadius: 16,
  },
  skeletonPrimaryButton: {
    width: 150,
    height: 40,
    borderRadius: 20,
  },
  skeletonDailyCard: {
    width: '100%',
    height: 110,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  skeletonToolsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  skeletonToolCard: {
    flex: 1,
    height: 132,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  skeletonMindClash: {
    width: '100%',
    height: 170,
    borderRadius: 24,
    marginTop: -4,
    marginBottom: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  skeletonMindClashBase: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
  },
  skeletonMindClashTagWrap: {
    position: 'absolute',
    top: 16,
    left: 16,
  },
  skeletonMindClashTag: {
    width: 140,
    height: 18,
    borderRadius: 12,
  },
  skeletonMindClashButtonWrap: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
  },
  skeletonMindClashButton: {
    width: 160,
    height: 36,
    borderRadius: 999,
  },
  skeletonSectionHeader: {
    marginTop: 4,
  },
  skeletonSectionLabel: {
    width: 140,
    height: 14,
    borderRadius: 8,
  },
  skeletonTimelineWrapper: {
    gap: 20,
    paddingBottom: 40,
  },
  skeletonTimelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  skeletonTimelineGutter: {
    width: 28,
    alignItems: 'center',
  },
  skeletonTimelineNode: {
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  skeletonTimelineLine: {
    width: 1,
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginTop: 6,
    marginBottom: -6,
    alignSelf: 'center',
  },
  skeletonLessonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  skeletonLessonIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
  },
  skeletonLessonTitle: {
    width: '80%',
    height: 12,
    borderRadius: 6,
    marginBottom: 4,
  },
  skeletonLessonLine: {
    width: '60%',
    height: 10,
    borderRadius: 6,
  },
  skeletonLessonLineWide: {
    width: '72%',
    height: 10,
    borderRadius: 6,
  },
  shimmerBase: {
    backgroundColor: 'rgba(15, 23, 42, 0.06)',
    borderRadius: 14,
    overflow: 'hidden',
  },
  shimmerHighlightContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: SCREEN_WIDTH * 0.2,
  },
  arenaWrapper: {
    marginTop: 24,
    marginBottom: 32,
  },
  arenaCard: {
    borderRadius: 28,
    padding: 1.5,
    backgroundColor: 'rgba(0, 212, 199, 0.15)',
    overflow: 'hidden',
  },
  arenaInner: {
    width: '100%',
    height: 130,
    borderRadius: 20,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
    padding: 12,
  },
  arenaDarkOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  arenaEnterBtn: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  arenaEnterGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    overflow: 'hidden',
  },
  arenaEnterText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },
  arenaGlowEffect: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(0, 212, 199, 0.08)',
  },
  arenaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  arenaIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(0, 212, 199, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arenaTitle: {
    fontSize: 19,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  arenaSubtitle: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    marginTop: -2,
  },
  arenaAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  arenaActionText: {
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#00D4C7',
  },
  sectionSeparatorContainer: {
    paddingHorizontal: 40,
    marginTop: 12,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  separatorLine: {
    width: '100%',
    height: 1,
    opacity: 0.8,
  },
  v2026Header: {
    paddingHorizontal: 0,
    width: '100%',
    marginBottom: 12,
    paddingBottom: 8,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 2,
    width: '100%',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerDivider: {
    height: 0,
    width: '100%',
    backgroundColor: 'transparent',
    marginTop: 0,
  },
  headerXpWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  headerRightContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    position: 'relative',
    overflow: 'visible',
  },
  homeHeaderMascot: {
    position: 'absolute',
    top: 144,
    right: -28,
    width: 226,
    height: 166,
    zIndex: 4,
  },
  homeScrollMascotWrap: {
    position: 'absolute',
    top: 59,
    right: -46,
    width: 226,
    height: 166,
    alignItems: 'flex-end',
    zIndex: 2,
  },
  homeScrollMascot: {
    width: 226,
    height: 166,
  },
  handwaveLottie: {
    width: 38,
    height: 38,
  },
  forhomeLottie: {
    width: 48,
    height: 48,
    marginRight: -10,
  },
  skeletonContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 100,
  },
  skeletonLottie: {
    width: 250,
    height: 250,
  },
  skeletonText: {
    marginTop: 20,
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    textAlign: 'center',
  },
  avatarMini: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: '#00D4C7',
  },
  greetingText: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#334155',
    textTransform: 'uppercase',
    letterSpacing: 1,
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  userNameText: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    marginTop: -2,
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  greetingTextNight: {
    color: 'rgba(196,214,252,0.92)',
    textShadowColor: 'rgba(8,6,28,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  userNameTextNight: {
    color: '#F4F6FF',
    textShadowColor: 'rgba(8,6,28,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },

  bentoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
  },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
  },
  kuralCard: {
    width: '100%',
    borderRadius: V2026.radius.lg,
    padding: 16,
    backgroundColor: V2026.colors.surface,
    borderWidth: 1.5,
    borderColor: V2026.colors.border,
    ...V2026.shadows.milky,
    overflow: 'hidden',
  },
  kuralHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  kuralBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(148, 163, 184, 0.15)',
  },
  kuralBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#0F172A',
    letterSpacing: 0.6,
  },
  kuralNumber: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#475569',
  },
  kuralGrid: {
    gap: 6,
  },
  kuralLine: {
    fontSize: 13,
    fontFamily: 'Poppins-Medium',
    color: '#0F172A',
    letterSpacing: 0.5,
    lineHeight: 20,
  },
  kuralLinePremium: {
    fontSize: 12,
    fontFamily: 'Poppins-SemiBold',
    letterSpacing: 0.4,
    color: '#0F172A',
    textShadowColor: 'rgba(0,0,0,0.04)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 0.5,
  },
  kuralLineMuted: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    fontStyle: 'italic',
  },
  kuralFooter: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  kuralFooterText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#475569',
    textTransform: 'capitalize',
  },
  pathHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  pathTitle: {
    fontSize: 20,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  viewAllText: {
    fontSize: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#00D4C7',
  },
  pathContainer: {
    width: '100%',
    minHeight: 300,
  },
  homeFixedHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    overflow: 'hidden',
    backgroundColor: 'transparent',
    zIndex: 20,
    minHeight: 118,
    // modern curved-bottom header shape (no straight separating line)
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
  },
  // Tall, bottom-anchored element: cover then scales the composition to this
  // height (cropping sides, not the bottom), so the header window shows the
  // lowest band of the animation.
  // The composition is portrait 1080x1920. Matching its 9:16 aspect ratio
  // full-width with a top anchor means no internal crop at all — the header
  // window frames the animation's true top edge.
  headerBackgroundLottie: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    aspectRatio: 9 / 16,
  },
  homeScrollContent: {
    width: '100%',
    position: 'relative',
  },
  rankCardNew: { borderRadius: 22, overflow: 'hidden', marginTop: 22, borderBottomWidth: 3, borderBottomColor: 'rgba(79,70,229,0.16)' },
  rankCardFill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  rankMedal: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F59E0B', alignItems: 'center', justifyContent: 'center' },
  rankBadge: { width: 46, height: 46, borderRadius: 15, backgroundColor: 'rgba(79,70,229,0.12)', alignItems: 'center', justifyContent: 'center' },
  rankNumRow: { flexDirection: 'row', alignItems: 'flex-start' },
  rankHash: { fontFamily: 'Poppins-SemiBold', fontSize: 14, color: '#A5A9DE', marginTop: 5, marginRight: 1 },
  rankEyebrow: { fontFamily: 'Inter-SemiBold', fontSize: 11, letterSpacing: 0.8, color: '#8A93A8' },
  rankStateName: { fontFamily: 'Poppins-SemiBold', fontSize: 17, color: '#171A2C', marginTop: 2, letterSpacing: -0.3 },
  rankRight: { alignItems: 'flex-end' },
  rankBig: { fontFamily: 'Poppins-Bold', fontSize: 27, color: '#4F46E5', letterSpacing: -0.6 },
  rankXpNew: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: '#6B7390', marginTop: 1 },
  premiumDepthBevel: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    zIndex: 1,
  },
  rankDepthGlow: {
    position: 'absolute',
    top: -46,
    right: -24,
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(79,70,229,0.12)',
  },
  stateRankCardCompact: {
    marginHorizontal: 4,
    marginTop: 16,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
  },
  stateRankSimpleFill: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  stateRankWash: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
  },
  stateRankGlowPrimary: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    top: -68,
    right: -42,
    backgroundColor: 'rgba(14, 165, 233, 0.16)',
  },
  stateRankGlowSecondary: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    bottom: -72,
    left: -38,
    backgroundColor: 'rgba(251, 191, 36, 0.14)',
  },
  stateRankTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  stateRankLeftCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stateRankIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateRankTextContainerCompact: {
    justifyContent: 'center',
    flex: 1,
  },
  stateRankLabelCompact: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#64748B',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  stateRankTitleCompact: {
    fontSize: 18,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    marginTop: 1,
  },
  stateRankMetaCompact: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#475569',
    marginTop: 6,
    lineHeight: 17,
  },
  stateRankRightCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stateRankArrowPill: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateRankMetricsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  stateRankMetricCard: {
    flex: 1,
    minHeight: 76,
    borderRadius: 20,
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.76)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  stateRankMetricLabel: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#64748B',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  stateRankMetricValue: {
    marginTop: 8,
    fontSize: 24,
    lineHeight: 27,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  stateRankMetricUnit: {
    marginTop: 3,
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
  },
  stateRankXpCompact: {
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#00D4C7',
  },
  stateRankCta: {
    fontSize: 12,
    fontFamily: 'Poppins-SemiBold',
    color: '#00D4C7',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  stateRankSimpleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  stateRankBevelTop: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
  },
  stateRankBevelBottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 14,
    backgroundColor: 'rgba(226,232,240,0.55)',
  },
  stateRankSimpleStats: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
  },
  stateRankLabelSolid: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#64748B',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  stateRankTitleSolid: {
    marginTop: 2,
    fontSize: 17,
    lineHeight: 20,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  stateRankSimpleValue: {
    fontSize: 24,
    lineHeight: 26,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  stateRankSimpleXp: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#2563EB',
  },
  thiruEtherealContainer: {
    marginHorizontal: 8,
    marginTop: 36,
    marginBottom: 8,
    alignItems: 'center',
    position: 'relative',
  },
  thiruEtherealQuoteIcon: {
    marginBottom: 4,
    opacity: 0.6,
  },
  thiruTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  thiruTitleLeaf: {
    marginTop: 0,
  },
  thiruEtherealNumber: {
    fontSize: 10,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 0,
    lineHeight: 14,
  },
  thiruEtherealLines: {
    alignItems: 'center',
    gap: 4,
    position: 'relative',
    paddingHorizontal: 20,
    marginTop: 8,
  },
  thiruEtherealCard: {
    width: '100%',
    minHeight: 192,
    borderRadius: 30,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    overflow: 'hidden',
  },
  thiruImageBackground: {
    flex: 1,
    width: '100%',
    justifyContent: 'space-between',
  },
  thiruImageContent: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 22,
    paddingBottom: 14,
  },
  thiruImageBackgroundStyle: {
    borderRadius: 30,
    width: '100%',
    height: '100%',
  },
  thiruImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.22)',
  },
  thiruGradientTint: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
  },
  thiruBackdropBase: {
    ...StyleSheet.absoluteFillObject,
  },
  thiruBackdropOrbA: {
    position: 'absolute',
    top: -54,
    right: -34,
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(56, 189, 248, 0.18)',
  },
  thiruBackdropOrbB: {
    position: 'absolute',
    bottom: -76,
    left: -24,
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
  },
  thiruBackdropOrbC: {
    position: 'absolute',
    top: 58,
    left: '42%',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(250, 204, 21, 0.14)',
  },
  thiruBackdropGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.78,
  },
  thiruQuoteFrame: {
    width: '100%',
    minHeight: 116,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 10,
    backgroundColor: 'transparent',
    borderRadius: 0,
    borderWidth: 0,
  },
  thiruEtherealQuoteMark: {
    fontSize: 42,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    color: 'rgba(255, 255, 255, 0.42)',
    position: 'absolute',
    lineHeight: 42,
  },
  thiruQuoteMarkOpen: {
    left: 0,
    top: -4,
  },
  thiruQuoteMarkClose: {
    right: 0,
    bottom: -12,
  },
  thiruVerseBlock: {
    width: '100%',
    alignItems: 'center',
    gap: 2,
  },
  thiruEtherealText: {
    fontSize: 10.5,
    fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif',
    fontStyle: 'italic',
    color: '#FFFFFF',
    lineHeight: 14,
    textAlign: 'center',
    letterSpacing: 0,
    includeFontPadding: false,
  },
  thiruVerseLoadingText: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
    color: 'rgba(255, 255, 255, 0.82)',
    fontFamily: 'Inter-Medium',
  },
  thiruReadableContainer: {
    width: '100%',
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.12)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  thiruReadableText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    color: '#334155',
    fontFamily: 'Inter-Medium',
  },
  thiruMeaningContainer: {
    width: '100%',
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 6,
  },
  thiruMeaningLabel: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#D1FAE5',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  thiruMeaningText: {
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    color: '#FFFFFF',
    fontFamily: 'Inter-Medium',
  },
  thiruCardHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 8,
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
  },
  thiruCardHintText: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#FFFFFF',
  },
  kuralLanguageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
  },
  kuralLanguageChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  kuralLanguageChipActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderColor: 'rgba(16, 185, 129, 0.28)',
  },
  kuralLanguageText: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
  },
  kuralLanguageTextActive: {
    color: '#10B981',
  },
  kuralMeaningBox: {
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.08)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  kuralMeaningLabel: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#0F766E',
    marginBottom: 4,
  },
  kuralMeaningText: {
    marginTop: 14,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    color: '#475569',
    fontFamily: 'Inter-Medium',
  },
  toolsSection: {
    marginTop: 28,
    marginBottom: 6,
    padding: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.06)',
    backgroundColor: '#F7F7F9',
  },
  studyToolsStack: {
    marginTop: 12,
    gap: 10,
  },
  // Flat Duolingo card: white, hairline border, colour lives in the icon coin.
  toolFlatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7EEF4',
    paddingVertical: 12,
    paddingHorizontal: 13,
  },
  toolCoin: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolFlatText: { flex: 1 },
  toolFlatTitle: { fontFamily: 'Poppins-Bold', fontSize: 15, color: '#0B2540', letterSpacing: -0.2 },
  toolFlatCopy: { fontFamily: 'Inter-Regular', fontSize: 12, color: '#64748B', marginTop: 2 },
  // Modern State Rank card — a rank medallion + leaderboard CTA.
  rankCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7EEF4',
    paddingVertical: 13,
    paddingHorizontal: 13,
    marginTop: 12,
  },
  rankCoin: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
  },
  rankMid: { flex: 1 },
  rankTitle: { fontFamily: 'Poppins-Bold', fontSize: 15, color: '#0B2540', letterSpacing: -0.2 },
  rankSub: { fontFamily: 'Inter-Medium', fontSize: 12, color: '#64748B', marginTop: 2 },
  rankNum: { fontFamily: 'Poppins-Bold', fontSize: 22, letterSpacing: -0.5, color: '#0F766E' },
  // Daily goal ring — the SVG track sizes itself, so the wrapper only has to
  // centre the value that sits inside it.
  goalRingWrap: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  goalRingCenter: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  goalRingText: { fontFamily: 'Poppins-Bold', fontSize: 12, color: '#0F172A', letterSpacing: -0.3 },
  // Quick Practice horizontal carousel.
  practiceRow: { gap: 12, paddingTop: 12, paddingRight: 8 },
  practiceChip: { alignItems: 'center', width: 68, gap: 8 },
  // 3D coin: gradient fill (set inline, light top -> base) + a coloured drop
  // shadow for depth — same treatment as the header streak/XP badges.
  practiceCoin: {
    width: 58, height: 58, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  practiceLabel: { fontFamily: 'Poppins-SemiBold', fontSize: 11.5, color: '#334155', letterSpacing: -0.1 },
  studyToolsMiniRow: {
    flexDirection: 'row',
    gap: 12,
  },
  toolsHeaderRow: {
    marginBottom: 10,
  },
  toolsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  toolCard: {
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.06)',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 2,
  },
  toolCardHero: {
    width: '100%',
  },
  toolMiniCard: {
    flex: 1,
  },
  toolCardFeatured: {
    width: '100%',
  },
  toolCardStandard: {
    width: '100%',
  },
  toolHeroInnerCard: {
    minHeight: 162,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.04)',
    backgroundColor: '#FCFCFD',
  },
  toolMiniInnerCard: {
    minHeight: 138,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.04)',
    backgroundColor: '#FCFCFD',
  },
  toolInnerCard: {
    minHeight: 142,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    overflow: 'hidden',
  },
  toolInnerCardCompact: {
    minHeight: 132,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  toolSoftWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  toolGlowBlob: {
    position: 'absolute',
    width: 116,
    height: 116,
    borderRadius: 58,
    right: -22,
    top: -18,
  },
  toolFluidBlobLarge: {
    position: 'absolute',
    width: 168,
    height: 168,
    borderRadius: 84,
    top: -42,
    right: -28,
  },
  toolFluidBlobSmall: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 66,
    bottom: -28,
    left: -18,
  },
  toolFluidVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  toolBackdropGlow: {
    position: 'absolute',
    top: -30,
    right: -30,
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: 'rgba(255,255,255,0.42)',
  },
  toolTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    zIndex: 2,
  },
  toolHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toolHeroContentRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    flex: 1,
  },
  toolHeroCopyColumn: {
    flex: 1,
    justifyContent: 'space-between',
    zIndex: 2,
  },
  toolHeroImagePanel: {
    width: '100%',
    minHeight: 120,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  toolTextWrap: {
    flex: 1,
    paddingTop: 1,
  },
  toolContentRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
    flex: 1,
  },
  toolCopyColumn: {
    flex: 1.02,
    justifyContent: 'space-between',
    paddingRight: 2,
    zIndex: 2,
  },
  toolVisualColumn: {
    width: 110,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  toolImagePanel: {
    width: '100%',
    height: '100%',
    minHeight: 104,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.34)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.26)',
    overflow: 'hidden',
    justifyContent: 'flex-end',
    alignItems: 'flex-end',
  },
  toolEyebrow: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: 'rgba(15, 23, 42, 0.5)',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },
  toolCircleBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.05)',
  },
  toolCircleBadgeHero: {
    width: 42,
    height: 42,
    borderRadius: 14,
  },
  toolCardTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Poppins-Bold',
    color: '#111111',
    lineHeight: 18,
    marginTop: 0,
  },
  toolCardTitleCompact: {
    marginTop: 0,
  },
  toolCardTitleSmall: {
    fontSize: 14,
    lineHeight: 17,
    marginTop: 0,
  },
  toolCardTitleGenerate: {
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: 0,
    includeFontPadding: false,
  },
  toolHeroTitle: {
    flex: 1,
    fontSize: 17,
    lineHeight: 20,
    fontFamily: 'Poppins-Bold',
    color: '#111111',
    letterSpacing: -0.3,
  },
  toolMiniTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 17,
    fontFamily: 'Poppins-Bold',
    color: '#111111',
    letterSpacing: -0.2,
  },
  toolCardTopLine: {
    width: 42,
    height: 3,
    borderRadius: 999,
    marginBottom: 10,
    opacity: 0.95,
    backgroundColor: 'rgba(17, 17, 17, 0.9)',
  },
  toolGlassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    borderRadius: 20,
    pointerEvents: 'none',
  },
  toolMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  toolMiniMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 9,
  },
  toolPillBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(17, 24, 39, 0.05)',
  },
  toolPillBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#111111',
  },
  toolImageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    width: '100%',
    marginTop: 0,
    zIndex: 2,
  },
  toolCardImage: {
    width: '138%',
    height: 118,
    marginBottom: -8,
    marginRight: -10,
  },
  toolCardImageSmall: {
    width: '142%',
    height: 104,
    marginBottom: -8,
    marginRight: -12,
  },
  toolHeroImage: {
    width: '138%',
    height: 126,
    marginBottom: -8,
    marginRight: -14,
  },
  toolMiniImage: {
    width: '205%',
    height: 142,
    marginBottom: -24,
    marginRight: -10,
  },
  toolSubtitle: {
    fontSize: 10.5,
    fontFamily: 'Inter-SemiBold',
    color: 'rgba(17, 24, 39, 0.6)',
    lineHeight: 14,
    zIndex: 2,
    marginTop: 4,
  },
  toolSubtitleCompact: {
    marginTop: 5,
  },
  toolSubtitleSmall: {
    fontSize: 10,
    lineHeight: 13,
    marginTop: 4,
  },
  toolHeroSubtitle: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#475569',
    maxWidth: 220,
    opacity: 0.95,
  },
  toolMiniSubtitle: {
    marginTop: 6,
    fontSize: 10.8,
    lineHeight: 14,
    fontFamily: 'Inter-SemiBold',
    color: '#475569',
    opacity: 0.95,
  },
  toolActionRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  toolActionText: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  toolMiniOpenChip: {
    marginTop: 9,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    zIndex: 3,
  },
  toolMiniOpenChipText: {
    fontSize: 10,
    fontFamily: 'Poppins-SemiBold',
    color: '#FFFFFF',
  },
  toolMiniImageWrap: {
    alignItems: 'center',
    marginTop: -4,
    marginRight: 0,
  },
  toolMiniTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  toolOpenChip: {
    marginTop: 14,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255, 46, 147, 0.18)',
    backgroundColor: '#FFF4F8',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  toolOpenChipText: {
    fontSize: 11,
    fontFamily: 'Poppins-SemiBold',
    color: '#FFFFFF',
  },
  toolTitleSpacer: {
    width: 44,
    height: 44,
  },
  toolWrapper: {
    marginBottom: 0,
  },
  toolsSeparatorLineWrapper: {
    marginTop: 8,
    marginHorizontal: 4,
  },
  toolsSeparatorLine: {
    height: 1,
    borderRadius: 1,
  },
  v2026Celebration: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    zIndex: 10000,
    justifyContent: 'center',
    alignItems: 'center',
  },
  celebrationTextV2: {
    fontSize: 28,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    marginTop: 20,
  },
  celebrationXPV2: {
    fontSize: 20,
    fontFamily: 'Poppins-Bold',
    color: '#FFD76F',
    marginTop: 8,
  },
  // Enhanced Mission Card Styles
  // V2026 SEXY MISSION CARD STYLES
  proCardContainer: {
    width: '100%',
    borderRadius: 28,
    padding: 0,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  proCardGlowBorder: {
    position: 'absolute',
    width: '300%',
    height: '300%',
    top: '-100%',
    left: '-100%',
  },
  proMeshOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.35,
  },
  meshOrb1: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#1695fd', // from mind2025 theme
    top: -40,
    left: -30,
  },
  meshOrb2: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: '#023480', // from mind2025 theme
    bottom: -60,
    right: -30,
  },
  proContent: {
    borderRadius: 26,
    padding: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    flexDirection: 'column',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.6)',
  },
  proHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  proMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 8,
  },
  proDayPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  proDayText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
  },
  proPhaseText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
  },
  proTitle: {
    fontSize: 17,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    lineHeight: 22,
  },
  proDescription: {
    fontSize: 13,
    fontFamily: 'Inter-SemiBold',
    color: '#475569',
    lineHeight: 19,
    marginTop: 8,
  },
  timerBadgeV2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(244, 63, 94, 0.05)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.1)',
  },
  timerText: {
    fontSize: 12,
    fontFamily: 'Poppins-SemiBold',
    color: '#F43F5E',
  },
  proFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0, 0, 0, 0.04)',
    marginTop: 6,
  },
  rewardValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 212, 199, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  rewardText: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#0D9488',
  },
  missionActionButton: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...V2026.shadows.milky,
  },
  missionActionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
  },
  ambientGlow: {
    position: 'absolute',
    top: -SCREEN_WIDTH * 0.4,
    left: -SCREEN_WIDTH * 0.2,
    width: SCREEN_WIDTH * 1.2,
    height: SCREEN_WIDTH * 1.2,
    backgroundColor: '#E0F2FE',
    borderRadius: SCREEN_WIDTH,
    opacity: 0.12,
  },
  ambientGlowSecondary: {
    position: 'absolute',
    bottom: -SCREEN_WIDTH * 0.4,
    right: -SCREEN_WIDTH * 0.2,
    width: SCREEN_WIDTH * 1.0,
    height: SCREEN_WIDTH * 1.0,
    backgroundColor: '#FDE68A',
    borderRadius: SCREEN_WIDTH,
    opacity: 0.08,
  },
  particlesContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
  },
  particle: {
    position: 'absolute',
    borderRadius: 999,
  },
  proCardBackgroundWash: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.55,
  },
  proTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  proTopicTag: {
    color: '#5F6368',
    fontSize: 8.5,
    fontFamily: 'Poppins-Bold',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  proDayBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  proDayBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
  },
  proLockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F3F4',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  proLockBadgeText: {
    fontSize: 10,
    fontFamily: 'Poppins-Medium',
    color: '#5F6368',
  },
  proProgressBarContainer: {
    flexDirection: 'row',
    gap: 6,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    marginVertical: 4,
  },
  proProgressSegment: {
    flex: 1,
    height: '100%',
    borderRadius: 2,
  },
  proDivider: {
    height: 1,
    backgroundColor: '#EEF2F7',
    marginVertical: 3,
  },
  missionActionButtonGlowWrap: {
    position: 'relative',
    borderRadius: 100,
    overflow: 'hidden',
    padding: 2,
  },
  missionActionButtonGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 100,
    opacity: 0.88,
    overflow: 'hidden',
  },
  missionActionButtonGlowFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '220%',
    borderRadius: 100,
    opacity: 1,
  },
  missionActionButtonGlowInner: {
    position: 'absolute',
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    borderRadius: 98,
    backgroundColor: '#1F2023',
  },
  missionActionButtonLocked: {
    backgroundColor: '#F1F3F4',
    borderWidth: 1,
    borderColor: '#E8EAED',
  },
  missionActionButtonTextLocked: {
    color: '#9AA0A6',
  },
  proAccentBar: {
    width: 18,
    height: 3,
    borderRadius: 999,
    backgroundColor: '#D1D5DB',
    marginBottom: 5,
  },
  // ── Daily Dose card (Google 2026 expressive) ──────────────────────────────
  ddCard: {
    width: '100%',
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E7EEF4',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    position: 'relative',
  },
  ddCornerGlow: {
    position: 'absolute',
    top: -50,
    right: -50,
    width: 150,
    height: 150,
    borderRadius: 75,
  },
  ddGeminiWash: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
  },
  ddDepthGlow: {
    position: 'absolute',
    top: -58,
    left: -34,
    width: 190,
    height: 190,
    borderRadius: 95,
    backgroundColor: 'rgba(14,165,233,0.16)',
  },
  ddDepthBevel: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 26,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    zIndex: 1,
  },
  ddRail: {
    width: 5,
  },
  ddBody: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 13,
    gap: 10,
    backgroundColor: 'transparent',
  },
  ddCopyColumn: {
    flex: 1,
    gap: 8,
  },
  ddBackgroundImage: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
  ddDecorWrap: {
    position: 'absolute',
    top: 5,
    right: 6,
    width: 76,
    height: 76,
    zIndex: 3,
  },
  ddDecor: {
    width: '100%',
    height: '100%',
  },
  ddTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ddKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ddKickerDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  ddKicker: {
    fontFamily: 'Poppins-Bold',
    fontSize: 10,
    color: '#334155',
    letterSpacing: 1.3,
  },
  ddTimePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  ddTimePillText: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 11,
    color: '#334155',
  },
  ddDayPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.90)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  ddDayText: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 11,
  },
  ddTitle: {
    fontFamily: 'Poppins-Bold',
    fontSize: 19,
    lineHeight: 25,
    color: '#0F172A',
    letterSpacing: -0.3,
    paddingRight: 64,
  },
  ddProgressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  ddProgressBlock: {
    gap: 6,
  },
  ddPhaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ddPhaseWord: {
    fontFamily: 'Poppins-Bold',
    fontSize: 10,
    letterSpacing: 1.4,
    color: '#94A3B8',
  },
  ddPhaseCount: {
    fontFamily: 'Poppins-Bold',
    fontSize: 12.5,
    fontVariant: ['tabular-nums'],
  },
  ddPhaseTotal: {
    color: '#94A3B8',
  },
  ddTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#EDF1F6',
    overflow: 'hidden',
  },
  ddTrackFill: {
    height: '100%',
    borderRadius: 999,
  },
  ddProgressLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 11,
    color: '#475569',
  },
  ddFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  ddXpBadge: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#FFF6E9',
  },
  ddXpBolt: {
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F59E0B',
  },
  ddXpText: {
    fontFamily: 'Poppins-Bold',
    fontSize: 12.5,
    color: '#B45309',
    letterSpacing: -0.2,
  },
  ddEmblem: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
  },
  ddStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 14,
  },
  // Duolingo-style depth: a darker bottom edge, not a shadow.
  ddStartBtnRaised: {
    borderBottomWidth: 3,
    borderBottomColor: 'rgba(0,0,0,0.16)',
  },
  ddStartText: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  ddStartTextLocked: {
    color: '#94A3B8',
  },
  // ── end Daily Dose card ────────────────────────────────────────────────────

  // ── Header avatar + bell ──────────────────────────────────────────────────
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#00D4C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  headerAvatarNight: {
    backgroundColor: 'rgba(0,212,199,0.28)',
    borderWidth: 1.5,
    borderColor: '#00D4C7',
  },
  headerAvatarText: {
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  headerBellBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(100,116,139,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  headerBellBtnNight: {
    backgroundColor: 'rgba(165,200,240,0.12)',
  },

  // ── Section label ─────────────────────────────────────────────────────────
  newSectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 10,
  },
  newSectionAccent: {
    width: 3,
    height: 14,
    borderRadius: 2,
    backgroundColor: '#00D4C7',
    marginRight: 8,
  },
  newSectionTitle: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    flex: 1,
  },
  newSectionSeeAll: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#00D4C7',
  },

  // ── Hero strip ────────────────────────────────────────────────────────────
  heroStrip: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
    marginTop: 4,
  },
  heroStripNight: {
    backgroundColor: '#111827',
    borderColor: 'rgba(255,255,255,0.06)',
  },
  weekDotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weekDotCol: {
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  weekDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(15,23,42,0.1)',
  },
  weekDotDone: {
    backgroundColor: '#00D4C7',
  },
  weekDotToday: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#00D4C7',
    backgroundColor: '#FFFFFF',
  },
  weekDotLabel: {
    fontSize: 9,
    fontFamily: 'Inter-SemiBold',
    color: '#94A3B8',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  weekDotLabelToday: {
    color: '#00D4C7',
  },
  heroStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  heroStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  heroStatDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(15,23,42,0.08)',
    marginHorizontal: 12,
  },
  heroStatNum: {
    fontSize: 18,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  heroStatLabel: {
    fontSize: 11,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
  },

  // ── Subject chips ─────────────────────────────────────────────────────────
  subjectChipsScroll: {
    marginTop: 12,
  },
  subjectChipsContent: {
    paddingHorizontal: 2,
    gap: 8,
    flexDirection: 'row',
  },
  subjectChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.05)',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  subjectChipActive: {
    backgroundColor: 'rgba(0,212,199,0.1)',
    borderColor: '#00D4C7',
  },
  subjectChipText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
  },
  subjectChipTextActive: {
    color: '#00D4C7',
  },

  // ── Quick launch ──────────────────────────────────────────────────────────
  quickLaunchScroll: {
    marginTop: 2,
  },
  quickLaunchContent: {
    paddingHorizontal: 2,
    gap: 12,
    flexDirection: 'row',
    paddingBottom: 4,
  },
  quickModeItem: {
    alignItems: 'center',
    gap: 6,
    width: 64,
  },
  quickModeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  quickModeLabel: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#475569',
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  // ── Bento tool layout ──────────────────────────────────────────────────────
  bentoToolRow: {
    flexDirection: 'row',
    gap: 12,
  },
  bentoToolHalf: {
    flex: 1,
  },

  // ── Leaderboard teaser ────────────────────────────────────────────────────
  leaderTeaserCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,212,199,0.18)',
    overflow: 'hidden',
    padding: 16,
    gap: 12,
    marginTop: 4,
  },
  leaderTeaserTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leaderTeaserLeft: {
    flex: 1,
    gap: 4,
  },
  leaderTeaserState: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  leaderRankBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  leaderRankHash: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#00D4C7',
  },
  leaderRankNum: {
    fontSize: 32,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    lineHeight: 36,
  },
  leaderRankLabel: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    marginLeft: 4,
  },
  leaderXPText: {
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#94A3B8',
  },
  leaderPodiumWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 0,
    paddingRight: 8,
  },
  leaderPodiumBar: {
    width: 18,
    borderRadius: 4,
  },
  leaderTeaserFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  leaderChallengeText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#00D4C7',
  },

  // ── GyanClash banner ──────────────────────────────────────────────────────
  clashBannerCard: {
    borderRadius: 20,
    overflow: 'hidden',
    padding: 18,
    marginTop: 12,
  },
  clashBannerGlow: {
    position: 'absolute',
    top: -40,
    right: -20,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(0,212,199,0.12)',
  },
  clashBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  clashBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  clashBannerIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: 'rgba(0,212,199,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clashBannerTitle: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
  },
  clashBannerSub: {
    fontSize: 11,
    fontFamily: 'Inter-Medium',
    color: 'rgba(255,255,255,0.6)',
    marginTop: 1,
  },
  clashBannerCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
  },
  clashBannerCtaText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.8,
  },

  // ── Floating challenge button ─────────────────────────────────────────────
  floatingClashBtn: {
    position: 'absolute',
    right: 20,
    zIndex: 50,
  },
  floatingClashInner: {
    borderRadius: 24,
    overflow: 'hidden',
  },
  floatingClashGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 24,
  },
  floatingClashText: {
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
  },
});

interface UserProgressData {
  completedLessons: string[];
  currentUnit: number;
  currentLesson: string;
  totalXP: number;
  streak: number;
  dailyDoseCompleted: boolean;
  dailySnackCompleted: boolean;
  lastSeen: string;
  unlockedUnits: number[];
}

interface FlyingXPItem {
  id: number;
  amount: number;
  startPosition: { x: number; y: number };
}

interface PathLesson {
  id: string;
  title: string;
  subtitle: string;
  topicTitle: string;
  topicId: string;
  description: string;
  xp: number;
  completed: boolean;
  current: boolean;
  locked: boolean;
  status: string;
  unit: number;
  section: number;
  topicColor: string;
  topicSubject: string;
  route: string;
  priority: number;
  isChest: boolean;
  topicIndex: number;
  lessonIndexInTopic: number;
  isFirstInTopic: boolean;
  isLastInTopic: boolean;
  subtopicId?: string;
}

const ShimmerBlock = ({ style }: { style?: StyleProp<ViewStyle> }) => {
  const shimmerValue = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmerValue, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    loop.start();
    return () => loop.stop();
  }, [shimmerValue]);

  const translateX = shimmerValue.interpolate({
    inputRange: [0, 1],
    outputRange: [-SCREEN_WIDTH, SCREEN_WIDTH],
  });

  return (
    <View style={[styles.shimmerBase, style]}>
      <Animated.View
        style={[
          styles.shimmerHighlightContainer,
          {
            transform: [{ translateX }],
          },
        ]}
      >
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.45)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
};

const cleanMissionTitle = (title?: string) => {
  const value = String(title || '').replace(/\s+/g, ' ').trim();
  return value.replace(/\s*\((?:Days?|Day)\s+\d+\s*(?:[-–]\s*\d+)?\)\s*$/i, '').trim();
};

const CompactTopicCard = ({
  lesson,
  locked,
  onStart,
  isLoading,
  progressPhase
}: {
  lesson: any,
  locked: boolean,
  onStart: (lesson: any) => void,
  isLoading?: boolean,
  progressPhase?: number
}) => {
  if (isLoading) {
    return (
      <View style={styles.ddCard}>
        <View style={{ padding: 18, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <ShimmerBlock style={{ width: 84, height: 16, borderRadius: 8 }} />
            <ShimmerBlock style={{ width: 54, height: 16, borderRadius: 8 }} />
          </View>
          <ShimmerBlock style={{ width: '72%', height: 22, borderRadius: 6, marginTop: 4 }} />
          <ShimmerBlock style={{ width: '50%', height: 14, borderRadius: 5 }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
            <ShimmerBlock style={{ width: 72, height: 30, borderRadius: 999 }} />
            <ShimmerBlock style={{ width: 100, height: 36, borderRadius: 999 }} />
          </View>
        </View>
      </View>
    );
  }

  const accentColor = lesson?.topicColor || '#6366F1';
  const displayTitle = cleanMissionTitle(lesson?.title || 'Daily Lesson');
  const subtitle = lesson?.subtitle || '';
  const subtitleParts = subtitle.split(/[•·]/).map((p: string) => p.trim()).filter(Boolean);
  const missionDayMeta = subtitleParts[0] || 'Daily Lesson';
  const visiblePhase   = Math.min(4, Math.max(1, progressPhase || 1));

  return (
    <View style={styles.ddCard}>
      {/* Soft solid accent tint */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: accentColor, opacity: 0.05 }]} />

      {/* HTML5 Liquid Flowing Wave Engine Matched to Homepage Theme (Teal -> Emerald -> Sky Cyan -> Indigo) */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 75, overflow: 'hidden', borderTopLeftRadius: 18, borderTopRightRadius: 18 }} pointerEvents="none">
        <WebView
          source={{ html: LIQUID_CANVAS_HTML }}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          style={{ width: '100%', height: 75, backgroundColor: 'transparent' }}
          containerStyle={{ backgroundColor: 'transparent' }}
          androidLayerType="hardware"
        />
        {/* Vertical Glass Fade into Card Body */}
        <LinearGradient
          colors={['transparent', 'rgba(255, 255, 255, 0.40)', '#FFFFFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={{ ...StyleSheet.absoluteFillObject }}
          pointerEvents="none"
        />
      </View>

      {/* Card body */}
      <View style={styles.ddBody}>
        <View style={styles.ddCopyColumn}>

          {/* ── Top row: emblem + kicker + day ── */}
          <View style={styles.ddTopRow}>
            <View style={styles.ddKickerRow}>
              <View style={[styles.ddEmblem, { backgroundColor: accentColor }]}>
                <Ionicons name="book" size={14} color="#FFFFFF" />
              </View>
              <Text style={styles.ddKicker}>DAILY DOSE</Text>
            </View>
            {locked ? (
              <MissionCountdownPill />
          ) : (
            <View style={[styles.ddDayPill, { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: `${accentColor}33`, zIndex: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 }]}>
              <Text style={[styles.ddDayText, { color: '#0F766E', fontFamily: 'Poppins-Bold', fontSize: 11 }]}>{missionDayMeta}</Text>
            </View>
          )}
        </View>

          {/* ── Title ── */}
          <Text style={styles.ddTitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.82}>
            {locked ? 'Upcoming Lesson' : displayTitle}
          </Text>

          {/* ── Phase progress ── */}
          {!locked && (
            <View style={styles.ddProgressBlock}>
              <View style={styles.ddPhaseRow}>
                <Text style={styles.ddPhaseWord}>PHASE</Text>
                <Text style={styles.ddPhaseCount}>
                  <Text style={{ color: accentColor }}>{visiblePhase}</Text>
                  <Text style={styles.ddPhaseTotal}> / 4</Text>
                </Text>
              </View>
              <View style={styles.ddTrack}>
                <MotiView
                  animate={{ width: `${(visiblePhase / 4) * 100}%` }}
                  transition={{ type: 'spring', damping: 20, stiffness: 180 }}
                  style={[styles.ddTrackFill, { backgroundColor: accentColor }]}
                />
              </View>
            </View>
          )}
        </View>

        {/* ── Footer ── */}
        <View style={styles.ddFooter}>
          <View style={styles.ddXpBadge}>
            <Text style={styles.ddXpText}>{lesson?.xp || 50} XP</Text>
          </View>
          <PressableScale
            disabled={locked}
            onPress={() => onStart(lesson)}
            style={[
              styles.ddStartBtn,
              { backgroundColor: locked ? '#E2E8F0' : accentColor },
              !locked && styles.ddStartBtnRaised,
            ]}
          >
            <Text style={[styles.ddStartText, locked && styles.ddStartTextLocked]}>
              {locked ? 'Locked' : 'Continue'}
            </Text>
            <Ionicons
              name={locked ? 'lock-closed' : 'arrow-forward'}
              size={14}
              color={locked ? '#94A3B8' : '#FFFFFF'}
            />
          </PressableScale>
        </View>
      </View>
    </View>
  );
};

const HomeSkeleton = () => (
  <View style={styles.skeletonWrapper}>
    <View style={styles.skeletonHeaderRow}>
      <View>
        <ShimmerBlock style={styles.skeletonHeaderTiny} />
        <ShimmerBlock style={styles.skeletonHeaderTitle} />
      </View>
      <ShimmerBlock style={styles.skeletonXPBar} />
    </View>

    <ShimmerBlock style={styles.skeletonSectionLabel} />
    <View style={styles.skeletonMissionCard}>
      <ShimmerBlock style={styles.skeletonMissionPretitle} />
      <ShimmerBlock style={styles.skeletonMissionTitle} />
      <View style={styles.skeletonMissionMetaRow}>
        <ShimmerBlock style={styles.skeletonMissionMetaShort} />
        <ShimmerBlock style={styles.skeletonMissionMetaLong} />
      </View>
      <ShimmerBlock style={styles.skeletonMissionDesc} />
      <ShimmerBlock style={styles.skeletonMissionSubtitle} />
      <View style={styles.skeletonMissionFooter}>
        <ShimmerBlock style={styles.skeletonRewardChip} />
        <ShimmerBlock style={styles.skeletonPrimaryButton} />
      </View>
    </View>

    <ShimmerBlock style={styles.skeletonSectionLabel} />
    <View style={styles.skeletonToolsGrid}>
      <ShimmerBlock style={styles.skeletonToolCard} />
      <ShimmerBlock style={styles.skeletonToolCard} />
    </View>

    <ShimmerBlock style={styles.skeletonDailyCard} />
    <ShimmerBlock style={styles.skeletonSectionLabel} />
    <View style={styles.skeletonTimelineWrapper}>
      {[0, 1, 2].map((i) => (
        <View key={`sk-row-${i}`} style={styles.skeletonTimelineRow}>
          <View style={styles.skeletonTimelineGutter}>
            <ShimmerBlock style={styles.skeletonTimelineNode} />
            {i < 2 && <View style={styles.skeletonTimelineLine} />}
          </View>
          <View style={{ flex: 1 }}>
            <View style={styles.skeletonLessonHeader}>
              <ShimmerBlock style={styles.skeletonLessonIcon} />
              <View style={{ flex: 1 }}>
                <ShimmerBlock style={styles.skeletonLessonTitle} />
                <ShimmerBlock style={styles.skeletonLessonLine} />
              </View>
            </View>
            <ShimmerBlock style={styles.skeletonLessonLineWide} />
          </View>
        </View>
      ))}
    </View>
  </View>
);

// Global cache to prevent skeleton on tab switch
let globalExamTopicsCache: any[] = [];
let globalInitialLoadingFinished = false;

const getTimeGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good Morning';
  if (hour < 17) return 'Good Afternoon';
  return 'Good Evening';
};

// Self-ticking countdown pill: the 1s tick is isolated here so the rest of the
// home screen never re-renders on a timer.
const MissionCountdownPill = () => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <View style={styles.ddTimePill}>
      <Ionicons name="time-outline" size={11} color="#64748B" />
      <Text style={styles.ddTimePillText}>{getMissionCountdown(new Date(now)) || 'Tomorrow'}</Text>
    </View>
  );
};

const DAILY_XP_GOAL = 100;

// Duolingo-style daily goal ring: fills with XP earned today, check when done.
const DailyGoalRing = ({ earned, goal }: { earned: number; goal: number }) => {
  const size = 38;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(1, goal > 0 ? earned / goal : 0);
  const done = progress >= 1;
  return (
    <View style={styles.goalRingWrap}>
      <Svg width={size} height={size}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#E2E8F0"
          strokeWidth={stroke}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={done ? '#48C586' : '#00D4C7'}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={circumference * (1 - progress)}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <View style={styles.goalRingCenter}>
        {done ? (
          <Ionicons name="checkmark" size={15} color="#48C586" />
        ) : (
          <Text style={styles.goalRingText}>{Math.max(0, Math.round(earned))}</Text>
        )}
      </View>
    </View>
  );
};

export function MindGainsHomePage({ showLearningPath = false }: MindGainsHomePageProps) {
  const router = useRouter();
  const { user } = useAuthContext();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams();

  // Check if this is the first visit to streak page today
  const checkFirstStreakPageVisitToday = async () => {
    try {
      const today = new Date().toDateString();
      const lastVisit = await AsyncStorage.getItem('lastStreakPageVisit');

      return !lastVisit || lastVisit !== today;
    } catch (error) {
      return true; // Default to showing if error
    }
  };

  // Play daystreak sound
  const playDaystreakSound = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('@/assets/sounds/daystreak.mp3')
      );
      await sound.playAsync();
      // Unload sound from memory after playing
      setTimeout(() => {
        sound.unloadAsync();
      }, 3000);
    } catch (error) {
      console.log('Error playing daystreak sound:', error);
    }
  };

  const playLessonCelebrationSound = async () => {
    try {
      const { sound } = await Audio.Sound.createAsync(
        require('@/assets/sounds/xpcollect.mp3')
      );
      await sound.playAsync();
      await sound.unloadAsync();
    } catch (error) {
      console.log('Error playing lesson celebration sound:', error);
    }
  };

  // animations
  const scrollY = useRef(new Animated.Value(0)).current;

  // state
  const [refreshing, setRefreshing] = useState(false);
  const [dailyXP, setDailyXP] = useState(0);

  const [missionSummary, setMissionSummary] = useState({
    dayNumber: 1,
    title: 'Daily Lesson',
    progressPhase: 1,
    locked: false,
    loading: true,
  });
  const [stateRankSnapshot, setStateRankSnapshot] = useState<{
    state: string;
    rank: number;
    xp: number;
  } | null>(null);
  const [selectedKuralLanguage, setSelectedKuralLanguage] = useState<KuralLanguage>('ta');

  const loadDailyXP = useCallback(async () => {
    if (!user?.id) return;
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const { data, error } = await supabase
        .from('user_transactions')
        .select('amount')
        .eq('user_id', user.id)
        .eq('currency_type', 'xp')
        .gte('created_at', startOfDay.toISOString());
      if (error) throw error;
      const sum = (data || []).reduce((acc: number, row: any) => acc + (Number(row.amount) || 0), 0);
      setDailyXP(sum);
    } catch (e) {
      console.warn('Failed to load daily XP:', e);
    }
  }, [user?.id]);

  useEffect(() => {
    let isMounted = true;
    const loadDailyMission = async () => {
      if (!user?.id) return;
      setMissionSummary((prev) => ({ ...prev, loading: true }));
      const protocolRow = await getUserProtocol(user.id);
      const synced = await syncProtocolForToday(user.id, protocolRow);
      if (!isMounted) return;
      if (!synced.protocol) {
        setMissionSummary((prev) => ({ ...prev, loading: false, locked: true }));
        return;
      }
      if (synced.locked) {
        setMissionSummary({
          dayNumber: synced.protocol.current_day_number || 1,
          title: 'Daily Lesson',
          progressPhase: synced.protocol.progress_phase || 1,
          locked: true,
          loading: false,
        });
        return;
      }
      const { payload, topicTitle } = await getMissionPayload(
        synced.protocol.track_id,
        synced.protocol.current_day_number
      );
      if (!isMounted) return;
      setMissionSummary({
        dayNumber: synced.protocol.current_day_number || 1,
        title: topicTitle || payload?.topic_title || 'Daily Lesson',
        progressPhase: synced.protocol.progress_phase || 1,
        locked: false,
        loading: false,
      });
    };
    loadDailyMission();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  // Use real database stats for MG tokens and streak
  const { userStats, totalMGTokens, currentStreak: dbStreak, refreshStats, loading: statsLoading } = useUserStats();

  const [currentXP, setCurrentXP] = useState(() => {
    // Initialize from cached data if available
    if (!user?.id) return 0;
    // You could expand this to check cached progress data
    return 0;
  });
  const [currentStreak, setCurrentStreak] = useState(() => {
    if (!user?.id) return 0;
    const cached = StreakCache.getCachedStreakSync ? StreakCache.getCachedStreakSync() : null;
    return cached?.userId === user.id ? cached.currentStreak : 0;
  });

  // Update currentXP from database MG tokens
  useEffect(() => {
    if (totalMGTokens !== undefined && totalMGTokens > 0) {
      setCurrentXP(totalMGTokens);
    }
  }, [totalMGTokens, dbStreak, userStats, statsLoading]);

  // Initialize user data on mount
  useEffect(() => {
    const initializeUser = async () => {
      if (user?.id) {
        try {
          await RewardService.initializeUserData();
          loadDailyXP();
        } catch (error) {
          console.error('Error initializing user data:', error);
        }
      }
    };

    initializeUser();
  }, [user?.id]);

  const [userProgress, setUserProgress] = useState<UserProgressData>({
    completedLessons: [],
    currentUnit: 1,
    currentLesson: 'daily-dose',
    totalXP: 0,
    streak: 0,
    dailyDoseCompleted: false,
    dailySnackCompleted: false,
    lastSeen: new Date().toDateString(),
    unlockedUnits: [1],
  });

  const [streakModalVisible, setStreakModalVisible] = useState(false);
  const [streakModalMode, setStreakModalMode] = useState<DayStreakMode>('prompt');
  const [streakStatus, setStreakStatus] = useState({
    currentStreak: 0,
    hasDailyDose: false,
    hasDailySnack: false,
    hasRegisteredToday: false,
  });

  // State for Supabase topics
  const [examTopics, setExamTopics] = useState<DatabaseTopic[]>(globalExamTopicsCache);
  const [topicsCache, setTopicsCache] = useState<{ data: DatabaseTopic[]; timestamp: number } | null>(
    globalExamTopicsCache.length > 0 ? { data: globalExamTopicsCache, timestamp: Date.now() } : null
  );

  const [streakLoading, setStreakLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(!globalInitialLoadingFinished);
  const [showKuralMeaning, setShowKuralMeaning] = useState(false);
  const flipAnim = useRef(new Animated.Value(0)).current;

  const isTester = user?.email === 'ragularvind84@gmail.com' || user?.id === '8a78b8d6-0764-46c8-af3f-68f9cb371a63';

  // Initial load without blocking UI
  useEffect(() => {
    if (user?.id && examTopics.length === 0) {
      // Load data in background without showing loader
      loadTopicsFromSupabase().catch(console.error);
      loadUserData().catch(console.error);
    }
  }, [user?.id]);

  const pathLessons = useMemo<PathLesson[]>(() => {
    const flatItems = [];
    let globalIndex = 0;

    examTopics.forEach((topic, topicIndex) => {
      // Track topic start for proper grouping
      const topicStartIndex = flatItems.length;

      // Use lessons directly from database instead of subtopics
      const lessons = topic.lessons || [];

      // Create lessons from database lessons
      lessons.forEach((lesson, lessonIndex) => {
        const lessonId = lesson.id; // Use real lesson UUID

        // Determine lesson status based on user progress
        const isCompleted = userProgress.completedLessons.includes(lessonId);

        // Current lesson logic: first non-completed lesson
        const completedCount = userProgress.completedLessons.length;
        const isCurrent = !isCompleted && (globalIndex === completedCount);

        // If no lessons completed, first lesson is current
        const isCurrentFirstLesson = completedCount === 0 && globalIndex === 0;
        const finalIsCurrent = isCurrent || isCurrentFirstLesson;

        // MASTER UNLOCK for Admin/Tester: ragularvind84@gmail.com
        const isLocked = !isCompleted && !finalIsCurrent && !isTester;

        const statusValue = isCompleted ? 'completed' : (finalIsCurrent ? 'current' : (isTester ? 'current' : 'locked'));

        flatItems.push({
          id: lessonId,
          title: lesson.title,
          subtitle: lesson.subtitle || topic.name,
          topicTitle: topic.name,
          topicId: topic.id,
          description: lesson.description || 'Learn important concepts step by step',
          xp: lesson.xp_reward || 10,
          completed: isCompleted,
          current: finalIsCurrent || (isTester && !isCompleted),
          locked: isLocked,
          status: statusValue,
          unit: Math.floor(topicIndex / 10) + 1,
          section: lessonIndex + 1,
          topicColor: '#00D4C7',
          topicSubject: topic.subject?.name || 'General Studies',
          route: '/study/reading-interface',
          priority: topicIndex + 1,
          isChest: false,
          // Topic grouping info for LearningPathNoSvg
          topicIndex,
          lessonIndexInTopic: lessonIndex,
          isFirstInTopic: lessonIndex === 0,
          isLastInTopic: lessonIndex === lessons.length - 1,
        });
        globalIndex++;
      });

    });
    if (flatItems.length === 0) {
      flatItems.push({
        id: 'placeholder',
        title: 'No lessons yet',
        subtitle: 'Create your first topic',
        topicTitle: 'General',
        topicId: 'none',
        description: 'Create your first topic to start learning',
        xp: 0,
        completed: false,
        current: true,
        locked: false,
        status: 'locked',
        unit: 1,
        section: 1,
        topicColor: '#00D4C7',
        topicSubject: 'General',
        route: '',
        priority: 0,
        isChest: false,
        topicIndex: 0,
        lessonIndexInTopic: 0,
        isFirstInTopic: true,
        isLastInTopic: true,
      });
    }
    return flatItems;
  }, [examTopics, userProgress]);

  const currentLesson = pathLessons.find(l => l.status === 'current') || pathLessons[0] || null;
  const isMissionFinished = useMemo(() => missionSummary.progressPhase > 4, [missionSummary.progressPhase]);
  const missionLocked = missionSummary.locked || isMissionFinished;

  const missionLessonCard = useMemo<PathLesson>(() => ({
    id: 'daily-mission',
    title: missionSummary.loading ? 'Loading...' : (cleanMissionTitle(missionSummary.title) || "Today's Lesson"),
    subtitle: missionLocked
      ? (isMissionFinished ? 'Complete' : 'Unlocks at 6:00 PM')
      : `Day ${missionSummary.dayNumber}`,
    topicTitle: 'Daily Lesson',
    topicId: 'daily-mission',
    description: '',
    xp: 50,
    completed: false,
    current: true,
    locked: missionLocked,
    status: 'current',
    unit: 1,
    section: 1,
    topicColor: '#00D4C7',
    topicSubject: 'Daily Lesson',
    route: '/daily-mission',
    priority: 0,
    isChest: false,
    topicIndex: 0,
    lessonIndexInTopic: 0,
    isFirstInTopic: true,
    isLastInTopic: true,
  }), [missionSummary, missionLocked, isMissionFinished]);

  const skipNextLoadRef = useRef(false);
  const lastLoadTime = useRef(0);
  // Long enough that ordinary tab-hopping never refetches. Anything that
  // genuinely changes the home data (finishing a lesson) sets skipNextLoadRef
  // and forces a reload regardless, so a short window buys nothing but flicker.
  const CACHE_DURATION = 5 * 60 * 1000;

  // Mark the arrival animation spent once the first paint is done.
  useEffect(() => { homeIntroPlayed = true; }, []);

  // load user data on focus and user change - with smart caching
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const timeSinceLastLoad = now - lastLoadTime.current;

      // Force reload if lesson was just completed
      if (skipNextLoadRef.current) {
        skipNextLoadRef.current = false;
        lastLoadTime.current = now;
        loadUserData();
        loadTopicsFromSupabase();
        return;
      }

      // Skip if recently loaded (within cache duration)
      if (timeSinceLastLoad < CACHE_DURATION) {
        return;
      }

      lastLoadTime.current = now;
      loadUserData();
      loadTopicsFromSupabase();
    }, [user?.id])
  );
  const loadUserData = async () => {
    try {
      if (!user?.id) return;

      // Load progress data from database
      const progress = await LearningProgressService.getUserProgress(user.id);
      if (progress) {
        setUserProgress(progress);
        setCurrentXP(progress.totalXP || 0);

        // Also refresh the user stats hook to get latest data
        await refreshStats();

        // Update streak if different
        if (progress.streak !== undefined && progress.streak !== currentStreak) {
          setCurrentStreak(progress.streak);
          if (user.id && progress.streak > 0 && StreakCache.cacheStreakData) {
            await StreakCache.cacheStreakData(user.id, {
              currentStreak: progress.streak,
              longestStreak: progress.streak,
              lastActivityDate: new Date().toISOString().split('T')[0],
            });
          }
        }
      }

      // Update daily streak on app entry (first time today)
      if (user?.id) {
        const newStreak = await StreakService.updateStreakOnAppEntry(user.id);
        setCurrentStreak(newStreak);

        // First open of the day with an active streak: celebrate in place
        // (Duolingo-style) instead of hijacking the user to another tab.
        if (newStreak > 0) {
          const isFirstVisit = await checkFirstStreakPageVisitToday();
          if (isFirstVisit) {
            try {
              await AsyncStorage.setItem('lastStreakPageVisit', new Date().toDateString());
            } catch {}
            playDaystreakSound();
            setStreakModalMode('celebration');
            setStreakModalVisible(true);
          }
        }
      }

      // Also refresh streak status to get latest data
      await refreshStreakStatus();

    } catch (err) {
      console.warn('loadUserData error', err);
    }
  };

  // Track if celebration has been triggered to prevent infinite loop
  const celebrationTriggeredRef = useRef(false);

  // Check for celebration trigger from lesson completion - ONLY ONCE
  useEffect(() => {
    const showCelebrationParam = Array.isArray(params.showCelebration)
      ? params.showCelebration[0]
      : params.showCelebration;
    const xpEarnedParam = Array.isArray(params.xpEarned)
      ? params.xpEarned[0]
      : params.xpEarned;
    const messageParam = Array.isArray(params.celebrationMessage)
      ? params.celebrationMessage[0]
      : params.celebrationMessage;

    if (
      showCelebrationParam === 'true' &&
      xpEarnedParam &&
      !celebrationTriggeredRef.current
    ) {
      celebrationTriggeredRef.current = true;
      const xpAmount = parseInt(xpEarnedParam.toString(), 10) || 0;
      const fallbackMessage =
        (Array.isArray(params.fromLesson) ? params.fromLesson[0] : params.fromLesson) === 'true'
          ? 'Lesson Complete!'
          : 'Excellent Work!';
      const messageToUse = messageParam || fallbackMessage;

      // Clear params to prevent re-triggering
      router.setParams({
        showCelebration: undefined,
        xpEarned: undefined,
        fromLesson: undefined,
        celebrationMessage: undefined,
      });

      // Start celebration immediately
      startCelebrationSequence(xpAmount, messageToUse);
    }
  }, [params.showCelebration, params.xpEarned, params.celebrationMessage, params.fromLesson]);

  const startCelebrationSequence = async (xpAmount: number, message?: string) => {
    if (!xpAmount || xpAmount <= 0) {
      celebrationTriggeredRef.current = false;
      return;
    }

    playLessonCelebrationSound();
    HapticService.success();

    try {
      await refreshStats();
      await loadDailyXP();
    } catch (error) {
      console.log('Error refreshing stats after celebration:', error);
    }

    setTimeout(() => {
      celebrationTriggeredRef.current = false;
      triggerLessonUnlockAnimation();
    }, 1200);
  };

  const triggerLessonUnlockAnimation = () => {
    // Haptic feedback for lesson unlock
    HapticService.medium();

    // Reload data to recalculate lesson statuses
    loadUserData().then(() => {
      loadTopicsFromSupabase();
    });
  };

  const [dailyKural, setDailyKural] = useState<LocalizedThirukkural | null>(null);

  useEffect(() => {
    let isMounted = true;
    const loadStateSnapshot = async () => {
      if (!user?.id) return;
      try {
        const rankData = await SupabaseService.getUserStateRank(user.id);
        const stateEntry = Array.isArray(rankData) ? rankData[0] : rankData;
        if (!isMounted || !stateEntry) return;
        setStateRankSnapshot({
          state: stateEntry.state || stateEntry.user_state || 'Your State',
          rank: stateEntry.rank || stateEntry.state_rank || 0,
          xp: stateEntry.xp || stateEntry.total_xp || 0,
        });
      } catch (error) {
        if (isMounted) {
          setStateRankSnapshot(null);
        }
      }
    };
    loadStateSnapshot();
    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  // Fetch Daily Kural for Homepage
  useEffect(() => {
    let cancelled = false;
    const fetchKural = async () => {
      try {
        const localized = await getDailyLocalizedThirukkural(selectedKuralLanguage);
        if (!cancelled) setDailyKural(localized);
      } catch (e) {
        console.warn(`Failed to fetch ${selectedKuralLanguage} daily Kural`, e);
        if (!cancelled) setDailyKural(null);
      }
    };
    fetchKural();
    return () => {
      cancelled = true;
    };
  }, [selectedKuralLanguage]);

  const refreshStreakStatus = useCallback(async () => {
    if (!user?.id) return null;
    try {
      setStreakLoading(true);
      const status = await StreakService.getStreakStatus(user.id);
      if (status && StreakCache.cacheStreakData) {
        await StreakCache.cacheStreakData(user.id, {
          currentStreak: status.currentStreak,
          longestStreak: status.currentStreak,
          lastActivityDate: new Date().toISOString().split('T')[0],
        });
      }
      setStreakStatus({
        currentStreak: status.currentStreak,
        hasDailyDose: status.hasDailyDose,
        hasDailySnack: status.hasDailySnack,
        hasRegisteredToday: status.hasRegisteredToday,
      });
      setCurrentStreak(status.currentStreak);
      setStreakLoading(false);
      return status;
    } catch (err) {
      console.warn('refreshStreakStatus error', err);
      setStreakLoading(false);
      return null;
    }
  }, [user?.id]);

  // Load topics from Supabase with caching
  const loadTopicsFromSupabase = async (forceRefresh = false) => {
    try {
      // Check cache first (10 minutes cache for better performance)
      // Exception: Testers get a much shorter cache (10 seconds) for instant content testing
      const CACHE_DURATION = isTester ? 10 * 1000 : 10 * 60 * 1000;
      const now = Date.now();

      if (!forceRefresh && topicsCache && (now - topicsCache.timestamp < CACHE_DURATION)) {
        setExamTopics(topicsCache.data);
        setInitialLoading(false);
        return;
      }

      const topics = await RealDatabaseContentService.getAllTopicsWithSubtopics();

      // Cache the data
      setTopicsCache({ data: topics, timestamp: now });
      setExamTopics(topics);
      globalExamTopicsCache = topics;
      globalInitialLoadingFinished = true;
      setInitialLoading(false);
    } catch (error) {
      console.error('Error loading topics from Supabase:', error);

      // Use cached data as fallback if available
      if (topicsCache) {
        setExamTopics(topicsCache.data);
      } else {
        setExamTopics([]);
      }
      globalInitialLoadingFinished = true;
      setInitialLoading(false);
    }
  };

  const handleFlip = () => {
    HapticService.selection();
    const nextVal = showKuralMeaning ? 0 : 180;
    Animated.spring(flipAnim, {
      toValue: nextVal,
      friction: 8,
      tension: 15,
      useNativeDriver: true,
    }).start();
    setShowKuralMeaning(!showKuralMeaning);
  };

  const frontInterpolate = flipAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });
  const backInterpolate = flipAnim.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });
  const frontOpacity = flipAnim.interpolate({
    inputRange: [89, 90],
    outputRange: [1, 0],
  });
  const backOpacity = flipAnim.interpolate({
    inputRange: [89, 90],
    outputRange: [0, 1],
  });

  const kuralLines = useMemo(() => {
    if (!dailyKural) return [];
    const verseText = getThirukkuralVerseText(dailyKural);
    if (selectedKuralLanguage === 'ta') {
      const tamilWords = String(dailyKural.kural_tamil || verseText)
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
      if (tamilWords.length >= 7) {
        return [
          tamilWords.slice(0, 4).join(' '),
          tamilWords.slice(4, 7).join(' '),
        ];
      }
    }
    return splitThirukkuralLines(verseText);
  }, [dailyKural, selectedKuralLanguage]);
  const kuralMeaning = useMemo(() => {
    return dailyKural?.meaning || '';
  }, [dailyKural]);
  // Handle lesson completion - update database progress
  const handleLessonComplete = async (lessonId: string, xpEarned: number = 50) => {
    try {
      if (!user?.id) return;

      // Update lesson progress in database
      await RewardService.updateLessonProgress(lessonId, 'completed', xpEarned);

      // Refresh user stats to update MG tokens display
      await refreshStats();
    } catch (error) {
      console.error('Error handling lesson completion:', error);
    }
  };

  // starting a lesson -> update progress and navigate (preserve all route logic)
  const handleLessonStart = (lesson: PathLesson) => {
    // Non-blocking progress updates (Fire and Forget)
    if (user?.id) {
      LearningProgressService.updateLessonProgress(user.id, lesson.id, 'started').catch(err => console.warn(err));
      RewardService.updateLessonProgress(lesson.id, 'unlocked', 0).catch(err => console.warn(err));
    }

    // Navigate immediately
    UniversalNavigation.navigateTo({
      pathname: '/study/lesson-intro',
      params: {
        topicId: lesson.topicId,
        topicName: lesson.topicTitle,
        lessonId: lesson.id,
        subtopicId: lesson.subtopicId || undefined,
        subjectName: lesson.topicSubject,
        subject: lesson.topicSubject,
        // Pass rich metadata for intro screen
        lessonTitle: lesson.title, // Explicitly pass lesson title
        description: lesson.description || lesson.subtitle,
        subtitle: lesson.subtitle,
        xp: lesson.xp?.toString() || '50'
      }
    });
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);

    // Clear AsyncStorage cache to reset to lesson 1
    await ClearProgressCache.resetToLesson1(user?.id || 'guest');

    await loadUserData();
    await loadTopicsFromSupabase(true); // Force refresh topics
    await refreshStreakStatus();
    setTimeout(() => setRefreshing(false), 900);
  }, [refreshStreakStatus, user?.id]);

  // Show skeleton loader during initial data loading
  const isLoading = initialLoading;
  const [showLoadedMascot, setShowLoadedMascot] = useState(false);

  // Quick Practice: subjects for the user's onboarding exam, each deep-linking
  // straight into that subject in Quiz Hub.
  const [practiceExamId, setPracticeExamId] = useState('upsc');
  const [practiceItems, setPracticeItems] = useState<{ id: string; label: string; icon: string; color: string }[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let examId = 'upsc';
        const user = await SupabaseService.getCurrentUser();
        if (user) {
          const { data } = await supabase
            .from('user_study_context')
            .select('primary_exam')
            .eq('user_id', user.id)
            .maybeSingle();
          examId = practiceExamIdForStudyContext(data?.primary_exam);
        }
        const subs = await RedisService.getSubjects(examId);
        if (!alive) return;
        setPracticeExamId(examId);
        setPracticeItems(
          subs.slice(0, 8).map((s: any, i: number) => ({
            id: s.id,
            label: shortSubjectLabel(s.name),
            icon: s.icon,
            color: PRACTICE_COLORS[i % PRACTICE_COLORS.length],
          })),
        );
      } catch { /* keep default/empty */ }
    })();
    return () => { alive = false; };
  }, []);
  // Keep in sync with getTimeGreeting: "Good Evening" starts at 17.
  const isNight = new Date().getHours() >= 17 || new Date().getHours() < 6;

  useEffect(() => {
    if (isLoading) {
      setShowLoadedMascot(false);
      return;
    }

    const timer = setTimeout(() => setShowLoadedMascot(true), 220);
    return () => clearTimeout(timer);
  }, [isLoading]);

  const glowScale = scrollY.interpolate({
    inputRange: [0, 180],
    outputRange: [1, 0.35],
    extrapolate: 'clamp',
  });
  const glowOpacity = scrollY.interpolate({
    inputRange: [0, 140],
    outputRange: [0.32, 0],
    extrapolate: 'clamp',
  });
  const glowTranslateY = scrollY.interpolate({
    inputRange: [0, 200],
    outputRange: [0, -120],
    extrapolate: 'clamp',
  });

  const renderLeaderboardTeaser = () => {
    if (!stateRankSnapshot) return null;
    return (
      <TouchableOpacity
        onPress={() => UniversalNavigation.navigateTo('/(tabs)/leaderboard')}
        activeOpacity={0.88}
        style={styles.leaderTeaserCard}
      >
        <LinearGradient colors={['#FFFFFF', '#F0FFFE']} style={StyleSheet.absoluteFillObject} />
        <View style={styles.leaderTeaserTop}>
          <View style={styles.leaderTeaserLeft}>
            <Text style={styles.leaderTeaserState}>
              {(stateRankSnapshot.state && stateRankSnapshot.state !== 'Unknown State' && stateRankSnapshot.state !== 'null')
                ? stateRankSnapshot.state : 'Your State'}
            </Text>
            <View style={styles.leaderRankBadge}>
              <Text style={styles.leaderRankHash}>#</Text>
              <Text style={styles.leaderRankNum}>
                {Number.isFinite(stateRankSnapshot.rank) && stateRankSnapshot.rank > 0 ? stateRankSnapshot.rank : '—'}
              </Text>
              <Text style={styles.leaderRankLabel}> in your state</Text>
            </View>
            <Text style={styles.leaderXPText}>{(stateRankSnapshot.xp || 0).toLocaleString()} XP earned</Text>
          </View>
          <View style={styles.leaderPodiumWrap}>
            <View style={[styles.leaderPodiumBar, { height: 36, backgroundColor: '#FFD700' }]} />
            <View style={[styles.leaderPodiumBar, { height: 52, backgroundColor: '#00D4C7', marginHorizontal: 5 }]} />
            <View style={[styles.leaderPodiumBar, { height: 28, backgroundColor: '#94A3B8' }]} />
          </View>
        </View>
        <View style={styles.leaderTeaserFooter}>
          <Text style={styles.leaderChallengeText}>See full leaderboard</Text>
          <Ionicons name="chevron-forward" size={14} color="#00D4C7" />
        </View>
      </TouchableOpacity>
    );
  };

  const renderGyanClashBanner = () => (
    <TouchableOpacity
      onPress={() => router.push('/(tabs)/arena' as any)}
      activeOpacity={0.88}
      style={styles.clashBannerCard}
    >
      <LinearGradient
        colors={['#0F172A', '#1A2540', '#0C1A30']}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={styles.clashBannerGlow} />
      <View style={styles.clashBannerContent}>
        <View style={styles.clashBannerLeft}>
          <View style={styles.clashBannerIconWrap}>
            <Ionicons name="thunderstorm" size={26} color="#00D4C7" />
          </View>
          <View>
            <Text style={styles.clashBannerTitle}>GyanClash</Text>
            <Text style={styles.clashBannerSub}>Battle live · Win XP · Climb ranks</Text>
          </View>
        </View>
        <LinearGradient
          colors={['#00D4C7', '#0EA5E9']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={styles.clashBannerCta}
        >
          <Text style={styles.clashBannerCtaText}>FIGHT</Text>
          <Ionicons name="chevron-forward" size={13} color="#FFFFFF" />
        </LinearGradient>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* Atmospheric Backdrop */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={['#FFFFFF', '#F8FAFC', '#F1F5F9']}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View pointerEvents="box-none" style={[styles.homeFixedHeader, { paddingTop: insets.top + 18, paddingBottom: 10, paddingHorizontal: 20 }]}>
        <LottieView
          key={isNight ? 'night' : 'morning'}
          source={isNight ? require('@/assets/nightheader.json') : require('@/assets/morningheader2.json')}
          autoPlay
          loop
          resizeMode="cover"
          style={styles.headerBackgroundLottie}
        />
        <View style={styles.v2026Header}>
          <View style={styles.headerLeft}>
            <View>
              <Text style={[styles.greetingText, isNight && styles.greetingTextNight]}>{getTimeGreeting()}</Text>
              <Text style={[styles.userNameText, isNight && styles.userNameTextNight]}>{user?.user_metadata?.full_name?.split(' ')[0] || 'Warrior'}</Text>
            </View>
          </View>
          <View style={styles.headerRightContainer}>
            <View style={styles.headerXpWrap}>
              <Enhanced3DXPBar
                totalXP={totalMGTokens || currentXP || 0}
                streak={dbStreak || currentStreak || 0}
                animated={true}
                isLoading={statsLoading || streakLoading}
              />
            </View>
          </View>
          <View style={styles.headerDivider} />
        </View>
      </View>

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingTop: insets.top + 154,
          paddingBottom: insets.bottom + 112,
          paddingHorizontal: 20
        }}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00D4C7" />}
      >
        {isLoading ? (
          <HomeSkeleton />
        ) : (
        <View style={styles.homeScrollContent}>

          {/* ── 1. HERO STRIP: week dots + streak + XP ── */}
          <MotiView {...introProps(80)}>
            <Text style={styles.sectionTitle}>{"Today's Mission"}</Text>
            <View style={{ marginTop: 10, position: 'relative' }}>
              {showLoadedMascot && !missionSummary.loading ? (
                <View pointerEvents="none" style={styles.homeScrollMascotWrap}>
                  <LottieView
                    source={require('@/assets/lotties/forhome.json')}
                    autoPlay
                    loop
                    resizeMode="contain"
                    style={styles.homeScrollMascot}
                  />
                </View>
              ) : null}
              <CompactTopicCard
                lesson={missionLessonCard}
                locked={missionLocked}
                progressPhase={missionSummary.progressPhase}
                onStart={(lesson) => {
                  if (missionLocked) return;
                  UniversalNavigation.navigateTo(lesson.route || '/daily-mission');
                }}
                isLoading={missionSummary.loading}
              />
            </View>
          </MotiView>

          {/* ── 2. QUICK PRACTICE (subjects from the user's exam) ── */}
          {practiceItems.length > 0 && (
          <MotiView {...introProps(110)}>
            <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Quick Practice</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.practiceRow}
            >
              {practiceItems.map((s, i) => (
                <MotiView key={s.id} {...introProps(60 + i * 45, 'x', 14)}>
                  <PressableScale
                    style={styles.practiceChip}
                    onPress={() => UniversalNavigation.navigateTo(`/quiz-hub?exam=${practiceExamId}&subject=${s.id}`)}
                  >
                    <LinearGradient
                      colors={[shade(s.color, 0.5), s.color, shade(s.color, -0.2)]}
                      locations={[0, 0.5, 1]}
                      start={{ x: 0.3, y: 0 }}
                      end={{ x: 0.7, y: 1 }}
                      style={styles.practiceCoin}
                    >
                      <MotiView {...(subjectIconLoop(s.id) as any)}>
                        <FontAwesome5 name={s.icon as any} size={20} color="#FFFFFF" />
                      </MotiView>
                    </LinearGradient>
                    <Text style={styles.practiceLabel} numberOfLines={1}>{s.label}</Text>
                  </PressableScale>
                </MotiView>
              ))}
            </ScrollView>
          </MotiView>
          )}

          {/* ── 6. STUDY TOOLS (flat, Duolingo-style) ── */}
          <MotiView {...introProps(140)}>
            <View style={styles.toolsSection}>
              <Text style={styles.sectionTitle}>Study Tools</Text>
              <View style={styles.studyToolsStack}>
                {studyToolsConfig.map((tool, i) => (
                  <MotiView key={tool.id} {...introProps(60 + i * 55)}>
                    <PressableScale
                      style={styles.toolFlatCard}
                      onPress={() => router.push(tool.route as any)}
                    >
                      <LinearGradient
                        colors={[shade(tool.color, 0.5), tool.color, shade(tool.color, -0.2)]}
                        locations={[0, 0.5, 1]}
                        start={{ x: 0.3, y: 0 }}
                        end={{ x: 0.7, y: 1 }}
                        style={styles.toolCoin}
                      >
                        {renderToolIcon(tool)}
                      </LinearGradient>
                      <View style={styles.toolFlatText}>
                        <Text style={styles.toolFlatTitle} numberOfLines={1}>{tool.title}</Text>
                        <Text style={styles.toolFlatCopy} numberOfLines={1}>{tool.copy}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#C3CEDA" />
                    </PressableScale>
                  </MotiView>
                ))}
              </View>
            </View>
          </MotiView>

          {/* ── 7. LEADERBOARD TEASER ── */}
          {stateRankSnapshot && (
            <MotiView {...introProps(200)}>
              <Text style={[styles.sectionTitle, { marginTop: 18 }]}>State Rank</Text>
              {(() => {
                const rankVal = Number.isFinite(stateRankSnapshot.rank) && stateRankSnapshot.rank > 0 ? stateRankSnapshot.rank : '-';
                const stateName = (stateRankSnapshot.state && stateRankSnapshot.state !== 'Unknown State' && stateRankSnapshot.state !== 'null')
                  ? stateRankSnapshot.state : 'Your State';
                return (
                  <PressableScale
                    onPress={() => UniversalNavigation.navigateTo('/(tabs)/leaderboard')}
                    style={styles.rankCard}
                  >
                    <LinearGradient
                      colors={[shade('#F59E0B', 0.5), '#F59E0B', shade('#F59E0B', -0.2)]}
                      locations={[0, 0.5, 1]}
                      start={{ x: 0.3, y: 0 }}
                      end={{ x: 0.7, y: 1 }}
                      style={styles.rankCoin}
                    >
                      <FontAwesome5 name="trophy" size={17} color="#FFFFFF" solid />
                    </LinearGradient>
                    <View style={styles.rankMid}>
                      <Text style={styles.rankTitle} numberOfLines={1}>{stateName}</Text>
                      <Text style={styles.rankSub} numberOfLines={1}>
                        {(stateRankSnapshot.xp || 0).toLocaleString()} XP earned
                      </Text>
                    </View>
                    <Text style={styles.rankNum}>#{rankVal}</Text>
                    <Ionicons name="chevron-forward" size={18} color="#C3CEDA" />
                  </PressableScale>
                );
              })()}
            </MotiView>
          )}

          {/* ── 8. GYANCLASH BANNER ── */}

          {/* ── 9. WHATSAPP SYNC ── */}
        {/* Daily Thirukkural (Premium 3D Flip Card Quote) */}
        <View style={styles.thiruEtherealContainer}>
          {!dailyKural ? (
            <View style={{ alignItems: 'center', width: '100%', gap: 12 }}>
              <ShimmerBlock style={{ width: 140, height: 12, borderRadius: 4, marginVertical: 4 }} />
              <View style={[styles.thiruEtherealLines, { width: '100%', alignItems: 'center', gap: 8 }]}>
                <ShimmerBlock style={{ width: '85%', height: 18, borderRadius: 4 }} />
                <ShimmerBlock style={{ width: '70%', height: 18, borderRadius: 4 }} />
              </View>
              <View style={{ height: 32 }} />
            </View>
          ) : (
            <View style={{ width: '100%' }}>
              <View style={styles.thiruTitleRow}>
                <Ionicons name="leaf" size={18} color="#10B981" style={styles.thiruTitleLeaf} />
                <Text style={styles.thiruEtherealNumber}>THIRUKKURAL • {dailyKural.kural_number}</Text>
              </View>

              {/* 3D Flip Interactive Card Wrapper */}
              <TouchableOpacity
                activeOpacity={0.95}
                onPress={handleFlip}
                style={{ width: '100%', minHeight: 180, position: 'relative', marginTop: 8 }}
              >
                {/* Front Side: Thirukkural Quote Lines */}
                <Animated.View
                  style={[
                    styles.thiruEtherealCard,
                    { backfaceVisibility: 'hidden' },
                    { transform: [{ rotateY: frontInterpolate }], opacity: frontOpacity }
                  ]}
                >
                  <ImageBackground
                    source={require('@/assets/thirukural.jpg')}
                    style={styles.thiruImageBackground}
                    imageStyle={styles.thiruImageBackgroundStyle}
                    resizeMode="stretch"
                  >
                    <View style={styles.thiruImageOverlay} />
                    <LinearGradient
                      colors={['rgba(15, 23, 42, 0.22)', 'rgba(15, 23, 42, 0.14)', 'rgba(15, 23, 42, 0.06)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.thiruGradientTint}
                    />
                    <View style={styles.thiruImageContent}>
                  <View style={styles.thiruQuoteFrame}>
                    <Text style={[styles.thiruEtherealQuoteMark, styles.thiruQuoteMarkOpen]}>“</Text>
                    <View style={styles.thiruVerseBlock}>
                      {selectedKuralLanguage !== 'ta' && !kuralLines.length ? (
                        <Text style={styles.thiruVerseLoadingText}>
                          Translating verse...
                        </Text>
                      ) : (
                        kuralLines.map((line: string, idx: number) => (
                          <Text
                            key={idx}
                            style={styles.thiruEtherealText}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.5}
                          >
                            {line.trim()}
                          </Text>
                        ))
                      )}
                    </View>
                    <Text style={[styles.thiruEtherealQuoteMark, styles.thiruQuoteMarkClose]}>”</Text>
                  </View>
                  <View style={styles.thiruCardHintRow}>
                    <Ionicons name="swap-horizontal" size={12} color="#10B981" />
                    <Text style={styles.thiruCardHintText}>Tap to see meaning</Text>
                  </View>
                    </View>
                  </ImageBackground>
                </Animated.View>

                {/* Back Side: Reflection / Meaning */}
                <Animated.View
                  style={[
                    styles.thiruEtherealCard,
                    StyleSheet.absoluteFillObject,
                    { backfaceVisibility: 'hidden' },
                    { transform: [{ rotateY: backInterpolate }], opacity: backOpacity }
                  ]}
                >
                  <ImageBackground
                    source={require('@/assets/thirukural.jpg')}
                    style={styles.thiruImageBackground}
                    imageStyle={styles.thiruImageBackgroundStyle}
                    resizeMode="stretch"
                  >
                    <View style={styles.thiruImageOverlay} />
                    <LinearGradient
                      colors={['rgba(15, 23, 42, 0.22)', 'rgba(15, 23, 42, 0.14)', 'rgba(15, 23, 42, 0.06)']}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.thiruGradientTint}
                    />
                    <View style={styles.thiruImageContent}>
                  {!!kuralMeaning && (
                    <View style={styles.thiruMeaningContainer}>
                      <Text style={styles.thiruMeaningLabel}>
                        {selectedKuralLanguage === 'ta' ? 'பொருள்' : selectedKuralLanguage === 'hi' ? 'अर्थ' : selectedKuralLanguage === 'te' ? 'భావం' : selectedKuralLanguage === 'kn' ? 'ಅರ್ಥ' : selectedKuralLanguage === 'ml' ? 'അർത്ഥം' : 'Meaning'}
                      </Text>
                      <Text style={styles.thiruMeaningText}>
                        {kuralMeaning}
                      </Text>
                    </View>
                  )}
                  <View style={styles.thiruCardHintRow}>
                    <Ionicons name="swap-horizontal" size={12} color="#64748B" />
                    <Text style={styles.thiruCardHintText}>Tap to see verse</Text>
                  </View>
                    </View>
                  </ImageBackground>
                </Animated.View>
              </TouchableOpacity>

              {/* Language Selector (placed below the 3D flip card area for seamless configuration) */}
              <View style={[styles.kuralLanguageRow, { marginTop: 16 }]}>
                {([
                  { id: 'ta', label: 'Tamil' },
                  { id: 'en', label: 'English' },
                  { id: 'hi', label: 'Hindi' },
                  { id: 'te', label: 'Telugu' },
                  { id: 'kn', label: 'Kannada' },
                  { id: 'ml', label: 'Malayalam' },
                ] as Array<{ id: KuralLanguage; label: string }>).map((lang) => (
                  <TouchableOpacity
                    key={lang.id}
                    activeOpacity={1}
                    onPress={() => {
                      setSelectedKuralLanguage(lang.id);
                      if (showKuralMeaning) {
                        HapticService.selection();
                        Animated.spring(flipAnim, {
                          toValue: 0,
                          friction: 8,
                          tension: 15,
                          useNativeDriver: true,
                        }).start();
                        setShowKuralMeaning(false);
                      }
                    }}
                    style={[
                      styles.kuralLanguageChip,
                      selectedKuralLanguage === lang.id && styles.kuralLanguageChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.kuralLanguageText,
                        selectedKuralLanguage === lang.id && styles.kuralLanguageTextActive,
                      ]}
                    >
                      {lang.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
        </View>
        )}
      </Animated.ScrollView>

      <DayStreakModal
        visible={streakModalVisible}
        mode={streakModalMode}
        currentStreak={currentStreak}
        onClose={() => setStreakModalVisible(false)}
        onCtaPress={() => setStreakModalVisible(false)}
      />

    </View>
  );
}

// End of MindGainsHomePage
