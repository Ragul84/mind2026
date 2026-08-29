import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  ScrollView,
  StatusBar,
  Linking,
  ImageBackground,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  ActivityIndicator,
  Pressable,
  Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome5 } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import { MotiView } from 'moti';
import { BlurView } from 'expo-blur';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuthContext } from '@/components/AuthProvider';
import { SupabaseService } from '@/utils/supabaseService';
import {
  getMissionPayload,
  getUserProtocol,
  getDailyQuestionTarget,
  updateProtocolPhase,
  MissionPayload,
  MissionLessonPage
} from '@/utils/protocolService';
import HapticService from '@/utils/hapticService';
import UnifiedLoader from '@/components/ui/UnifiedLoader';
import RedisService, { getIndiaDateKey, type RedisQuestion } from '@/utils/redisService';
import { weakAreasService } from '@/services/weakAreasService';
import NotificationService from '@/utils/notificationService';
import { SecureRewardsService } from '@/services/secureRewardsService';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const getYouTubeVideoId = (url?: string) => {
  const value = String(url || '').trim();
  if (!value) return '';
  const patterns = [
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/watch\?.*?[?&]?v=([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
};

const buildYouTubeEmbedHtml = (videoId: string, title: string) => `
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
      iframe { width: 100%; height: 100%; border: 0; display: block; }
    </style>
  </head>
  <body>
    <iframe
      title="${String(title || 'Video lesson').replace(/"/g, '&quot;')}"
      src="https://www.youtube-nocookie.com/embed/${videoId}?playsinline=1&rel=0&modestbranding=1"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen>
    </iframe>
  </body>
</html>
`;

const buildYouTubeInteractivePlayerHtml = (videoId: string, title: string) => `
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
    <style>
      html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #000; overflow: hidden; }
      #player { width: 100%; height: 100%; border: 0; }
    </style>
  </head>
  <body>
    <div id="player"></div>
    <script>
      var tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      var firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

      var player;
      function onYouTubeIframeAPIReady() {
        player = new YT.Player('player', {
          height: '100%',
          width: '100%',
          videoId: '${videoId}',
          playerVars: {
            'playsinline': 1,
            'rel': 0,
            'modestbranding': 1,
            'controls': 1,
            'showinfo': 0
          },
          events: {
            'onReady': onPlayerReady,
            'onStateChange': onPlayerStateChange
          }
        });
      }

      function onPlayerReady(event) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
        setInterval(function() {
          if (player && typeof player.getCurrentTime === 'function') {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'timeupdate',
              currentTime: player.getCurrentTime(),
              duration: player.getDuration()
            }));
          }
        }, 500);
      }

      function onPlayerStateChange(event) {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'stateChange',
          state: event.data
        }));
      }

      window.seekToTime = function(seconds) {
        if (player && typeof player.seekTo === 'function') {
          player.seekTo(seconds, true);
          player.playVideo();
        }
      };
    </script>
  </body>
</html>
`;

const cleanMissionTitle = (title?: string) => {
  const value = String(title || '').replace(/\s+/g, ' ').trim();
  return value.replace(/\s*\((?:Days?|Day)\s+\d+\s*(?:[-–]\s*\d+)?\)\s*$/i, '').trim();
};

const PHASE_FLOW: Record<string, { label: string; next?: string }> = {
  snapshot: { label: 'Reading Notes', next: 'Recall Cards' },
  flashback: { label: 'Daily Flashback', next: 'Reading Notes' },
  flashcards: { label: 'Recall Cards', next: 'Video Lessons' },
  videos: { label: 'Video Lessons', next: 'Exam Practice' },
  quiz: { label: 'Exam Practice', next: 'Current Affairs' },
  current_affairs: { label: 'Current Affairs' },
};

export default function MissionReader() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();

  const phaseId = parseInt(params.phaseId as string || '1', 10);
  const phaseType = params.phaseType as string;
  const topicTitle = params.topicTitle as string;

  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<MissionPayload | null>(null);
  const [complete, setComplete] = useState(false);
  const [readyToComplete, setReadyToComplete] = useState(false);
  const mainScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    async function loadData() {
      if (!user?.id) return;
      setLoading(true);
      try {
        const protocol = await getUserProtocol(user.id);
        if (protocol) {
          const { payload: missionPayload } = await getMissionPayload(
            protocol.track_id,
            protocol.current_day_number
          );
          setPayload(missionPayload);
        }
      } catch (error) {
        console.error('Failed to load mission payload:', error);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [user?.id]);

  useEffect(() => {
    setReadyToComplete(false);
  }, [phaseType, payload]);

  const handleComplete = async () => {
    if (!user?.id) return;
    HapticService.success();
    
    // Update phase in DB if it's the current phase
    const protocol = await getUserProtocol(user.id);
    if (protocol && protocol.progress_phase === phaseId) {
      await updateProtocolPhase(user.id, phaseId + 1);
      
      // If completing Phase 5 (Current Affairs), today's goal is complete!
      if (phaseId === 5) {
        const missionReward = await SecureRewardsService.adjustBalance({
          amount: 50,
          reason: 'daily_mission_completion',
          claimKey: SecureRewardsService.claimKey([
            'daily-mission',
            user.id,
            protocol.track_id,
            protocol.current_day_number,
          ]),
          metadata: {
            trackId: protocol.track_id,
            dayNumber: protocol.current_day_number,
            phaseId,
          },
        });
        if (!missionReward.success) {
          console.warn('Daily mission reward failed:', missionReward.error);
        }
        await SupabaseService.ensureDailyStreak(user.id);
        await AsyncStorage.setItem('mindgains:stats_dirty_at', String(Date.now()));
        await NotificationService.cancelRemainingStudyRemindersForToday();
      }
    }
    
    setComplete(true);
    setTimeout(() => {
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/daily-mission');
      }
    }, 2400);
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <UnifiedLoader context="learn" message="Loading your lesson…" />
      </View>
    );
  }

  const renderContent = () => {
    switch (phaseType) {
      case 'snapshot':
        return <SnapshotContent payload={payload} setReadyToComplete={setReadyToComplete} scrollRef={mainScrollRef} />;
      case 'flashback':
        return <FlashbackContent payload={payload} setReadyToComplete={setReadyToComplete} />;
      case 'flashcards':
        return <FlashcardsContent payload={payload} setReadyToComplete={setReadyToComplete} />;
      case 'videos':
        return <VideosContent payload={payload} userId={user?.id} setReadyToComplete={setReadyToComplete} />;
      case 'quiz':
        return <QuizContent payload={payload} onComplete={handleComplete} />;
      case 'current_affairs':
        return <CurrentAffairsQuizContent onComplete={handleComplete} />;
      default:
        return <Text style={styles.errorText}>Unknown phase type</Text>;
    }
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* 🏔️ Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity activeOpacity={1} onPress={() => router.canGoBack() ? router.back() : router.replace('/daily-mission')} style={styles.backButton}>
          <Ionicons name="close" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={2}>
          {cleanMissionTitle(topicTitle)}
        </Text>
        <View style={styles.headerRight} />
      </View>


      <ScrollView 
        ref={mainScrollRef}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {renderContent()}
      </ScrollView>

      {/* 🚀 Action Button (Except for Quiz which has its own flow) */}
      {phaseType !== 'quiz' && phaseType !== 'current_affairs' && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}
      >
          <TouchableOpacity
            style={[styles.completeButton, !readyToComplete && styles.completeButtonDisabled]}
            onPress={handleComplete}
            disabled={!readyToComplete}
            activeOpacity={1}
          >
            <View style={[styles.gradientButton, { backgroundColor: readyToComplete ? '#2563EB' : '#CBD5E1' }]}>
              <Text style={styles.completeButtonText}>Mark as complete</Text>
              <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        </View>
      )}

      {/* 🎊 Completion Overlay */}
      {complete && (() => {
        const flow = PHASE_FLOW[phaseType] || { label: 'Session' };
        const isDayDone = phaseType === 'current_affairs';
        return (
          <View style={styles.completionOverlay}>
            <BlurView intensity={60} tint="dark" style={StyleSheet.absoluteFill} />
            <LottieView
              source={require('@/assets/lotties/confetti.json')}
              autoPlay
              loop={false}
              resizeMode="cover"
              style={styles.completionConfetti}
              pointerEvents="none"
            />
            <View style={styles.completionCard}>
              <LottieView
                source={require('@/assets/lotties/welcomescreen.json')}
                autoPlay
                loop
                style={styles.completionMascot}
              />
              <Text style={styles.successTitle}>{isDayDone ? 'Day complete!' : 'Nice work!'}</Text>
              <Text style={styles.successSubtitle}>
                {isDayDone
                  ? '+50 XP earned · streak extended. See you tomorrow.'
                  : `${flow.label} done${flow.next ? ` · ${flow.next} unlocked` : ''}`}
              </Text>
            </View>
          </View>
        );
      })()}
    </View>
  );
}

/* --- Phase Content Components --- */

const FlashbackContent = ({ payload, setReadyToComplete }: { payload: MissionPayload | null; setReadyToComplete: (value: boolean) => void }) => {
  useEffect(() => {
    setReadyToComplete(true);
    return () => setReadyToComplete(false);
  }, [setReadyToComplete]);

  const config = payload?.curriculum_metadata?.spaced_repetition_config;
  if (!config) return <Text style={styles.errorText}>No flashback data found.</Text>;

  return (
    <View>
      <View style={styles.flashbackHeader}>
        <LinearGradient colors={['#8B5CF6', '#6D28D9']} style={styles.flashbackIcon}>
          <Ionicons name="refresh" size={20} color="#FFFFFF" />
        </LinearGradient>
        <View>
          <Text style={styles.flashbackTitle}>Daily Flashback</Text>
          <Text style={styles.flashbackSubtitle}>Micro-recall from previous sessions</Text>
        </View>
      </View>

      <View style={styles.flashbackCard}>
        <Text style={styles.flashbackPrompt}>RECALL CHALLENGE</Text>
        <Text style={styles.flashbackQuestion}>
          Can you remember the core logic of Day N-{config.intervals[0] || 3}?
        </Text>
        <View style={styles.flashbackDivider} />
        <Text style={styles.flashbackTip}>
          Tip: Active recall for 1 minute beats 10 minutes of reading.
        </Text>
      </View>

      <View style={styles.recallIndicatorContainer}>
        {config.intervals.map((interval, i) => (
          <View key={i} style={styles.recallBadge}>
            <Text style={styles.recallBadgeText}>N-{interval}</Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const GOOGLE_LESSON_COLORS = ['#4285F4', '#34A853', '#FBBC05', '#EA4335', '#7C3AED', '#0EA5E9'];

const splitLessonSentences = (detail?: string) => {
  const text = String(detail || '').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
};

const cleanDisplayCell = (value?: string) => String(value || '').trim().replace(/[.。]+$/u, '');

// Replace curriculum jargon with words students actually use.
const humanizeSectionTitle = (title?: string) => {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  if (/recitation/i.test(t)) {
    t = t.replace(/\bmaster\b/gi, '').replace(/\brecitation\b/gi, '').replace(/\s+/g, ' ').trim();
    t = t ? `${t} — Quick Revision` : 'Quick Revision';
  }
  return t;
};

// Drop filler sentences that just echo the topic already shown in the header.
const stripTopicEcho = (text: string) =>
  text
    .replace(/^today,?\s+you\s*(?:will|’ll|'ll)\s+study[^.!?]*[.!?]\s*/i, '')
    .replace(/^in\s+this\s+(?:section|lesson|session),?\s+you\s*(?:will|’ll|'ll)\s+(?:study|learn)[^.!?]*[.!?]\s*/i, '')
    .trim();

// "12-13.definition.judicial review" → "12-13 · definition · judicial review"
const normalizePointSeparators = (raw: string) => {
  let text = raw.trim();
  if ((text.match(/[a-z0-9]\.[a-z]/gi) || []).length >= 1) {
    text = text.replace(/([a-z0-9])\.(?=[a-z])/gi, '$1 · ');
  }
  return text.replace(/\s*=\s*/g, ' — ');
};

// Split "Blueprint: 1946 Cabinet Mission" into a highlighted label + value.
const splitPointLabel = (raw: string): { label: string; value: string } | null => {
  const match = raw.match(/^(.{2,48}?)\s*(?::|•|·|—)\s+?(.+)$/);
  if (!match) return null;
  const label = match[1].trim();
  if (!label || label.split(/\s+/).length > 6) return null;
  return { label, value: match[2].trim() };
};

// One structured key point: badge = number/range chip ("9", "12–13"),
// label = highlighted term ("Blueprint"), text = readable body.
type ReaderPoint = { badge?: string; label?: string; text: string };

const RANGE_BADGE_RE = /^\d{1,3}(?:\s*[-–]\s*\d{1,3})?[A-Za-z]?$/;

const tidyPointText = (raw: string) => {
  return raw
    .trim()
    .replace(/\s*\+\s*/g, ' & ')          // "Definition+Judicial" → "Definition & Judicial"
    .replace(/([A-Za-z0-9])\(/g, '$1 (')  // "Protection(1st Amdt)" → "Protection (1st Amdt)"
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,.\s]+/, '');
};

// Turn one raw extracted string into clean structured points. Enumerated runs
// ("1:States/UTs, 2:Salaries, …") explode into rows keeping their REAL numbers
// as badges, so "9: Judicial Review" stays schedule 9 even if the list skips.
const parseReaderPoint = (raw: string): ReaderPoint[] => {
  const enumerated = extractRecitationItems(raw);
  if (enumerated.length >= 3) {
    return enumerated
      .map((item) => {
        const [lead, ...rest] = item.split(':');
        const badge = lead.trim().replace(/[^\d–-]/g, '');
        const text = tidyPointText(rest.join(':'));
        if (!badge || !text) return null;
        return { badge, text };
      })
      .filter(Boolean) as ReaderPoint[];
  }
  const pair = splitPointLabel(raw);
  if (pair) {
    if (RANGE_BADGE_RE.test(pair.label)) {
      return [{ badge: pair.label.replace(/\s*[-–]\s*/g, '–'), text: tidyPointText(pair.value) }];
    }
    return [{ label: pair.label, text: tidyPointText(pair.value) }];
  }
  return [{ text: tidyPointText(raw) }];
};

const stripTrapPrefix = (t: string) =>
  t.replace(/^(?:key\s+)?(?:exam\s+)?trap\s*[:\-—]\s*/i, '').trim();

// Canonical 12 Schedules of the Constitution of India. The vault content for
// this page is truncated (stops at 11) and uses cryptic shorthand ("RS Seats",
// "Sched Areas"), so when a section is clearly the Schedules list we render
// this verified version instead of trusting the stored blob.
const CONSTITUTION_SCHEDULES: ReaderPoint[] = [
  { badge: '1', text: 'States and Union Territories' },
  { badge: '2', text: 'Salaries & allowances — President, Governors, Speakers, Judges, CAG' },
  { badge: '3', text: 'Forms of Oaths and Affirmations' },
  { badge: '4', text: 'Allocation of Rajya Sabha seats to states & UTs' },
  { badge: '5', text: 'Administration of Scheduled Areas & Scheduled Tribes' },
  { badge: '6', text: 'Tribal Areas in Assam, Meghalaya, Tripura & Mizoram' },
  { badge: '7', text: 'Union, State and Concurrent Lists — division of powers' },
  { badge: '8', text: '22 Official Languages' },
  { badge: '9', text: 'Laws shielded from judicial review (1st Amdt, 1951)' },
  { badge: '10', text: 'Anti-defection provisions (52nd Amdt, 1985)' },
  { badge: '11', text: 'Panchayats — 29 subjects (73rd Amdt, 1992)' },
  { badge: '12', text: 'Municipalities — 18 subjects (74th Amdt, 1992)' },
];

const isScheduleListSection = (title: string, points: ReaderPoint[]) => {
  if (!/schedule/i.test(title)) return false;
  const numbered = points.filter((p) => p.badge && /^\d{1,2}$/.test(p.badge));
  return numbered.length >= 6;
};

const splitLessonBodyAndTrap = (detail?: string) => {
  const sentences = splitLessonSentences(detail);
  const trapIndex = sentences.findIndex((sentence) => /trap|not\s+\d|not\s+[a-z]/i.test(sentence));
  if (trapIndex < 0) return { body: sentences, trap: '' };
  return {
    body: sentences.filter((_, idx) => idx !== trapIndex),
    trap: sentences[trapIndex],
  };
};

const extractRecitationItems = (text?: string) => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!/(^|[^0-9])\d{1,2}\s*:/.test(normalized)) return [];
  // Boundary-aware: "10:" must not also match as "0:" (which split 10/11/12
  // into wrong digits). Each item runs to the next comma.
  const items: string[] = [];
  const re = /(^|[^0-9])(\d{1,2})\s*:\s*([^,]+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized)) !== null) {
    const num = match[2];
    const body = match[3].trim();
    if (body) items.push(`${num}:${body}`);
  }
  return items;
};

const extractRecitationStudyItems = (
  page: MissionLessonPage,
  blocks: NonNullable<MissionLessonPage['blocks']>
) => {
  const denseItems: Array<{ index: string; text: string }> = [];
  const seen = new Set<string>();

  const pushText = (raw?: string) => {
    const items = extractRecitationItems(raw);
    if (!items.length) return;
    items.forEach((item) => {
      const [lead, ...rest] = item.split(':');
      const index = lead.trim();
      const text = rest.join(':').trim();
      if (!index || !text) return;
      const key = `${index}:${text}`;
      if (seen.has(key)) return;
      seen.add(key);
      denseItems.push({ index, text });
    });
  };

  pushText(page.intro);
  blocks.forEach((block) => {
    if (block.text) pushText(block.text);
    if ((block.type === 'fact_grid' || block.type === 'checklist') && block.items?.length) {
      block.items.forEach((item, idx) => {
        const label = cleanDisplayCell(String(item.label || '')).replace(/^\d+\s*:\s*/, '');
        const value = cleanDisplayCell([item.value, item.detail].filter(Boolean).join(' • '));
        const text = [label, value].filter(Boolean).join(' • ');
        if (!text) return;
        const index = String(idx + 1);
        const key = `${index}:${text}`;
        if (seen.has(key)) return;
        seen.add(key);
        denseItems.push({ index, text });
      });
    }
  });

  return denseItems;
};

const extractFactPairs = (detail?: string) => {
  return splitLessonSentences(detail)
    .map((sentence) => {
      const match = sentence.match(/^([^:]{2,60}):\s*(.+)$/);
      if (!match) return null;
      return { label: match[1].trim(), value: match[2].trim() };
    })
    .filter(Boolean) as Array<{ label: string; value: string }>;
};

const LESSON_CARD_ICONS: Array<keyof typeof Ionicons.glyphMap> = [
  'business-outline',
  'library-outline',
  'shield-checkmark-outline',
  'heart-outline',
  'flag-outline',
  'globe-outline',
  'document-text-outline',
  'school-outline',
];

const buildLessonOverview = (title: string, notes: Array<{ title: string; detail: string }>) => {
  const items = notes.slice(0, 5).map((note) => note.title);
  if (!items.length) {
    return 'Work through each page at your own pace, then lock it in with recall cards and exam practice.';
  }
  return [
    `By the end of this session you should be able to explain: ${items.join(', ')}.`,
    'Read each page like coaching notes — learn the idea, note the trap, then test yourself in Exam Practice.',
  ].join(' ');
};

const buildFallbackLessonPages = (title: string, notes: Array<{ title: string; detail: string }>): any[] => {
  return [
    {
      title: 'Overview',
      type: 'overview',
      intro: buildLessonOverview(title, notes),
      blocks: [
        {
          type: 'fact_grid',
          items: notes.slice(0, 6).map((note) => ({ label: note.title, value: 'Study page' })),
        },
      ],
    },
    ...notes.map((note) => {
      const facts = extractFactPairs(note.detail);
      const trap = splitLessonSentences(note.detail).find((sentence) => /trap|not\s+\d|not\s+[a-z]/i.test(sentence));
      return {
        title: note.title,
        type: 'concept',
        blocks: [
          facts.length >= 3
            ? { type: /date|meeting|adopted|enforced|formed|time/i.test(note.detail) ? 'timeline' : 'fact_grid', items: facts }
            : { type: 'text', text: note.detail },
          ...(trap ? [{ type: 'trap' as const, text: trap }] : []),
        ],
      };
    }),
  ];
};

const buildLessonTableRows = (title: string, detail?: string) => {
  if (!/Constitution Structure/i.test(title)) return [];
  const rows = [
    ['Original Constitution', '22 Parts', '395 Articles', '8 Schedules'],
    ['Current structure', '25 Parts', '448+ Articles', '12 Schedules'],
  ];
  return detail ? rows : [];
};

const getPageBlocks = (page: MissionLessonPage, activeColor: string) => {
  const blocks = page.blocks || [];
  const tableRows = buildLessonTableRows(page.title, page.intro || blocks.map((b) => b.text).join(' '));
  if (tableRows.length > 0) {
    return [
      {
        type: 'table' as const,
        headers: ['Section', 'Parts', 'Articles', 'Schedules'],
        rows: tableRows,
      },
    ];
  }
  return blocks.length ? blocks : [{ type: 'text' as const, text: page.intro || '' }];
};

const getVisualPageIntro = (
  page: MissionLessonPage,
  blocks: NonNullable<MissionLessonPage['blocks']>
) => {
  const firstBlockText = String(blocks[0]?.text || '');
  if (/recitation|schedule/i.test(page.title || '') || extractRecitationItems(firstBlockText).length >= 4) {
    return '';
  }
  if (page.intro) return page.intro;
  const firstType = blocks[0]?.type;
  if (/Constitution Structure/i.test(page.title)) {
    return 'The Constitution of India began in 1949 with 22 Parts, 395 Articles and 8 Schedules. Amendments have expanded it, so the present structure is larger than the original text.';
  }
  if (firstType === 'table') return '';
  if (firstType === 'timeline') return '';
  if (firstType === 'fact_grid') return '';
  return '';
};

const buildLegacyReaderSection = (
  page: MissionLessonPage,
  color: string,
  pageIndex: number,
  topicName: string
) => {
  const blocks = getPageBlocks(page, color);
  const intro = getVisualPageIntro(page, blocks);
  const displayTitle = humanizeSectionTitle(
    pageIndex === 0 && page.title === topicName ? 'Overview' : page.title
  );
  const contentParts: string[] = [];
  const items: string[] = [];
  const traps: string[] = [];

  if (intro) {
    contentParts.push(intro);
  }

  blocks.forEach((block) => {
    if (block.type === 'table' && block.rows?.length) {
      block.rows.forEach((row) => {
        const line = row.map((cell) => cleanDisplayCell(cell)).filter(Boolean).join(' • ');
        if (line) items.push(line);
      });
      return;
    }

    if ((block.type === 'fact_grid' || block.type === 'checklist' || block.type === 'timeline') && block.items?.length) {
      block.items.forEach((item, idx) => {
        const parts = [item.label, item.value, item.detail]
          .filter(Boolean)
          .map((value) => cleanDisplayCell(String(value)));
        const line = parts.join(' • ');
        if (!line) return;
        items.push(line);
      });
      return;
    }

    if (block.type === 'trap' && block.text) {
      traps.push(cleanDisplayCell(block.text));
      return;
    }

    if (block.type === 'formula' && block.text) {
      items.push(block.title ? `${cleanDisplayCell(block.title)}: ${cleanDisplayCell(block.text)}` : cleanDisplayCell(block.text));
      return;
    }

    if (block.type === 'text' && block.text) {
      const recitationItems = extractRecitationItems(block.text);
      if (recitationItems.length >= 4 || /recitation|schedule/i.test(String(block.title || displayTitle))) {
        recitationItems.forEach((item) => {
          const [lead, ...rest] = item.split(':');
          const text = rest.join(':').trim();
          if (text) items.push(text);
        });
        return;
      }
      contentParts.push(block.title ? `${cleanDisplayCell(block.title)}\n${cleanDisplayCell(block.text)}` : cleanDisplayCell(block.text));
      return;
    }

    if (block.text) {
      contentParts.push(cleanDisplayCell(block.text));
    }
  });

  // Final pass: enumerated runs ("1: …, 2: …") buried inside paragraphs become
  // list items; trap sentences move to the dedicated callout; topic echoes go.
  const prose: string[] = [];
  contentParts.filter(Boolean).forEach((part) => {
    const enumerated = extractRecitationItems(part);
    if (enumerated.length >= 3) {
      enumerated.forEach((item) => {
        const [, ...rest] = item.split(':');
        const text = rest.join(':').trim();
        if (text) items.push(text);
      });
      return;
    }
    const kept = splitLessonSentences(stripTopicEcho(part)).filter((sentence) => {
      if (/^(?:exam\s+)?trap\s*[:\-—]/i.test(sentence)) {
        traps.push(sentence.replace(/^(?:exam\s+)?trap\s*[:\-—]\s*/i, '').trim());
        return false;
      }
      return true;
    });
    if (kept.length) prose.push(kept.join(' '));
  });

  const dedupedItems = Array.from(new Set(items.filter(Boolean).map(normalizePointSeparators)));
  let points = dedupedItems.flatMap(parseReaderPoint).filter((p) => p.text).slice(0, 16);
  if (isScheduleListSection(displayTitle, points)) {
    points = CONSTITUTION_SCHEDULES;
  }

  return {
    title: displayTitle,
    content: prose.join('\n\n').trim(),
    points,
    traps: Array.from(new Set(traps.filter(Boolean).map(stripTrapPrefix))),
  };
};

const LessonBlockRenderer = ({
  block,
  activeColor,
  blockIndex,
}: {
  block: NonNullable<MissionLessonPage['blocks']>[number];
  activeColor: string;
  blockIndex: number;
}) => {
  if (block.type === 'table' && block.rows?.length) {
    const headers = block.headers || [];
    return (
      <View style={[styles.lessonTable, { borderColor: '#DCE7F3', backgroundColor: '#FFFFFF', borderLeftWidth: 6, borderLeftColor: activeColor }]}>
        {headers.length > 0 && (
          <View style={[styles.lessonTableHeader, { backgroundColor: `${activeColor}18`, borderBottomColor: `${activeColor}26` }]}>
            {headers.map((header) => (
              <Text key={header} style={[styles.lessonTableHeaderText, { color: activeColor }]}>{header}</Text>
            ))}
          </View>
        )}
        {block.rows.map((row, rowIdx) => (
          <View
            key={`${row.join('-')}-${rowIdx}`}
            style={[
              styles.lessonTableRow,
              {
                borderBottomColor: `${activeColor}18`,
                backgroundColor: rowIdx % 2 === 0 ? 'rgba(255,255,255,0.82)' : `${activeColor}06`,
              }
            ]}
          >
            {row.map((cell, cellIdx) => (
              <Text key={`${cell}-${cellIdx}`} style={[styles.lessonTableCell, cellIdx === 0 && styles.lessonTableFirstCell]}>
                {cleanDisplayCell(cell)}
              </Text>
            ))}
          </View>
        ))}
      </View>
    );
  }

  if ((block.type === 'fact_grid' || block.type === 'checklist') && block.items?.length) {
    if (/recitation|schedule/i.test(String(block.items?.[0]?.label || '')) || block.items.length >= 8) {
      return (
        <View style={styles.recitationGrid}>
          {block.items.map((item, idx) => (
            <View key={`${item.label}-${idx}`} style={styles.recitationItem}>
              <Text style={[styles.recitationIndex, { color: activeColor }]}>{idx + 1}</Text>
              <Text style={styles.recitationText}>
                {[item.label, item.value, item.detail].filter(Boolean).map((value) => cleanDisplayCell(String(value))).join(' • ')}
              </Text>
            </View>
          ))}
        </View>
      );
    }
    return (
      <View style={block.type === 'checklist' ? styles.checklistGrid : styles.overviewList}>
        {block.items.map((item, idx) => {
          const color = GOOGLE_LESSON_COLORS[(blockIndex + idx) % GOOGLE_LESSON_COLORS.length];
          const iconName = LESSON_CARD_ICONS[idx % LESSON_CARD_ICONS.length];
          const title = cleanDisplayCell(String(item.label || ''));
          const subtitle = cleanDisplayCell(
            [item.value !== 'Learning page' ? item.value : '', item.detail].filter(Boolean).join(' • ')
          );
          if (block.type === 'checklist') {
            return (
              <View key={`${item.label}-${idx}`} style={[styles.lessonShowcaseCard, { borderLeftColor: color }]}>
                <View style={[styles.lessonShowcaseIconWrap, { backgroundColor: color }]}>
                  <Ionicons name={iconName} size={24} color="#FFFFFF" />
                </View>
                <View style={styles.lessonShowcaseTextWrap}>
                  {!!title && <Text style={styles.lessonShowcaseTitle}>{title}</Text>}
                  {!!subtitle && <Text style={styles.lessonShowcaseSubtitle}>{subtitle}</Text>}
                </View>
              </View>
            );
          }
          return (
            <View key={`${item.label}-${idx}`} style={[styles.lessonShowcaseCard, { borderLeftColor: color }]}>
              <View style={[styles.lessonShowcaseIconWrap, { backgroundColor: color }]}>
                <Ionicons name={iconName} size={24} color="#FFFFFF" />
              </View>
              <View style={styles.lessonShowcaseTextWrap}>
                {!!title && <Text style={styles.lessonShowcaseTitle}>{title}</Text>}
                {!!subtitle && <Text style={styles.lessonShowcaseSubtitle}>{subtitle}</Text>}
              </View>
            </View>
          );
        })}
      </View>
    );
  }

  if (block.type === 'timeline' && block.items?.length) {
    return (
      <View style={styles.timelineBlock}>
        {block.items.map((item, idx) => (
          <View key={`${item.label}-${idx}`} style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, { backgroundColor: activeColor }]} />
              {idx < (block.items?.length || 0) - 1 && <View style={styles.timelineLine} />}
            </View>
            <View style={[styles.timelineCard, { borderLeftWidth: 6, borderLeftColor: activeColor }]}>
              {!!item.label && <Text style={styles.timelineLabel}>{cleanDisplayCell(item.label)}</Text>}
              {!!item.value && <Text style={styles.timelineValue}>{cleanDisplayCell(item.value)}</Text>}
              {!!item.detail && <Text style={styles.timelineValue}>{cleanDisplayCell(item.detail)}</Text>}
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (block.type === 'trap') {
    return (
      <View style={[styles.lessonTrapCallout, { borderColor: '#FDE68A', backgroundColor: '#FFFFFF', borderLeftWidth: 6, borderLeftColor: activeColor }]}>
        <Ionicons name="alert-circle-outline" size={18} color={activeColor} />
        <Text style={styles.lessonTrapText}>{block.text}</Text>
      </View>
    );
  }

  if (block.type === 'formula') {
    return (
      <View style={[styles.formulaBlock, { borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', borderLeftWidth: 6, borderLeftColor: activeColor }]}>
        {!!block.title && <Text style={[styles.formulaTitle, { color: activeColor }]}>{block.title}</Text>}
        <Text style={styles.formulaText}>{block.text}</Text>
      </View>
    );
  }

  if (block.type === 'text' && block.text) {
    const recitationItems = extractRecitationItems(block.text);
    const isRecitationBlock = /recitation|schedule/i.test(String(block.title || ''));
    if (recitationItems.length >= 4 || isRecitationBlock) {
      const normalizedItems = recitationItems.length
        ? recitationItems
        : String(block.text)
            .replace(/\s+/g, ' ')
            .split(/(?=\d+\s*:)/)
            .map((item) => item.trim().replace(/^[,.\s]+/, ''))
            .filter(Boolean);
      return (
        <View style={[styles.lessonTextCard, styles.recitationTextCard, { borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', borderLeftWidth: 6, borderLeftColor: activeColor }]}>
          {!!block.title && <Text style={[styles.lessonPageTitle, styles.recitationBlockTitle, { color: activeColor, marginBottom: 10 }]}>{block.title}</Text>}
          <View style={styles.recitationDenseGrid}>
            {normalizedItems.map((item, idx) => {
              const [lead, ...rest] = item.split(':');
              return (
                <View key={`${item}-${idx}`} style={[styles.recitationDenseItem, { borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', borderLeftWidth: 4, borderLeftColor: activeColor }]}>
                  <Text style={[styles.recitationDenseIndex, { color: activeColor }]}>{lead.trim()}</Text>
                  <Text style={styles.recitationDenseText}>{rest.join(':').trim()}</Text>
                </View>
              );
            })}
          </View>
        </View>
      );
    }
    return (
      <View style={[styles.lessonTextCard, { borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', borderLeftWidth: 6, borderLeftColor: activeColor }]}>
        {!!block.title && <Text style={[styles.lessonPageTitle, { color: activeColor, marginBottom: 10 }]}>{block.title}</Text>}
        <Text style={styles.lessonSentence}>{block.text}</Text>
      </View>
    );
  }

  const sentences = splitLessonSentences(block.text);
  return (
    <>
      {!!block.title && <Text style={styles.blockTitle}>{block.title}</Text>}
      {sentences.length > 1 ? (
        sentences.map((sentence, idx) => (
          <View key={`${sentence}-${idx}`} style={styles.lessonSentenceRow}>
            <View style={[styles.lessonSentenceDot, { backgroundColor: activeColor }]} />
            <Text style={styles.lessonSentence}>{sentence}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.lessonSentence}>{block.text}</Text>
      )}
    </>
  );
};

// ── Rich reading-notes renderer ─────────────────────────────────────────────
// Renders getPageBlocks() blocks as real tables / timelines / definition rows /
// chunked highlighted paragraphs, instead of flattening them into a wall of text.
// Highlight the exam-important CONCEPTS — the quoted key terms ("equality before
// the law", "reasonable classification") plus amendments / years / percentages —
// NOT bare article numbers (they repeat), and only the FIRST time each appears.
const HL_SPLIT = /(\*\*[^*]+\*\*|"[^"]{2,52}"|\d+(?:st|nd|rd|th)\s+Amendment|\b\d{4}\b|\b\d+%)/g;

function HighlightedText({ text, accent, style }: { text: string; accent: string; style?: any }) {
  const parts = String(text).split(HL_SPLIT);
  const seen = new Set<string>();
  return (
    <Text style={style}>
      {parts.map((p, i) => {
        if (!p) return null;
        if (/^\*\*[^*]+\*\*$/.test(p)) return <Text key={i} style={styles.rbBold}>{p.slice(2, -2)}</Text>;
        const quoted = /^"[^"]+"$/.test(p);
        const isHL = quoted || /^(?:\d+(?:st|nd|rd|th)\s+Amendment|\d{4}|\d+%)$/.test(p);
        if (!isHL) return p;
        const display = quoted ? p.replace(/^"|"$/g, '') : p;
        const key = display.toLowerCase();
        if (seen.has(key)) return display;
        seen.add(key);
        return <Text key={i} style={[styles.rbTerm, quoted && styles.rbTermStrong, { color: accent }]}>{display}</Text>;
      })}
    </Text>
  );
}

// Generic scaffolding copy the generator pads pages with — pure noise, never show it.
const FILLER_RE = /usually tests this page|work through each page|at your own pace|lock it in with recall|read each page like coaching|learn the idea.{0,6}note the trap/i;
// Sentences that deserve a highlighted callout instead of a plain bullet.
const IMPORTANT_RE = /^\s*(don'?t|do not|never|always|remember|note[:\s]|warning|caution|tip[:\s]|important|must\b|avoid|key\b|pro tip)/i;

function splitSentences(text: string): string[] {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  const parts = clean.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [clean];
  return parts.map((s) => s.trim()).filter((s) => s.replace(/[^\w஀-௿]/g, '').length > 1);
}
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii'];

// Render-time enrichment: pull a clean short comma-list out of a sentence so the
// items show as chips instead of prose. Conservative — fails to null (plain point)
// unless it finds 3-7 short items after a ":" / "such as" / "including" / "of".
function extractChipList(text: string): { lead: string; items: string[] } | null {
  const t = String(text).trim().replace(/[.;]$/, '');
  const parts = t.split(/,\s*/);
  if (parts.length < 3) return null;
  const clausey = /\b(is|are|was|were|be|been|has|have|had|will|can|could|which|that|who|means?|include[sd]?|allow\w*|permit\w*|because|when|where|while|so|but|treat|give|refers?)\b/i;
  const clean = (s: string) => s.replace(/^(?:and|or)\s+/i, '').replace(/[.;]$/, '').trim();
  const isItem = (s: string) => { const c = clean(s); const w = c.split(/\s+/); return c.length >= 2 && c.length <= 26 && w.length <= 3 && /^[A-Za-z(]/.test(c) && !clausey.test(c); };
  // Longest trailing run of clean, short, list-like items.
  let start = parts.length;
  for (let i = parts.length - 1; i >= 0; i--) { if (isItem(parts[i])) start = i; else break; }
  let items = parts.slice(start).map(clean);
  let lead = parts.slice(0, start).join(', ');
  // Recover a first item glued to the lead's tail ("...reason is their religion").
  if (start > 0) {
    const pw = parts[start - 1].trim().split(/\s+/);
    const cand = (pw[pw.length - 1] || '').replace(/[^A-Za-z()]/g, '');
    if (cand.length >= 3 && !clausey.test(cand)) { items.unshift(cand); lead = [...parts.slice(0, start - 1), pw.slice(0, -1).join(' ')].join(', '); }
  }
  if (items.length < 3 || items.length > 7) return null;
  lead = lead.trim().replace(/[,:]$/, '').replace(/\s+(?:of|is|are|their|the|only|following|namely|reason|as)$/i, '').trim();
  if (lead.length < 3) return null;
  return { lead, items };
}

function Callout({ text, accent }: { text: string; accent: string }) {
  return (
    <View style={[styles.rbCallout, { borderLeftColor: accent, backgroundColor: `${accent}0E` }]}>
      <Ionicons name="bulb" size={14} color={accent} style={{ marginTop: 1 }} />
      <HighlightedText text={text} accent={accent} style={styles.rbCalloutText} />
    </View>
  );
}

function renderReaderBlock(block: any, accent: string) {
  if (!block) return null;
  switch (block.type) {
    case 'table': {
      if (!block.rows?.length) return null;
      const cols = Math.max(block.headers?.length || 0, ...block.rows.map((r: any[]) => r.length));
      const wide = cols > 3; // <=3 columns fill the card with equal widths; more scroll.
      const cellStyle = wide ? styles.rbTableCell : styles.rbTableCellFlex;
      const inner = (
        <View style={[styles.rbTable, !wide && styles.rbTableFull]}>
          {block.headers?.length ? (
            <View style={[styles.rbTableRow, { backgroundColor: `${accent}12` }]}>
              {block.headers.map((h: string, i: number) => (
                <Text key={i} style={[cellStyle, styles.rbTableHeadCell, { color: accent }]}>{cleanDisplayCell(h)}</Text>
              ))}
            </View>
          ) : null}
          {block.rows.map((row: string[], ri: number) => (
            <View key={ri} style={[styles.rbTableRow, ri % 2 === 1 && { backgroundColor: '#F8FAFC' }]}>
              {row.map((cell: string, ci: number) => (
                <Text key={ci} style={[cellStyle, ci === 0 && styles.rbTableCellLead]}>{cleanDisplayCell(cell)}</Text>
              ))}
            </View>
          ))}
        </View>
      );
      return wide ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{inner}</ScrollView> : inner;
    }
    case 'fact_grid':
    case 'checklist': {
      if (!block.items?.length) return null;
      // Overview grids carry filler values ("Study page") — render the topics as a
      // clean numbered "what you'll cover" list rather than junk label -> value rows.
      const meaningless = block.type === 'fact_grid' && block.items.every((it: any) =>
        !it.value || /^study page$/i.test(String(it.value).trim()) || String(it.value).trim() === String(it.label ?? '').trim());
      if (meaningless) {
        return (
          <View style={styles.rbDefCard}>
            {block.items.map((it: any, i: number) => (
              <View key={i} style={[styles.rbAgendaRow, i > 0 && styles.rbDefDivider]}>
                <View style={[styles.rbNumChip, { backgroundColor: accent }]}><Text style={styles.rbNumChipText}>{i + 1}</Text></View>
                <Text style={styles.rbAgendaText}>{cleanDisplayCell(String(it.label ?? ''))}</Text>
                <Ionicons name="chevron-forward" size={15} color="#C7CDDC" />
              </View>
            ))}
          </View>
        );
      }
      return (
        <View style={styles.rbDefCard}>
          {block.items.map((item: any, i: number) => {
            const label = cleanDisplayCell(String(item.label ?? ''));
            const value = cleanDisplayCell(String(item.value ?? item.detail ?? ''));
            if (block.type === 'checklist') {
              return (
                <View key={i} style={[styles.rbDefRow2, i > 0 && styles.rbDefDivider]}>
                  <Ionicons name="checkmark-circle" size={16} color={accent} style={{ marginTop: 1 }} />
                  <Text style={styles.rbDefValue}>{[label, value].filter(Boolean).join(': ')}</Text>
                </View>
              );
            }
            return (
              <View key={i} style={[styles.rbDefRow2, i > 0 && styles.rbDefDivider]}>
                {value
                  ? <Text style={[styles.rbDefLabel, { color: accent }]}>{label}</Text>
                  : <View style={[styles.rbDot, { backgroundColor: accent }]} />}
                <Text style={styles.rbDefValue}>{value || label}</Text>
              </View>
            );
          })}
        </View>
      );
    }
    case 'timeline': {
      if (!block.items?.length) return null;
      return (
        <View style={styles.rbTimeline}>
          {block.items.map((item: any, i: number) => (
            <View key={i} style={styles.rbTlRow}>
              <View style={styles.rbTlLeft}>
                <View style={[styles.rbTlDot, { backgroundColor: accent }]} />
                {i < block.items.length - 1 && <View style={styles.rbTlLine} />}
              </View>
              <View style={styles.rbTlBody}>
                <Text style={[styles.rbTlLabel, { color: accent }]}>{cleanDisplayCell(String(item.label ?? ''))}</Text>
                {!!(item.value ?? item.detail) && <Text style={styles.rbTlValue}>{cleanDisplayCell(String(item.value ?? item.detail ?? ''))}</Text>}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case 'trap': {
      if (!block.text) return null;
      return <Callout text={cleanDisplayCell(block.text)} accent={accent} />;
    }
    case 'formula': {
      if (!block.text) return null;
      return (
        <View style={[styles.rbFormula, { borderColor: `${accent}44`, backgroundColor: `${accent}08` }]}>
          {!!block.title && <Text style={[styles.rbFormulaTitle, { color: accent }]}>{cleanDisplayCell(block.title)}</Text>}
          <Text style={styles.rbFormulaText}>{cleanDisplayCell(block.text)}</Text>
        </View>
      );
    }
    case 'stat': {
      if (!block.items?.length) return null;
      return (
        <View style={styles.rbStatRow}>
          {block.items.map((it: any, i: number) => (
            <View key={i} style={[styles.rbStatCard, { borderColor: `${accent}30`, backgroundColor: `${accent}0A` }]}>
              <Text style={[styles.rbStatValue, { color: accent }]}>{cleanDisplayCell(String(it.value ?? it.label ?? ''))}</Text>
              <Text style={styles.rbStatLabel}>{cleanDisplayCell(String(it.label ?? it.detail ?? ''))}</Text>
            </View>
          ))}
        </View>
      );
    }
    case 'flow': {
      if (!block.items?.length) return null;
      return (
        <View>
          {block.items.map((it: any, i: number) => {
            const label = typeof it === 'string' ? it : (it.label ?? it.value ?? '');
            const detail = typeof it === 'string' ? '' : (it.value ?? it.detail ?? '');
            return (
              <View key={i}>
                <View style={styles.rbFlowStep}>
                  <View style={[styles.rbFlowNum, { backgroundColor: accent }]}><Text style={styles.rbNumChipText}>{i + 1}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rbFlowLabel}>{cleanDisplayCell(String(label))}</Text>
                    {!!detail && <Text style={styles.rbTlValue}>{cleanDisplayCell(String(detail))}</Text>}
                  </View>
                </View>
                {i < block.items.length - 1 && <View style={styles.rbFlowArrow}><Ionicons name="arrow-down" size={15} color={accent} /></View>}
              </View>
            );
          })}
        </View>
      );
    }
    case 'dodont': {
      const dos = block.do || block.dos || [];
      const donts = block.dont || block.donts || [];
      if (!dos.length && !donts.length) return null;
      return (
        <View style={styles.rbDDRow}>
          <View style={[styles.rbDDCol, { borderColor: '#B4E0CF', backgroundColor: '#E7F5EF' }]}>
            <View style={styles.rbDDHead}><Ionicons name="checkmark-circle" size={14} color="#059669" /><Text style={[styles.rbDDTitle, { color: '#059669' }]}>{cleanDisplayCell(String(block.doTitle || 'Do'))}</Text></View>
            {dos.map((d: any, i: number) => <View key={i} style={styles.rbDDItemRow}><View style={[styles.rbDDDot, { backgroundColor: '#059669' }]} /><Text style={styles.rbDDItem}>{cleanDisplayCell(String(d))}</Text></View>)}
          </View>
          <View style={[styles.rbDDCol, { borderColor: '#F5C4CF', backgroundColor: '#FCE9EE' }]}>
            <View style={styles.rbDDHead}><Ionicons name="close-circle" size={14} color="#E11D48" /><Text style={[styles.rbDDTitle, { color: '#E11D48' }]}>{cleanDisplayCell(String(block.dontTitle || "Don't"))}</Text></View>
            {donts.map((d: any, i: number) => <View key={i} style={styles.rbDDItemRow}><View style={[styles.rbDDDot, { backgroundColor: '#E11D48' }]} /><Text style={styles.rbDDItem}>{cleanDisplayCell(String(d))}</Text></View>)}
          </View>
        </View>
      );
    }
    case 'mindmap':
    case 'branch': {
      const items = block.branches || block.items || [];
      if (!items.length) return null;
      return (
        <View style={styles.rbMindWrap}>
          {!!block.center && <View style={[styles.rbMindCenter, { backgroundColor: accent }]}><Text style={styles.rbMindCenterT}>{cleanDisplayCell(String(block.center))}</Text></View>}
          <View style={styles.rbMindBranches}>
            {items.map((b: any, i: number) => {
              const label = typeof b === 'string' ? b : (b.label ?? b.value ?? '');
              const detail = typeof b === 'string' ? '' : (b.value ?? b.detail ?? '');
              return (
                <View key={i} style={[styles.rbMindNode, { borderColor: `${accent}30`, backgroundColor: `${accent}0A` }]}>
                  <Text style={[styles.rbMindNodeT, { color: accent }]}>{cleanDisplayCell(String(label))}</Text>
                  {!!detail && <Text style={styles.rbMindNodeD}>{cleanDisplayCell(String(detail))}</Text>}
                </View>
              );
            })}
          </View>
        </View>
      );
    }
    default: {
      const raw = cleanDisplayCell(String(block.text ?? ''));
      if (!raw.trim() || FILLER_RE.test(raw)) return null;
      const title = block.title ? <Text style={styles.rbHeading}>{cleanDisplayCell(block.title)}</Text> : null;

      // Explicit "1: ... 2: ..." runs -> numbered list.
      const recite = extractRecitationItems(raw);
      if (recite.length >= 2) {
        return (
          <View style={[styles.rbGroup, { backgroundColor: `${accent}08` }]}>
            {title}
            {recite.map((it: string, i: number) => {
              const [lead, ...rest] = it.split(':');
              const val = rest.join(':').trim();
              return (
                <View key={i} style={styles.rbDefRow}>
                  <View style={[styles.rbNumChip, { backgroundColor: accent }]}><Text style={styles.rbNumChipText}>{i + 1}</Text></View>
                  <Text style={styles.rbDefValue}>{val || lead.trim()}</Text>
                </View>
              );
            })}
          </View>
        );
      }

      // Multi-sentence prose -> scannable numbered sub-points (i, ii, iii...) so two
      // points under the same concept don't share an identical bullet; "important"
      // lines become callouts.
      const sentences = splitSentences(raw);
      if (sentences.length >= 2) {
        let bn = 0;
        return (
          <View style={{ gap: 9 }}>
            {title}
            {sentences.map((s, i) => {
              if (IMPORTANT_RE.test(s)) return <Callout key={i} text={s} accent={accent} />;
              bn += 1;
              const marker = ROMAN[bn - 1] ? `${ROMAN[bn - 1]})` : `${bn}.`;
              const cl = extractChipList(s);
              if (cl) {
                return (
                  <View key={i} style={{ gap: 8 }}>
                    <View style={styles.rbPointRow}>
                      <Text style={[styles.rbRoman, { color: accent }]}>{marker}</Text>
                      <HighlightedText text={cl.lead} accent={accent} style={styles.rbPointText} />
                    </View>
                    <View style={styles.rbChipWrap}>
                      {cl.items.map((it, k) => (
                        <View key={k} style={[styles.rbChip, { backgroundColor: `${accent}12`, borderColor: `${accent}33` }]}>
                          <Text style={[styles.rbChipT, { color: accent }]}>{it}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              }
              return (
                <View key={i} style={styles.rbPointRow}>
                  <Text style={[styles.rbRoman, { color: accent }]}>{marker}</Text>
                  <HighlightedText text={s} accent={accent} style={styles.rbPointText} />
                </View>
              );
            })}
          </View>
        );
      }

      // Single line — callout if it's a directive, else a clean highlighted paragraph.
      if (IMPORTANT_RE.test(raw)) return <View>{title}<Callout text={raw} accent={accent} /></View>;
      return (
        <View style={{ gap: 8 }}>
          {title}
          <HighlightedText text={raw} accent={accent} style={styles.rbParagraph} />
        </View>
      );
    }
  }
}

function ReaderBlocks({ page, pageAccent }: { page: any; pageAccent: string }) {
  const rawBlocks: any[] = page?.blocks || [];
  const intro = getVisualPageIntro(page, rawBlocks);
  const items: React.ReactNode[] = [];
  // Intro -> split into numbered points (never a raw paragraph dump).
  if (intro && !FILLER_RE.test(intro)) {
    const r = renderReaderBlock({ type: 'text', text: intro }, pageAccent);
    if (r) items.push(r);
  }
  // Real structured blocks (traps, tables, grids) — only when the page has them.
  const structured = rawBlocks.length ? getPageBlocks(page, pageAccent) : [];
  structured.forEach((b: any, i: number) => {
    if (b?.type === 'text' && intro && String(b.text || '').trim() === String(intro).trim()) return;
    const rendered = renderReaderBlock(b, GOOGLE_LESSON_COLORS[(i + 1) % GOOGLE_LESSON_COLORS.length]);
    if (rendered) items.push(rendered);
  });
  if (!items.length) {
    const r = renderReaderBlock({ type: 'text', text: page?.intro || '' }, pageAccent);
    if (r) items.push(r);
  }
  return (
    <View style={{ gap: 14, marginTop: 4 }}>
      {items.map((node, i) => (
        <MotiView
          key={i}
          from={{ opacity: 0, translateY: 18 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 400, delay: 80 + i * 120 }}
        >
          {node}
        </MotiView>
      ))}
    </View>
  );
}

// Derive the correct option index for a quiz question (some payloads leave
// `answer` undefined but embed the answer text in the explanation).
function deriveCheckAnswer(q: any, opts: string[]): number {
  if (typeof q.answer === 'number') return q.answer;
  if (typeof q.correct === 'number') return q.correct;
  const why = String(q.explanation || q.answer || q.correct || '').toLowerCase();
  let best = 0, bestLen = -1;
  opts.forEach((o, i) => { const t = String(o).toLowerCase().trim(); if (t && why.includes(t) && t.length > bestLen) { best = i; bestLen = t.length; } });
  return best;
}
function buildCheckFromQuiz(q: any) {
  const raw = q && (q.options || q.choices);
  if (!q || !Array.isArray(raw) || raw.length < 2) return null;
  const options = raw.map((o: any) => cleanDisplayCell(String(o)));
  return { kind: 'mcq' as const, question: cleanDisplayCell(String(q.question || q.q || '')), options, answer: deriveCheckAnswer(q, options), why: cleanDisplayCell(String(q.explanation || '')) };
}

// Derive a varied interaction from the page's own blocks (no distractors needed):
// a fact_grid becomes a MATCH, a timeline becomes an ORDER. Falls back to null
// (then the page uses its MCQ) so the interaction type varies page to page.
function deriveExercise(page: any, allPages?: any[]): any {
  const blocks = page?.blocks || [];
  const fg = blocks.find((b: any) => b.type === 'fact_grid' && Array.isArray(b.items)
    && b.items.filter((it: any) => it.label && (it.value || it.detail)).length >= 3);
  if (fg) {
    const items = fg.items.filter((it: any) => it.label && (it.value || it.detail)).slice(0, 5);
    return { kind: 'match', prompt: 'Match each term to its detail', pairs: items.map((it: any) => ({ l: cleanDisplayCell(String(it.label)).slice(0, 40), r: cleanDisplayCell(String(it.value ?? it.detail)).slice(0, 60) })) };
  }
  const tl = blocks.find((b: any) => b.type === 'timeline' && Array.isArray(b.items) && b.items.length >= 3 && b.items.length <= 5);
  if (tl) {
    const items = tl.items.map((it: any) => cleanDisplayCell(String(it.label ?? it.value ?? '')).slice(0, 44));
    if (items.every((s: string) => s.length > 1)) return { kind: 'order', prompt: 'Tap these in the correct order', items };
  }
  const mm = blocks.find((b: any) => (b.type === 'mindmap' || b.type === 'branch') && Array.isArray(b.branches) && b.branches.length >= 3 && b.branches.length <= 5);
  if (mm) {
    const clean = (s: any) => cleanDisplayCell(String(s ?? '')).trim();
    // An option (correct OR distractor) is only fit for a select-all if it's a
    // short, single-concept label: no article headings, no colon-style headings,
    // nothing long enough to be truncated mid-word. If ANY correct branch is
    // clumsy, the correct set would look different from plain distractors and give
    // the answer away — so we skip select-all for that page and fall back to MCQ.
    const clumsy = (s: string) => !s || s.length <= 1 || s.length > 30 || /^(art|article)\b/i.test(s) || s.includes(':');
    const correct = mm.branches.map((x: any) => clean(x.label));
    if (correct.every((s: string) => !clumsy(s)) && correct.length >= 3) {
      const maxLen = Math.max(16, ...correct.map((s: string) => s.length));
      const pool: string[] = [];
      (allPages || []).forEach((pg: any) => {
        if (pg === page) return;
        (pg.blocks || []).forEach((b: any) => {
          (b.branches || b.items || []).forEach((x: any) => {
            const l = clean(x.label);
            if (!clumsy(l) && l.length <= maxLen + 4 && correct.indexOf(l) < 0 && pool.indexOf(l) < 0) pool.push(l);
          });
        });
      });
      const distractors = pool.sort(() => Math.random() - 0.5).slice(0, 2);
      if (distractors.length >= 1) {
        return { kind: 'selectall', prompt: `Select all that belong to "${clean(mm.center).slice(0, 30)}"`, correct, options: [...correct, ...distractors].sort(() => Math.random() - 0.5) };
      }
    }
  }
  return null;
}

function MatchExercise({ pairs, accent, onSolved }: { pairs: { l: string; r: string }[]; accent: string; onSolved: () => void }) {
  const rights = useMemo(() => pairs.map((p, i) => ({ r: p.r, i })).sort(() => Math.random() - 0.5), [pairs]);
  const [selL, setSelL] = useState<number | null>(null);
  const [selR, setSelR] = useState<number | null>(null);
  const [matched, setMatched] = useState<number[]>([]);
  const [wrong, setWrong] = useState(false);
  const has = (i: number) => matched.indexOf(i) >= 0;
  const attempt = (li: number, ri: number) => {
    if (li === ri) {
      const n = [...matched, li]; setMatched(n); setSelL(null); setSelR(null);
      if (n.length === pairs.length) onSolved();
    } else { setWrong(true); setTimeout(() => { setWrong(false); setSelL(null); setSelR(null); }, 550); }
  };
  return (
    <View style={styles.matchWrap}>
      <View style={styles.matchCol}>
        {pairs.map((p, i) => (
          <TouchableOpacity key={i} activeOpacity={0.85} disabled={has(i)}
            onPress={() => { if (has(i)) return; setSelL(i); if (selR != null) attempt(i, selR); }}
            style={[styles.matchTile, has(i) && styles.matchDone, selL === i && !has(i) && { borderColor: accent, backgroundColor: `${accent}12` }, wrong && selL === i && styles.matchBad]}>
            <Text style={[styles.matchTileT, has(i) && { color: '#059669' }]} numberOfLines={3}>{p.l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.matchCol}>
        {rights.map((x, k) => (
          <TouchableOpacity key={k} activeOpacity={0.85} disabled={has(x.i)}
            onPress={() => { if (has(x.i)) return; setSelR(x.i); if (selL != null) attempt(selL, x.i); }}
            style={[styles.matchTile, has(x.i) && styles.matchDone, selR === x.i && !has(x.i) && { borderColor: accent, backgroundColor: `${accent}12` }, wrong && selR === x.i && styles.matchBad]}>
            <Text style={[styles.matchTileT, has(x.i) && { color: '#059669' }]} numberOfLines={3}>{x.r}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function OrderExercise({ items, accent, onSolved }: { items: string[]; accent: string; onSolved: () => void }) {
  const shuffled = useMemo(() => items.map((label, i) => ({ label, i })).sort(() => Math.random() - 0.5), [items]);
  const [seq, setSeq] = useState<number[]>([]);
  const [wrongIdx, setWrongIdx] = useState<number | null>(null);
  const tap = (orig: number) => {
    if (seq.indexOf(orig) >= 0) return;
    if (orig === seq.length) { const n = [...seq, orig]; setSeq(n); if (n.length === items.length) onSolved(); }
    else { setWrongIdx(orig); setTimeout(() => setWrongIdx(null), 480); }
  };
  return (
    <View style={{ gap: 8 }}>
      {shuffled.map((it) => {
        const done = seq.indexOf(it.i) >= 0;
        return (
          <TouchableOpacity key={it.i} activeOpacity={0.85} disabled={done} onPress={() => tap(it.i)}
            style={[styles.orderTile, done && styles.matchDone, wrongIdx === it.i && styles.matchBad]}>
            <View style={[styles.orderNum, { backgroundColor: done ? '#059669' : `${accent}18`, borderColor: done ? '#059669' : `${accent}44` }]}>
              <Text style={[styles.orderNumT, { color: done ? '#fff' : accent }]}>{done ? seq.indexOf(it.i) + 1 : ''}</Text>
            </View>
            <Text style={[styles.orderTileT, done && { color: '#059669' }]} numberOfLines={2}>{it.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
function SelectAllExercise({ options, correct, accent, onResult }: { options: string[]; correct: string[]; accent: string; onResult: (ok: boolean) => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const [locked, setLocked] = useState(false);
  const toggle = (o: string) => { if (locked) return; setSel((s) => (s.indexOf(o) >= 0 ? s.filter((x) => x !== o) : [...s, o])); };
  const check = () => {
    if (!sel.length) return;
    const ok = sel.length === correct.length && correct.every((c) => sel.indexOf(c) >= 0);
    setLocked(true); onResult(ok);
  };
  return (
    <View style={{ gap: 8 }}>
      {options.map((o, i) => {
        const isSel = sel.indexOf(o) >= 0;
        const isCorrect = correct.indexOf(o) >= 0;
        const good = locked && isCorrect;
        const bad = locked && isSel && !isCorrect;
        return (
          <TouchableOpacity key={i} activeOpacity={0.85} disabled={locked} onPress={() => toggle(o)}
            style={[styles.checkOpt, isSel && !locked && { borderColor: accent, backgroundColor: `${accent}0F` }, good && styles.checkOptGood, bad && styles.checkOptBad]}>
            <View style={[styles.checkBox, isSel && !locked && { backgroundColor: accent, borderColor: accent }, good && styles.checkBoxGood, bad && styles.checkBoxBad]}>
              {((isSel && !locked) || good) ? <Ionicons name="checkmark" size={12} color="#fff" /> : bad ? <Ionicons name="close" size={12} color="#fff" /> : null}
            </View>
            <Text style={styles.checkOptT}>{o}</Text>
          </TouchableOpacity>
        );
      })}
      {!locked && (
        <TouchableOpacity activeOpacity={0.85} onPress={check} disabled={!sel.length}
          style={[styles.selCheckBtn, { backgroundColor: sel.length ? accent : '#EEF2F9' }]}>
          <Text style={[styles.selCheckT, { color: sel.length ? '#fff' : '#9AA1B4' }]}>Check selection</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Article numbers mentioned in a string, expanding "Article 12 & 13" -> [12,13].
function artNums(s: any): string[] {
  const nums: string[] = [];
  const re = /art(?:icle)?s?\.?\s*(\d+)((?:\s*(?:&|and|,|to)\s*\d+)*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(s)))) { nums.push(m[1]); (m[2].match(/\d+/g) || []).forEach((n) => nums.push(n)); }
  return nums;
}
const CHECK_STOP = new Set(['about', 'point', 'which', 'their', 'before', 'following', 'under', 'these', 'equality', 'social']);
function titleWords(s: any): string[] {
  return (String(s).toLowerCase().match(/[a-z]{5,}/g) || []).filter((w) => !CHECK_STOP.has(w));
}
// Map each concept page to the quiz question about the SAME article/topic, so a
// check tests what was just taught (not a later page). Article match first, then
// keyword overlap; each question used at most once.
function buildChecksByPage(payload: any, pages: any[]): Record<number, any> {
  const quiz = payload?.quiz?.questions || payload?.quiz || [];
  const used = new Set<number>();
  const map: Record<number, any> = {};
  pages.forEach((pg: any, pi: number) => {
    if (pi < 1) return;
    const ex = deriveExercise(pg, pages); // match / order / select-all from blocks
    if (ex) { map[pi] = ex; return; }
    const pa = artNums(pg?.title);
    let best = -1;
    if (pa.length) {
      for (let qi = 0; qi < quiz.length; qi++) {
        if (used.has(qi)) continue;
        const qa = artNums((quiz[qi].question || quiz[qi].q || '') + ' ' + (quiz[qi].explanation || ''));
        if (qa.some((a) => pa.includes(a))) { best = qi; break; }
      }
    }
    if (best < 0) {
      const pk = titleWords(pg?.title);
      let bestScore = 0;
      quiz.forEach((q: any, qi: number) => {
        if (used.has(qi)) return;
        const qt = ((q.question || q.q || '') + ' ' + (q.explanation || '')).toLowerCase();
        const score = pk.reduce((s: number, w: string) => s + (qt.includes(w) ? 1 : 0), 0);
        if (score > bestScore) { bestScore = score; best = qi; }
      });
      if (bestScore < 1) best = -1;
    }
    // Last resort: page order (concept pages start at index 1), for authored days
    // whose quiz is written page-by-page but whose titles carry no article number.
    if (best < 0) { const idx = pi - 1; if (idx >= 0 && idx < quiz.length && !used.has(idx)) best = idx; }
    if (best < 0) return;
    used.add(best);
    const c = buildCheckFromQuiz(quiz[best]);
    if (c) map[pi] = c;
  });
  return map;
}

const SnapshotContent = ({ payload, setReadyToComplete, scrollRef }: { payload: MissionPayload | null; setReadyToComplete: (value: boolean) => void; scrollRef: React.RefObject<ScrollView>; }) => {
  const [pageIndex, setPageIndex] = useState(0);
  const snapshot = payload?.snapshot;
  if (!snapshot) return <Text style={styles.errorText}>No snapshot data found.</Text>;
  const notes = snapshot.quick_notes || [];
  const topicName = cleanMissionTitle(payload?.topic_title || snapshot.title || 'this topic');
  const pages = payload?.lesson_pages && payload.lesson_pages.length > 0
    ? payload.lesson_pages
    : buildFallbackLessonPages(topicName, notes);
  const activeNote = pages[pageIndex] || pages[0];
  const activeColor = GOOGLE_LESSON_COLORS[pageIndex % GOOGLE_LESSON_COLORS.length];
  const activeSection = buildLegacyReaderSection(activeNote, activeColor, pageIndex, topicName);
  const progress = pages.length ? ((pageIndex + 1) / pages.length) * 100 : 0;
  const prevDisabled = pageIndex === 0;
  const nextDisabled = pageIndex === pages.length - 1;

  // Interleaved check: after reading a concept page, prove it before advancing.
  const [checking, setChecking] = useState(false);
  const [checkSel, setCheckSel] = useState<number | null>(null);
  const [checkLocked, setCheckLocked] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [exerciseOk, setExerciseOk] = useState(true);
  const checksByPage = useMemo(() => buildChecksByPage(payload, pages), [payload]);
  const check = checksByPage[pageIndex] || null;
  const okNow = checking && checkLocked && !!check && checkSel === check.answer;

  useEffect(() => {
    setReadyToComplete(pageIndex === pages.length - 1 && (!check || checkLocked));
  }, [pageIndex, pages.length, check, checkLocked, setReadyToComplete]);

  const goToPage = (targetIndex: number) => {
    setChecking(false); setCheckSel(null); setCheckLocked(false); setShowConfetti(false); setExerciseOk(true);
    setPageIndex(targetIndex);
    scrollRef?.current?.scrollTo({ y: 0, animated: true });
  };

  const onNext = () => {
    if (checking) {
      if (!checkLocked) {
        if (checkSel != null) {
          setCheckLocked(true);
          if (check != null && checkSel === check.answer) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 1700); }
          setTimeout(() => scrollRef?.current?.scrollToEnd({ animated: true }), 120);
        }
      } else if (!nextDisabled) goToPage(pageIndex + 1);
      return;
    }
    if (check) { setChecking(true); scrollRef?.current?.scrollTo({ y: 0, animated: true }); return; }
    if (!nextDisabled) goToPage(pageIndex + 1);
  };

  const onExerciseSolved = (ok = true) => {
    setCheckLocked(true); setExerciseOk(ok);
    if (ok) { setShowConfetti(true); setTimeout(() => setShowConfetti(false), 1700); }
    setTimeout(() => scrollRef?.current?.scrollToEnd({ animated: true }), 150);
  };

  // Next-button label / colour across read -> check -> continue.
  let nextLabel = 'Next', nextIcon = 'arrow-right', nextBg = activeColor, nextIsDisabled = false;
  if (checking && !checkLocked) {
    if (check?.kind === 'mcq') { nextLabel = 'Check'; nextIsDisabled = checkSel == null; }
    else { nextLabel = check?.kind === 'match' ? 'Match them all' : check?.kind === 'selectall' ? 'Select the right ones' : 'Tap in order'; nextIsDisabled = true; }
  }
  else if (checking && checkLocked) {
    if (nextDisabled) { nextLabel = 'Ready'; nextIcon = 'check'; nextBg = '#059669'; }
    else { nextLabel = 'Continue'; }
  } else if (!check && nextDisabled) { nextLabel = 'Ready'; nextIcon = 'check'; nextBg = '#059669'; }

  return (
    <View style={styles.snapshotWrap}>
      {pages.length > 0 && activeNote && (
        <>
          <View style={[styles.lessonPageCard, styles.legacyReaderCard, { backgroundColor: '#FFFFFF', borderColor: '#E6EAF4' }]}>
            {/* Artwork header band — scene stays visible, never behind text */}
            <View style={styles.readerArtBand}>
              <ImageBackground
                source={require('@/assets/dailydoseinpagereal.png')}
                style={styles.readerArtImage}
                resizeMode="cover"
              />
              <View style={styles.readerArtPill}>
                <Text style={[styles.legacyReaderSectionPillText, { color: activeColor }]}>
                  Section {pageIndex + 1} of {pages.length}
                </Text>
              </View>
            </View>

            {/* Thin reading progress */}
            <View style={styles.readerProgressTrack}>
              <View style={[styles.readerProgressFill, { width: `${progress}%`, backgroundColor: activeColor }]} />
            </View>

            <View style={styles.legacyReaderOverlay}>
              {!checking && <Text style={styles.legacyReaderTitle}>{activeSection.title}</Text>}

              {checking && check ? (
                <View style={{ gap: 10, marginTop: 6 }}>
                  <Text style={[styles.checkEyebrow, { color: activeColor }]}>{check.kind === 'match' ? 'Match up' : check.kind === 'order' ? 'Order them' : 'Quick check'}</Text>
                  <Text style={styles.checkQ}>{check.kind === 'mcq' ? check.question : check.prompt}</Text>

                  {check.kind === 'match' ? (
                    <MatchExercise pairs={check.pairs} accent={activeColor} onSolved={onExerciseSolved} />
                  ) : check.kind === 'order' ? (
                    <OrderExercise items={check.items} accent={activeColor} onSolved={onExerciseSolved} />
                  ) : check.kind === 'selectall' ? (
                    <SelectAllExercise options={check.options} correct={check.correct} accent={activeColor} onResult={onExerciseSolved} />
                  ) : (
                    check.options.map((o: string, idx: number) => {
                      const isSel = checkSel === idx;
                      const good = checkLocked && idx === check.answer;
                      const bad = checkLocked && isSel && idx !== check.answer;
                      return (
                        <TouchableOpacity
                          key={idx}
                          activeOpacity={0.85}
                          disabled={checkLocked}
                          onPress={() => setCheckSel(idx)}
                          style={[styles.checkOpt, isSel && !checkLocked && { borderColor: activeColor, backgroundColor: `${activeColor}0F` }, good && styles.checkOptGood, bad && styles.checkOptBad]}
                        >
                          <View style={[styles.checkBox, isSel && !checkLocked && { backgroundColor: activeColor, borderColor: activeColor }, good && styles.checkBoxGood, bad && styles.checkBoxBad]}>
                            {good ? <Ionicons name="checkmark" size={12} color="#fff" /> : bad ? <Ionicons name="close" size={12} color="#fff" /> : null}
                          </View>
                          <Text style={styles.checkOptT}>{o}</Text>
                        </TouchableOpacity>
                      );
                    })
                  )}

                  {checkLocked && (check.kind === 'mcq' ? (
                    <View style={[styles.checkFb, okNow ? styles.checkFbOk : styles.checkFbNo]}>
                      <Text style={[styles.checkFbH, { color: okNow ? '#059669' : '#E11D48' }]}>{okNow ? 'Correct' : 'Not quite'}</Text>
                      {!!check.why && <Text style={styles.checkFbW}>{check.why}</Text>}
                    </View>
                  ) : (
                    <View style={[styles.checkFb, exerciseOk ? styles.checkFbOk : styles.checkFbNo]}>
                      <Text style={[styles.checkFbH, { color: exerciseOk ? '#059669' : '#E11D48' }]}>{exerciseOk ? 'Nailed it 🎯' : 'Check the highlighted ones'}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <ReaderBlocks key={pageIndex} page={activeNote} pageAccent={activeColor} />
              )}

              <View style={styles.legacyReaderNavRow}>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => goToPage(Math.max(0, pageIndex - 1))}
                  disabled={prevDisabled}
                  style={[styles.legacyReaderNavButton, styles.legacyReaderNavGhost, prevDisabled && { opacity: 0.55 }]}
                >
                  <FontAwesome5 name="arrow-left" size={11} color={prevDisabled ? '#CBD5E1' : '#475069'} />
                  <Text style={[styles.legacyReaderNavGhostText, prevDisabled && { color: '#CBD5E1' }]}>Prev</Text>
                </TouchableOpacity>

                <View style={styles.legacyReaderDots}>
                  {pages.map((_, idx) => (
                    <View
                      key={`dot-${idx}`}
                      style={[
                        styles.legacyReaderDot,
                        idx === pageIndex && [styles.legacyReaderDotActive, { backgroundColor: activeColor }],
                        idx < pageIndex && { backgroundColor: activeColor, opacity: 0.4 },
                      ]}
                    />
                  ))}
                </View>

                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={onNext}
                  disabled={nextIsDisabled}
                  style={[styles.legacyReaderNavButton, styles.legacyReaderNavSolid, { backgroundColor: nextBg, opacity: nextIsDisabled ? 0.5 : 1 }]}
                >
                  <Text style={styles.legacyReaderNavText}>{nextLabel}</Text>
                  <FontAwesome5 name={nextIcon} size={11} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </>
      )}
      {showConfetti && (
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <LottieView source={require('@/assets/lotties/confetti.json')} autoPlay loop={false} style={{ flex: 1 }} resizeMode="cover" />
        </View>
      )}
    </View>
  );
};

const FlashcardsContent = ({ payload, setReadyToComplete }: { payload: MissionPayload | null; setReadyToComplete: (value: boolean) => void }) => {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const cards = payload?.flashcards || [];

  if (cards.length === 0) return <Text style={styles.errorText}>No flashcards found.</Text>;

  const current = cards[index];
  const accent = GOOGLE_LESSON_COLORS[index % GOOGLE_LESSON_COLORS.length];
  const progress = cards.length ? ((index + 1) / cards.length) * 100 : 0;

  useEffect(() => {
    setReadyToComplete(index === cards.length - 1);
  }, [index, cards.length, setReadyToComplete]);

  const sourceLabel = String((current as any).source || '').includes('trap')
    ? 'Trap'
    : String((current as any).source || '').includes('timeline')
      ? 'Timeline'
      : String((current as any).source || '').includes('table')
        ? 'Pair'
        : 'Recall';

  return (
    <View style={styles.flashcardTool}>
      <View style={styles.flashDeckHeader}>
        <View>
          <Text style={styles.flashDeckEyebrow}>RECALL DECK</Text>
          <Text style={styles.flashDeckTitle}>{index + 1}/{cards.length}</Text>
        </View>
        <View style={[styles.flashDeckChip, { backgroundColor: `${accent}14`, borderColor: `${accent}44` }]}>
          <Ionicons name="layers-outline" size={14} color={accent} />
          <Text style={[styles.flashDeckChipText, { color: accent }]}>{sourceLabel}</Text>
        </View>
      </View>

      <View style={styles.flashProgressTrack}>
        <View style={[styles.flashProgressFill, { width: `${progress}%`, backgroundColor: accent }]} />
      </View>
      
      <TouchableOpacity 
        activeOpacity={1} 
        onPress={() => setFlipped(!flipped)}
        style={styles.cardTouch}
      >
        <View style={styles.flashcard}>
          <View style={styles.flashLiquidLayer} pointerEvents="none">
            <View style={[styles.flashLiquidOrbLarge, { backgroundColor: accent }]} />
            <View style={[styles.flashLiquidOrbSmall, { backgroundColor: GOOGLE_LESSON_COLORS[(index + 2) % GOOGLE_LESSON_COLORS.length] }]} />
          </View>

          <View style={[styles.flashcardSide, flipped && { opacity: 0 }]}>
            <Text style={styles.flashSideLabel}>Cue</Text>
            <Text style={styles.flashcardText}>{current.front}</Text>
            <View style={styles.flipPrompt}>
              <Ionicons name="finger-print-outline" size={13} color="#64748B" />
              <Text style={styles.flipPromptText}>Tap to reveal fact</Text>
            </View>
          </View>
          
          <View style={[styles.flashcardSide, styles.flashcardBack, !flipped && { opacity: 0 }]}>
            <Text style={[styles.flashSideLabel, { color: accent }]}>Remember</Text>
            <Text style={styles.flashcardText}>{current.back}</Text>
          </View>
        </View>
      </TouchableOpacity>

      {flipped && (
        <View style={styles.flashConfidenceRow}>
          {[
            ['repeat-outline', 'Again'],
            ['checkmark-circle-outline', 'Got it'],
            ['flash-outline', 'Strong'],
          ].map(([icon, label], idx) => (
            <TouchableOpacity
              key={label}
              activeOpacity={1}
              style={[styles.flashConfidenceButton, idx === 1 && { borderColor: `${accent}55`, backgroundColor: `${accent}10` }]}
              onPress={() => {
                if (index < cards.length - 1) {
                  setIndex((prev) => prev + 1);
                  setFlipped(false);
                }
              }}
            >
              <Ionicons name={icon as any} size={16} color={idx === 1 ? accent : '#64748B'} />
              <Text style={[styles.flashConfidenceText, idx === 1 && { color: accent }]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <View style={styles.flashcardControls}>
        <TouchableOpacity 
          style={styles.controlBtn} 
          activeOpacity={1} onPress={() => {
            setIndex(prev => Math.max(0, prev - 1));
            setFlipped(false);
          }}
          disabled={index === 0}
        >
          <Ionicons name="chevron-back" size={24} color={index === 0 ? '#CBD5E1' : '#0F172A'} />
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={styles.controlBtn} 
          activeOpacity={1} onPress={() => {
            if (index < cards.length - 1) {
              setIndex(prev => prev + 1);
              setFlipped(false);
            }
          }}
          disabled={index === cards.length - 1}
        >
          <Ionicons name="chevron-forward" size={24} color={index === cards.length - 1 ? '#CBD5E1' : '#0F172A'} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

interface VideoItem {
  title: string;
  url: string;
  summary?: string;
  duration_sec?: number;
}

const VideosContent = ({ payload, setReadyToComplete }: { payload: MissionPayload | null; userId?: string; setReadyToComplete: (value: boolean) => void }) => {
  const videos = payload?.videos || [];
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [playbackTime, setPlaybackTime] = useState<number>(0);
  const [notesText, setNotesText] = useState<string>('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const inputRef = useRef<TextInput>(null);
  const [openedExternal, setOpenedExternal] = useState(false);
  const webViewRef = useRef<WebView>(null);

  // A URL is playable in-app only if we can extract a real 11-char video id.
  // Most stored links are YouTube SEARCH urls (rot-proof, always relevant) which
  // can't be embedded — those open in the YouTube app/browser instead.
  const openVideo = (vid: VideoItem) => {
    if (getYouTubeVideoId(vid.url)) {
      setSelectedVideo(vid);
    } else {
      HapticService.light();
      Linking.openURL(vid.url).catch(() => {});
      setOpenedExternal(true); // can't track external playback — count as engaged
    }
  };

  useEffect(() => {
    // Ready once they've watched 15s of an embedded video OR opened an external one.
    if (openedExternal || (selectedVideo && playbackTime >= 15)) {
      setReadyToComplete(true);
    } else {
      setReadyToComplete(false);
    }
  }, [selectedVideo, playbackTime, openedExternal, setReadyToComplete]);

  useEffect(() => {
    if (selectedVideo) {
      const videoId = getYouTubeVideoId(selectedVideo.url) || selectedVideo.url;
      const loadNotes = async () => {
        try {
          const saved = await AsyncStorage.getItem(`@miga_notes_${videoId}`);
          setNotesText(saved || '');
          setPlaybackTime(0);
        } catch (e) {
          console.error("AsyncStorage error:", e);
        }
      };
      loadNotes();
    }
  }, [selectedVideo]);

  if (videos.length === 0) return <Text style={styles.errorText}>No recommended videos.</Text>;

  const handleNotesChange = async (text: string) => {
    setNotesText(text);
    if (selectedVideo) {
      const videoId = getYouTubeVideoId(selectedVideo.url) || selectedVideo.url;
      try {
        await AsyncStorage.setItem(`@miga_notes_${videoId}`, text);
      } catch (e) {
        console.error("Notes save failure:", e);
      }
    }
  };

  const seekPlayerTo = (seconds: number) => {
    HapticService.selection();
    webViewRef.current?.injectJavaScript(`window.seekToTime(${seconds}); true;`);
  };

  const tagCurrentFrame = () => {
    HapticService.medium();
    const mm = Math.floor(playbackTime / 60);
    const ss = Math.floor(playbackTime % 60);
    const timestampTag = `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}]`;
    const before = notesText.substring(0, selection.start);
    const after = notesText.substring(selection.end);
    const updated = before + timestampTag + after;
    handleNotesChange(updated);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  const renderParsedNotes = (text: string) => {
    if (!text.trim()) {
      return (
        <View style={styles.notesPlaceholder}>
          <Ionicons name="create-outline" size={32} color="#94A3B8" />
          <Text style={styles.notesPlaceholderText}>
            No notes taken yet. Use the Tag button to link notes to video timeline frames!
          </Text>
        </View>
      );
    }
    const regex = /(\[(\d{2}):(\d{2})\])/g;
    const parts = text.split(regex);
    const elements = [];
    let i = 0;
    while (i < parts.length) {
      if (parts[i]) {
        elements.push(<Text key={`txt-${i}`} style={styles.parsedNotesText}>{parts[i]}</Text>);
      }
      if (i + 1 < parts.length && parts[i + 1]) {
        const fullMatch = parts[i + 1];
        const mm = parseInt(parts[i + 2], 10);
        const ss = parseInt(parts[i + 3], 10);
        const secs = mm * 60 + ss;
        elements.push(
          <TouchableOpacity key={`badge-${i}`} style={styles.timeBadgePill} activeOpacity={0.7} onPress={() => seekPlayerTo(secs)}>
            <Ionicons name="play" size={10} color="#FFFFFF" />
            <Text style={styles.timeBadgeText}>{fullMatch.replace('[', '').replace(']', '')}</Text>
          </TouchableOpacity>
        );
        i += 4;
      } else {
        i += 1;
      }
    }
    return <View style={styles.notesFlowWrap}>{elements}</View>;
  };

  return (
    <View>
      <Text style={styles.sectionLabel}>VIDEO LESSONS</Text>
      {videos.map((vid, idx) => {
        const embeddable = !!getYouTubeVideoId(vid.url);
        return (
        <View key={`${vid.url}-${idx}`} style={styles.videoCardShell}>
          <TouchableOpacity style={styles.videoCard} activeOpacity={0.9} onPress={() => openVideo(vid)}>
            <LinearGradient colors={['#EA4335', '#C53929']} style={styles.videoPlayIcon}>
              <Ionicons name={embeddable ? 'play' : 'logo-youtube'} size={18} color="#FFFFFF" />
            </LinearGradient>
            <View style={styles.videoInfo}>
              <Text style={styles.videoTitle}>{vid.title}</Text>
              <View style={styles.videoMeta}>
                <Ionicons name={embeddable ? 'tv-outline' : 'open-outline'} size={14} color="#64748B" />
                <Text style={styles.videoDuration}>{embeddable ? (vid.duration_sec ? `${Math.floor(vid.duration_sec / 60)} mins` : 'Watch') : 'Watch on YouTube'}</Text>
              </View>
            </View>
            <View style={styles.cardIndicatorBadge}><Text style={styles.cardIndicatorText}>STUDY</Text></View>
          </TouchableOpacity>
        </View>
        );
      })}

      <Modal visible={!!selectedVideo} animationType="slide" transparent={false} onRequestClose={() => setSelectedVideo(null)}>
        {selectedVideo && (
          <SafeAreaView style={styles.cockpitContainer} edges={['top', 'left', 'right']}>
            <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />
            <View style={styles.cockpitHeader}>
              <TouchableOpacity style={styles.cockpitCloseBtn} onPress={() => setSelectedVideo(null)} activeOpacity={0.7}>
                <Ionicons name="chevron-back" size={24} color="#F8FAFC" />
                <Text style={styles.cockpitCloseText}>Back</Text>
              </TouchableOpacity>
              <View style={styles.cockpitTitleBlock}>
                <Text style={styles.cockpitHeaderTitle} numberOfLines={1}>{selectedVideo.title}</Text>
                <Text style={styles.cockpitSubTitle}>VIDEO LESSON</Text>
              </View>
              <View style={styles.cockpitHeaderRight}><LinearGradient colors={['#3B82F6', '#2563EB']} style={styles.studyPill}><Text style={styles.studyPillText}>LESSON</Text></LinearGradient></View>
            </View>

            <View style={styles.cockpitPlayerWrap}>
              <WebView
                ref={webViewRef}
                source={{ html: buildYouTubeInteractivePlayerHtml(getYouTubeVideoId(selectedVideo.url), selectedVideo.title), baseUrl: 'https://www.youtube-nocookie.com' }}
                style={styles.cockpitPlayer}
                javaScriptEnabled domStorageEnabled allowsFullscreenVideo allowsInlineMediaPlayback
                onMessage={(e) => { try { const d = JSON.parse(e.nativeEvent.data); if (d.type === 'timeupdate') setPlaybackTime(d.currentTime); } catch (err) {} }}
              />
            </View>

            <KeyboardAvoidingView behavior="padding" style={styles.cockpitTabContent}>
              <ScrollView contentContainerStyle={styles.notesTabWrap}>
                <View style={styles.notesEditorCard}>
                  <View style={styles.notesEditorHeader}>
                    <Text style={styles.notesEditorTitle}>STUDY NOTES</Text>
                    <TouchableOpacity style={styles.tagFrameBtn} onPress={tagCurrentFrame}><Text style={styles.tagFrameBtnText}>Add Timestamp</Text></TouchableOpacity>
                  </View>
                  <TextInput ref={inputRef} style={styles.notesTextInput} multiline value={notesText} onChangeText={handleNotesChange} onSelectionChange={(e) => setSelection(e.nativeEvent.selection)} />
                </View>
                <View style={styles.notesPreviewCard}><Text style={styles.notesPreviewLabel}>SAVED NOTES</Text>{renderParsedNotes(notesText)}</View>
              </ScrollView>
            </KeyboardAvoidingView>
          </SafeAreaView>
        )}
      </Modal>
    </View>
  );
};

const QuizContent = ({ payload, onComplete }: { payload: MissionPayload | null, onComplete: () => void }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(600);
  const questions = payload?.quiz?.questions || [];

  const handleOptionPress = (idx: number) => {
    if (showResult || finished) return;
    setSelectedOption(idx);
    setShowResult(true);
    if (idx === questions[currentIndex].answer_index) setCorrectCount(prev => prev + 1);
    HapticService.medium();
  };

  if (questions.length === 0) return <Text style={styles.errorText}>No questions found.</Text>;
  const currentQ = questions[currentIndex];

  return (
    <View style={styles.quizTool}>
      <Text style={styles.quizQuestion}>{currentQ.question}</Text>
      <View style={styles.optionsList}>
        {currentQ.options.map((option, idx) => (
          <TouchableOpacity key={idx} style={[styles.optionCard, showResult && idx === currentQ.answer_index && styles.optionCorrect]} onPress={() => handleOptionPress(idx)}>
            <Text style={styles.optionText}>{option}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {showResult && <TouchableOpacity style={styles.nextButton} onPress={() => { if (currentIndex < questions.length - 1) { setCurrentIndex(p => p + 1); setShowResult(false); } else { setFinished(true); onComplete(); } }}><Text style={styles.nextButtonText}>Next</Text></TouchableOpacity>}
    </View>
  );
};

const CurrentAffairsQuizContent = ({ onComplete }: { onComplete: () => void }) => {
  const [questions, setQuestions] = useState<RedisQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const dateKey = getIndiaDateKey();

  const loadQuestions = async () => {
    setLoading(true);
    setError('');
    try {
      let dailyQuestions = await RedisService.getDailyCurrentAffairs(dateKey);

      if (!dailyQuestions?.length) {
        dailyQuestions = await RedisService.getQuestions('current_affairs', 10);
        if (dailyQuestions.length) {
          await RedisService.setDailyCurrentAffairs(dateKey, dailyQuestions);
        }
      }

      if (!dailyQuestions?.length) {
        throw new Error('No current affairs questions are available.');
      }

      setQuestions(dailyQuestions.slice(0, 10));
      setCurrentIndex(0);
      setSelectedOption(null);
      setCorrectCount(0);
    } catch (loadError) {
      console.warn('[daily-mission.current-affairs] load failed:', loadError);
      setError('Today’s current affairs set could not be loaded. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadQuestions();
  }, [dateKey]);

  if (loading) {
    return (
      <View style={styles.currentAffairsQuizState}>
        <ActivityIndicator size="large" color="#047857" />
        <Text style={styles.currentAffairsLoadingText}>Preparing today’s current affairs…</Text>
      </View>
    );
  }

  if (error || questions.length === 0) {
    return (
      <View style={styles.currentAffairsQuizState}>
        <View style={styles.currentAffairsStateIcon}>
          <Ionicons name="cloud-offline-outline" size={25} color="#B45309" />
        </View>
        <Text style={styles.currentAffairsErrorTitle}>Couldn’t load today’s set</Text>
        <Text style={styles.currentAffairsErrorText}>{error}</Text>
        <TouchableOpacity style={styles.currentAffairsRetryButton} onPress={loadQuestions}>
          <Ionicons name="refresh" size={16} color="#FFFFFF" />
          <Text style={styles.currentAffairsRetryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentQuestion = questions[currentIndex];
  const answered = selectedOption !== null;
  const isCorrect = selectedOption === currentQuestion.answer_index;
  const progress = ((currentIndex + 1) / questions.length) * 100;

  const selectOption = (optionIndex: number) => {
    if (answered) return;
    setSelectedOption(optionIndex);
    if (optionIndex === currentQuestion.answer_index) {
      setCorrectCount((value) => value + 1);
      HapticService.success();
    } else {
      HapticService.error();
      const q = currentQuestion as any;
      const topic = q.subject || q.topic || q.category;
      if (topic) void weakAreasService.recordWrong(String(topic), 'Current Affairs', 'Missed in Daily Dose', 'quiz');
    }
  };

  const goNext = () => {
    if (!answered) return;
    if (currentIndex >= questions.length - 1) {
      onComplete();
      return;
    }
    setCurrentIndex((value) => value + 1);
    setSelectedOption(null);
  };

  return (
    <View style={styles.currentAffairsQuiz}>
      <View style={styles.currentAffairsQuizHeader}>
        <View>
          <Text style={styles.currentAffairsQuizEyebrow}>DAILY CURRENT AFFAIRS</Text>
          <Text style={styles.currentAffairsQuizDate}>{dateKey}</Text>
        </View>
        <View style={styles.currentAffairsScoreChip}>
          <Ionicons name="checkmark-circle" size={15} color="#047857" />
          <Text style={styles.currentAffairsScoreText}>{correctCount}/{questions.length}</Text>
        </View>
      </View>

      <View style={styles.currentAffairsProgressTrack}>
        <View style={[styles.currentAffairsProgressFill, { width: `${progress}%` }]} />
      </View>

      <Text style={styles.currentAffairsQuestionCount}>
        Question {currentIndex + 1} of {questions.length}
      </Text>
      <Text style={styles.currentAffairsQuestion}>{currentQuestion.question}</Text>

      <View style={styles.currentAffairsOptions}>
        {currentQuestion.options.map((option, optionIndex) => {
          const isAnswer = optionIndex === currentQuestion.answer_index;
          const isSelected = optionIndex === selectedOption;
          return (
            <TouchableOpacity
              key={`${currentIndex}-${optionIndex}`}
              activeOpacity={0.86}
              disabled={answered}
              onPress={() => selectOption(optionIndex)}
              style={[
                styles.currentAffairsOption,
                answered && isAnswer && styles.currentAffairsOptionCorrect,
                answered && isSelected && !isAnswer && styles.currentAffairsOptionWrong,
              ]}
            >
              <View
                style={[
                  styles.currentAffairsOptionIndex,
                  answered && isAnswer && styles.currentAffairsOptionIndexCorrect,
                  answered && isSelected && !isAnswer && styles.currentAffairsOptionIndexWrong,
                ]}
              >
                <Text style={styles.currentAffairsOptionIndexText}>
                  {String.fromCharCode(65 + optionIndex)}
                </Text>
              </View>
              <Text style={styles.currentAffairsOptionText}>{option}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {answered && (
        <View
          style={[
            styles.currentAffairsExplanation,
            isCorrect
              ? styles.currentAffairsExplanationCorrect
              : styles.currentAffairsExplanationWrong,
          ]}
        >
          <Text style={styles.currentAffairsExplanationTitle}>
            {isCorrect ? 'Correct' : 'Review this'}
          </Text>
          <Text style={styles.currentAffairsExplanationText}>
            {currentQuestion.explanation || 'Remember this fact for your next revision.'}
          </Text>
          {!!currentQuestion.source_url && (
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => Linking.openURL(currentQuestion.source_url || '')}
              style={styles.currentAffairsSourceLink}
            >
              <Ionicons name="shield-checkmark-outline" size={14} color="#0369A1" />
              <Text style={styles.currentAffairsSourceText} numberOfLines={1}>
                Official source: {currentQuestion.source_title || 'Open release'}
              </Text>
              <Ionicons name="open-outline" size={13} color="#0369A1" />
            </TouchableOpacity>
          )}
        </View>
      )}

      <TouchableOpacity
        activeOpacity={0.86}
        disabled={!answered}
        onPress={goNext}
        style={[
          styles.currentAffairsNextButton,
          !answered && styles.currentAffairsNextButtonDisabled,
        ]}
      >
        <Text style={styles.currentAffairsNextText}>
          {currentIndex === questions.length - 1 ? 'Finish Daily Dose' : 'Next Question'}
        </Text>
        <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 16, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  backButton: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, color: '#171A2C', fontSize: 15, fontFamily: 'Poppins-SemiBold', letterSpacing: 0.1, marginLeft: 8 },
  headerRight: { width: 44 },
  scrollContent: { padding: 20, paddingBottom: 120, backgroundColor: '#F8FAFC', minHeight: Dimensions.get('window').height - 100 },
  longDayBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF1F2', paddingVertical: 8, paddingHorizontal: 16, gap: 8 },
  longDayText: { fontSize: 12, fontFamily: 'Poppins-SemiBold', color: '#F43F5E' },
  staminaBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF9C3', paddingVertical: 8, paddingHorizontal: 16, gap: 8 },
  staminaText: { fontSize: 12, fontFamily: 'Poppins-SemiBold', color: '#854D0E' },
  flashbackHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  flashbackIcon: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  flashbackTitle: { fontSize: 20, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  flashbackSubtitle: { fontSize: 14, fontFamily: 'Inter-Medium', color: '#64748B' },
  flashbackCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#E2E8F0' },
  flashbackPrompt: { fontSize: 11, fontFamily: 'Poppins-SemiBold', color: '#8B5CF6', letterSpacing: 1, marginBottom: 12 },
  flashbackQuestion: { fontSize: 18, fontFamily: 'Poppins-SemiBold', color: '#1E293B', lineHeight: 26, marginBottom: 20 },
  flashbackDivider: { height: 1, backgroundColor: '#F1F5F9', marginBottom: 16 },
  flashbackTip: { fontSize: 13, fontFamily: 'Inter-Italic', color: '#64748B' },
  recallIndicatorContainer: { flexDirection: 'row', gap: 8, marginTop: 16 },
  recallBadge: { backgroundColor: '#F5F3FF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1, borderColor: '#DDD6FE' },
  recallBadgeText: { fontSize: 12, fontFamily: 'Poppins-SemiBold', color: '#7C3AED' },
  confettiLottie: { ...StyleSheet.absoluteFillObject, zIndex: 150, pointerEvents: 'none' },
  lessonTabs: { gap: 8, paddingRight: 20, paddingBottom: 14 },
  snapshotWrap: { gap: 10 },
  snapshotHeaderStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 2,
  },
  lessonTab: { flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 220, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  lessonTabDot: { width: 8, height: 8, borderRadius: 4 },
  lessonTabText: { flexShrink: 1, fontSize: 12, fontFamily: 'Poppins-SemiBold', color: '#475569' },
  lessonPageCard: {
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'transparent',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E6EAF4',
    marginBottom: 8,
  },
  legacyReaderCard: {
    padding: 0,
  },
  lessonCardBackground: {
    ...StyleSheet.absoluteFillObject,
    opacity: 1,
  },
  lessonCardBackgroundImage: {
    width: '100%',
    height: '100%',
  },
  readerArtBand: {
    height: 96,
    backgroundColor: '#D8E6FD',
    overflow: 'hidden',
    position: 'relative',
  },
  readerArtImage: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    aspectRatio: 2.1,
  },
  readerArtPill: {
    position: 'absolute',
    top: 12,
    left: 16,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  legacyReaderSectionPillText: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  readerMiniHead: {
    paddingTop: 16,
    paddingHorizontal: 18,
    paddingBottom: 8,
  },
  readerMiniChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 999,
  },
  readerProgressTrack: {
    height: 3,
    backgroundColor: '#EEF2F9',
    overflow: 'hidden',
  },
  readerProgressFill: {
    height: '100%',
  },
  legacyReaderOverlay: {
    flex: 1,
    padding: 18,
    paddingTop: 16,
  },
  legacyReaderTitle: {
    fontSize: 19,
    fontFamily: 'Poppins-SemiBold',
    color: '#171A2C',
    lineHeight: 26,
    letterSpacing: -0.2,
    marginBottom: 10,
  },
  legacyReaderBodyText: {
    fontSize: 15,
    fontFamily: 'Inter-Regular',
    color: '#3A4257',
    lineHeight: 26,
    letterSpacing: 0.05,
  },
  keyPointsGroup: {
    borderRadius: 16,
    padding: 14,
    gap: 11,
    marginTop: 16,
  },
  keyPointsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 1,
  },
  keyPointsHeaderDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  keyPointsHeaderText: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    letterSpacing: 1.4,
  },
  keyPointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  keyPointBadge: {
    minWidth: 30,
    height: 24,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPointBadgeText: {
    fontSize: 11.5,
    fontFamily: 'Poppins-SemiBold',
  },
  keyPointMarker: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
    marginLeft: 6,
    marginRight: 6,
  },
  legacyReaderPointIndexWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  legacyReaderPointIndex: {
    fontSize: 11,
    fontFamily: 'Poppins-SemiBold',
  },
  legacyReaderPointText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter-Medium',
    color: '#334155',
    lineHeight: 22,
    paddingTop: 1,
  },
  keyPointLabel: {
    fontFamily: 'Inter-SemiBold',
    color: '#171A2C',
  },
  keyPointValue: {
    fontFamily: 'Inter-Regular',
    color: '#52607A',
  },
  examTrapCard: {
    marginTop: 12,
    borderRadius: 16,
    backgroundColor: '#FFF7ED',
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 7,
  },
  examTrapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  examTrapLabel: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    letterSpacing: 1.4,
    color: '#B45309',
  },
  examTrapText: {
    fontSize: 13.5,
    fontFamily: 'Inter-Medium',
    color: '#7C2D12',
    lineHeight: 21,
  },
  legacyReaderNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 18,
  },
  legacyReaderNavButton: {
    flex: 0.34,
    height: 40,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 14,
  },
  legacyReaderNavGhost: {
    backgroundColor: '#F1F4FB',
  },
  legacyReaderNavGhostText: {
    fontSize: 12.5,
    fontFamily: 'Poppins-SemiBold',
    letterSpacing: 0.2,
    color: '#475069',
  },
  legacyReaderNavSolid: {},
  legacyReaderNavText: {
    fontSize: 12.5,
    fontFamily: 'Poppins-SemiBold',
    letterSpacing: 0.2,
    color: '#FFFFFF',
  },
  legacyReaderDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 0.32,
    justifyContent: 'center',
  },
  legacyReaderDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#D7DEEC',
  },
  legacyReaderDotActive: {
    width: 18,
  },
  lessonPageAccent: { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
  lessonPageHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  lessonPageNumber: { minWidth: 34, height: 34, borderRadius: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  lessonPageNumberText: { fontSize: 12, fontFamily: 'Poppins-Bold' },
  snapshotIconBadge: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  lessonPageTitle: { flex: 1, fontSize: 16, fontFamily: 'Poppins-Bold', color: '#0F172A', lineHeight: 22, marginTop: 0 },
  lessonBodyBlock: { gap: 12 },
  overviewList: { gap: 14, marginBottom: 6 },
  checklistGrid: { gap: 14, marginBottom: 6 },
  lessonShowcaseCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    minHeight: 108,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderRadius: 26,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderLeftWidth: 10,
  },
  lessonShowcaseIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lessonShowcaseTextWrap: {
    flex: 1,
    gap: 4,
  },
  lessonShowcaseTitle: {
    fontSize: 16,
    lineHeight: 22,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  lessonShowcaseSubtitle: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
  },
  lessonTextCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginVertical: 8,
    backgroundColor: '#FFFFFF',
  },
  recitationTextCard: {
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  overviewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  overviewTile: { width: '47.5%', minHeight: 80, backgroundColor: '#F8FAFC', borderRadius: 18, padding: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  overviewTileIcon: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  overviewTileNumber: { fontSize: 13, fontFamily: 'Poppins-Bold' },
  overviewTileTitle: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#0F172A', lineHeight: 18 },
  overviewTileValue: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#475569', lineHeight: 17, marginTop: 6 },
  lessonIntroText: {
    fontSize: 15.5,
    fontFamily: 'Inter-Medium',
    color: '#334155',
    lineHeight: 24,
    backgroundColor: '#F7FBFF',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#D6E6F8',
  },
  smartReadHero: {
    gap: 10,
    marginBottom: 14,
  },
  smartReadHeroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  smartReadHeroIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smartReadHeroText: {
    flex: 1,
  },
  smartReadHeroLabel: {
    fontSize: 11,
    fontFamily: 'Poppins-Bold',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  smartReadHeroTitle: {
    fontSize: 16,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    lineHeight: 22,
  },
  smartReadHeroSub: {
    marginTop: 3,
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
    lineHeight: 18,
  },
  smartStepTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  smartStepDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#DCE7F3',
  },
  lessonTable: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#DCE7F3',
    backgroundColor: '#FFFFFF',
    marginBottom: 4,
  },
  lessonTableHeader: { flexDirection: 'row', backgroundColor: '#EFF6FF', borderBottomWidth: 1, borderBottomColor: '#DCE7F3' },
  lessonTableHeaderText: { flex: 1, paddingHorizontal: 10, paddingVertical: 10, fontSize: 11, fontFamily: 'Poppins-Bold', color: '#1D4ED8', textAlign: 'left' },
  lessonTableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EEF2F7' },
  lessonTableCell: { flex: 1, paddingHorizontal: 10, paddingVertical: 12, fontSize: 12.5, fontFamily: 'Inter-SemiBold', color: '#334155', lineHeight: 18, textAlign: 'left' },
  lessonTableFirstCell: { color: '#0F172A', fontFamily: 'Poppins-Bold', textAlign: 'left' },
  lessonSentenceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  lessonSentenceDot: { width: 7, height: 7, borderRadius: 4, marginTop: 9 },
  lessonSentence: { flex: 1, fontSize: 13.5, fontFamily: 'Inter-Medium', color: '#1E293B', lineHeight: 20 },
  smartReadStage: {
    gap: 12,
    minHeight: 260,
  },
  smartIntroCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DCE7F3',
    borderLeftWidth: 6,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: '#FFFFFF',
  },
  smartIntroLabel: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 10,
  },
  recitationStudySection: { gap: 12 },
  recitationStage: {
    position: 'relative',
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 22,
    borderRadius: 26,
    backgroundColor: '#DFF1FF',
    overflow: 'hidden',
  },
  recitationStageFrame: {
    ...StyleSheet.absoluteFillObject,
  },
  recitationHeroBanner: {
    minHeight: 92,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 18,
    justifyContent: 'center',
    overflow: 'hidden',
    marginTop: 10,
  },
  recitationHeroTitle: {
    maxWidth: '78%',
    fontSize: 16,
    lineHeight: 22,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },
  recitationHeroMascot: {
    position: 'absolute',
    right: -10,
    bottom: -8,
  },
  recitationStudyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#F7FBFF',
  },
  recitationStudyBannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    lineHeight: 17,
  },
  recitationDenseGrid: {
    gap: 8,
  },
  recitationDenseItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FCFEFF',
    borderWidth: 1,
    borderColor: '#D8E7F8',
  },
  recitationDenseIndex: {
    minWidth: 34,
    textAlign: 'center',
    fontSize: 12.5,
    fontFamily: 'Poppins-Bold',
    lineHeight: 18,
  },
  recitationDenseText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: 'Inter-SemiBold',
    color: '#334155',
    lineHeight: 18,
  },
  recitationBlockTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  recitationGrid: { gap: 10 },
  recitationItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#FCFEFF',
    borderWidth: 1,
    borderColor: '#D8E7F8',
  },
  recitationIndex: {
    minWidth: 18,
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
    lineHeight: 18,
  },
  recitationText: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Inter-SemiBold',
    color: '#334155',
    lineHeight: 18,
  },
  blockTitle: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#0F172A', marginTop: 4 },
  timelineBlock: { gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch' },
  timelineRail: { width: 26, alignItems: 'center' },
  timelineDot: { width: 11, height: 11, borderRadius: 6, marginTop: 18 },
  timelineLine: { flex: 1, width: 2, backgroundColor: '#E2E8F0' },
  timelineCard: {
    flex: 1,
    backgroundColor: '#FCFEFF',
    borderWidth: 1,
    borderColor: '#D8E7F8',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  timelineLabel: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  timelineValue: { fontSize: 14, fontFamily: 'Inter-SemiBold', color: '#475569', lineHeight: 20, marginTop: 4 },
  formulaBlock: {
    backgroundColor: '#F8FBFF',
    borderWidth: 1,
    borderRadius: 20,
    padding: 18,
  },
  formulaTitle: { fontSize: 13, fontFamily: 'Poppins-Bold', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 8 },
  formulaText: { fontSize: 22, fontFamily: 'Poppins-Bold', color: '#0F172A', lineHeight: 30 },
  lessonTrapCallout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 18,
    padding: 14,
    marginTop: 6,
    borderWidth: 1,
  },
  lessonTrapText: { flex: 1, fontSize: 14, fontFamily: 'Poppins-SemiBold', color: '#0F172A', lineHeight: 21 },
  lessonPager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, gap: 10 },
  lessonPagerButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' },
  lessonPagerButtonDisabled: { opacity: 0.55 },
  lessonPagerText: { fontSize: 12, fontFamily: 'Poppins-SemiBold', color: '#0F172A' },
  lessonPagerTextDisabled: { color: '#CBD5E1' },
  lessonPagerCount: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#64748B' },
  recitationPager: {
    marginTop: 22,
    paddingHorizontal: 4,
  },
  recitationPagerButton: {
    minWidth: 88,
    justifyContent: 'center',
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  recitationPagerSvg: {
    alignSelf: 'center',
  },
  recitationPagerCount: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    color: '#334155',
  },
  smartPagerCountWrap: {
    alignItems: 'center',
    gap: 2,
  },
  smartPagerCountTop: {
    fontSize: 11,
    fontFamily: 'Poppins-Bold',
    letterSpacing: 0.4,
  },
  readerMascotOverlay: {
    position: 'absolute',
    right: 10,
    bottom: 18,
    width: 92,
    height: 92,
    zIndex: 20,
  },
  readerMascotLottie: {
    width: '100%',
    height: '100%',
  },
  sectionLabel: { fontSize: 11, fontFamily: 'Poppins-SemiBold', color: '#64748B', letterSpacing: 1.2, marginBottom: 14, textTransform: 'uppercase' },
  termGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  termBadge: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center', gap: 12 },
  termDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34A853' },
  // ── Rich reader blocks ──
  rbParagraph: { fontFamily: 'Inter-Regular', fontSize: 15, lineHeight: 24, color: '#334155', letterSpacing: 0.1 },
  // Interleaved check (milky-white Aurora)
  checkEyebrow: { fontFamily: 'Inter-SemiBold', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  checkQ: { fontFamily: 'Poppins-SemiBold', fontSize: 16, lineHeight: 22, color: '#171A2C', letterSpacing: -0.2 },
  checkOpt: { flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 14, borderWidth: 1.5, borderColor: '#E6EAF4', backgroundColor: '#FFFFFF' },
  checkOptGood: { borderColor: '#B4E0CF', backgroundColor: '#E7F5EF' },
  checkOptBad: { borderColor: '#F5C4CF', backgroundColor: '#FCE9EE' },
  checkBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: '#E6EAF4', alignItems: 'center', justifyContent: 'center' },
  checkBoxGood: { backgroundColor: '#059669', borderColor: '#059669' },
  checkBoxBad: { backgroundColor: '#E11D48', borderColor: '#E11D48' },
  checkOptT: { flex: 1, fontFamily: 'Inter-SemiBold', fontSize: 14, lineHeight: 20, color: '#171A2C' },
  checkFb: { borderRadius: 14, padding: 13, borderWidth: 1, gap: 4, marginTop: 2 },
  checkFbOk: { backgroundColor: '#E7F5EF', borderColor: '#B4E0CF' },
  checkFbNo: { backgroundColor: '#FCE9EE', borderColor: '#F5C4CF' },
  checkFbH: { fontFamily: 'Poppins-Bold', fontSize: 14 },
  checkFbW: { fontFamily: 'Inter-Regular', fontSize: 12.5, lineHeight: 19, color: '#171A2C' },
  matchWrap: { flexDirection: 'row', gap: 9 },
  matchCol: { flex: 1, gap: 8 },
  matchTile: { minHeight: 46, borderWidth: 1.5, borderColor: '#E6EAF4', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9, justifyContent: 'center', backgroundColor: '#FFFFFF' },
  matchDone: { borderColor: '#B4E0CF', backgroundColor: '#E7F5EF' },
  matchBad: { borderColor: '#F5C4CF', backgroundColor: '#FCE9EE' },
  matchTileT: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, lineHeight: 17, color: '#171A2C' },
  orderTile: { flexDirection: 'row', alignItems: 'center', gap: 11, borderWidth: 1.5, borderColor: '#E6EAF4', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, backgroundColor: '#FFFFFF' },
  orderNum: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  orderNumT: { fontFamily: 'Poppins-Bold', fontSize: 12 },
  orderTileT: { flex: 1, fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: '#171A2C' },
  selCheckBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  selCheckT: { fontFamily: 'Poppins-SemiBold', fontSize: 13.5 },
  rbPointRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rbPointDot: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },
  rbRoman: { fontFamily: 'Inter-Bold', fontSize: 13, lineHeight: 22, minWidth: 20 },
  rbChipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginLeft: 30, marginTop: 1 },
  rbChip: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 6 },
  rbChipT: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5 },
  rbPointText: { flex: 1, fontFamily: 'Inter-Medium', fontSize: 14.5, lineHeight: 22, color: '#334155' },
  rbCallout: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, borderLeftWidth: 3, borderRadius: 12, paddingVertical: 11, paddingHorizontal: 12 },
  rbCalloutText: { flex: 1, fontFamily: 'Inter-SemiBold', fontSize: 14, lineHeight: 21, color: '#1E293B' },
  rbBold: { fontFamily: 'Inter-Bold', color: '#0F172A' },
  rbTerm: { fontFamily: 'Inter-SemiBold' },
  rbTermStrong: { fontFamily: 'Inter-Bold' },
  rbHeading: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: '#0F172A', marginTop: 2 },
  rbGroup: { borderRadius: 16, padding: 14, gap: 10 },
  rbDefRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rbLabelChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  rbLabelChipText: { fontFamily: 'Poppins-SemiBold', fontSize: 11.5 },
  rbDot: { width: 7, height: 7, borderRadius: 4, marginTop: 7 },
  rbDefValue: { flex: 1, fontFamily: 'Inter-Medium', fontSize: 14, lineHeight: 21, color: '#334155' },
  rbNumChip: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rbNumChipText: { fontFamily: 'Poppins-Bold', fontSize: 11, color: '#FFFFFF' },
  rbTable: { borderWidth: 1, borderColor: '#E6EAF4', borderRadius: 12, overflow: 'hidden' },
  rbTableRow: { flexDirection: 'row' },
  rbTableCell: { paddingVertical: 9, paddingHorizontal: 12, fontFamily: 'Inter-Medium', fontSize: 13, color: '#334155', minWidth: 92, borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E6EAF4' },
  rbTableHeadCell: { fontFamily: 'Poppins-SemiBold', fontSize: 12 },
  rbTableCellLead: { fontFamily: 'Poppins-SemiBold', color: '#0F172A' },
  rbTableFull: { alignSelf: 'stretch', width: '100%' },
  rbTableCellFlex: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, fontFamily: 'Inter-Medium', fontSize: 13, lineHeight: 18, color: '#334155', borderRightWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#E6EAF4' },
  rbDefCard: { borderWidth: 1, borderColor: '#E6EAF4', borderRadius: 14, overflow: 'hidden' },
  rbDefRow2: { flexDirection: 'row', gap: 12, paddingVertical: 10, paddingHorizontal: 13, alignItems: 'flex-start' },
  rbDefDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#EEF2F9' },
  rbDefLabel: { width: 104, fontFamily: 'Poppins-SemiBold', fontSize: 13, lineHeight: 19 },
  rbAgendaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 13 },
  rbAgendaText: { flex: 1, fontFamily: 'Poppins-SemiBold', fontSize: 14, color: '#0F172A' },
  rbStatRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rbStatCard: { flexGrow: 1, flexBasis: '30%', minWidth: 92, borderWidth: 1, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 12 },
  rbStatValue: { fontFamily: 'Poppins-Bold', fontSize: 21, letterSpacing: -0.5 },
  rbStatLabel: { fontFamily: 'Inter-Medium', fontSize: 11.5, lineHeight: 15, color: '#475069', marginTop: 2 },
  rbFlowStep: { flexDirection: 'row', gap: 11, alignItems: 'flex-start', borderWidth: 1, borderColor: '#E6EAF4', borderRadius: 12, padding: 11 },
  rbFlowNum: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rbFlowLabel: { fontFamily: 'Poppins-SemiBold', fontSize: 13.5, color: '#0F172A', lineHeight: 19 },
  rbFlowArrow: { alignItems: 'center', paddingVertical: 3 },
  rbDDRow: { flexDirection: 'row', gap: 9 },
  rbDDCol: { flex: 1, borderWidth: 1, borderRadius: 14, padding: 11, gap: 7 },
  rbDDHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rbDDTitle: { fontFamily: 'Poppins-Bold', fontSize: 12.5 },
  rbDDItemRow: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  rbDDDot: { width: 5, height: 5, borderRadius: 3, marginTop: 7 },
  rbDDItem: { flex: 1, fontFamily: 'Inter-Medium', fontSize: 12.5, lineHeight: 18, color: '#334155' },
  rbMindWrap: { alignItems: 'center', gap: 12 },
  rbMindCenter: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 999 },
  rbMindCenterT: { fontFamily: 'Poppins-Bold', fontSize: 14, color: '#FFFFFF' },
  rbMindBranches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  rbMindNode: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, minWidth: 104, maxWidth: '47%' },
  rbMindNodeT: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5 },
  rbMindNodeD: { fontFamily: 'Inter-Regular', fontSize: 11.5, lineHeight: 15, color: '#475069', marginTop: 2 },
  rbTimeline: { paddingLeft: 2 },
  rbTlRow: { flexDirection: 'row', gap: 12 },
  rbTlLeft: { alignItems: 'center', width: 14 },
  rbTlDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  rbTlLine: { flex: 1, width: 2, backgroundColor: '#E6EAF4', marginVertical: 2 },
  rbTlBody: { flex: 1, paddingBottom: 16 },
  rbTlLabel: { fontFamily: 'Poppins-SemiBold', fontSize: 13.5 },
  rbTlValue: { fontFamily: 'Inter-Regular', fontSize: 13.5, lineHeight: 20, color: '#475069', marginTop: 2 },
  rbFormula: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 6 },
  rbFormulaTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 12.5, letterSpacing: 0.3 },
  rbFormulaText: { fontFamily: 'Inter-SemiBold', fontSize: 15, lineHeight: 23, color: '#0F172A' },
  termEn: { fontSize: 14, fontFamily: 'Poppins-SemiBold', color: '#0F172A' },
  termLocal: { fontSize: 12, fontFamily: 'Poppins-Medium', color: '#64748B', marginTop: 2 },
  trapContainer: { borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(217, 119, 6, 0.2)' },
  trapGradient: { padding: 20 },
  trapHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  trapTitle: { fontSize: 16, fontFamily: 'Poppins-Bold', color: '#B45309' },
  mistakeRow: { flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' },
  mistakeBullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#D97706', marginTop: 8 },
  mistakeText: { flex: 1, fontSize: 14, fontFamily: 'Inter-Medium', color: '#475569', lineHeight: 20 },
  flashcardTool: { flex: 1 },
  flashDeckHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  flashDeckEyebrow: { fontSize: 11, fontFamily: 'Poppins-Bold', color: '#94A3B8', letterSpacing: 1.2 },
  flashDeckTitle: { fontSize: 20, fontFamily: 'Poppins-Bold', color: '#0F172A', marginTop: 2 },
  flashDeckChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  flashDeckChipText: { fontSize: 12, fontFamily: 'Poppins-Bold' },
  flashProgressTrack: { height: 7, borderRadius: 999, backgroundColor: '#E2E8F0', overflow: 'hidden', marginBottom: 14 },
  flashProgressFill: { height: '100%', borderRadius: 999 },
  cardTouch: { width: '100%', height: 430, marginVertical: 12 },
  flashcard: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 30, borderWidth: 1, borderColor: '#DCE7F3', overflow: 'hidden' },
  flashLiquidLayer: { ...StyleSheet.absoluteFillObject, opacity: 0.18 },
  flashLiquidOrbLarge: { position: 'absolute', width: 250, height: 250, borderRadius: 125, top: -78, right: -70 },
  flashLiquidOrbSmall: { position: 'absolute', width: 190, height: 190, borderRadius: 95, bottom: -64, left: -54 },
  flashcardSide: { flex: 1, padding: 30, justifyContent: 'center', alignItems: 'center' },
  flashcardBack: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(248, 250, 252, 0.96)' },
  flashSideLabel: { position: 'absolute', top: 26, left: 26, fontSize: 11, fontFamily: 'Poppins-Bold', color: '#64748B', letterSpacing: 1.1, textTransform: 'uppercase' },
  flashcardText: { fontSize: 23, fontFamily: 'Poppins-Bold', color: '#0F172A', textAlign: 'center', lineHeight: 33, maxWidth: '96%' },
  flipPrompt: { position: 'absolute', bottom: 28, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255, 255, 255, 0.76)', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  flipPromptText: { fontSize: 12, fontFamily: 'Inter-SemiBold', color: '#64748B' },
  flashConfidenceRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  flashConfidenceButton: { flex: 1, minHeight: 44, borderRadius: 15, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  flashConfidenceText: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#64748B' },
  flashcardControls: { flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 10 },
  controlBtn: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
  videoCard: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 12, alignItems: 'center', gap: 16 },
  videoCardShell: { backgroundColor: '#FFFFFF', borderRadius: 24, marginBottom: 14, borderWidth: 1, borderColor: '#E2E8F0', overflow: 'hidden' },
  videoPlayIcon: { width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center' },
  videoInfo: { flex: 1, gap: 4 },
  videoTitle: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  videoDuration: { fontSize: 11, fontFamily: 'Poppins-SemiBold', color: '#64748B' },
  videoMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  cardIndicatorBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#EFF6FF', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  cardIndicatorText: { fontSize: 10, fontFamily: 'Poppins-Bold', color: '#3B82F6' },
  cockpitContainer: { flex: 1, backgroundColor: '#0B0F19' },
  cockpitHeader: { height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  cockpitCloseBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cockpitCloseText: { color: '#F8FAFC', fontSize: 14, fontFamily: 'Poppins-SemiBold' },
  cockpitTitleBlock: { flex: 1, alignItems: 'center', marginHorizontal: 12 },
  cockpitHeaderTitle: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins-Bold', textAlign: 'center' },
  cockpitSubTitle: { color: '#60A5FA', fontSize: 9, fontFamily: 'Poppins-Bold', letterSpacing: 1.5, marginTop: 1 },
  cockpitHeaderRight: { width: 70, alignItems: 'flex-end' },
  studyPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  studyPillText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Poppins-Bold' },
  cockpitPlayerWrap: { width: '100%', aspectRatio: 1.77, backgroundColor: '#000000', position: 'relative' },
  cockpitPlayer: { flex: 1 },
  cockpitTabWrapper: { height: 52, backgroundColor: '#0F172A', justifyContent: 'center', paddingHorizontal: 16 },
  cockpitTabBar: { flexDirection: 'row', backgroundColor: 'rgba(30, 41, 59, 0.6)', borderRadius: 12, padding: 3, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)' },
  cockpitTab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 9 },
  cockpitTabActive: { backgroundColor: '#3B82F6' },
  cockpitTabText: { color: '#94A3B8', fontSize: 12, fontFamily: 'Poppins-SemiBold' },
  cockpitTabTextActive: { color: '#FFFFFF' },
  cockpitTabContent: { flex: 1, backgroundColor: '#0F172A' },
  notesTabWrap: { padding: 16, gap: 16, paddingBottom: 40 },
  notesEditorCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)' },
  notesEditorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  notesEditorTitle: { color: '#94A3B8', fontSize: 10, fontFamily: 'Poppins-Bold', letterSpacing: 1.5 },
  tagFrameBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#3B82F6', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  tagFrameBtnText: { color: '#FFFFFF', fontSize: 10, fontFamily: 'Poppins-Bold' },
  notesTextInput: { minHeight: 110, color: '#F8FAFC', fontSize: 14, fontFamily: 'Inter-Medium', textAlignVertical: 'top', padding: 8, backgroundColor: '#0F172A', borderRadius: 12, borderWidth: 1, borderColor: '#334155' },
  notesPreviewCard: { backgroundColor: '#1E293B', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)' },
  notesPreviewLabel: { color: '#94A3B8', fontSize: 10, fontFamily: 'Poppins-Bold', letterSpacing: 1, marginBottom: 12 },
  notesPlaceholder: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24, gap: 8 },
  notesPlaceholderText: { color: '#64748B', fontSize: 12, fontFamily: 'Inter-Medium', textAlign: 'center', paddingHorizontal: 20, lineHeight: 18 },
  notesFlowWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, lineHeight: 22 },
  parsedNotesText: { color: '#E2E8F0', fontSize: 14, fontFamily: 'Inter-Medium', lineHeight: 22 },
  timeBadgePill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#3B82F6', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, marginHorizontal: 2, transform: [{ translateY: -1 }] },
  timeBadgeText: { color: '#FFFFFF', fontSize: 11, fontFamily: 'Poppins-Bold' },
  migaTabWrap: { flex: 1 },
  migaScrollContent: { padding: 16, gap: 12, paddingBottom: 24 },
  migaMsgRow: { flexDirection: 'row', gap: 10, maxWidth: '85%' },
  migaMsgRowUser: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  migaMsgRowMiga: { alignSelf: 'flex-start' },
  migaMsgBubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, lineHeight: 18 },
  migaMsgBubbleUser: { backgroundColor: '#3B82F6', borderTopRightRadius: 2 },
  migaMsgBubbleMiga: { backgroundColor: '#1E293B', borderTopLeftRadius: 2, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)' },
  migaMsgText: { fontSize: 13, lineHeight: 19, fontFamily: 'Inter-Medium' },
  migaMsgTextUser: { color: '#FFFFFF' },
  migaMsgTextMiga: { color: '#E2E8F0' },
  migaInputContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#1E293B', backgroundColor: '#0B0F19', gap: 10 },
  migaTextInput: { flex: 1, height: 40, backgroundColor: '#1E293B', borderRadius: 20, color: '#F8FAFC', fontSize: 13, fontFamily: 'Inter-Medium', paddingHorizontal: 16, borderWidth: 1, borderColor: '#334155' },
  migaSendBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center' },
  checklistTabWrap: { padding: 16, gap: 12, paddingBottom: 40 },
  checklistCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1E293B', borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.05)' },
  checklistCardChecked: { borderColor: 'rgba(16, 185, 129, 0.3)', opacity: 0.8 },
  customCheckbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: '#334155' },
  customCheckboxChecked: { backgroundColor: '#10B981', borderColor: '#10B981' },
  checklistText: { flex: 1, color: '#E2E8F0', fontSize: 13, fontFamily: 'Inter-Medium' },
  checklistTextChecked: { color: '#64748B', textDecorationLine: 'line-through' },
  quizTool: { flex: 1 },
  quizQuestion: { fontSize: 20, fontFamily: 'Poppins-Bold', color: '#0F172A', marginBottom: 24 },
  optionsList: { gap: 12 },
  optionCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 18, borderWidth: 1.5, borderColor: '#E2E8F0' },
  optionCorrect: { borderColor: '#059669', backgroundColor: '#F0FDF4' },
  optionText: { fontSize: 16, fontFamily: 'Inter-SemiBold', color: '#0F172A' },
  nextButton: { backgroundColor: '#4285F4', paddingVertical: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  nextButtonText: { color: '#FFFFFF', fontSize: 14, fontFamily: 'Poppins-Bold' },
  currentAffairsQuiz: { gap: 16 },
  currentAffairsQuizState: {
    minHeight: 360,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  currentAffairsLoadingText: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#64748B' },
  currentAffairsStateIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF7ED',
  },
  currentAffairsErrorTitle: { fontSize: 17, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  currentAffairsErrorText: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    fontFamily: 'Inter-Medium',
    color: '#64748B',
  },
  currentAffairsRetryButton: {
    minHeight: 42,
    paddingHorizontal: 18,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    backgroundColor: '#047857',
  },
  currentAffairsRetryText: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Poppins-Bold' },
  currentAffairsQuizHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  currentAffairsQuizEyebrow: {
    fontSize: 10,
    lineHeight: 14,
    fontFamily: 'Poppins-Bold',
    letterSpacing: 1,
    color: '#047857',
  },
  currentAffairsQuizDate: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
  },
  currentAffairsScoreChip: {
    minHeight: 34,
    paddingHorizontal: 11,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  currentAffairsScoreText: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#047857' },
  currentAffairsProgressTrack: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
  },
  currentAffairsProgressFill: { height: '100%', borderRadius: 4, backgroundColor: '#10B981' },
  currentAffairsQuestionCount: { fontSize: 11, fontFamily: 'Inter-SemiBold', color: '#94A3B8' },
  currentAffairsQuestion: {
    fontSize: 18,
    lineHeight: 27,
    fontFamily: 'Poppins-SemiBold',
    color: '#0F172A',
  },
  currentAffairsOptions: { gap: 10 },
  currentAffairsOption: {
    minHeight: 58,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  currentAffairsOptionCorrect: { borderColor: '#34D399', backgroundColor: '#ECFDF5' },
  currentAffairsOptionWrong: { borderColor: '#FB7185', backgroundColor: '#FFF1F2' },
  currentAffairsOptionIndex: {
    width: 31,
    height: 31,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  currentAffairsOptionIndexCorrect: { backgroundColor: '#A7F3D0' },
  currentAffairsOptionIndexWrong: { backgroundColor: '#FECDD3' },
  currentAffairsOptionIndexText: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#334155' },
  currentAffairsOptionText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Inter-SemiBold',
    color: '#334155',
  },
  currentAffairsExplanation: { borderRadius: 18, padding: 14, borderWidth: 1 },
  currentAffairsExplanationCorrect: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  currentAffairsExplanationWrong: { backgroundColor: '#FFF7ED', borderColor: '#FED7AA' },
  currentAffairsExplanationTitle: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  currentAffairsExplanationText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Inter-Medium',
    color: '#475569',
  },
  currentAffairsSourceLink: {
    marginTop: 10,
    minHeight: 34,
    borderRadius: 11,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(224, 242, 254, 0.72)',
  },
  currentAffairsSourceText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#0369A1',
  },
  currentAffairsNextButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: '#047857',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  currentAffairsNextButtonDisabled: { backgroundColor: '#94A3B8', opacity: 0.58 },
  currentAffairsNextText: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#FFFFFF' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    backgroundColor: '#F8FAFC',
  },
  completeButton: { width: '100%' },
  completeButtonDisabled: { opacity: 0.7 },
  completeHint: { fontSize: 12, fontFamily: 'Inter-Medium', color: '#64748B', marginTop: 8, textAlign: 'center' },
  gradientButton: { height: 48, borderRadius: 999, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  completeButtonText: { fontSize: 13.5, fontFamily: 'Poppins-SemiBold', color: '#FFFFFF', letterSpacing: 0.3 },
  errorText: { color: '#EF4444', textAlign: 'center', marginTop: 40, fontFamily: 'Inter-Medium' },
  completionOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  completionConfetti: { ...StyleSheet.absoluteFillObject, zIndex: 1 },
  completionCard: { width: SCREEN_WIDTH * 0.82, backgroundColor: '#FFFFFF', borderRadius: 28, paddingVertical: 26, paddingHorizontal: 24, alignItems: 'center', zIndex: 2 },
  completionMascot: { width: 132, height: 132, marginBottom: 6 },
  successTitle: { fontSize: 20, fontFamily: 'Poppins-Bold', color: '#171A2C', textAlign: 'center', letterSpacing: -0.2 },
  successSubtitle: { fontSize: 13.5, fontFamily: 'Inter-Medium', color: '#52607A', textAlign: 'center', marginTop: 6, lineHeight: 20 },
});
