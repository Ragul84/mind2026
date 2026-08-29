import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Dimensions,
  TextInput,
  ActivityIndicator,
  Keyboard,
  Platform,
  StatusBar,
  UIManager,
  Modal,
  ScrollView,
  PanResponder,
} from 'react-native';
import LottieView from 'lottie-react-native';
import { mascotApi, MathSolution } from '@/services/mascotApi';
import { supabase, SupabaseService } from '@/utils/supabaseService';
import RedisService from '@/utils/redisService';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import MascotRig, { MascotRigRef } from '@/components/MascotRig';
import { MigaChat } from '@/components/ui/MigaChat';
import { useMascotAudio } from '@/hooks/useMascotAudio';
import type { VisemeFrame } from '@/hooks/useMascotAudio';
import type { MascotEmotion as BaseMascotEmotion } from '@/services/companion/types';
import { MotiView, AnimatePresence } from 'moti';
import { useAuthContext } from '@/components/AuthProvider';
import Voice from '@react-native-voice/voice';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { StoryUploadModal } from '@/components/ui/StoryUploadModal';
import CameraScanModal from '@/components/ui/CameraScanModal';
import { CallSessionService } from '@/services/callSessionService';
import { V2026 } from '@/theme/v2026-tokens';
import { AIUsageService } from '@/services/aiUsageService';
import { useFocusEffect } from 'expo-router';
import { useTabDockHeight } from './_layout';
import { connectMascotSocket } from '@/utils/mascotTransport';
import {
  getDailyLocalizedThirukkural,
  getLocalizedThirukkural,
  type LocalizedThirukkural,
} from '@/utils/thirukkuralService';

const SCREEN = Dimensions.get('window');
const MATH_PROMPTS = [
  { label: 'Solve 2x + 3 = 11', prompt: 'Solve 2x + 3 = 11 step by step.' },
  { label: 'Pipe fills in 6h', prompt: 'A pipe fills a tank in 6 hours. Another empties it in 10 hours. Find the time to fill if both are open.' },
  { label: 'Profit on marked price', prompt: 'Find profit / loss for a marked price and discount question.' },
  { label: 'Time and work', prompt: 'Solve a time and work problem step by step.' },
];

const LANGUAGES_MAP = [
  { label: 'Tamil', code: 'ta', sarvam: 'ta-IN' },
  { label: 'Hindi', code: 'hi', sarvam: 'hi-IN' },
  { label: 'Telugu', code: 'te', sarvam: 'te-IN' },
  { label: 'Kannada', code: 'kn', sarvam: 'kn-IN' },
  { label: 'Malayalam', code: 'ml', sarvam: 'ml-IN' },
];

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const sanitizeText = (text: string) => {
  if (!text) return '';
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .trim();
};

type ExperienceMode = 'tutor' | 'story';
type StoryPhase = 'idle' | 'ingesting' | 'generating' | 'speaking' | 'awaiting';
type MascotEmotion = BaseMascotEmotion | 'idleSpeaking' | 'correct' | 'wrong';
type LiveMessage = { id: string; role: 'user' | 'assistant'; text: string; timestamp: number };
type WordTiming = { word: string; start_ms: number; end_ms?: number };
type MascotSessionStatus = 'active' | 'paused' | 'completed';
type MascotSessionMode = ExperienceMode;
type MascotSession = {
  id: string;
  mode: MascotSessionMode;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
  languageCode: string;
  languageLabel: string;
  status: MascotSessionStatus;
  topic?: string;
  storyId?: string | null;
  messageCount: number;
  transcript: LiveMessage[];
};
type VisualBoard = {
  title?: string;
  subtitle?: string;
  rows?: Array<{ label?: string; value?: string; note?: string }>;
  bullets?: string[];
};
type MathSolveState = 'idle' | 'loading' | 'solving' | 'done';
type StudentStoryProfile = {
  name: string;
  exam_goal: string;
  language_code: string;
  language_label: string;
  preferred_style: 'family drama' | 'school' | 'cinema' | 'roast' | 'emotional' | 'village';
  personal_anchor?: string;
  pending_topic?: string;
  needs_anchor?: boolean;
  current_topic?: string;
  current_module_number?: number;
  current_module?: string;
  expected_answer?: string;
};

const getTimeGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

// Spoken when the daily voice-reply budget is spent. A fixed string, so the TTS
// audio cache serves it for free after the first ever generation.
const VOICE_LIMIT_MESSAGE =
  "That's all my voice replies for today. We can keep going in chat, or upgrade to Pro for a lot more call time.";

const buildLearnModePrompt = (
  userText: string,
  lang: string,
  isMathMode: boolean,
  inputKind: 'topic' | 'answer',
  allowCheckQuestion: boolean,
  confirm: 'affirm' | 'negate' | null = null,
) => [
  'SYSTEM: You are MIGA, a live voice tutor for Indian students and exam aspirants. You are not a long-form chatbot.',
  isMathMode
    ? 'MATH MODE: Teach the solution step by step like a patient 1-on-1 tutor. Explain the idea, the method, each step, and one shortcut only if it is useful. Never dismiss a problem as unclear unless the actual numbers or question are missing.'
    : (inputKind === 'topic'
      ? 'LEARN MODE: Teach the topic clearly in 2-4 short spoken sentences. On normal topic turns, do not ask a question. Just teach cleanly unless the student explicitly asks for a quiz, revision check, or question.'
      : 'LEARN MODE: Answer the student based on what you already taught. Default to a direct explanation, not a quiz.'),
  confirm === 'affirm'
    ? 'CONFIRMATION: The student is simply saying YES to your previous offer to continue/explain. This is NOT a quiz answer. Do NOT say "correct", "exactly right", or grade them. Just continue and teach the thing you offered.'
    : confirm === 'negate'
      ? 'CONFIRMATION: The student is saying NO to your previous offer. This is NOT a quiz answer. Do NOT grade them. Briefly acknowledge and offer a different direction or ask what they want next.'
      : '',
  'CLARITY RULE: Do not say "say it again" or "not quite right" for normal greetings or simple questions. Ask for clarification only when the meaning is genuinely impossible to infer.',
  'LANGUAGE RULE: Reply naturally in the selected language. If the user mixes English with the selected language, use the same natural mix. Do not force fake slang, word-by-word translation, or repeated filler words.',
  'STYLE: No Markdown. No long lists. No random topic switches. Keep the whole turn under 55 words unless the user asks for depth.',
  'CHECK RULE: Do not ask any question in this reply. Do not quiz the student. Teach only.',
  'WAIT: End after the explanation.',
  `SELECTED_LANGUAGE: ${lang || 'English'}`,
  `USER: ${userText}`,
].join('\n');

const stripTutorQuestions = (text: string, allowQuestion = false) => {
  const clean = String(text || '').trim();
  if (!clean || allowQuestion) return clean;
  const parts = clean
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => !part.includes('?'));
  if (parts.length > 0) return parts.join(' ').trim();
  return clean.replace(/\?/g, '.').trim();
};

const buildStoryModePrompt = (topic: string, lang: string) => [
  'SYSTEM: You are MIGA Audio Story, an immersive listening experience for Indian exam students and aspirants.',
  'TASK: Create a full concept story on the requested topic. Use a pocket-friendly audio-first format that helps the listener understand the concept, remember key exam points, and follow along without looking at the screen.',
  'STYLE: Keep it narrative, clear, and rhythmic. Use short sections, examples, exam tips, important formulas, and one concise takeaway at the end.',
  'LISTENING MODE: This is a passive story experience. Do not ask any questions, do not wait for a response, and do not generate a quiz at the end.',
  `SELECTED_LANGUAGE: ${lang || 'English'}`,
  `USER: ${topic}`,
].join('\n');

const defaultProfileName = (user: any) => {
  const metaName = user?.user_metadata?.full_name || user?.user_metadata?.name;
  if (metaName) return String(metaName).split(' ')[0];
  const emailName = user?.email ? String(user.email).split('@')[0] : '';
  return emailName || 'friend';
};

const mascotSessionsStorageKey = (userId?: string | null) => `miga_mascot_sessions_v2:${userId || 'guest'}`;
const mascotActiveSessionKey = (userId?: string | null) => `miga_mascot_active_session_v2:${userId || 'guest'}`;
const createMascotSessionId = () => `miga-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const normalizeSessionTopic = (topic?: string) => {
  const cleanTopic = (topic || '').replace(/\s+/g, ' ').trim();
  if (!cleanTopic) return '';
  if (isCachedGreeting(cleanTopic) || isBrokenTutorEvaluatorLine(cleanTopic)) return '';
  if (cleanTopic.length < 4) return '';
  return cleanTopic;
};
const getSessionTopicFromTranscript = (messages: LiveMessage[]) => {
  const firstUserTurn = messages.find((item) => item.role === 'user' && normalizeSessionTopic(item.text));
  return normalizeSessionTopic(firstUserTurn?.text);
};
const shouldAutoTitleSession = (messages: LiveMessage[]) => {
  const hasMeaningfulUserTurn = messages.some((item) => item.role === 'user' && !!normalizeSessionTopic(item.text));
  const hasAssistantTurn = messages.some((item) => item.role === 'assistant' && item.text.trim().length > 0);
  return hasMeaningfulUserTurn && hasAssistantTurn;
};
const buildSessionTitle = (topic?: string) => {
  const cleanTopic = normalizeSessionTopic(topic);
  return cleanTopic ? cleanTopic.slice(0, 48) : '';
};
const shouldShowTutorVisualBoard = (board: VisualBoard | null | undefined) => {
  if (!board) return false;
  const meaningfulRows = Array.isArray(board.rows) ? board.rows.filter((row) => (row?.label || row?.value || row?.note || '').toString().trim()) : [];
  const meaningfulBullets = Array.isArray(board.bullets) ? board.bullets.filter((item) => String(item || '').trim()) : [];
  return meaningfulRows.length >= 2 || meaningfulBullets.length >= 2;
};

const clampTranscript = (messages: LiveMessage[], max = 40) => messages.slice(-max);

const isGreetingOnly = (text: string) => /^(hi|hii+|hello|hey|yo|vanakkam|namaste|namaskar|வணக்கம்|नमस्ते)[\s!.?]*$/i.test(text.trim());
const isBrokenTutorEvaluatorLine = (text: string) => {
  const value = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!value) return false;
  return [
    'say it',
    'say that',
    'more clearly',
    'not quite',
    'almost',
    'expected idea',
    'expected key',
    'next key point',
    'key point is',
    'try again more clearly',
  ].some((phrase) => value.includes(phrase));
};
const isLikelyMathFollowUp = (text: string) => {
  const value = text.toLowerCase().trim();
  if (!value) return false;
  if (/[=+\-*/×÷^]|₹|rs\.?|\d{2,}/i.test(value)) return false;
  return /(why|how|explain|slower|shortcut|step|again|lcm|formula|புரிய|ஏன்|எப்படி|மெதுவா|shortcut|குறுக்கு)/i.test(value);
};
const GREETING_WORD = /^(hi+|hii+|hello+|helo+|hey+|heya|yo+|hola|good)$/i;
const GREETING_PHRASE = /^(good\s*(morning|afternoon|evening|day)|vanakkam|namaste|namaskar|namaskaram|namaskara|வணக்கம்|नमस्ते|नमस्कार|నమస్తే|నమస్కారం|ನಮಸ್ಕಾರ|നമസ്കാരം)$/i;
// Filler words people tack onto a greeting that should not stop it counting as "just a greeting".
const GREETING_FILLER = new Set(['miga','there','buddy','friend','dear','bro','sir','madam','mam','maam','please','pls','da','machi','anna','akka','ji']);
const isCachedGreeting = (text: string) => {
  const value = text.trim().toLowerCase().replace(/[!.?,;:]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!value) return false;
  // Whole-phrase greetings ("good morning", "namaste") first.
  if (GREETING_PHRASE.test(value)) return true;
  const tokens = value.split(' ');
  if (tokens.length > 4) return false; // long sentence => real topic, not a greeting
  const meaningful = tokens.filter((t) => !GREETING_FILLER.has(t));
  if (meaningful.length === 0) return false;
  // Every meaningful token must itself be a greeting word, else it carries a real request
  // (e.g. "hi explain monetary policy" must NOT be treated as a bare greeting).
  return meaningful.every((t) => GREETING_WORD.test(t) || GREETING_PHRASE.test(t));
};
const getTutorGreetingReply = (lang: string) => {
  const label = (lang || 'English').toLowerCase();
  if (label.includes('tamil')) return 'வணக்கம். இன்று என்ன topic பார்க்கலாம்?';
  if (label.includes('hindi')) return 'नमस्ते. आज कौन सा topic समझना है?';
  if (label.includes('telugu')) return 'నమస్తే. ఈ రోజు ఏ topic నేర్చుకోవాలి?';
  if (label.includes('kannada')) return 'ನಮಸ್ಕಾರ. ಇಂದು ಯಾವ topic ಕಲಿಯೋಣ?';
  if (label.includes('malayalam')) return 'നമസ്കാരം. ഇന്ന് ഏത് topic പഠിക്കാം?';
  return 'Hi. What topic do you want to learn today?';
};
const finalAnswerLabel = (languageCode: string) => {
  const root = (languageCode || 'en').toLowerCase().split(/[-_]/)[0];
  switch (root) {
    case 'ta': return 'இறுதி பதில்';
    case 'hi': return 'अंतिम उत्तर';
    case 'te': return 'తుది సమాధానం';
    case 'kn': return 'ಅಂತಿಮ ಉತ್ತರ';
    case 'ml': return 'അവസാന ഉത്തരം';
    default: return 'Final answer';
  }
};
const isSoftTutorCheckQuestion = (text: string) => {
  const value = text.trim();
  if (!value.includes('?')) return false;
  const normalized = value.toLowerCase();
  if (/^(tell me|say|answer|explain why|what is the answer)/i.test(normalized)) return false;
  return /^(do you|can you|why do you think|what happens if|which one|shall we|would you)/i.test(normalized);
};
// Bare confirmations to the tutor's "shall we look at X?" offer - these are NOT quiz answers
// and must never be graded "correct"/"incorrect" by the backend.
const isAffirmationReply = (text: string) => {
  const v = text.trim().toLowerCase().replace(/[!.?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v || v.split(' ').length > 4) return false;
  return /^(yes|yeah|yep|yup|ya|sure|ok|okay|okie|fine|please do|go ahead|go on|continue|carry on|sounds good|let'?s go|haan|haa|ji|ji haan|aama|aamaa|aam|seri|sari|avunu|howdu|aanu|adhe|ஆம்|ஆமா|ஆமாம்|சரி|हाँ|हां|जी|జీ|అవును|ಹೌದು|ಸರಿ|അതെ|ശരി)$/i.test(v.split(' ').filter((t) => !['please','na','da','ji','then','sir','madam'].includes(t)).join(' ') || v);
};
const isNegationReply = (text: string) => {
  const v = text.trim().toLowerCase().replace(/[!.?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!v || v.split(' ').length > 4) return false;
  return /^(no|nope|nah|not now|maybe later|later|skip|illa|illai|vendaam|vendam|nahi|nahin|nahee|kaadu|kaadhu|alla|venda|వద్దు|లేదు|ಬೇಡ|ಇಲ್ಲ|വേണ്ട|ഇല്ല|வேண்டாம்|இல்லை|नहीं|ना)$/i.test(v);
};

// Boot loading screen
const getTutorWaitNudge = (langCode: string, hasQuestion: boolean) => {
  const normalized = (langCode || 'en-IN').trim();
  const map: Record<string, { question: string; continue: string }> = {
    'en-IN': {
      question: 'If you did not catch that clearly, should I repeat the question?',
      continue: 'If that was not clear, should I repeat it once more?',
    },
    'ta-IN': {
      question: 'தெளிவாக கேட்கவில்லை என்றால், கேள்வியை மறுபடியும் சொல்லட்டுமா?',
      continue: 'தெளிவாக இல்லையெனில், இதை மறுபடியும் சொல்லட்டுமா?',
    },
    'hi-IN': {
      question: 'अगर साफ़ नहीं सुनाई दिया, तो क्या मैं सवाल दोबारा बोलूँ?',
      continue: 'अगर साफ़ नहीं हुआ, तो क्या मैं इसे एक बार फिर दोहराऊँ?',
    },
    'te-IN': {
      question: 'స్పష్టంగా వినిపించకపోతే, ప్రశ్నను మళ్లీ చెప్పాలా?',
      continue: 'స్పష్టంగా లేకపోతే, దీన్ని ఇంకోసారి చెప్పాలా?',
    },
    'kn-IN': {
      question: 'ಸ್ಪಷ್ಟವಾಗಿ ಕೇಳಿಸದಿದ್ದರೆ, ಪ್ರಶ್ನೆಯನ್ನು ಮತ್ತೆ ಹೇಳಲಾ?',
      continue: 'ಸ್ಪಷ್ಟವಾಗಿಲ್ಲದಿದ್ದರೆ, ಇದನ್ನು ಇನ್ನೊಮ್ಮೆ ಹೇಳಲಾ?',
    },
    'ml-IN': {
      question: 'വ്യക്തമായി കേൾക്കാനായില്ലെങ്കിൽ, ചോദ്യം വീണ്ടും പറയട്ടേ?',
      continue: 'വ്യക്തമായില്ലെങ്കിൽ, ഇത് ഒരിക്കൽ കൂടി പറയട്ടേ?',
    },
  };
  const selected = map[normalized] || map['en-IN'];
  return hasQuestion ? selected.question : selected.continue;
};

const BootLoader = () => (
  <View style={boot.root} pointerEvents="none">
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#F8FAFC' }]} />
    <MotiView
      from={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', damping: 20 }}
      style={{ alignItems: 'center' }}
    >
      <LottieView
        source={require('@/assets/lotties/loadingscreen.json')}
        autoPlay
        loop
        style={{ width: 140, height: 140 }}
      />
      <MotiView
        from={{ opacity: 0.3 }}
        animate={{ opacity: 1 }}
        transition={{ loop: true, type: 'timing', duration: 1200 }}
      >
        <Text style={{ fontSize: 13, fontFamily: 'Poppins-Bold', color: '#64748B', marginTop: 12, letterSpacing: 2 }}>
          WAKING UP MIGA
        </Text>
      </MotiView>
    </MotiView>
  </View>
);

const boot = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 900,
  },
  ring: {
    position: 'absolute',
    width: SCREEN.width * 0.6,
    height: SCREEN.width * 0.6,
    borderRadius: SCREEN.width * 0.3,
    borderWidth: 2,
    borderColor: 'rgba(0, 212, 199, 0.2)',
  },
  avatar: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  dotRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 40,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00D4C7',
  },
  label: {
    marginTop: 12,
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#64748B',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});

// Main screen
export default function MascotScreen() {
  const { user, loading } = useAuthContext();
  const insets = useSafeAreaInsets();
  const tabDockHeight = useTabDockHeight();
  const bootSessionIdRef = useRef(createMascotSessionId());

  const [askInput, setAskInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [subtitles, setSubtitles] = useState('');
  const [emotion, setEmotion] = useState<MascotEmotion>('idle');
  const [isMascotBooted, setIsMascotBooted] = useState(false);
  const [experienceMode, setExperienceMode] = useState<ExperienceMode>('tutor');
  const [liveMessages, setLiveMessages] = useState<LiveMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [storyPhase, setStoryPhase] = useState<StoryPhase>('idle');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [currentStoryId, setCurrentStoryId] = useState<string | null>(null);
  const [storyLanguage, setStoryLanguage] = useState('en-IN');
  const [isStoryStreaming, setIsStoryStreaming] = useState(false);
  const [isStoryListening, setIsStoryListening] = useState(false);
  const [isTutorListening, setIsTutorListening] = useState(false);
  const [isTutorStreaming, setIsTutorStreaming] = useState(false);
  const [storyAwaitingUser, setStoryAwaitingUser] = useState(false);
  const [isLangPickerOpen, setIsLangPickerOpen] = useState(false);
  const [choices, setChoices] = useState<string[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState('English');
  const [stageIntroKey, setStageIntroKey] = useState(0);
  const [showSessionFlash, setShowSessionFlash] = useState(false);
  const sessionFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Safety net for the input box locking up: if the WS backing a tutor/math
  // turn stalls with no message, error, or close event at all (a silent hang,
  // not a clean failure — those already reset via onError/onClose), isSending
  // would otherwise stay true forever with nothing to unlock the input.
  const sendWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visualBoard, setVisualBoard] = useState<VisualBoard | null>(null);
  const [visualBoardOffset, setVisualBoardOffset] = useState({ x: 0, y: 0 });
  const [hasTutorConversationStarted, setHasTutorConversationStarted] = useState(false);
  const [fingerPoint, setFingerPoint] = useState<{ x: number; y: number; id: number } | null>(null);
  const [isMathMode, setIsMathMode] = useState(false);
  const [isCameraScanOpen, setIsCameraScanOpen] = useState(false);
  const [mathScanMode, setMathScanMode] = useState<'camera' | 'gallery'>('camera');
  const [lastSolution, setLastSolution] = useState<MathSolution | null>(null);
  const [mathInputIntent, setMathInputIntent] = useState<'auto' | 'doubt' | 'new'>('auto');
  const [mathSolveState, setMathSolveState] = useState<MathSolveState>('idle');
  const [mathRevealCount, setMathRevealCount] = useState(0);
  const [tutorAwaitingReply, setTutorAwaitingReply] = useState(false);
  const [showStoryAudioLabel, setShowStoryAudioLabel] = useState(false);
  const [streakMissPopup, setStreakMissPopup] = useState<string | null>(null);
  const [isTabPaused, setIsTabPaused] = useState(false);
  const [keyboardLift, setKeyboardLift] = useState(0);
  const [sessions, setSessions] = useState<MascotSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>(bootSessionIdRef.current);
  const [isSessionSheetOpen, setIsSessionSheetOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'call' | 'chat'>('chat');
  const [chatMounted, setChatMounted] = useState(true);
  const activeTutorLanguageCode = LANGUAGES_MAP.find((item) => item.label === selectedLanguage)?.sarvam || 'en-IN';

  // Interactive Mascot suggestion states
  const [kuralFlowState, setKuralFlowState] = useState<'idle' | 'couplet' | 'ask_meaning' | 'choose_meaning_lang' | 'choose_kural_lang' | 'reading_explanation'>('idle');
  const [currentKural, setCurrentKural] = useState<LocalizedThirukkural | null>(null);

  const [currentAffairsState, setCurrentAffairsState] = useState<'idle' | 'question' | 'explanation'>('idle');
  const [caQuestions, setCaQuestions] = useState<any[]>([]);
  const [caIndex, setCaIndex] = useState<number>(0);
  const [studentProfile, setStudentProfile] = useState<StudentStoryProfile>(() => ({
    name: defaultProfileName(user),
    exam_goal: 'Competitive exams',
    language_code: 'en-IN',
    language_label: 'English',
    preferred_style: 'family drama',
  }));

  const greetedRef = useRef(false);
  const mascotRef = useRef<MascotRigRef>(null);
  const storyWsRef = useRef<WebSocket | null>(null);
  const storyTranscriptRef = useRef('');
  const storyLanguageRef = useRef(storyLanguage);
  const studentProfileRef = useRef<StudentStoryProfile>(studentProfile);
  const selectedLanguageRef = useRef(selectedLanguage);
  const experienceModeRef = useRef<ExperienceMode>(experienceMode);
  const sessionsRef = useRef<MascotSession[]>([]);
  const sessionIdRef = useRef(bootSessionIdRef.current);
  const activeTurnIdRef = useRef('');
  const turnCounterRef = useRef(0);
  const tutorCheckAllowedRef = useRef(false);
  const isStoryListeningRef = useRef(false);
  const isTutorListeningRef = useRef(false);
  const activityStateRef = useRef({
    isSending: false,
    isThinking: false,
    isPlaying: false,
    isStoryStreaming: false,
    isTutorStreaming: false,
    isStoryListening: false,
    isTutorListening: false,
  });

  // High-fidelity word-by-word subtitle synchronization refs and hooks
  const subtitleIntervalRef = useRef<any>(null);
  const startSubtitleReveal = useCallback((fullText: string, durationMs: number, wordTimings?: WordTiming[]) => {
    if (subtitleIntervalRef.current) {
      if (Array.isArray(subtitleIntervalRef.current)) subtitleIntervalRef.current.forEach((timer) => clearTimeout(timer));
      else clearInterval(subtitleIntervalRef.current);
      subtitleIntervalRef.current = null;
    }
    const cleanText = sanitizeText(fullText);
    const words = cleanText.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      setSubtitles('');
      return;
    }
    const validTimings = Array.isArray(wordTimings)
      ? wordTimings.filter((item) => item && typeof item.word === 'string' && Number.isFinite(Number(item.start_ms)))
      : [];
    if (validTimings.length > 0) {
      const timingDuration = Math.max(...validTimings.map((item) => Number(item.end_ms ?? item.start_ms ?? 0)), 1);
      const scale = durationMs && timingDuration ? durationMs / timingDuration : 1;
      const revealedWords = validTimings.map((item) => sanitizeText(item.word)).filter(Boolean);
      subtitleIntervalRef.current = validTimings.map((item, index) => {
        const delay = Math.max(0, Math.floor(Number(item.start_ms || 0) * scale));
        return setTimeout(() => {
          const sourceWords = revealedWords.length >= Math.min(index + 1, words.length) ? revealedWords : words;
          setSubtitles(sourceWords.slice(0, index + 1).join(' '));
        }, delay);
      });
      return;
    }
    setSubtitles(words[0]);
    const duration = durationMs || Math.max(1500, words.length * 320);
    const intervalTime = Math.max(150, Math.floor(duration / words.length));

    let currentIndex = 1;
    subtitleIntervalRef.current = setInterval(() => {
      if (currentIndex >= words.length) {
        clearInterval(subtitleIntervalRef.current);
        subtitleIntervalRef.current = null;
        return;
      }
      setSubtitles((prev) => words.slice(0, currentIndex + 1).join(' '));
      currentIndex++;
    }, intervalTime);
  }, []);

  const clearSubtitleReveal = useCallback(() => {
    if (subtitleIntervalRef.current) {
      if (Array.isArray(subtitleIntervalRef.current)) subtitleIntervalRef.current.forEach((timer) => clearTimeout(timer));
      else clearInterval(subtitleIntervalRef.current);
      subtitleIntervalRef.current = null;
    }
    setSubtitles('');
  }, []);

  const beginMascotTurn = useCallback((kind: string) => {
    const turnId = `${kind}-${Date.now()}-${turnCounterRef.current + 1}`;
    turnCounterRef.current += 1;
    activeTurnIdRef.current = turnId;
    setTutorAwaitingReply(false);
    console.log('[miga_mascot_turn.start]', { turnId, kind, mode: experienceMode, math: isMathMode });
    return turnId;
  }, [experienceMode, isMathMode]);

  const isActiveTurn = useCallback((turnId: string) => activeTurnIdRef.current === turnId, []);
  const streamModeRef = useRef<ExperienceMode>('story');
  const storyQueueEmptyRef = useRef(false);
  const storyWaitFlagRef = useRef(false);
  const tutorWaitFlagRef = useRef(false);
  const startStoryListeningRef = useRef<(() => Promise<void>) | null>(null);
  const hadStreamResponseRef = useRef(false);
  const subtitleRunningRef = useRef(false);
  const subtitleTextQueueRef = useRef<string[]>([]);
  const subtitleDurationQueueRef = useRef<number[]>([]);
  const subtitleTimerRef = useRef<any>(null);
  const nudgeForSubtitleRef = useRef('');
  const tutorWaitNudgeTimerRef = useRef<any>(null);
  const latestTutorQuestionRef = useRef('');
  const currentAudioDurationRef = useRef<number | null>(null);
  const currentAudioWordTimingsRef = useRef<WordTiming[] | null>(null);
  const pendingVisualBoardRef = useRef<VisualBoard | null>(null);
  const visualBoardDragOriginRef = useRef({ x: 0, y: 0 });
  const sessionHydratedRef = useRef(false);
  const hydratedUserIdRef = useRef<string | null>(null);
  // Remaining voice replies allowed today. null = unknown/unlimited, which is the
  // FAIL-OPEN default: if the server has not been told about miga_call yet, or the
  // gate errors, voice keeps working exactly as before. It only ever blocks when a
  // real server response reports the daily limit is spent.
  const voiceRepliesRemainingRef = useRef<number | null>(null);
  const sessionSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPersistedPayloadRef = useRef('');

  const buildSessionSnapshot = useCallback((base?: Partial<MascotSession>): MascotSession => {
    const now = new Date().toISOString();
    const transcript = Array.isArray(base?.transcript)
      ? clampTranscript(base.transcript, 40)
      : clampTranscript(liveMessages, 40);
    const topic = typeof base?.topic === 'string' ? base.topic : getSessionTopicFromTranscript(transcript);
    const resolvedMode = base?.mode || experienceMode;
    const resolvedTitle = base?.title !== undefined
      ? base.title
      : (shouldAutoTitleSession(transcript) ? buildSessionTitle(topic) : '');
    return {
      id: base?.id || sessionIdRef.current,
      mode: resolvedMode,
      title: resolvedTitle,
      createdAt: base?.createdAt || now,
      updatedAt: now,
      lastMessage: transcript[transcript.length - 1]?.text || base?.lastMessage,
      languageCode: base?.languageCode || (resolvedMode === 'story' ? storyLanguageRef.current : activeTutorLanguageCode),
      languageLabel: base?.languageLabel || (resolvedMode === 'story' ? (selectedLanguage || 'English') : selectedLanguage),
      status: base?.status || (isThinking || isSending || isStoryStreaming || isTutorStreaming ? 'active' : 'paused'),
      topic: base?.topic || topic,
      storyId: base?.storyId ?? currentStoryId ?? null,
      messageCount: transcript.length,
      transcript,
    };
  }, [activeTutorLanguageCode, currentStoryId, experienceMode, isSending, isStoryStreaming, isThinking, isTutorStreaming, liveMessages, selectedLanguage]);

  const persistMascotSessions = useCallback(async (nextSessions: MascotSession[], nextActiveId?: string) => {
    try {
      const userId = user?.id || null;
      const key = mascotSessionsStorageKey(userId);
      const activeKey = mascotActiveSessionKey(userId);
      const trimmedSessions = nextSessions.slice(0, 12);
      const activeId = nextActiveId || sessionIdRef.current;
      const payload = JSON.stringify({ sessions: trimmedSessions, activeId });
      if (payload === lastPersistedPayloadRef.current) {
        setSessions(trimmedSessions);
        if (nextActiveId) setActiveSessionId(nextActiveId);
        return;
      }
      lastPersistedPayloadRef.current = payload;
      await AsyncStorage.multiSet([
        [key, JSON.stringify(trimmedSessions)],
        [activeKey, activeId],
      ]);
      if (userId) {
        void Promise.all(trimmedSessions.map((session) => CallSessionService.upsert(session))).catch((error) => {
          console.warn('[mascot] Failed to sync cloud call sessions:', error);
        });
      }
      setSessions(trimmedSessions);
      if (nextActiveId) setActiveSessionId(nextActiveId);
    } catch (error) {
      console.warn('[mascot] Failed to persist sessions:', error);
    }
  }, [user?.id]);

  const upsertCurrentSession = useCallback(async (patch?: Partial<MascotSession>) => {
    const next = buildSessionSnapshot({
      ...patch,
      id: patch?.id || sessionIdRef.current,
    });
    const existing = sessionsRef.current.filter((item) => item.id !== next.id);
    const nextSessions = [next, ...existing].slice(0, 12);
    await persistMascotSessions(nextSessions, next.id);
    return next;
  }, [buildSessionSnapshot, persistMascotSessions]);

  const startFreshSession = useCallback(async (mode: MascotSessionMode = experienceMode, title?: string) => {
    // Hard-stop any in-flight speech/audio/stream before spinning up the new session
    // so the previous session can never keep talking over the fresh one.
    interruptRef.current?.();
    const nextId = createMascotSessionId();
    sessionIdRef.current = nextId;
    activeTurnIdRef.current = `session-${nextId}`;
    setActiveSessionId(nextId);
    setExperienceMode(mode);
    setAskInput('');
    setLiveMessages([]);
    setVisualBoard(null);
    pendingVisualBoardRef.current = null;
    tutorCheckAllowedRef.current = false;
    setChoices([]);
    setSubtitles('');
    setStatusMessage(mode === 'story' ? 'New story session' : 'New chat ready');
    setIsTabPaused(false);
    setStageIntroKey((prev) => prev + 1);
    setEmotion('idle');
    setStoryPhase('idle');
    setCurrentStoryId(null);
    setTutorAwaitingReply(false);
    setHasTutorConversationStarted(false);
    setLastSolution(null);
    setMathInputIntent('auto');
    setMathSolveState('idle');
    setMathRevealCount(0);
    setIsSending(false);
    setIsThinking(false);
    setIsStoryStreaming(false);
    setIsTutorStreaming(false);
    setStoryAwaitingUser(false);
    setIsStoryListening(false);
    setIsTutorListening(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    // Visually reinforce that a brand-new session was created and is now active.
    setShowSessionFlash(true);
    if (sessionFlashTimerRef.current) clearTimeout(sessionFlashTimerRef.current);
    sessionFlashTimerRef.current = setTimeout(() => setShowSessionFlash(false), 1800);
    const next = buildSessionSnapshot({
      id: nextId,
      mode,
      title: title ?? '',
      createdAt: new Date().toISOString(),
      status: 'active',
      topic: '',
      storyId: null,
      transcript: [],
      messageCount: 0,
    });
    await persistMascotSessions([next, ...sessionsRef.current.filter((item) => item.id !== nextId)].slice(0, 12), nextId);
    return nextId;
  }, [buildSessionSnapshot, experienceMode, persistMascotSessions]);

  const restoreSession = useCallback((session: MascotSession) => {
    // Stop whatever the previous/current session was saying before swapping context in.
    interruptRef.current?.();
    sessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    setExperienceMode(session.mode);
    setLiveMessages(session.transcript || []);
    setCurrentStoryId(session.storyId || null);
    setStoryLanguage(session.languageCode || 'en-IN');
    setSelectedLanguage(session.languageLabel || 'English');
    setVisualBoard(null);
    pendingVisualBoardRef.current = null;
    tutorCheckAllowedRef.current = false;
    setChoices([]);
    setSubtitles('');
    setStatusMessage(session.lastMessage || 'Ready');
    setIsTabPaused(false);
    setEmotion('idle');
    setStoryPhase(session.mode === 'story' ? 'awaiting' : 'idle');
    setTutorAwaitingReply(false);
    setHasTutorConversationStarted((session.transcript || []).length > 0 && session.mode === 'tutor');
    setMathInputIntent('auto');
    setMathSolveState('idle');
    setMathRevealCount(0);
  }, []);

  const markSessionActive = useCallback(async (patch?: Partial<MascotSession>) => {
    if (!sessionHydratedRef.current) return;
    const next = await upsertCurrentSession({
      status: isSending || isThinking || isStoryStreaming || isTutorStreaming ? 'active' : 'paused',
      ...patch,
    });
    return next;
  }, [isSending, isStoryStreaming, isThinking, isTutorStreaming, upsertCurrentSession]);
  const upsertCurrentSessionRef = useRef(upsertCurrentSession);
  useEffect(() => {
    upsertCurrentSessionRef.current = upsertCurrentSession;
  }, [upsertCurrentSession]);

  useEffect(() => {
    if (!user?.id || loading) return;
    if (hydratedUserIdRef.current === user.id) return;
    hydratedUserIdRef.current = user.id;
    let live = true;
    (async () => {
      try {
        const [[storedSessionsRaw, storedActiveId], cloudSessions] = await Promise.all([
          AsyncStorage.multiGet([
            mascotSessionsStorageKey(user.id),
            mascotActiveSessionKey(user.id),
          ]),
          CallSessionService.list(12),
        ]);
        if (!live) return;
        const localSessions = JSON.parse(storedSessionsRaw?.[1] || '[]') as MascotSession[];
        const storedSessions = Array.isArray(cloudSessions) && cloudSessions.length > 0 ? cloudSessions : localSessions;
        const activeId = storedActiveId?.[1] || '';
        if (Array.isArray(storedSessions) && storedSessions.length > 0) {
          const normalizedSessions = storedSessions.slice(0, 12).map((item) => {
            const transcript = Array.isArray(item.transcript) ? item.transcript : [];
            const hasUserTurn = transcript.some((entry) => entry.role === 'user' && entry.text.trim());
            return {
              ...item,
              title: hasUserTurn && shouldAutoTitleSession(transcript)
                ? (item.title || buildSessionTitle(getSessionTopicFromTranscript(transcript)))
                : '',
              transcript: hasUserTurn ? transcript : [],
              lastMessage: hasUserTurn ? item.lastMessage : undefined,
              messageCount: hasUserTurn ? transcript.length : 0,
              topic: hasUserTurn ? (item.topic || getSessionTopicFromTranscript(transcript)) : '',
            };
          });
          lastPersistedPayloadRef.current = JSON.stringify({
            sessions: normalizedSessions,
            activeId: activeId || normalizedSessions[0]?.id || '',
          });
          setSessions(normalizedSessions);
        }
        // Launching the app always opens a fresh session rather than resuming the
        // last one, in both call and chat: past sessions stay one tap away in
        // history. (Chat mode does the same in MigaChat's mount effect.)
        const freshId = await startFreshSession(experienceModeRef.current, '');
        setActiveSessionId(freshId);
        sessionHydratedRef.current = true;
      } catch (error) {
        console.warn('[mascot] Failed to hydrate sessions:', error);
        sessionHydratedRef.current = true;
      }
    })();
    return () => { live = false; };
  }, [loading, user?.id]);

  useEffect(() => {
    if (!sessionHydratedRef.current || !user?.id) return;
    if (sessionSyncTimerRef.current) clearTimeout(sessionSyncTimerRef.current);
    sessionSyncTimerRef.current = setTimeout(() => {
      const sessionTopic = getSessionTopicFromTranscript(liveMessages);
      const sessionTitle = shouldAutoTitleSession(liveMessages) ? buildSessionTitle(sessionTopic) : '';
      void markSessionActive({
        id: sessionIdRef.current,
        mode: experienceMode,
        title: sessionTitle,
        lastMessage: liveMessages[liveMessages.length - 1]?.text,
        languageCode: experienceMode === 'story' ? storyLanguageRef.current : activeTutorLanguageCode,
        languageLabel: experienceMode === 'story' ? (selectedLanguage || 'English') : selectedLanguage,
        topic: sessionTopic,
        storyId: currentStoryId || null,
      });
    }, 900);
    return () => {
      if (sessionSyncTimerRef.current) clearTimeout(sessionSyncTimerRef.current);
    };
  }, [activeTutorLanguageCode, currentStoryId, experienceMode, liveMessages, markSessionActive, selectedLanguage, user?.id]);

  const visualBoardPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_evt, gestureState) => Math.abs(gestureState.dx) > 5 || Math.abs(gestureState.dy) > 5,
    onPanResponderGrant: () => {
      visualBoardDragOriginRef.current = visualBoardOffset;
    },
    onPanResponderMove: (_evt, gestureState) => {
      const nextX = visualBoardDragOriginRef.current.x + gestureState.dx;
      const nextY = visualBoardDragOriginRef.current.y + gestureState.dy;
      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
      setVisualBoardOffset({
        x: clamp(nextX, -SCREEN.width * 0.36, SCREEN.width * 0.36),
        y: clamp(nextY, -SCREEN.height * 0.22, SCREEN.height * 0.22),
      });
    },
  }), [visualBoardOffset]);

  const { isPlaying, speak, stopAudio, playUri, preloadAudio } = useMascotAudio({
    onAudioStart: (text) => {
      setIsThinking(false);
      setStatusMessage(null);
      if (experienceMode === 'story') setStoryPhase('speaking');
      const estimated = Math.max(1500, text.split(/\s+/).length * 320);
      startSubtitleReveal(text, currentAudioDurationRef.current || estimated, currentAudioWordTimingsRef.current || undefined);
      currentAudioDurationRef.current = null;
      currentAudioWordTimingsRef.current = null;
    },
    onAudioStop: () => {
      mascotRef.current?.stopSpeaking();
      mascotRef.current?.resetAudioQueue();
      mascotRef.current?.setMouth(0);
      setStatusMessage(null);
      clearSubtitleReveal();
      if (streamModeRef.current === 'tutor') {
        setTutorAwaitingReply(tutorWaitFlagRef.current);
      }
      if (experienceMode === 'story') {
        setStoryPhase('awaiting');
      }
      setIsSending(false);
      setIsThinking(false);
      if (experienceMode === 'tutor' && isMathMode) {
        setMathSolveState((prev) => (prev === 'idle' ? prev : 'done'));
      }
    },
    onVisemeFrame: (val, form) => {
      mascotRef.current?.setMouth(val, form);
    },
    onAudioMeta: (durationMs) => {
      currentAudioDurationRef.current = durationMs;
    },
    languageCode: activeTutorLanguageCode,
  });
  const stopAudioRef = useRef(stopAudio);
  useEffect(() => {
    stopAudioRef.current = stopAudio;
  }, [stopAudio]);

  const isResponding = isThinking || isSending || isPlaying || isTutorStreaming || isStoryStreaming;

  const resetSubtitles = useCallback(() => {
    setSubtitles('');
  }, []);

  const pushLiveMessage = useCallback((role: 'user' | 'assistant', text: string) => {
    setLiveMessages((prev) => [...prev, { id: Date.now().toString(), role, text, timestamp: Date.now() }]);
  }, []);

  const clearTutorWaitNudge = useCallback(() => {
    if (tutorWaitNudgeTimerRef.current) {
      clearTimeout(tutorWaitNudgeTimerRef.current);
      tutorWaitNudgeTimerRef.current = null;
    }
  }, []);

  const scheduleTutorWaitNudge = useCallback(() => {
    clearTutorWaitNudge();
    if (experienceMode !== 'tutor' || !tutorAwaitingReply || !tutorWaitFlagRef.current) return;
    const question = latestTutorQuestionRef.current;
    if (!question) return;
    tutorWaitNudgeTimerRef.current = setTimeout(() => {
      if (experienceMode !== 'tutor' || !tutorAwaitingReply || !tutorWaitFlagRef.current || isPlaying || isThinking || isTutorStreaming || isTutorListening) return;
      const nudgeLanguageCode = (studentProfileRef.current.language_code || activeTutorLanguageCode || 'en-IN').trim();
      const nudge = getTutorWaitNudge(nudgeLanguageCode, !!question);
      setTutorAwaitingReply(false);
      setEmotion('listening');
      mascotRef.current?.setExpression('listening');
      pushLiveMessage('assistant', nudge);
      speak(nudge, () => {
        setEmotion('speaking');
        mascotRef.current?.startSpeaking();
      });
    }, 10000);
  }, [activeTutorLanguageCode, clearTutorWaitNudge, experienceMode, isPlaying, isThinking, isTutorListening, isTutorStreaming, pushLiveMessage, speak, tutorAwaitingReply]);

  useEffect(() => {
    if (!tutorAwaitingReply) {
      clearTutorWaitNudge();
      return;
    }
    scheduleTutorWaitNudge();
    return clearTutorWaitNudge;
  }, [clearTutorWaitNudge, scheduleTutorWaitNudge, tutorAwaitingReply]);

  useEffect(() => {
    if (!isThinking || isPlaying) {
      mascotRef.current?.lookAt(0, 0);
      mascotRef.current?.setMouth(0, 0);
      return;
    }
    mascotRef.current?.setExpression('thinking');
    mascotRef.current?.setMouth(0, 0);
    return () => {
      mascotRef.current?.lookAt(0, 0);
      mascotRef.current?.setMouth(0, 0);
    };
  }, [isPlaying, isThinking]);

  useEffect(() => {
    let live = true;
    if (!user?.id) return () => { live = false; };
    (async () => {
      try {
        const today = new Date();
        const todayKey = today.toLocaleDateString('en-CA');
        const storageKey = `miga_streak_miss_angry_seen_${user.id}_${todayKey}`;
        const alreadySeen = await AsyncStorage.getItem(storageKey);
        if (alreadySeen || !live) return;
        const { data } = await supabase
          .from('user_profiles')
          .select('streak_count,last_activity_date')
          .eq('id', user.id)
          .maybeSingle();
        if (!live || !data?.last_activity_date || !data?.streak_count) return;
        const last = new Date(`${data.last_activity_date}T00:00:00`);
        const todayStart = new Date(`${todayKey}T00:00:00`);
        const diffDays = Math.floor((todayStart.getTime() - last.getTime()) / 86400000);
        if (diffDays <= 1) return;
        await AsyncStorage.setItem(storageKey, '1');
        setStreakMissPopup(`You missed ${diffDays} days. MIGA noticed the gap.`);
        setEmotion('sad');
        mascotRef.current?.setExpression('sad');
        setTimeout(() => {
          if (!live) return;
          setStreakMissPopup(null);
          setEmotion('idle');
          mascotRef.current?.setExpression('idle');
        }, 3600);
      } catch (error) {
        console.warn('[mascot] streak miss expression check failed', error);
      }
    })();
    return () => { live = false; };
  }, [user?.id]);

  const profileStorageKey = useCallback(() => `miga_story_profile_${user?.id || 'guest'}`, [user?.id]);

  const newMascotSessionId = useCallback(() => `miga-${Date.now()}-${Math.random().toString(36).slice(2)}`, []);

  const getTutorLangCode = useCallback(() => {
    const storedCode = studentProfileRef.current?.language_code?.trim();
    if (storedCode) return storedCode;
    const map: Record<string, string> = {
      English: 'en-IN', Hindi: 'hi-IN', Tamil: 'ta-IN',
      Telugu: 'te-IN', Malayalam: 'ml-IN', Kannada: 'kn-IN',
    };
    return map[selectedLanguage] || 'en-IN';
  }, [selectedLanguage]);

  useEffect(() => {
    if (isMathMode && isLangPickerOpen) {
      setIsLangPickerOpen(false);
    }
  }, [isLangPickerOpen, isMathMode]);

  const tutorProfileForRequest = useCallback((): StudentStoryProfile => {
    const base = studentProfileRef.current;
    if (hasTutorConversationStarted) return base;
    const { current_topic, current_module_number, current_module, expected_answer, pending_topic, ...stable } = base;
    return {
      ...stable,
      language_code: getTutorLangCode(),
      language_label: selectedLanguage,
    };
  }, [getTutorLangCode, hasTutorConversationStarted, selectedLanguage]);

  const persistStudentProfile = useCallback(async (next: StudentStoryProfile) => {
    studentProfileRef.current = next;
    setStudentProfile(next);
    try {
      await AsyncStorage.setItem(profileStorageKey(), JSON.stringify(next));
    } catch (err) {
      console.warn('[mascot] profile save failed:', err);
    }
  }, [profileStorageKey]);

  const mergeStudentProfile = useCallback((patch: Partial<StudentStoryProfile>) => {
    const next = {
      ...studentProfileRef.current,
      ...patch,
    };
    persistStudentProfile(next);
  }, [persistStudentProfile]);

  const pendingSentenceRef = useRef('');
  const sentenceBySeqRef = useRef<Record<string, string>>({});
  const rejectedSentenceSeqRef = useRef<Record<string, boolean>>({});
  const streamAudioQueueRef = useRef<{ chunk: string; preloadPromise?: Promise<string>; text: string; emotion: MascotEmotion; isFinal: boolean; visemes?: VisemeFrame[]; wordTimings?: WordTiming[]; durationMs?: number }[]>([]);
  const isStreamingPlaybackActiveRef = useRef(false);
  const streamFinalPendingRef = useRef(false);
  const awaitingAiResponseRef = useRef(false);

  const finishCurrentStream = useCallback((waitForUser = false, fallbackMessage?: string) => {
    awaitingAiResponseRef.current = false;
    setIsSending(false);
    setIsThinking(false);
    setIsTutorStreaming(false);
    setIsStoryStreaming(false);
    setIsStoryListening(false);
    setIsTutorListening(false);
    void Voice.stop().catch(() => {});
    setEmotion(waitForUser ? 'listening' : 'idle');
    mascotRef.current?.stopSpeaking();
    mascotRef.current?.setMouth(0);
    currentAudioDurationRef.current = null;
    currentAudioWordTimingsRef.current = null;
    pendingVisualBoardRef.current = null;
    void stopAudio();
    if (sendWatchdogRef.current) {
      clearTimeout(sendWatchdogRef.current);
      sendWatchdogRef.current = null;
    }

    if (streamModeRef.current === 'story') {
      setStoryAwaitingUser(waitForUser);
      setStoryPhase(waitForUser ? 'awaiting' : 'idle');
      if (waitForUser) startStoryListeningRef.current?.();
    } else if (waitForUser) {
      setEmotion('listening');
      setStatusMessage(null);
    }

    if (fallbackMessage && !hadStreamResponseRef.current) {
      if (streamModeRef.current === 'story') {
        setStatusMessage(fallbackMessage);
      } else {
        setSubtitles(fallbackMessage);
      }
      pushLiveMessage('assistant', fallbackMessage);
    }
  }, [pushLiveMessage, stopAudio]);

  const processStreamPlaybackQueue = useCallback(async () => {
    if (isStreamingPlaybackActiveRef.current || streamAudioQueueRef.current.length === 0) return;

    isStreamingPlaybackActiveRef.current = true;
    const item = streamAudioQueueRef.current.shift();
    if (!item) {
      isStreamingPlaybackActiveRef.current = false;
      return;
    }

    try {
      if (item.chunk) {
        let playTarget = `data:audio/mp3;base64,${item.chunk}`;
        if (item.preloadPromise) {
          try {
            const preloadedId = await item.preloadPromise;
            if (preloadedId) playTarget = preloadedId;
          } catch (e) {
            console.warn('[mascot] preload error, continuing with raw chunk data', e);
          }
        }

        // Native audio playback using playUri
        const nextEmotion = streamModeRef.current === 'story' ? 'idleSpeaking' : (item.emotion || 'speaking');
        setEmotion(nextEmotion as MascotEmotion);
        currentAudioWordTimingsRef.current = Array.isArray(item.wordTimings) ? item.wordTimings : null;
        currentAudioDurationRef.current = item.durationMs || null;
        await playUri(playTarget, () => {
          // onStart
          mascotRef.current?.startSpeaking();
          mascotRef.current?.setExpression(nextEmotion as any);
          if (streamModeRef.current === 'story') {
            setStoryPhase('speaking');
          }
        }, item.text || '', item.visemes);
      } else if (item.text) {
        const nextEmotion = streamModeRef.current === 'story' ? 'idleSpeaking' : (item.emotion || 'speaking');
        setEmotion(nextEmotion as MascotEmotion);
        await new Promise<void>((resolve) => {
          speak(item.text, () => {
            mascotRef.current?.startSpeaking();
            mascotRef.current?.setExpression(nextEmotion as any);
            if (streamModeRef.current === 'story') setStoryPhase('speaking');
          });
          const timeoutMs = Math.max(1200, Math.min(9000, item.text.split(/\s+/).filter(Boolean).length * 320));
          setTimeout(resolve, timeoutMs);
        });
      }
    } catch (err) {
      console.warn('[mascot] Native stream playback error:', err);
    } finally {
      mascotRef.current?.stopSpeaking();
      mascotRef.current?.setMouth(0);

      const isFinalItem = item.isFinal || (streamFinalPendingRef.current && streamAudioQueueRef.current.length === 0);
      if (isFinalItem) {
        streamFinalPendingRef.current = false;
        if (streamModeRef.current === 'story') {
          if (storyWaitFlagRef.current) {
            setStoryPhase('awaiting');
            startStoryListeningRef.current?.();
          } else {
            setStoryPhase('idle');
            setEmotion('idle');
          }
        } else {
          setIsTutorStreaming(false);
          setIsThinking(false);
        setEmotion(storyWaitFlagRef.current ? 'listening' : 'idle');
          // Show the board once teaching for this chunk has finished, whether or not
          // the tutor is pausing for the user. During a pause the Continue button
          // dismisses it and advances to the next chunk.
          if (shouldShowTutorVisualBoard(pendingVisualBoardRef.current)) {
            setVisualBoard(pendingVisualBoardRef.current);
          }
          pendingVisualBoardRef.current = null;
        }
      }

      isStreamingPlaybackActiveRef.current = false;
      // Loop to next item
      processStreamPlaybackQueue();
    }
  }, [playUri, speak]);

  const handleStorySocketMessage = useCallback((event: MessageEvent) => {
    try {
      const data = JSON.parse(String(event.data));
      const incomingTurnId = String(data.request_id || data.requestId || '');
      if (incomingTurnId && incomingTurnId !== activeTurnIdRef.current) return;
      if (data.type === 'emotion') {
        const nextEmotion = String(data.emotion || data.value || 'teaching') as MascotEmotion;
        setEmotion(nextEmotion);
        mascotRef.current?.setExpression(nextEmotion);
      } else if (data.type === 'sentence') {
          const sentence = stripTutorQuestions(String(data.text || '').trim(), tutorCheckAllowedRef.current);
        if (sentence) {
          const seqKey = String(data.seq ?? 'latest');
          if (streamModeRef.current === 'tutor' && isBrokenTutorEvaluatorLine(sentence)) {
            rejectedSentenceSeqRef.current[seqKey] = true;
            return;
          }
          const nextEmotion = String(data.emotion || 'teaching') as MascotEmotion;
          hadStreamResponseRef.current = true;
          pendingSentenceRef.current = sentence;
          sentenceBySeqRef.current[seqKey] = sentence;
          if (streamModeRef.current === 'tutor' && tutorCheckAllowedRef.current && isSoftTutorCheckQuestion(sentence)) {
            latestTutorQuestionRef.current = sentence;
          }
          storyTranscriptRef.current += `${sentence} `;
          pushLiveMessage('assistant', sentence);
          setEmotion(nextEmotion);
          mascotRef.current?.setExpression(nextEmotion);
          setSubtitles('');
        }
      } else if (data.type === 'audio') {
        const chunk = data.chunk || '';
        const isFinal = Boolean(data.is_final || data.isFinal);
        const seqKey = String(data.seq ?? 'latest');
        if (rejectedSentenceSeqRef.current[seqKey]) {
          delete rejectedSentenceSeqRef.current[seqKey];
          return;
        }
        const text = sentenceBySeqRef.current[seqKey] || pendingSentenceRef.current || '';
        const nextEmotion = String(data.emotion || emotion || 'speaking') as MascotEmotion;
        if (pendingSentenceRef.current === text) pendingSentenceRef.current = '';

        if (chunk || text) {
          hadStreamResponseRef.current = true;
          const dataUri = `data:audio/mp3;base64,${chunk}`;
          const preloadPromise = chunk ? preloadAudio(dataUri) : undefined;

          streamAudioQueueRef.current.push({
            chunk,
            preloadPromise,
            text,
            emotion: nextEmotion,
            isFinal,
            visemes: Array.isArray(data.visemes) ? data.visemes : undefined,
            wordTimings: Array.isArray(data.word_timings) ? data.word_timings : undefined,
            durationMs: Number(data.duration_ms || 0) || undefined,
          });
          processStreamPlaybackQueue();
        } else if (text) {
          hadStreamResponseRef.current = true;
          streamAudioQueueRef.current.push({
            chunk: '',
            text,
            emotion: nextEmotion,
            isFinal,
            visemes: Array.isArray(data.visemes) ? data.visemes : undefined,
            wordTimings: Array.isArray(data.word_timings) ? data.word_timings : undefined,
            durationMs: Number(data.duration_ms || 0) || undefined,
          });
          processStreamPlaybackQueue();
        } else if (isFinal) {
          if (streamAudioQueueRef.current.length > 0) {
            streamAudioQueueRef.current[streamAudioQueueRef.current.length - 1].isFinal = true;
          } else if (isStreamingPlaybackActiveRef.current) {
            streamFinalPendingRef.current = true;
          } else {
            finishCurrentStream(storyWaitFlagRef.current);
          }
        }
      } else if (data.type === 'done') {
        const wait = Boolean(data.wait_for_user) && streamModeRef.current !== 'story';
        const askedQuestion = streamModeRef.current === 'tutor' && !!latestTutorQuestionRef.current;
        tutorWaitFlagRef.current = wait || askedQuestion;
        if (streamModeRef.current === 'tutor') {
          setTutorAwaitingReply(tutorWaitFlagRef.current);
        }
        if (streamAudioQueueRef.current.length === 0 && !isStreamingPlaybackActiveRef.current) {
          finishCurrentStream(streamModeRef.current === 'story' ? wait : tutorWaitFlagRef.current);
        }
      } else if (data.type === 'choices') {
        const nextChoices = Array.isArray(data.choices) ? data.choices.filter(Boolean).slice(0, 4).map(String) : [];
        setChoices(nextChoices);
      } else if (data.type === 'visual_board') {
        if (streamModeRef.current !== 'story' && data.board && typeof data.board === 'object') {
          pendingVisualBoardRef.current = shouldShowTutorVisualBoard(data.board as VisualBoard) ? (data.board as VisualBoard) : null;
        }
      } else if (data.type === 'memory_update') {
        if (data.patch && typeof data.patch === 'object') {
          mergeStudentProfile(data.patch);
        }
      } else if (data.type === 'error') {
        finishCurrentStream(false, String(data.message || 'MIGA stream failed. Try again.'));
      }
    } catch (err) {
      console.warn('[mascot] WS onmessage error:', err);
    }
  }, [emotion, finishCurrentStream, mergeStudentProfile, processStreamPlaybackQueue, pushLiveMessage]);

  const ensureStorySocket = useCallback(async () => {
    if (storyWsRef.current?.readyState === WebSocket.OPEN) return storyWsRef.current;
    if (storyWsRef.current?.readyState === WebSocket.CONNECTING) {
      try { storyWsRef.current.close(); } catch {}
      storyWsRef.current = null;
    }

    // Railway can be slow to accept the WS upgrade on a cold connection
    // (measured ~1.9s cold vs ~0.5s warm), and mobile networks add more. The old
    // 1.2s default made the first call time out and drop to the text fallback, so
    // give the voice path a realistic window before giving up.
    const ws = await connectMascotSocket('/ws_story', {
      onMessage: handleStorySocketMessage,
      onError: () => {
        finishCurrentStream(false, 'MIGA AI request failed. Please try again.');
        void stopAudio();
        setIsStoryListening(false);
        setIsTutorListening(false);
        void Voice.stop().catch(() => {});
        mascotRef.current?.stopSpeaking();
        mascotRef.current?.setMouth(0);
        mascotRef.current?.setExpression('idle');
        storyWsRef.current = null;
      },
      onClose: () => {
        const wasAwaitingAi = awaitingAiResponseRef.current && !hadStreamResponseRef.current;
        awaitingAiResponseRef.current = false;
        setIsStoryStreaming(false);
        setIsTutorStreaming(false);
        setIsThinking(false);
        setIsSending(false);
        setIsStoryListening(false);
        setIsTutorListening(false);
        void Voice.stop().catch(() => {});
        void stopAudio();
        mascotRef.current?.stopSpeaking();
        mascotRef.current?.setMouth(0);
        mascotRef.current?.setExpression('idle');
        storyWsRef.current = null;
        if (wasAwaitingAi) {
          finishCurrentStream(false, 'MIGA voice connection dropped mid-answer. Please try again.');
        }
      },
    }, 8000);

    if (!ws) {
      storyWsRef.current = null;
      finishCurrentStream(false, 'MIGA voice server is taking too long to respond. Please try again.');
      return null;
    }

    storyWsRef.current = ws;
    return ws;
  }, [finishCurrentStream, handleStorySocketMessage, stopAudio]);

  const resetStreamState = useCallback(() => {
    clearTutorWaitNudge();
    setTutorAwaitingReply(false);
    storyQueueEmptyRef.current = false;
    storyWaitFlagRef.current = false;
    tutorWaitFlagRef.current = false;
    latestTutorQuestionRef.current = '';
    setChoices([]);
    mascotRef.current?.resetAudioQueue();
    setIsStoryListening(false);
    setIsTutorListening(false);
    void Voice.stop().catch(() => {});
    resetSubtitles();
    streamAudioQueueRef.current = [];
    streamFinalPendingRef.current = false;
    sentenceBySeqRef.current = {};
    rejectedSentenceSeqRef.current = {};
    pendingSentenceRef.current = '';
    hadStreamResponseRef.current = false;
    isStreamingPlaybackActiveRef.current = false;
    stopAudio();
    }, [clearTutorWaitNudge, resetSubtitles, stopAudio]);

  const interruptCurrentStream = useCallback(() => {
    clearTutorWaitNudge();
    setTutorAwaitingReply(false);
    tutorWaitFlagRef.current = false;
    latestTutorQuestionRef.current = '';
    activeTurnIdRef.current = `interrupted-${Date.now()}`;
    if (storyWsRef.current) {
      storyWsRef.current.close();
      storyWsRef.current = null;
    }
    resetStreamState();
    setIsSending(false);
    setIsThinking(false);
    setIsTutorStreaming(false);
    setIsStoryStreaming(false);
    setIsStoryListening(false);
    setIsTutorListening(false);
    void Voice.stop().catch(() => {});
    setStoryPhase('awaiting');
    setEmotion('listening');
    mascotRef.current?.stopSpeaking();
    mascotRef.current?.setMouth(0);
    mascotRef.current?.setExpression('listening');
  }, [clearTutorWaitNudge, resetStreamState]);

  // Keep a live ref to the central stop so session switches (defined earlier) can
  // reuse the exact proven interrupt sequence without breaking speech/lipsync/subtitles.
  const interruptRef = useRef(interruptCurrentStream);
  useEffect(() => {
    interruptRef.current = interruptCurrentStream;
  }, [interruptCurrentStream]);
  useEffect(() => () => {
    if (sessionFlashTimerRef.current) clearTimeout(sessionFlashTimerRef.current);
  }, []);

  const startStoryStream = useCallback((input: string) => {
    const text = input.trim();
    if (!text) return;
    const turnId = beginMascotTurn('story');
    resetStreamState();
    if (!currentStoryId) {
      sessionIdRef.current = newMascotSessionId();
    }
    setIsStoryStreaming(true);
    setIsThinking(true);
    setStoryAwaitingUser(false);
    setStoryPhase('generating');
    setVisualBoard(null);
    setSubtitles('');
    setStatusMessage('Thinking...');
    setEmotion('thinking');
    mascotRef.current?.setExpression('thinking');
    mascotRef.current?.setMouth(0, 0);
    awaitingAiResponseRef.current = true;
    hadStreamResponseRef.current = false;
    streamModeRef.current = 'story';
    const payload: any = {
      action: 'start',
      query: text,
      language_code: storyLanguageRef.current,
      mode: 'story',
      request_id: turnId,
      session_id: sessionIdRef.current,
      student_profile: studentProfileRef.current,
    };
    if (currentStoryId) payload.upload_id = currentStoryId;
    pushLiveMessage('user', text);
    void (async () => {
      const ws = await ensureStorySocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(payload));
    })();
  }, [beginMascotTurn, ensureStorySocket, currentStoryId, pushLiveMessage, resetStreamState]);

  const startTutorDirect = useCallback(async (input: string, inputKind: 'topic' | 'answer' = 'topic', confirm: 'affirm' | 'negate' | null = null) => {
    const text = input.trim();
    if (!text) return;
    const turnId = beginMascotTurn('tutor_direct');
    // Voice budget gate. Reads a ref set by the PREVIOUS turn's consume, so it adds
    // zero latency here, and fails open (null => allowed). Only a real server limit
    // ever drives it to 0, so a stale/unconfigured gate can never block a call.
    if (voiceRepliesRemainingRef.current !== null && voiceRepliesRemainingRef.current <= 0) {
      pushLiveMessage('user', text);
      pushLiveMessage('assistant', VOICE_LIMIT_MESSAGE);
      hadStreamResponseRef.current = true; // keep finishCurrentStream from overwriting it
      // Idle (not waitForUser) so the message is delivered once and the call
      // settles, instead of the mic resuming and re-blocking every utterance.
      finishCurrentStream(false, VOICE_LIMIT_MESSAGE);
      setEmotion('speaking');
      mascotRef.current?.setExpression('speaking');
      speak(VOICE_LIMIT_MESSAGE, () => mascotRef.current?.startSpeaking());
      return;
    }
    const isFirstTutorTurn = !hasTutorConversationStarted;
    const allowCheckQuestion = false;
    tutorCheckAllowedRef.current = allowCheckQuestion;
    if (isFirstTutorTurn) {
      sessionIdRef.current = newMascotSessionId();
      setLiveMessages([]);
      setVisualBoard(null);
      pendingVisualBoardRef.current = null;
    }
    resetStreamState();
    setIsTutorStreaming(true);
    setIsThinking(true);
    setHasTutorConversationStarted(true);
    setStatusMessage('Thinking...');
    setEmotion('thinking');
    mascotRef.current?.setExpression('thinking');
    mascotRef.current?.setMouth(0, 0);
    awaitingAiResponseRef.current = true;
    hadStreamResponseRef.current = false;
    streamModeRef.current = 'tutor';
    setSubtitles('');
    pushLiveMessage('user', text);

    let responseText = '';
    try {
      // miga_stream strips ALL client `system` messages (it owns the system prompt),
      // so the voice instructions must ride on the USER turn or the model gets no
      // question at all and echoes its own prompt. Keep the actual question first so
      // the server's intent detection reads it cleanly, then a compact voice directive.
      const voiceDirective =
        confirm === 'affirm'
          ? 'The student is saying yes to continue. Keep teaching what you just offered, do not grade them.'
          : confirm === 'negate'
            ? 'The student is saying no. Acknowledge briefly and offer another direction.'
            : 'Teach directly and do not ask me a question back.';
      const voiceTurn = `${text}\n\n[Voice tutor mode: reply in ${selectedLanguage || 'English'}, 2 to 4 short spoken sentences. ${voiceDirective}]`;
      await new Promise<void>((resolve, reject) => {
        mascotApi.streamChat(
          user?.id || 'guest',
          [
            { role: 'user', content: voiceTurn },
          ],
          'chat',
          (token) => {
            if (!isActiveTurn(turnId)) return;
            responseText += token;
            setSubtitles((prev) => prev + token);
          },
          () => resolve(),
          (err) => reject(err),
          { languageCode: getTutorLangCode(), languageLabel: selectedLanguage }
        );
      });

      if (!isActiveTurn(turnId)) return;
      const finalText = stripTutorQuestions(responseText.trim(), allowCheckQuestion);
      if (!finalText) throw new Error('No tutor answer received.');
      pushLiveMessage('assistant', finalText);
      setStatusMessage(null);
      setEmotion('speaking');
      mascotRef.current?.setExpression('speaking');
      speak(finalText, () => {
        if (!isActiveTurn(turnId)) return;
        setEmotion('speaking');
        mascotRef.current?.startSpeaking();
      });
      // Meter this spoken reply. Fire-and-forget so it never delays the voice, and
      // fail open: only a valid server limit (limit > 0) sets a real remaining
      // count; any error or an unconfigured gate (limit 0) leaves voice unlimited.
      void AIUsageService.consume('miga_call')
        .then((usage) => {
          voiceRepliesRemainingRef.current = usage.limit > 0 ? usage.remaining : null;
        })
        .catch(() => {});
    } catch (error) {
      if (!isActiveTurn(turnId)) return;
      console.warn('[mascot] Tutor direct fallback failed:', error);
      finishCurrentStream(false, 'Tutor fallback failed. Please try again.');
    }
  }, [beginMascotTurn, finishCurrentStream, getTutorLangCode, hasTutorConversationStarted, isActiveTurn, isMathMode, newMascotSessionId, pushLiveMessage, resetStreamState, selectedLanguage, setHasTutorConversationStarted, setSubtitles, setStatusMessage, setEmotion, speak]);

  const startTutorStream = useCallback((input: string, inputKind: 'topic' | 'answer' = 'topic', confirm: 'affirm' | 'negate' | null = null) => {
    const text = input.trim();
    if (!text) return;
    const turnId = beginMascotTurn('tutor');
    const isFirstTutorTurn = !hasTutorConversationStarted;
    const allowCheckQuestion = false;
    tutorCheckAllowedRef.current = allowCheckQuestion;
    if (isFirstTutorTurn) {
      sessionIdRef.current = newMascotSessionId();
      setLiveMessages([]);
      setVisualBoard(null);
      pendingVisualBoardRef.current = null;
    }
    resetStreamState();
    setIsTutorStreaming(true);
    setIsThinking(true);
    setHasTutorConversationStarted(true);
    setStatusMessage('Thinking...');
    setEmotion('thinking');
    mascotRef.current?.setExpression('thinking');
    mascotRef.current?.setMouth(0, 0);
    awaitingAiResponseRef.current = true;
    hadStreamResponseRef.current = false;
    streamModeRef.current = 'tutor';
    pushLiveMessage('user', text);
    latestTutorQuestionRef.current = '';
    const payload = {
      action: 'start',
      query: text,
      tutor_instruction: buildLearnModePrompt(text, selectedLanguage, isMathMode, inputKind, allowCheckQuestion, confirm),
      confirm_kind: confirm || '',
      language_code: getTutorLangCode(),
      mode: 'tutor',
      input_kind: inputKind,
      request_id: turnId,
      session_id: sessionIdRef.current,
      student_profile: isFirstTutorTurn ? tutorProfileForRequest() : studentProfileRef.current,
    };
    void (async () => {
      const ws = await ensureStorySocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        await startTutorDirect(text, inputKind, confirm);
        return;
      }
      ws.send(JSON.stringify(payload));
    })();
  }, [beginMascotTurn, ensureStorySocket, getTutorLangCode, hasTutorConversationStarted, newMascotSessionId, pushLiveMessage, resetStreamState, selectedLanguage, isMathMode, tutorProfileForRequest, startTutorDirect]);

  const startMathSolve = useCallback(async (problemText: string) => {
    const text = problemText.trim();
    if (!text) return;
    const turnId = beginMascotTurn('math_solve');
    // Same voice budget gate as startTutorDirect — a math solve is narrated
    // (TTS) exactly like a spoken tutor reply, so it draws from the same
    // per-call budget instead of being a free, unmetered side door.
    if (voiceRepliesRemainingRef.current !== null && voiceRepliesRemainingRef.current <= 0) {
      pushLiveMessage('user', text);
      pushLiveMessage('assistant', VOICE_LIMIT_MESSAGE);
      setStatusMessage(null);
      setEmotion('speaking');
      mascotRef.current?.setExpression('speaking');
      speak(VOICE_LIMIT_MESSAGE, () => mascotRef.current?.startSpeaking());
      return;
    }
    const startedAt = Date.now();
    const isFirstTutorTurn = !hasTutorConversationStarted;
    if (isFirstTutorTurn) {
      sessionIdRef.current = newMascotSessionId();
      setLiveMessages([]);
      setVisualBoard(null);
      pendingVisualBoardRef.current = null;
    }

    setHasTutorConversationStarted(true);
    setIsThinking(true);
    setMathSolveState('loading');
    setMathRevealCount(0);
    streamModeRef.current = 'tutor';
    setStatusMessage('Solving step by step...');
    setSubtitles('');
    setEmotion('thinking');
    mascotRef.current?.setExpression('thinking');
    mascotRef.current?.setMouth(0, 0);
    pushLiveMessage('user', text);
    setVisualBoard({
      title: 'Working it out...',
      subtitle: text,
      rows: [
        { label: 'Reading the question', value: 'Step 1', note: 'Let me identify what is asked.' },
        { label: 'Choosing the method', value: 'Step 2', note: 'I will pick the cleanest path.' },
        { label: 'Writing the working', value: 'Step 3', note: 'The board will fill in one line at a time.' },
      ],
      bullets: ['Loading the solution board...'],
    });

    let queuedSpeech = false;
    try {
      const solution = await mascotApi.solveMathProblem(text, activeTutorLanguageCode);
      if (!isActiveTurn(turnId)) return;
      setLastSolution(solution);
      setMathSolveState('solving');
      setMathRevealCount(0);
      const summary = [
        `Answer: ${solution.answer}`,
        ...(solution.steps || []).map((step) => `${step.title}: ${step.spokenExplanation}`),
        solution.checkQuestion?.question ? `Check: ${solution.checkQuestion.question}` : '',
      ].filter(Boolean).join('\n\n');

      pushLiveMessage('assistant', summary);
      setVisualBoard({
        title: solution.answer ? `Answer: ${solution.answer}` : 'Math solution',
        subtitle: solution.problem,
        rows: (solution.steps || []).slice(0, 5).map((step, index) => ({
          label: `${index + 1}. ${step.title}`,
          value: (step.boardLines || []).join('\n'),
          note: step.highlight || step.spokenExplanation,
        })),
        bullets: solution.checkQuestion ? [`Try: ${solution.checkQuestion.question}`] : [],
      });
      setStatusMessage('Preparing voice...');
      setEmotion('thinking');
      mascotRef.current?.setExpression('thinking');
      // Narrate the whole board, step by step, like a teacher working through it -
      // not just the first two lines. spokenExplanation is already in the chosen language.
      const speechText = [
        ...(solution.steps || []).map((step) => step?.spokenExplanation).filter(Boolean),
        solution.answer ? `${finalAnswerLabel(activeTutorLanguageCode)}: ${solution.answer}` : '',
      ].filter(Boolean).join(' ');
      if (speechText.trim()) {
        queuedSpeech = true;
        speak(speechText, () => {
          if (!isActiveTurn(turnId)) return;
          console.log('[miga_mascot_turn.audio_start]', {
            turnId,
            kind: 'math_solve',
            elapsed_ms: Date.now() - startedAt,
          });
          setEmotion('speaking');
          mascotRef.current?.startSpeaking();
        });
      } else {
        setStatusMessage('Math solved');
        setEmotion('idle');
        setMathSolveState('done');
      }
      // Meter this solve exactly like a normal spoken reply (see startTutorDirect).
      void AIUsageService.consume('miga_call')
        .then((usage) => {
          voiceRepliesRemainingRef.current = usage.limit > 0 ? usage.remaining : null;
        })
        .catch(() => {});
    } catch (error: any) {
      if (!isActiveTurn(turnId)) return;
      const message = error?.message || 'Math solve failed. Try again with a clearer problem.';
      pushLiveMessage('assistant', message);
      setSubtitles(message);
      setStatusMessage('Math solve failed');
      setEmotion('idle');
      mascotRef.current?.setExpression('idle');
      setMathSolveState('idle');
    } finally {
      if (isActiveTurn(turnId)) {
        if (!queuedSpeech) {
          setIsThinking(false);
          setIsSending(false);
        }
        mascotRef.current?.setMouth(0);
        console.log('[miga_mascot_turn.complete]', {
          turnId,
          kind: 'math_solve',
          elapsed_ms: Date.now() - startedAt,
        });
      }
    }
  }, [activeTutorLanguageCode, beginMascotTurn, hasTutorConversationStarted, isActiveTurn, newMascotSessionId, pushLiveMessage, speak]);

  const startMathFollowUp = useCallback((questionText: string) => {
    const text = questionText.trim();
    if (!text || !lastSolution) return;
    const turnId = beginMascotTurn('math_followup');
    resetStreamState();
    setHasTutorConversationStarted(true);
    setIsThinking(true);
    setStatusMessage('Explaining...');
    setSubtitles('Explaining...');
    setEmotion('thinking');
    mascotRef.current?.setExpression('thinking');
    mascotRef.current?.setMouth(0, 0);
    awaitingAiResponseRef.current = true;
    hadStreamResponseRef.current = false;
    streamModeRef.current = 'tutor';
    pushLiveMessage('user', text);

    const payload = {
      action: 'start',
      query: text,
      tutor_instruction: [
        'SYSTEM: You are MIGA, continuing a math tutoring session.',
        'Use the existing solution JSON as context. Do not solve from scratch unless the student asks for a new problem.',
        'Answer only the follow-up doubt in 2-4 clear spoken sentences. If the student asks for a specific step, explain that step slower.',
        'If they ask for shortcut, show only the shortcut and why it works.',
        'If the selected language is English, start the first spoken line with: Okay, let\'s look into this step.',
        'If the selected language is not English, start with the natural equivalent opening in that language.',
        `SELECTED_LANGUAGE: ${selectedLanguage}`,
        `EXISTING_SOLUTION_JSON: ${JSON.stringify(lastSolution)}`,
        `STUDENT_FOLLOW_UP: ${text}`,
      ].join('\n'),
      language_code: activeTutorLanguageCode,
      mode: 'tutor',
      input_kind: 'math_followup',
      request_id: turnId,
      session_id: sessionIdRef.current,
      student_profile: studentProfileRef.current,
    };
    void (async () => {
      const ws = await ensureStorySocket();
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify(payload));
    })();
  }, [activeTutorLanguageCode, beginMascotTurn, ensureStorySocket, lastSolution, pushLiveMessage, resetStreamState, selectedLanguage]);

  const stopStoryListening = useCallback(async () => {
    setIsStoryListening(false);
    try { await Voice.stop(); } catch {}
  }, []);

  const startStoryListening = useCallback(async () => {
    if (isStoryListening || isStoryStreaming || storyPhase === 'speaking') return;
    setIsStoryListening(true);
    try {
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (g !== PermissionsAndroid.RESULTS.GRANTED) { setIsStoryListening(false); return; }
      }
      await Voice.start(storyLanguageRef.current || 'en-IN');
    } catch {
      setIsStoryListening(false);
      const message = 'Mic is not available in this Expo build. Type your reply here, or use a dev build for voice.';
      setSubtitles(message);
      setStatusMessage('Mic unavailable');
    }
  }, [isStoryListening, isStoryStreaming, storyPhase]);

  useEffect(() => {
    startStoryListeningRef.current = startStoryListening;
  }, [startStoryListening]);

  const startTutorListening = useCallback(async () => {
    if (isTutorListening || isTutorStreaming || isThinking) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsTutorListening(true);
    try {
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const g = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (g !== PermissionsAndroid.RESULTS.GRANTED) { setIsTutorListening(false); return; }
      }
      await Voice.start(getTutorLangCode());
    } catch {
      setIsTutorListening(false);
      const message = 'Mic is not available in this Expo build. Type your question here, or use a dev build for voice.';
      setSubtitles(message);
      setStatusMessage('Mic unavailable');
    }
  }, [isTutorListening, isTutorStreaming, isThinking, getTutorLangCode]);

  const stopTutorListening = useCallback(async () => {
    setIsTutorListening(false);
    try { await Voice.stop(); } catch {}
  }, []);

  // Fixed: no premature isThinking reset in finally
  const handleSendAsk = useCallback(async (override?: string) => {
    const raw = (typeof override === 'string' ? override : askInput).trim();
    if (!raw) return;
    Keyboard.dismiss();
    setIsTabPaused(false);
    if (isThinking || isTutorStreaming || isStoryStreaming || isPlaying || isStoryListening || isTutorListening) {
      interruptCurrentStream();
      setIsSending(false);
      setIsThinking(false);
      setIsTutorStreaming(false);
      setIsStoryStreaming(false);
      setIsStoryListening(false);
      setIsTutorListening(false);
      tutorCheckAllowedRef.current = false;
      tutorWaitFlagRef.current = false;
      storyWaitFlagRef.current = false;
      latestTutorQuestionRef.current = '';
    }
    storyWaitFlagRef.current = false;
    clearTutorWaitNudge();
    setTutorAwaitingReply(false);
    latestTutorQuestionRef.current = '';
    setAskInput('');
    if (experienceMode === 'tutor' && !isMathMode && isCachedGreeting(raw)) {
      const reply = getTutorGreetingReply(selectedLanguage);
      pushLiveMessage('user', raw);
      pushLiveMessage('assistant', reply);
      setStatusMessage('Preparing voice...');
      setIsSending(true);
      setIsThinking(true);
      try {
        await playMascotTTS(reply, 'speaking', activeTutorLanguageCode);
      } finally {
        setIsSending(false);
        setIsThinking(false);
      }
      return;
    }
    setIsThinking(true);
    setStatusMessage('Thinking...');
    setEmotion('thinking');
    mascotRef.current?.setExpression('thinking');
    setIsSending(true);
    if (sendWatchdogRef.current) clearTimeout(sendWatchdogRef.current);
    sendWatchdogRef.current = setTimeout(() => {
      finishCurrentStream(false, 'MIGA is taking too long to respond. Please try again.');
    }, 25000);
    if (experienceMode === 'tutor' && isMathMode) {
      if (lastSolution && (mathInputIntent === 'doubt' || (mathInputIntent === 'auto' && isLikelyMathFollowUp(raw)))) {
        startMathFollowUp(raw);
      } else {
        if (mathInputIntent === 'new') setLastSolution(null);
        startMathSolve(raw);
      }
    } else if (experienceMode === 'story') {
      setChoices([]);
      startStoryStream(raw);
    } else {
      // A bare "yes"/"no" after the tutor offered to continue is a confirmation, not a quiz
      // answer - flag it so the backend continues teaching instead of grading "exactly correct".
      const confirm: 'affirm' | 'negate' | null = hasTutorConversationStarted
        ? (isAffirmationReply(raw) ? 'affirm' : isNegationReply(raw) ? 'negate' : null)
        : null;
      startTutorStream(raw, 'topic', confirm);
    }
    if (mathInputIntent !== 'auto') setMathInputIntent('auto');
  }, [activeTutorLanguageCode, askInput, clearTutorWaitNudge, experienceMode, finishCurrentStream, hasTutorConversationStarted, interruptCurrentStream, isMathMode, isPlaying, isStoryListening, isStoryStreaming, isThinking, isTutorListening, isTutorStreaming, lastSolution, mathInputIntent, pushLiveMessage, selectedLanguage, startMathFollowUp, startMathSolve, startStoryStream, startTutorStream, tutorAwaitingReply]);

  const handleSendAskRef = useRef(handleSendAsk);
  const startStoryStreamRef = useRef(startStoryStream);
  const stopStoryListeningRef = useRef(stopStoryListening);
  useEffect(() => { handleSendAskRef.current = handleSendAsk; }, [handleSendAsk]);
  useEffect(() => { startStoryStreamRef.current = startStoryStream; }, [startStoryStream]);
  useEffect(() => { stopStoryListeningRef.current = stopStoryListening; }, [stopStoryListening]);

  const handleMathPresetPress = useCallback((prompt: string) => {
    const clean = prompt.trim();
    if (!clean) return;
    setMathInputIntent('auto');
    setAskInput('');
    handleSendAsk(clean);
  }, [handleSendAsk]);

  const resetMathSession = useCallback(() => {
    setMathInputIntent('auto');
    setLastSolution(null);
    setVisualBoard(null);
    pendingVisualBoardRef.current = null;
    setMathSolveState('idle');
    setMathRevealCount(0);
    setChoices([]);
    setSubtitles('');
    setStatusMessage(null);
    setIsThinking(false);
    setIsSending(false);
    mascotRef.current?.setExpression('idle');
    mascotRef.current?.setMouth(0);
  }, []);

  const handleExperienceChange = useCallback((mode: ExperienceMode) => {
    if (mode === experienceMode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    interruptCurrentStream();
    if (storyWsRef.current) { storyWsRef.current.close(); storyWsRef.current = null; }
    void stopStoryListening();
    void stopTutorListening();
    void startFreshSession(mode, '');
  }, [experienceMode, interruptCurrentStream, startFreshSession, stopStoryListening, stopTutorListening]);

  const handleMicToggle = useCallback(async () => {
    setIsTabPaused(false);
    if (experienceMode === 'story') {
      if ((storyPhase === 'speaking' || isStoryStreaming || isPlaying) && !isStoryListening) {
        interruptCurrentStream();
      }
      isStoryListening ? await stopStoryListening() : await startStoryListening();
    } else {
      if ((isTutorStreaming || isThinking || isPlaying) && !isTutorListening) {
        interruptCurrentStream();
      }
      isTutorListening ? await stopTutorListening() : await startTutorListening();
    }
  }, [experienceMode, isStoryListening, isStoryStreaming, isTutorListening, storyPhase,
      isTutorStreaming, isThinking, isPlaying, interruptCurrentStream,
      startStoryListening, stopStoryListening, startTutorListening, stopTutorListening]);

  const handleUploadSuccess = useCallback(async (uploadId: string) => {
    setCurrentStoryId(uploadId);
    setIsThinking(true);
    setStoryPhase('generating');
    setChoices([]);
    try { startStoryStream('Start the interactive story now based on the document.'); }
    catch { pushLiveMessage('assistant', 'Error starting story.'); setStoryPhase('awaiting'); }
    finally { setIsThinking(false); }
  }, [pushLiveMessage, startStoryStream]);

  const updateFingerTarget = useCallback((event: any) => {
    const touch = event.nativeEvent;
    const pageX = touch.pageX ?? touch.locationX ?? SCREEN.width / 2;
    const pageY = touch.pageY ?? touch.locationY ?? SCREEN.height / 2;
    const localX = touch.locationX ?? pageX;
    const localY = touch.locationY ?? pageY;
    const x = (pageX / SCREEN.width) * 2 - 1;
    const y = (pageY / SCREEN.height) * 2 - 1;
    mascotRef.current?.lookAt(x, y);
    setFingerPoint({ x: localX, y: localY, id: Date.now() });
  }, []);

  const handleStageTouch = useCallback((event: any) => {
    updateFingerTarget(event);
  }, [updateFingerTarget]);

  const handleStageTouchStart = useCallback((event: any) => {
    updateFingerTarget(event);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [updateFingerTarget]);

  const handleStageTouchEnd = useCallback(() => {
    mascotRef.current?.lookAt(0, 0);
    setTimeout(() => setFingerPoint(null), 160);
  }, []);

  const stagePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        updateFingerTarget(event);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      },
      onPanResponderMove: updateFingerTarget,
      onPanResponderRelease: handleStageTouchEnd,
      onPanResponderTerminate: handleStageTouchEnd,
    })
  ).current;

  const handleTextExtracted = useCallback((text: string, analysis: any) => {
    setAskInput(text);
    if (experienceMode === 'tutor' && isMathMode) {
      startMathSolve(text);
    } else if (experienceMode === 'tutor') {
      startTutorStream(text);
    } else {
      startStoryStream(text);
    }
  }, [experienceMode, isMathMode, startMathSolve, startTutorStream, startStoryStream]);

  // Local interactive mascot narration and suggestion handlers
  const playMascotTTS = useCallback(async (text: string, emotionalExpr: MascotEmotion = 'speaking', languageCode?: string) => {
    try {
      setIsThinking(true);
      setEmotion('thinking');
      mascotRef.current?.setExpression('thinking');
      setSubtitles('');
      setStatusMessage('Preparing voice...');

      const cleanInput = sanitizeText(text);
      const leadEmotion = emotionalExpr === 'correct'
        ? 'happy'
        : emotionalExpr === 'wrong'
          ? 'sad'
          : emotionalExpr === 'happy' || emotionalExpr === 'sad'
            ? emotionalExpr
            : null;
      if (leadEmotion) {
        setEmotion(leadEmotion);
        mascotRef.current?.setExpression(leadEmotion);
        await new Promise((resolve) => setTimeout(resolve, 180));
      }

      const activeLanguageCode = languageCode || (experienceMode === 'story' ? storyLanguage : activeTutorLanguageCode);
      const base64Audio = await mascotApi.getTTS(cleanInput, activeLanguageCode);
      const dataUri = `data:audio/mp3;base64,${base64Audio.replace(/^data:audio\/mp3;base64,/, '')}`;

      setIsThinking(false);
      const speakingPose = (experienceMode === 'story' ? 'idleSpeaking' : 'speaking') as MascotEmotion;
      setEmotion(speakingPose);
      mascotRef.current?.startSpeaking();
      mascotRef.current?.setExpression(speakingPose as any);

      await playUri(dataUri, () => {
        if (experienceMode === 'story') {
          setStoryPhase('speaking');
        }
      }, cleanInput);
      setEmotion('idle');
      mascotRef.current?.stopSpeaking();
      mascotRef.current?.setExpression('idle');
    } catch (err) {
      console.error('[mascot] Local TTS play failed:', err);
      setIsThinking(false);
      setEmotion('idle');
      mascotRef.current?.stopSpeaking();
      mascotRef.current?.setExpression('idle');
      throw err;
    }
  }, [activeTutorLanguageCode, experienceMode, playUri, storyLanguage]);

  const handleThirukkuralSuggestion = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      interruptCurrentStream();
      setKuralFlowState('couplet');
      setIsThinking(true);
      setEmotion('thinking');
      mascotRef.current?.setExpression('thinking');

      const result = await getDailyLocalizedThirukkural('en');

      setCurrentKural(result);
      setIsThinking(false);

      setChoices(['Meaning in English', 'Meaning in another language', 'Thirukkural in another language', 'Exit Kural Mode']);

      await playMascotTTS(`Today's Thirukkural Couplet number ${result.kural_number} is: ${result.kural_transliteration}. Do you want to know the meaning of this?`, "teaching");
    } catch (err) {
      console.warn('[mascot] Thirukkural fetch failed:', err);
      setIsThinking(false);
      setKuralFlowState('idle');
      await playMascotTTS("Apologies, I couldn't connect to the wisdom database to fetch today's Thirukkural. Please check your network.", "idle");
    }
  }, [interruptCurrentStream, playMascotTTS]);

  const handleKuralChoicePress = useCallback(async (choice: string) => {
    if (choice === 'Exit Kural Mode') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await stopAudio();
      setKuralFlowState('idle');
      setCurrentKural(null);
      setChoices([]);
      setIsThinking(false);
      setIsSending(false);
      setStatusMessage(null);
      setSubtitles('');
      setEmotion('idle');
      mascotRef.current?.setExpression('idle');
      return;
    }

    if (!currentKural) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (choice === 'Learn another Kural') {
      setKuralFlowState('idle');
      try {
        setKuralFlowState('couplet');
        setIsThinking(true);
        setEmotion('thinking');
        mascotRef.current?.setExpression('thinking');

        const result = await getLocalizedThirukkural(
          Math.floor(Math.random() * 1330) + 1,
          'en',
        );

        setCurrentKural(result);
        setIsThinking(false);
        setChoices(['Meaning in English', 'Meaning in another language', 'Thirukkural in another language', 'Exit Kural Mode']);
        await playMascotTTS(`Here is another Thirukkural Couplet number ${result.kural_number}: ${result.kural_transliteration}. Do you want to know the meaning of this?`, "teaching");
      } catch (err) {
        setIsThinking(false);
        setKuralFlowState('idle');
        await playMascotTTS("Apologies, I couldn't load another Thirukkural. Please check your network.", "idle");
      }
      return;
    }

    if (kuralFlowState === 'couplet' || kuralFlowState === 'ask_meaning' || kuralFlowState === 'reading_explanation') {
      if (choice === 'Meaning in English') {
        setKuralFlowState('reading_explanation');
        const englishExplanation = `The English meaning of this Kural is: ${currentKural.meaning}. Modern life application: ${currentKural.life_application || currentKural.explanation_modern || 'Apply standard integrity principles.'}`;
        setChoices(['Learn another Kural', 'Exit Kural Mode']);
        await playMascotTTS(englishExplanation, "teaching");
      } else if (choice === 'Meaning in another language') {
        setKuralFlowState('choose_meaning_lang');
        setChoices(['Tamil', 'Hindi', 'Telugu', 'Kannada', 'Malayalam', 'Go Back']);
        await playMascotTTS("Sure! Which language would you like to hear the meaning in?", "teaching");
      } else if (choice === 'Thirukkural in another language') {
        setKuralFlowState('choose_kural_lang');
        setChoices(['Hindi', 'Telugu', 'Kannada', 'Malayalam', 'Go Back']);
        await playMascotTTS("Of course! Which language would you like to hear the Thirukkural couplet in?", "teaching");
      }
    } else if (kuralFlowState === 'choose_meaning_lang') {
      if (choice === 'Go Back') {
        setKuralFlowState('couplet');
        setChoices(['Meaning in English', 'Meaning in another language', 'Thirukkural in another language', 'Exit Kural Mode']);
        await playMascotTTS("Going back. Do you want to hear the meaning in English or another language?", "teaching");
        return;
      }

      const langObj = LANGUAGES_MAP.find(l => l.label === choice);
      if (!langObj) return;
      const langCode = langObj.code;
      try {
        setIsThinking(true);
        setEmotion('thinking');
        mascotRef.current?.setExpression('thinking');

        const localized = await getLocalizedThirukkural(
          currentKural.kural_number,
          langCode as 'ta' | 'hi' | 'te' | 'kn' | 'ml',
        );

        setKuralFlowState('reading_explanation');
        setChoices(['Learn another Kural', 'Exit Kural Mode']);
        await playMascotTTS(`The meaning in ${choice} is: ${localized.meaning}`, "teaching");
      } catch (err) {
        console.warn('[mascot] Translation error:', err);
        setKuralFlowState('reading_explanation');
        setChoices(['Learn another Kural', 'Exit Kural Mode']);
        await playMascotTTS(`Apologies, I couldn't translate the meaning to ${choice} right now. Please try again.`, "teaching");
      } finally {
        setIsThinking(false);
      }
    } else if (kuralFlowState === 'choose_kural_lang') {
      if (choice === 'Go Back') {
        setKuralFlowState('couplet');
        setChoices(['Meaning in English', 'Meaning in another language', 'Thirukkural in another language', 'Exit Kural Mode']);
        await playMascotTTS("Going back. Do you want to hear the meaning in English or another language?", "teaching");
        return;
      }

      const langObj = LANGUAGES_MAP.find(l => l.label === choice);
      if (!langObj) return;
      const langCode = langObj.code;
      try {
        setIsThinking(true);
        setEmotion('thinking');
        mascotRef.current?.setExpression('thinking');

        const localized = await getLocalizedThirukkural(
          currentKural.kural_number,
          langCode as 'hi' | 'te' | 'kn' | 'ml',
        );

        setKuralFlowState('reading_explanation');
        setChoices(['Learn another Kural', 'Exit Kural Mode']);
        await playMascotTTS(`The translated couplet in ${choice} is: ${localized.verse}`, "teaching");
      } catch (err) {
        console.warn('[mascot] Couplet translation error:', err);
        setKuralFlowState('reading_explanation');
        setChoices(['Learn another Kural', 'Exit Kural Mode']);
        await playMascotTTS(`Apologies, I couldn't translate the couplet to ${choice} right now. Please try again.`, "teaching");
      } finally {
        setIsThinking(false);
      }
    }
  }, [currentKural, kuralFlowState, playMascotTTS, stopAudio]);

  const handleCurrentAffairsSuggestion = useCallback(async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      interruptCurrentStream();
      setCurrentAffairsState('question');
      setIsThinking(true);
      setEmotion('thinking');
      mascotRef.current?.setExpression('thinking');

      // Fetch dynamic Current Affairs questions strictly from Redis (Upstash)
      const todayStr = new Date().toLocaleDateString('en-CA');
      let qList = await RedisService.getDailyCurrentAffairs(todayStr);

      if (!qList || qList.length === 0) {
        qList = await RedisService.getQuestions('current_affairs', 15);
        if (qList && qList.length > 0) {
          await RedisService.setDailyCurrentAffairs(todayStr, qList);
        }
      }

      if (qList && qList.length > 0) {
        setCaQuestions(qList);
        setCaIndex(0);
        setIsThinking(false);

        const currentQ = qList[0];
        const cleanOpts = (currentQ.options || []).map((opt: string) => opt.split('. ').slice(1).join('. ') || opt).map((opt: string) => opt.length > 25 ? opt.substring(0, 22) + '...' : opt);
        setChoices([...cleanOpts, 'Exit Current Affairs']);

        await playMascotTTS(`Let's discuss today's Current Affairs! Question 1: ${currentQ.question}`, "teaching");
      } else {
        throw new Error("Strict fetch error - Current affairs questions list empty");
      }
    } catch (err) {
      console.warn('[mascot] Current Affairs fetch failed:', err);
      setIsThinking(false);
      setCurrentAffairsState('idle');
      await playMascotTTS("I couldn't fetch today's Current Affairs questions. Please make sure your internet is working properly.", "idle");
    }
  }, [interruptCurrentStream, playMascotTTS]);

  const handleCurrentAffairsChoicePress = useCallback(async (choice: string) => {
    if (caQuestions.length === 0) return;
    const currentQ = caQuestions[caIndex];
    if (!currentQ) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (choice === 'Exit Current Affairs') {
      setCurrentAffairsState('idle');
      setCaQuestions([]);
      setChoices([]);
      setEmotion('idle');
      mascotRef.current?.setExpression('idle');
      await playMascotTTS("Exited Current Affairs. What would you like to study next?", "idle");
      return;
    }

    if (choice === 'Next Question') {
      const nextIdx = caIndex + 1;
      if (nextIdx < caQuestions.length) {
        setCaIndex(nextIdx);
        setCurrentAffairsState('question');
        const nextQ = caQuestions[nextIdx];

        const cleanOpts = nextQ.options.map((opt: string) => opt.split('. ').slice(1).join('. ') || opt).map((opt: string) => opt.length > 25 ? opt.substring(0, 22) + '...' : opt);
        setChoices([...cleanOpts, 'Exit Current Affairs']);

        await playMascotTTS(`Question ${nextIdx + 1}: ${nextQ.question}`, "teaching");
      } else {
        setCurrentAffairsState('idle');
        setCaQuestions([]);
        setChoices([]);
        await playMascotTTS("Awesome job! We have completed today's Current Affairs discussion. You are fully updated!", "idle");
      }
      return;
    }

    // Process user answer choice
    const cleanOpts = currentQ.options.map((opt: string) => opt.split('. ').slice(1).join('. ') || opt).map((opt: string) => opt.length > 25 ? opt.substring(0, 22) + '...' : opt);
    const selectedIdx = cleanOpts.indexOf(choice);
    const actualIdx = selectedIdx >= 0 ? selectedIdx : currentQ.options.findIndex((opt: string) => opt.includes(choice));

    setCurrentAffairsState('explanation');
    setChoices(['Next Question', 'Exit Current Affairs']);

    if (actualIdx === currentQ.answer_index) {
      await playMascotTTS(`Spot on! That is absolutely correct. ${currentQ.explanation}`, "correct");
    } else {
      const correctOptionLetter = String.fromCharCode(65 + currentQ.answer_index); // A, B, C, D
      await playMascotTTS(`Ah, that's not quite right. The correct answer is Option ${correctOptionLetter}. ${currentQ.explanation}`, "wrong");
    }
  }, [caQuestions, caIndex, playMascotTTS]);

  // Effects
  useEffect(() => { storyLanguageRef.current = storyLanguage; }, [storyLanguage]);
  useEffect(() => { studentProfileRef.current = studentProfile; }, [studentProfile]);
  useEffect(() => { selectedLanguageRef.current = selectedLanguage; }, [selectedLanguage]);
  useEffect(() => { experienceModeRef.current = experienceMode; }, [experienceMode]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { isStoryListeningRef.current = isStoryListening; }, [isStoryListening]);
  useEffect(() => { isTutorListeningRef.current = isTutorListening; }, [isTutorListening]);
  useEffect(() => {
    activityStateRef.current = {
      isSending,
      isThinking,
      isPlaying,
      isStoryStreaming,
      isTutorStreaming,
      isStoryListening,
      isTutorListening,
    };
  }, [isPlaying, isSending, isStoryListening, isStoryStreaming, isThinking, isTutorListening, isTutorStreaming]);
  useEffect(() => {
    setVisualBoardOffset({ x: 0, y: 0 });
    visualBoardDragOriginRef.current = { x: 0, y: 0 };
  }, [visualBoard?.title, visualBoard?.subtitle, visualBoard?.rows?.length, visualBoard?.bullets?.length, isMathMode, lastSolution]);
  useEffect(() => {
    if (!isMathMode || mathSolveState !== 'solving' || !visualBoard?.rows?.length) return;
    const total = visualBoard.rows.length;
    // Reveal each board line at a teacher's writing pace so the board fills in alongside
    // the spoken step-by-step explanation instead of finishing in under two seconds.
    const perRowMs = 1300;
    setMathRevealCount(1);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i < total; i += 1) {
      timers.push(setTimeout(() => setMathRevealCount((prev) => Math.max(prev, i + 1)), perRowMs * i));
    }
    timers.push(setTimeout(() => setMathSolveState('done'), Math.max(perRowMs * total + 600, 2000)));
    return () => timers.forEach(clearTimeout);
  }, [isMathMode, mathSolveState, visualBoard?.rows?.length]);
  useEffect(() => {
    if (studentProfile.language_label && studentProfile.language_label !== selectedLanguage) {
      setSelectedLanguage(studentProfile.language_label);
    }
    if (studentProfile.language_code && studentProfile.language_code !== storyLanguage) {
      setStoryLanguage(studentProfile.language_code);
    }
  }, [studentProfile.language_code, studentProfile.language_label, selectedLanguage, storyLanguage]);

  useEffect(() => {
    let live = true;
    (async () => {
      const fallback: StudentStoryProfile = {
        name: defaultProfileName(user),
        exam_goal: 'Competitive exams',
        language_code: storyLanguage,
        language_label: selectedLanguage,
        preferred_style: 'family drama',
      };
      try {
        const raw = await AsyncStorage.getItem(profileStorageKey());
        if (!live) return;
        if (raw) {
          const saved = JSON.parse(raw);
          const next = { ...fallback, ...saved, name: saved?.name || fallback.name };
          studentProfileRef.current = next;
          setStudentProfile(next);
        } else {
          studentProfileRef.current = fallback;
          setStudentProfile(fallback);
        }
      } catch {
        if (!live) return;
        studentProfileRef.current = fallback;
        setStudentProfile(fallback);
      }
    })();
    return () => { live = false; };
  }, [profileStorageKey, user]);

  useEffect(() => {
    Voice.onSpeechResults = (e) => {
      const spoken = e.value?.[0]?.trim();
      if (!spoken) return;
      const mode = experienceModeRef.current;
      if (mode === 'story' && isStoryListeningRef.current) {
        void stopStoryListeningRef.current();
        startStoryStreamRef.current(spoken);
        return;
      }
      if (mode === 'tutor' && isTutorListeningRef.current) {
        setIsTutorListening(false);
        isTutorListeningRef.current = false;
        Voice.stop().catch(() => {});
        handleSendAskRef.current(spoken);
      }
    };
    Voice.onSpeechError = () => {
      setIsStoryListening(false);
      setIsTutorListening(false);
      isStoryListeningRef.current = false;
      isTutorListeningRef.current = false;
      setSubtitles('I could not hear that. Type it here, or use a dev build for voice mic support.');
      setStatusMessage('Mic unavailable');
    };
    return () => {
      Voice.onSpeechResults = undefined as any;
      Voice.onSpeechError = undefined as any;
      Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (experienceMode !== 'story' || !storyAwaitingUser || isStoryListening) return;
    const t = setTimeout(() => {
      if (experienceMode === 'story' && storyAwaitingUser && !isStoryListening) startStoryListening();
    }, 500);
    return () => clearTimeout(t);
  }, [experienceMode, storyAwaitingUser, isStoryListening, startStoryListening]);

  useEffect(() => {
    if (experienceMode !== 'story') {
      setShowStoryAudioLabel(false);
      return;
    }
    setShowStoryAudioLabel(true);
    const t = setTimeout(() => setShowStoryAudioLabel(false), 2000);
    return () => clearTimeout(t);
  }, [experienceMode]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = Keyboard.addListener(showEvent, (event) => {
      setKeyboardLift(Math.max(0, (event.endCoordinates?.height || 0) - insets.bottom));
    });
    const onHide = Keyboard.addListener(hideEvent, () => {
      setKeyboardLift(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [insets.bottom]);

  useEffect(() => {
    if (experienceMode !== 'tutor' || isResponding || isTutorListening || !subtitles.trim().endsWith('?')) return;
    if (nudgeForSubtitleRef.current === subtitles) return;
    const currentQuestion = subtitles;
    const t = setTimeout(() => {
      if (nudgeForSubtitleRef.current === currentQuestion) return;
      nudgeForSubtitleRef.current = currentQuestion;
      setEmotion('listening');
      mascotRef.current?.setExpression('listening');
    }, 12000);
    return () => clearTimeout(t);
  }, [experienceMode, isResponding, isTutorListening, subtitles]);

  useEffect(() => {
    if (experienceMode !== 'tutor' || greetedRef.current || isThinking || isSending || subtitles) return;
    const greeting = getTimeGreeting();
    setStatusMessage(greeting);
    greetedRef.current = true;
    const t = setTimeout(() => setStatusMessage((p) => (p === greeting ? null : p)), 3000);
    return () => clearTimeout(t);
  }, [experienceMode, isThinking, isSending, subtitles]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        const wasActive = Object.values(activityStateRef.current).some(Boolean);
        if (sessionHydratedRef.current) {
          void upsertCurrentSessionRef.current({ status: 'paused' });
        }
        setIsTabPaused(wasActive);
        setIsSending(false);
        setIsThinking(false);
        setIsStoryStreaming(false);
        setIsTutorStreaming(false);
        setIsStoryListening(false);
        setIsTutorListening(false);
        setStoryAwaitingUser(false);
        void Voice.stop().catch(() => {});
        void stopAudioRef.current();
        mascotRef.current?.stopSpeaking();
        mascotRef.current?.resetAudioQueue();
        mascotRef.current?.setMouth(0);
      };
    }, [])
  );

  // Fallback: dismiss boot overlay if onReady never fires (web, CDN fail, etc.)
  useEffect(() => {
    const t = setTimeout(() => setIsMascotBooted(true), 15000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => () => {
    if (sessionSyncTimerRef.current) clearTimeout(sessionSyncTimerRef.current);
  }, []);

  useEffect(() => () => {
    if (storyWsRef.current) { storyWsRef.current.close(); storyWsRef.current = null; }
  }, []);

  if (!user && !loading) return <View style={s.root} />;

  const isInputLocked = isSending;
  const isListening = experienceMode === 'story' ? isStoryListening : isTutorListening;
  const assistantStatus = isTabPaused
    ? 'Paused'
    : isListening
      ? 'Listening'
      : isPlaying || storyPhase === 'speaking'
        ? 'Speaking'
        : isThinking || isTutorStreaming || isStoryStreaming
          ? 'Thinking'
          : statusMessage || 'Ready';
  const phaseLabel: Record<StoryPhase, string> = {
    idle: 'Ready', ingesting: 'Reading doc...', generating: 'Thinking...', speaking: 'Speaking...', awaiting: 'Your turn...',
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <View style={s.environment} pointerEvents="none">
        <LinearGradient
          colors={['#F8FAFC', '#FFFFFF', '#EEF7F2']}
          style={StyleSheet.absoluteFill}
        />
        <View style={s.cleanTopWash} />
        <View style={s.cleanBottomWash} />
      </View>

      <SafeAreaView edges={['top']} style={s.safeArea}>
        {/* Top-Left action buttons */}
        <View style={s.topActionsHeader}>
          {/* Left: history toggle + Math */}
          <View style={s.headerLeftRow}>
            <TouchableOpacity
              style={s.headerIconButton}
              onPress={() => setIsSessionSheetOpen(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="menu" size={20} color="#0F172A" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.headerIconButton, isMathMode && s.actionPillBtnActive]}
              onPress={() => {
                setIsMathMode(prev => {
                  const next = !prev;
                  if (!next) {
                    setMathInputIntent('auto');
                    setLastSolution(null);
                  }
                  return next;
                });
              }}
              activeOpacity={0.8}
            >
              <Ionicons
                name={isMathMode ? "calculator" : "calculator-outline"}
                size={18}
                color={isMathMode ? "#FFFFFF" : "#0F172A"}
              />
            </TouchableOpacity>
          </View>

          {/* Center: MIGA brand */}
          <View style={s.headerBrandCenter} pointerEvents="none">
            <Text style={s.headerBrandText}>MIGA</Text>
            <View style={s.headerBrandBolt}>
              <Ionicons name="flash" size={12} color="#FFFFFF" />
            </View>
          </View>

          {/* Right: Chat */}
          <TouchableOpacity
            style={s.actionPillBtn}
            onPress={() => { setChatMounted(true); setViewMode('chat'); }}
            activeOpacity={0.8}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={15} color="#0F172A" />
            <Text style={s.actionPillText}>Chat</Text>
          </TouchableOpacity>
        </View>

        {/* Story-mode "hat" toggle removed; language moves into the input dock. */}

        {/* Immersion stage */}
        <View style={s.stage}>
          <AnimatePresence>
            {showSessionFlash ? (
              <MotiView
                key="session-flash"
                from={{ opacity: 0, translateY: -14, scale: 0.92 }}
                animate={{ opacity: 1, translateY: 0, scale: 1 }}
                exit={{ opacity: 0, translateY: -14, scale: 0.92 }}
                transition={{ type: 'spring', damping: 18, stiffness: 220 }}
                style={s.sessionFlash}
                pointerEvents="none"
              >
                <Text style={s.sessionFlashText}>New session started</Text>
              </MotiView>
            ) : null}
          </AnimatePresence>
          <View style={[StyleSheet.absoluteFill, { zIndex: -1 }]} pointerEvents="none">
             <View style={s.flagMedallionShadow} />
             <View style={s.flagSplitWrap}>
               <MotiView
                 key={`flag-left-${stageIntroKey}-${isMascotBooted ? 'ready' : 'booting'}`}
                 from={{ translateX: -92 }}
                 animate={{ translateX: 0 }}
                 transition={{ type: 'timing', duration: 260, delay: 20 }}
                 style={[s.flagHalf, s.flagHalfLeft]}
               >
                 <View style={[s.flagHalfContent, s.flagHalfContentLeft]}>
                   <View style={s.flagSaffron} />
                   <View style={s.flagWhite} />
                   <View style={s.flagGreen} />
                 </View>
               </MotiView>
               <MotiView
                 key={`flag-right-${stageIntroKey}-${isMascotBooted ? 'ready' : 'booting'}`}
                 from={{ translateX: 92 }}
                 animate={{ translateX: 0 }}
                 transition={{ type: 'timing', duration: 260, delay: 20 }}
                 style={[s.flagHalf, s.flagHalfRight]}
               >
                 <View style={[s.flagHalfContent, s.flagHalfContentRight]}>
                   <View style={s.flagSaffron} />
                   <View style={s.flagWhite} />
                   <View style={s.flagGreen} />
                 </View>
               </MotiView>
               <MotiView
                 key={`chakra-${stageIntroKey}-${isMascotBooted ? 'ready' : 'booting'}`}
                 from={{ opacity: 0, scale: 0.7 }}
                 animate={{ opacity: 1, scale: 1 }}
                 transition={{ type: 'spring', damping: 18, delay: 170 }}
                 style={s.chakra}
               >
                 {Array.from({ length: 12 }).map((_, i) => (
                   <View
                     key={`chakra-${i}`}
                     style={[s.chakraSpoke, { transform: [{ rotate: `${i * 15}deg` }] }]}
                   />
                 ))}
                 <View style={s.chakraHub} />
               </MotiView>
             </View>
             <MotiView
               key={`flag-ring-${stageIntroKey}-${isMascotBooted ? 'ready' : 'booting'}`}
               from={{ opacity: 0, scale: 0.86 }}
               animate={{ opacity: 1, scale: 1 }}
               transition={{ type: 'spring', damping: 22, delay: 190 }}
               style={s.flagMedallionRing}
             />
          </View>

          {/* Mascot Container - No vertical clipping */}
          <MotiView
            key={`mascot-pop-${stageIntroKey}-${isMascotBooted ? 'ready' : 'booting'}`}
            from={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: 'timing', duration: 180, delay: 220 }}
            style={[
              s.mascotWrapper,
              experienceMode === 'story' && s.hiddenMascotWrapper,
            ]}
            pointerEvents={experienceMode === 'story' ? 'none' : 'auto'}
          >
            <MascotRig
              key="mascot-rig-stable"
              ref={mascotRef}
              size={Math.min(SCREEN.width * 1.15, 520)}
              onReady={() => setIsMascotBooted(true)}
              onError={() => setIsMascotBooted(true)}
              emotion={emotion}
              onTouch={() => {}}
              onAudioQueueEmpty={() => {
                mascotRef.current?.stopSpeaking();
                mascotRef.current?.setMouth(0);
              }}
            />
          </MotiView>

          {experienceMode === 'story' && (
            <View style={s.storyAudioScene} pointerEvents="none">
              <MotiView
                from={{ scale: 0.85, opacity: 0.08 }}
                animate={{ scale: 1.15, opacity: 0.18 }}
                transition={{ type: 'timing', duration: 2000, loop: true, repeatReverse: true }}
                style={s.storyWaveRing}
              />
              <MotiView
                from={{ scale: 0.65, opacity: 0.06 }}
                animate={{ scale: 1.05, opacity: 0.14 }}
                transition={{ type: 'timing', duration: 1800, loop: true, repeatReverse: true, delay: 280 }}
                style={[s.storyWaveRing, s.storyWaveRingSecondary]}
              />
              <MotiView
                from={{ scale: 0.45, opacity: 0.12 }}
                animate={{ scale: 0.85, opacity: 0.22 }}
                transition={{ type: 'timing', duration: 1600, loop: true, repeatReverse: true, delay: 520 }}
                style={[s.storyWaveRing, s.storyWaveRingTertiary]}
              />
              <MotiView
                from={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'timing', duration: 600, delay: 160 }}
                style={s.storyAudioCore}
              >
                <Ionicons name="headset" size={30} color="#FFFFFF" />
              </MotiView>
              {showStoryAudioLabel && (
                <MotiView
                  from={{ opacity: 0.7, translateY: 20 }}
                  animate={{ opacity: 1, translateY: 0 }}
                  exit={{ opacity: 0, translateY: 8 }}
                  transition={{ type: 'timing', duration: 450, delay: 250 }}
                  style={s.storyAudioLabel}
                >
                  <Text style={s.storyAudioLabelText}>Immersive Story Listening</Text>
                </MotiView>
              )}
            </View>
          )}

          {/* Transparent touch gesture overlay for eye follow. Android WebView
              renders on its own native Surface that can composite above sibling
              views regardless of zIndex, so this needs an explicit elevation to
              reliably sit on top and actually receive the drag that drives lookAt(). */}
          <View
            style={[StyleSheet.absoluteFillObject, { zIndex: 10, elevation: 10 }]}
            pointerEvents="box-only"
            {...stagePanResponder.panHandlers}
          />

          <AnimatePresence>
            {!!fingerPoint && (
              <MotiView
                key={`finger-${fingerPoint.id}`}
                from={{ opacity: 0.75, scale: 0.65 }}
                animate={{ opacity: 0.12, scale: 1.8 }}
                exit={{ opacity: 0, scale: 2.1 }}
                transition={{ type: 'timing', duration: 260 }}
                pointerEvents="none"
                style={[
                  s.fingerTrace,
                  { left: fingerPoint.x - 18, top: fingerPoint.y - 18 },
                ]}
              >
                <View style={s.fingerTraceCore} />
              </MotiView>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {!!streakMissPopup && (
              <MotiView
                key="streak-miss-popup"
                from={{ opacity: 0, translateY: -10, scale: 0.96 }}
                animate={{ opacity: 1, translateY: 0, scale: 1 }}
                exit={{ opacity: 0, translateY: -8, scale: 0.98 }}
                transition={{ type: 'timing', duration: 260 }}
                pointerEvents="none"
                style={s.streakMissPopup}
              >
                <Ionicons name="flame" size={16} color="#EF4444" />
                <Text style={s.streakMissPopupText}>{streakMissPopup}</Text>
              </MotiView>
            )}
          </AnimatePresence>

          {/* Persistent visual board for timelines, formulas, lists */}
          <AnimatePresence>
            {experienceMode !== 'story' && !!visualBoard && (
              <MotiView
                key={`visual-board-${visualBoard.title || 'board'}`}
                from={{ opacity: 0, translateY: -14, scale: 0.96 }}
                animate={{ opacity: 1, translateY: 0, scale: 1 }}
                exit={{ opacity: 0, translateY: -6, scale: 0.98 }}
                transition={{ type: 'timing', duration: 260 }}
                {...visualBoardPanResponder.panHandlers}
                style={[
                  s.visualBoard,
                  isMathMode
                    ? [s.visualBoardMathMode, s.visualBoardMathTop, { bottom: undefined }]
                    : s.visualBoardTutorMode,
                  { transform: [{ translateX: visualBoardOffset.x }, { translateY: visualBoardOffset.y }] },
                ]}
              >
                <TouchableOpacity
                  style={{ position: 'absolute', right: 12, top: 12, zIndex: 140 }}
                  onPress={() => setVisualBoard(null)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close-circle" size={22} color="#94A3B8" />
                </TouchableOpacity>
                {isMathMode && (
                  <View style={s.mathBoardHeader}>
                    <View style={s.mathBoardHeaderLeft}>
                      <Ionicons name="create-outline" size={14} color="#0F172A" />
                      <Text style={s.mathBoardHeaderText}>
                        {mathSolveState === 'loading' ? 'Solving...' : mathSolveState === 'done' ? 'Solved' : 'Math Board'}
                      </Text>
                    </View>
                    <View style={s.mathBoardHeaderTag}>
                      <Text style={s.mathBoardHeaderTagText}>
                        {mathSolveState === 'loading' ? 'Loading' : 'Step by step'}
                      </Text>
                    </View>
                  </View>
                )}
                {isMathMode && !!visualBoard.title && <Text style={s.visualBoardTitle}>{visualBoard.title}</Text>}
                {isMathMode && !!visualBoard.subtitle && <Text style={s.visualBoardSub}>{visualBoard.subtitle}</Text>}
                {!!visualBoard.rows?.length && (
                  <View style={s.visualRows}>
                    {(() => {
                      const revealLimit = mathSolveState === 'loading'
                        ? visualBoard.rows?.length || 0
                        : Math.max(mathRevealCount, 1);
                      // Only rows that should currently be shown are rendered at all.
                      // A not-yet-revealed row used to stay mounted at opacity 0, which
                      // still reserved its full height, so the board was always sized
                      // for the eventual max content instead of growing with it.
                      return visualBoard.rows.slice(0, Math.min(6, revealLimit));
                    })().map((row, idx) => {
                      const revealLimit = mathSolveState === 'loading'
                        ? visualBoard.rows?.length || 0
                        : Math.max(mathRevealCount, 1);
                      const isCurrent = idx === Math.max(revealLimit - 1, 0);
                      const isLoadingRow = mathSolveState === 'loading';
                      return (
                      <MotiView
                        key={`${row.label}-${idx}`}
                        from={{ opacity: 0, translateY: 8 }}
                        animate={{ opacity: 1, translateY: 0 }}
                        transition={{ type: 'timing', duration: 220, delay: idx * 90 }}
                        style={[
                          s.visualRow,
                          isMathMode ? s.visualRowLive : null,
                          !isMathMode ? s.visualRowTutorCompact : null,
                          isLoadingRow ? s.visualRowLoading : null,
                          idx < Math.max(revealLimit - 1, 0) ? s.visualRowDimmed : null,
                          isCurrent ? s.visualRowWriting : null,
                        ]}
                      >
                        <View style={[s.visualRowTop, isMathMode ? s.visualRowTopMath : s.visualRowTopTutor]}>
                          <Text
                            style={[s.visualRowLabel, isMathMode ? s.visualRowLabelMath : s.visualRowLabelTutor]}
                            numberOfLines={isMathMode ? 2 : 1}
                          >
                            {row.label}
                          </Text>
                          {!!row.value && (
                            <Text
                              style={[s.visualRowValue, isMathMode ? s.visualRowValueMath : s.visualRowValueTutor]}
                            >
                              {row.value}
                            </Text>
                          )}
                        </View>
                        {!!row.note && <Text style={s.visualRowNote} numberOfLines={2}>{row.note}</Text>}
                      </MotiView>
                    )})}
                  </View>
                )}
                {!!visualBoard.bullets?.length && (
                  <View style={s.visualBullets}>
                    {visualBoard.bullets.slice(0, 4).map((item, idx) => (
                      <Text key={`${item}-${idx}`} style={s.visualBullet} numberOfLines={2}>- {item}</Text>
                    ))}
                  </View>
                )}
              </MotiView>
            )}

            {/* Continue button - only while the tutor is genuinely paused mid-lesson
                waiting on the student (tutorAwaitingReply, set from the server's
                wait_for_user or an asked question). Showing it on every idle moment
                meant it also appeared after a lesson had finished and on a fresh
                session, offering to continue something that had nothing left to
                teach. Tapping advances the chunk, the same as saying "yes" aloud. */}
            {experienceMode === 'tutor' && hasTutorConversationStarted && tutorAwaitingReply && !isThinking && !isTutorStreaming && !isPlaying && !isTutorListening && (
              <MotiView
                key="tutor-continue"
                from={{ opacity: 0, translateY: 12 }}
                animate={{ opacity: 1, translateY: 0 }}
                exit={{ opacity: 0, translateY: 8 }}
                transition={{ type: 'timing', duration: 220 }}
                pointerEvents="box-none"
                style={{ position: 'absolute', left: 0, right: 0, bottom: Math.max(insets.bottom + 190, 200), alignItems: 'center', zIndex: 130 }}
              >
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    setVisualBoard(null);
                    setTutorAwaitingReply(false);
                    clearTutorWaitNudge();
                    startTutorStream('continue', 'topic', 'affirm');
                  }}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 7,
                    backgroundColor: '#FFFFFF',
                    paddingHorizontal: 22,
                    paddingVertical: 13,
                    borderRadius: 999,
                    borderWidth: 0.5,
                    borderColor: 'rgba(0,0,0,0.06)',
                  }}
                >
                  <Text style={{ color: '#1D1D1F', fontFamily: 'Inter-SemiBold', fontSize: 15, letterSpacing: -0.2 }}>Continue</Text>
                  <Ionicons name="chevron-forward" size={16} color="#1D1D1F" />
                </TouchableOpacity>
              </MotiView>
            )}
          </AnimatePresence>

                    {/* Subtitle bubble - Premium Fading Style (Always bottom, full text visible) */}
          <AnimatePresence>
            {!!subtitles && !(isMathMode && lastSolution && visualBoard) && (
              <MotiView
                key="sub"
                from={{ opacity: 0, translateY: 15, scale: 0.95 }}
                animate={{ opacity: 1, translateY: 0, scale: 1 }}
                exit={{ opacity: 0, translateY: 5, scale: 0.98 }}
                transition={{ type: 'timing', duration: 400 }}
                style={[
                  s.subtitleContainer,
                  {
                    bottom: isMathMode && lastSolution
                      ? Math.max(insets.bottom + 170, 180)
                      : Math.max(insets.bottom + 115, 125),
                  },
                  isMathMode && lastSolution ? s.subtitleContainerMathMode : null,
                  visualBoard ? s.subtitleContainerBoardAware : null,
                ]}
              >
                <BlurView intensity={68} tint="light" style={s.subtitleBlur}>
                  <Text
                    style={s.subtitleText}
                    numberOfLines={isMathMode && lastSolution ? 5 : undefined}
                  >
                    {sanitizeText(subtitles)}
                  </Text>
                </BlurView>
              </MotiView>
            )}
          </AnimatePresence>

          {/* Choice pills */}
          <AnimatePresence>
            {choices.length > 0 && (
              <MotiView
                key="choices"
                from={{ opacity: 0, translateY: 18 }}
                animate={{ opacity: 1, translateY: 0 }}
                exit={{ opacity: 0 }}
                style={[
                  s.choicesWrap,
                  { bottom: insets.bottom + 160 }
                ]}
              >
                {choices.map((c) => {
                  const isLengthyOrMany = choices.length > 2 || choices.some(x => x.length > 18);
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[
                        s.choicePill,
                        isLengthyOrMany ? { width: '48%', alignItems: 'center' } : null
                      ]}
                      activeOpacity={0.8}
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        if (kuralFlowState !== 'idle') {
                          handleKuralChoicePress(c);
                        } else if (currentAffairsState !== 'idle') {
                          handleCurrentAffairsChoicePress(c);
                        } else {
                          handleSendAsk(c);
                        }
                      }}
                    >
                      <Text style={s.choiceText} numberOfLines={1} adjustsFontSizeToFit>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </MotiView>
            )}
          </AnimatePresence>
        </View>

        {/* Control dock */}
        {/* Premium floating dock */}
        <MotiView
          animate={{ translateY: -keyboardLift }}
          transition={{ type: 'timing', duration: 220 }}
          style={[s.floatingDockWrap, { bottom: Math.max(insets.bottom + 52, 64) }]}
        >
          {isTabPaused && (
            <MotiView
              from={{ opacity: 0, translateY: 6 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 180 }}
              style={s.pauseBanner}
            >
              <Ionicons name="pause-circle-outline" size={16} color="#0F172A" />
              <Text style={s.pauseBannerText}>Paused</Text>
              <TouchableOpacity
                onPress={() => {
                  setIsTabPaused(false);
                  void upsertCurrentSessionRef.current({ status: 'active' });
                }}
                activeOpacity={0.8}
                style={s.pauseBannerBtn}
              >
                <Text style={s.pauseBannerBtnText}>Resume</Text>
              </TouchableOpacity>
            </MotiView>
          )}


          {experienceMode === 'tutor' && isMathMode && lastSolution && (
            <View style={s.mathContextActions}>
              <TouchableOpacity
                style={[s.mathContextChip, mathInputIntent === 'doubt' && s.mathContextChipActive]}
                activeOpacity={0.82}
                onPress={() => setMathInputIntent('doubt')}
              >
                <Ionicons
                  name="chatbubble-ellipses-outline"
                  size={15}
                  color={mathInputIntent === 'doubt' ? '#FFFFFF' : '#0F172A'}
                />
                <Text style={[s.mathContextText, mathInputIntent === 'doubt' && s.mathContextTextActive]}>
                  Ask a doubt
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.mathContextChip, mathInputIntent === 'new' && s.mathContextChipActive]}
                activeOpacity={0.82}
                onPress={() => {
                  setMathInputIntent('new');
                  setLastSolution(null);
                  setAskInput('');
                  setVisualBoard(null);
                }}
              >
                <Ionicons
                  name="add-circle-outline"
                  size={15}
                  color={mathInputIntent === 'new' ? '#FFFFFF' : '#0F172A'}
                />
                <Text style={[s.mathContextText, mathInputIntent === 'new' && s.mathContextTextActive]}>
                  New problem
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {isMathMode && mathSolveState === 'idle' ? (
            <View style={[s.mathDock, { marginBottom: 2 }]}>
              <View style={s.mathDockRow}>
                <TouchableOpacity
                  onPress={() => {
                    setMathScanMode('camera');
                    setIsCameraScanOpen(true);
                  }}
                  activeOpacity={0.85}
                  style={[s.mathActionBtn, s.mathActionBtnScan]}
                >
                  <LinearGradient
                    colors={['rgba(14,165,233,0.18)', 'rgba(45,212,191,0.18)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.mathActionBtnFill}
                  >
                    <View style={[s.mathActionBtnIcon, s.mathActionBtnIconScan]}>
                      <Ionicons name="scan-outline" size={18} color="#0F172A" />
                    </View>
                    <Text style={s.mathActionBtnText}>Scan</Text>
                  </LinearGradient>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    setMathScanMode('gallery');
                    setIsCameraScanOpen(true);
                  }}
                  activeOpacity={0.85}
                  style={[s.mathActionBtn, s.mathActionBtnAttach]}
                >
                  <LinearGradient
                    colors={['rgba(251,191,36,0.18)', 'rgba(251,146,60,0.18)']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={s.mathActionBtnFill}
                  >
                    <View style={[s.mathActionBtnIcon, s.mathActionBtnIconAttach]}>
                      <Ionicons name="attach-outline" size={18} color="#0F172A" />
                    </View>
                    <Text style={s.mathActionBtnText}>Attach</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.mathPromptRail}>
                {MATH_PROMPTS.map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    style={s.mathPromptChip}
                    activeOpacity={0.85}
                    onPress={() => handleMathPresetPress(item.prompt)}
                  >
                    <Text style={s.mathPromptChipText} numberOfLines={2}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
              <View style={s.mathHintRow}>
                <Text style={s.mathHintText}>Scan a page or tap a sample sum to start solving.</Text>
              </View>
            </View>
          ) : isMathMode && mathSolveState === 'loading' ? (
            <View style={s.mathSolveLoadingRow}>
              <ActivityIndicator size="small" color="#0F172A" />
              <Text style={s.mathSolveLoadingText}>Solving step by step...</Text>
            </View>
          ) : isMathMode ? (
            <View style={s.mathSolveActions}>
              <TouchableOpacity
                style={s.mathSolveActionBtn}
                activeOpacity={0.82}
                onPress={() => {
                  if (lastSolution) {
                    setMathInputIntent('doubt');
                    setAskInput('');
                  }
                }}
              >
                <Ionicons name="help-circle-outline" size={15} color="#0F172A" />
                <Text style={s.mathSolveActionText}>Ask doubt</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.mathSolveActionBtn}
                activeOpacity={0.82}
                onPress={() => {
                  if (lastSolution) {
                    setMathInputIntent('doubt');
                    startMathFollowUp('Please repeat the recent step slowly.');
                  }
                }}
              >
                <Ionicons name="refresh-outline" size={15} color="#0F172A" />
                <Text style={s.mathSolveActionText}>Repeat step</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.mathSolveActionBtn, s.mathSolveActionBtnPrimary]}
                activeOpacity={0.82}
                onPress={resetMathSession}
              >
                <Ionicons name="add-circle-outline" size={15} color="#FFFFFF" />
                <Text style={[s.mathSolveActionText, s.mathSolveActionTextPrimary]}>New problem</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.floatingInputBar}>
              <>
                {((experienceMode === 'story' && (isStoryStreaming || isPlaying || storyPhase === 'speaking' || storyPhase === 'generating'))
                  // Tutor/call mode had no visible way to interrupt MIGA mid-speech —
                  // only an undiscoverable re-tap-the-mic/type-anyway workaround.
                  // Story mode's stop button is the correct, already-built pattern.
                  || (experienceMode === 'tutor' && (isTutorStreaming || isPlaying || isThinking))) && (
                  <TouchableOpacity
                    style={s.storyStopBtn}
                    onPress={interruptCurrentStream}
                    activeOpacity={0.82}
                  >
                    <Ionicons name="stop" size={18} color="#FFFFFF" />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={handleMicToggle}
                  disabled={isSending && !isListening}
                  style={[s.premiumMicBtn, isListening && s.premiumMicBtnActive]}
                  activeOpacity={0.82}
                >
                  <Ionicons
                    name={isListening ? 'mic' : 'mic-outline'}
                    size={20}
                    color={isListening ? '#FFFFFF' : '#0F172A'}
                  />
                </TouchableOpacity>

                <TextInput
                  placeholder={
                    experienceMode === 'story'
                      ? storyAwaitingUser ? 'Reply to MIGA...' : 'Type here...'
                      : 'Ask MIGA anything...'
                  }
                  placeholderTextColor="#94A3B8"
                  style={s.premiumInput}
                  value={askInput}
                  onChangeText={setAskInput}
                  onSubmitEditing={() => handleSendAsk()}
                  editable={!isInputLocked}
                  returnKeyType="send"
                />

                <View style={s.inputActions}>
                  <TouchableOpacity
                    style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1F5F4', borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)', marginRight: 8 }}
                    onPress={() => setIsLangPickerOpen(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="language" size={18} color="#0F172A" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.premiumSendBtn, (isSending || !askInput.trim()) && s.premiumSendBtnDisabled]}
                    onPress={() => handleSendAsk()}
                    disabled={isSending || !askInput.trim()}
                  >
                    {isResponding ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Ionicons name="arrow-up" size={18} color="#FFFFFF" />
                    )}
                  </TouchableOpacity>
                </View>
              </>
            </View>
          )}
        </MotiView>
      </SafeAreaView>

      {/* Boot overlay */}
      {!isMascotBooted && (
        <View style={s.bootOverlay}>
          <BootLoader />
        </View>
      )}

      {/* Language sheet */}
      <Modal
        visible={isLangPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsLangPickerOpen(false)}
      >
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setIsLangPickerOpen(false)}>
          <MotiView
            from={{ translateY: 300, opacity: 0.9 }}
            animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'timing', duration: 220 }}
            style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}
          >
            <View style={s.sheetHandle} />
            <Text style={s.sheetTitle}>Voice Language</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {[
                { id: 'en-IN', label: 'English' },
                { id: 'hi-IN', label: 'Hindi' },
                { id: 'ta-IN', label: 'Tamil' },
                { id: 'te-IN', label: 'Telugu' },
                { id: 'ml-IN', label: 'Malayalam' },
                { id: 'kn-IN', label: 'Kannada' },
              ].map((lang) => {
                const active = selectedLanguage === lang.label;
                return (
                  <TouchableOpacity
                    key={lang.id}
                    style={[s.langRow, active && s.langRowOn]}
                    activeOpacity={0.8}
                    onPress={() => {
                      setSelectedLanguage(lang.label);
                      setStoryLanguage(lang.id);
                      mergeStudentProfile({
                        language_code: lang.id,
                        language_label: lang.label,
                        name: studentProfileRef.current.name || defaultProfileName(user),
                      });
                      setIsLangPickerOpen(false);
                    }}
                  >
                    <Text style={[s.langRowText, active && s.langRowTextOn]}>{lang.label}</Text>
                    {active && <Ionicons name="checkmark-circle" size={20} color="#00D4C7" />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </MotiView>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={isSessionSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setIsSessionSheetOpen(false)}
      >
        <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={() => setIsSessionSheetOpen(false)}>
          <MotiView
            from={{ translateY: 320, opacity: 0.92 }}
            animate={{ translateY: 0, opacity: 1 }}
            transition={{ type: 'timing', duration: 220 }}
            style={[s.sheet, { paddingBottom: insets.bottom + 24 }]}
          >
            <View style={s.sheetHandle} />
            <View style={s.sessionSheetHead}>
              <Text style={s.sheetTitle}>Sessions</Text>
              <TouchableOpacity
                style={s.sessionNewBtn}
                onPress={async () => {
                  await startFreshSession(experienceMode);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="add" size={15} color="#FFFFFF" />
                <Text style={s.sessionNewBtnText}>New</Text>
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {sessions.length === 0 ? (
                <View style={s.emptySessionBox}>
                  <Text style={s.emptySessionText}>No saved sessions yet.</Text>
                </View>
              ) : sessions.map((session) => {
                const active = session.id === activeSessionId;
                return (
                  <TouchableOpacity
                    key={session.id}
                    style={[s.sessionRow, active && s.sessionRowActive]}
                    activeOpacity={0.85}
                    onPress={async () => {
                      restoreSession(session);
                      await persistMascotSessions([
                        { ...session, updatedAt: new Date().toISOString(), status: 'active' as MascotSessionStatus },
                        ...sessionsRef.current.filter((item) => item.id !== session.id),
                      ].slice(0, 12), session.id);
                      setIsSessionSheetOpen(false);
                    }}
                  >
                    <View style={s.sessionRowLeft}>
                      <View style={[s.sessionBadge, session.mode === 'story' ? s.sessionBadgeStory : s.sessionBadgeTutor]}>
                        <Ionicons name={session.mode === 'story' ? 'book' : 'school'} size={13} color="#FFFFFF" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.sessionRowTitle} numberOfLines={1}>{session.title || 'New chat'}</Text>
                        <Text style={s.sessionRowMeta} numberOfLines={1}>
                          {session.languageLabel} - {session.messageCount} turns - {session.status}
                        </Text>
                      </View>
                    </View>
                    <Ionicons name={active ? 'radio-button-on' : 'chevron-forward'} size={18} color={active ? '#00AFA5' : '#94A3B8'} />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </MotiView>
        </TouchableOpacity>
      </Modal>

      <StoryUploadModal
        visible={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onUploadSuccess={handleUploadSuccess}
        onUploadStart={() => setStoryPhase('ingesting')}
        onUploadEnd={() => setStoryPhase('idle')}
      />

      <CameraScanModal
        visible={isCameraScanOpen}
        onClose={() => setIsCameraScanOpen(false)}
        onTextExtracted={handleTextExtracted}
        qrLike={isMathMode}
        languageCode={activeTutorLanguageCode}
      />

      {chatMounted && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', zIndex: 200, display: viewMode === 'chat' ? 'flex' : 'none' }]}>
          <SafeAreaView style={{ flex: 1 }} edges={['top']}>
            <MigaChat
              userId={hydratedUserIdRef.current || ''}
              languageCode={activeTutorLanguageCode}
              languageLabel={selectedLanguage}
              bottomInset={tabDockHeight}
              onSwitchToCall={() => setViewMode('call')}
            />
          </SafeAreaView>
        </View>
      )}
    </View>
  );
}

// Styles
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  safeArea: { flex: 1 },
  environment: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  cleanTopWash: {
    position: 'absolute',
    top: -SCREEN.width * 0.42,
    alignSelf: 'center',
    width: SCREEN.width * 1.15,
    height: SCREEN.width * 1.15,
    borderRadius: SCREEN.width * 0.575,
    backgroundColor: 'rgba(255, 153, 51, 0.1)',
  },
  cleanBottomWash: {
    position: 'absolute',
    bottom: -SCREEN.width * 0.36,
    alignSelf: 'center',
    width: SCREEN.width * 1.22,
    height: SCREEN.width * 1.22,
    borderRadius: SCREEN.width * 0.61,
    backgroundColor: 'rgba(19, 136, 8, 0.08)',
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitle: { fontSize: 24, fontFamily: 'Poppins-Bold', color: '#0F172A', letterSpacing: -1 },
  accent: { color: '#00D4C7' },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 212, 199, 0.1)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00D4C7' },
  liveText: { fontSize: 10, fontFamily: 'Poppins-Bold', color: '#00D4C7', letterSpacing: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconHeader: {
    position: 'absolute',
    top: 44,
    right: 14,
    zIndex: 120,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  headerIconButtonDisabled: {
    backgroundColor: 'rgba(241, 245, 249, 0.92)',
    borderColor: 'rgba(148, 163, 184, 0.16)',
  },
  modeIconButton: {
    backgroundColor: '#0F172A',
    borderColor: 'rgba(15, 23, 42, 0.18)',
  },
  modeIconButtonStory: {
    backgroundColor: '#138808',
    borderColor: 'rgba(19, 136, 8, 0.22)',
  },
  modeIconDot: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF9933',
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  hiddenMascotWrapper: {
    opacity: 0,
  },
  storyAudioScene: {
    position: 'absolute',
    left: '50%',
    top: '45%',
    transform: [{ translateX: -SCREEN.width * 0.36 }, { translateY: -SCREEN.width * 0.18 }],
    width: SCREEN.width * 0.72,
    height: SCREEN.width * 0.72,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
  },
  storyWaveRing: {
    position: 'absolute',
    width: SCREEN.width * 0.55,
    height: SCREEN.width * 0.55,
    borderRadius: SCREEN.width * 0.275,
    borderWidth: 1.5,
    borderColor: 'rgba(0, 212, 199, 0.24)',
    backgroundColor: 'rgba(0, 212, 199, 0.02)',
  },
  storyWaveRingSecondary: {
    width: SCREEN.width * 0.42,
    height: SCREEN.width * 0.42,
    borderRadius: SCREEN.width * 0.21,
    borderColor: 'rgba(0, 212, 199, 0.16)',
  },
  storyWaveRingTertiary: {
    width: SCREEN.width * 0.28,
    height: SCREEN.width * 0.28,
    borderRadius: SCREEN.width * 0.14,
    borderColor: 'rgba(0, 212, 199, 0.1)',
  },
  storyAudioCore: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#0F172A',
    shadowOpacity: 0.28,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 12 },
  },
  storyAudioLabel: {
    position: 'absolute',
    bottom: -36,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 24,
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
  },
  storyAudioLabelText: {
    color: '#E2E8F0',
    fontSize: 12,
    fontWeight: '600',
  },
  streakMissPopup: {
    position: 'absolute',
    top: 100,
    alignSelf: 'center',
    zIndex: 140,
    maxWidth: '86%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.18)',
    ...V2026.shadows.milky,
  },
  streakMissPopupText: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#7F1D1D',
  },
  newHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 110,
    width: '100%',
  },
  headerBrandWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  brandLogoCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 199, 0.15)',
    ...V2026.shadows.milky,
  },
  brandMainText: {
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    lineHeight: 16,
  },
  brandStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 1,
  },
  brandStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#34D399',
  },
  brandStatusDotHot: {
    backgroundColor: '#EF4444',
  },
  brandStatusText: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  aiMascotTab: {
    position: 'absolute',
    top: 48,
    left: 16,
    zIndex: 110,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: 154,
    height: 54,
    paddingHorizontal: 11,
    borderRadius: 27,
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  aiMark: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ECFDF5',
  },
  aiCopy: { flex: 1, minWidth: 0 },
  aiTitle: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#0F172A', lineHeight: 16 },
  aiStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  aiStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#34D399' },
  aiStatusDotHot: { backgroundColor: '#EF4444' },
  aiStatusText: { flexShrink: 1, fontSize: 11, fontFamily: 'Inter-SemiBold', color: '#64748B' },
  langPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.36)',
    ...V2026.shadows.milky,
  },
  langPillText: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#0F172A' },
  modeToggle: {
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#0F172A',
    alignItems: 'center',
    justifyContent: 'center',
    ...V2026.shadows.milky,
  },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modeLabel: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#FFFFFF' },

  // Mode Title
  modeTitleContainer: { paddingHorizontal: 20, marginTop: 4 },
  modeTitle: { fontSize: 16, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  modeSubtitle: { fontSize: 12, fontFamily: 'Inter-Medium', color: '#64748B', marginTop: -2 },

  // Stage
  stage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  sessionFlash: {
    position: 'absolute',
    top: 64,
    alignSelf: 'center',
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#0F172A',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  sessionFlashText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  flagMedallionShadow: {
    position: 'absolute',
    top: SCREEN.height * 0.105,
    width: Math.min(SCREEN.width * 0.78, 360),
    height: Math.min(SCREEN.width * 0.78, 360),
    borderRadius: Math.min(SCREEN.width * 0.39, 180),
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.04)',
    transform: [{ translateY: 24 }, { scale: 0.98 }],
  },
  flagSplitWrap: {
    position: 'absolute',
    top: SCREEN.height * 0.1,
    width: Math.min(SCREEN.width * 0.76, 350),
    height: Math.min(SCREEN.width * 0.76, 350),
    borderRadius: Math.min(SCREEN.width * 0.38, 175),
    alignSelf: 'center',
    overflow: 'hidden',
    flexDirection: 'row',
    borderWidth: 8,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    ...V2026.shadows.milky,
  },
  flagHalf: {
    width: '50%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
  },
  flagHalfLeft: {
    borderTopLeftRadius: Math.min(SCREEN.width * 0.38, 175),
    borderBottomLeftRadius: Math.min(SCREEN.width * 0.38, 175),
  },
  flagHalfRight: {
    borderTopRightRadius: Math.min(SCREEN.width * 0.38, 175),
    borderBottomRightRadius: Math.min(SCREEN.width * 0.38, 175),
  },
  flagHalfContent: {
    position: 'absolute',
    top: 0,
    width: Math.min(SCREEN.width * 0.76, 350) - 16,
    height: Math.min(SCREEN.width * 0.76, 350) - 16,
  },
  flagHalfContentLeft: {
    left: 0,
  },
  flagHalfContentRight: {
    right: 0,
  },
  flagSaffron: {
    flex: 1,
    backgroundColor: '#FF9933',
  },
  flagWhite: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flagGreen: {
    flex: 1,
    backgroundColor: '#138808',
  },
  chakra: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -22,
    marginLeft: -22,
    zIndex: 4,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: '#000080',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chakraSpoke: {
    position: 'absolute',
    width: 1,
    height: 38,
    backgroundColor: '#000080',
  },
  chakraHub: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#000080',
  },
  flagMedallionRing: {
    position: 'absolute',
    top: SCREEN.height * 0.087,
    width: Math.min(SCREEN.width * 0.82, 378),
    height: Math.min(SCREEN.width * 0.82, 378),
    borderRadius: Math.min(SCREEN.width * 0.41, 189),
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  floatingHeader: {
    position: 'absolute',
    top: 112,
    right: 16,
    flexDirection: 'row',
    gap: 8,
    zIndex: 100,
    alignItems: 'center',
  },
  bootOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 999, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  pulseWrap: {
    position: 'absolute',
    width: SCREEN.width, height: SCREEN.width,
    alignItems: 'center', justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: SCREEN.width * 0.6, height: SCREEN.width * 0.6,
    borderRadius: SCREEN.width * 0.3,
    borderWidth: 2, borderColor: 'rgba(0, 212, 199, 0.15)',
  },
  mascotWrapper: {
    width: SCREEN.width,
    height: SCREEN.height * 0.66,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -65,
  },

  // Recommendation Pill
  recPillContainer: { position: 'absolute', top: 20, alignSelf: 'center' },
  recPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 199, 0.2)',
    ...V2026.shadows.primary,
  },
  recPillText: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#0F172A' },

  // Status pill
  statusPill: {
    position: 'absolute', bottom: 40, alignSelf: 'center',
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 25, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#E2E8F0',
    ...V2026.shadows.milky,
  },
  statusPillText: { fontSize: 14, fontFamily: 'Inter-SemiBold', color: '#64748B' },

  visualBoard: {
    position: 'absolute',
    alignSelf: 'center',
    width: '92%',
    maxWidth: 520,
    maxHeight: 280,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    overflow: 'hidden',
    alignItems: 'stretch',
    zIndex: 120,
    ...V2026.shadows.milky,
  },
  visualBoardTutorMode: {
    top: 112,
    bottom: undefined,
    width: '88%',
    maxHeight: 220,
    zIndex: 125,
  },
  visualBoardMathMode: {
    top: undefined,
    maxHeight: 285,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.98)',
    zIndex: 115,
  },
  visualBoardMathTop: {
    top: 122,
    bottom: undefined,
    maxHeight: 330,
  },
  mathBoardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(15, 23, 42, 0.06)',
  },
  mathBoardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mathBoardHeaderText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  mathBoardHeaderTag: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(19, 136, 8, 0.08)',
  },
  mathBoardHeaderTagText: {
    fontSize: 11,
    fontFamily: 'Inter-SemiBold',
    color: '#166534',
  },
  visualBoardTitle: {
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    lineHeight: 17,
  },
  visualBoardSub: {
    marginTop: 1,
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
    lineHeight: 14,
  },
  visualRows: {
    marginTop: 8,
    gap: 6,
  },
  visualRow: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#EEF2F7',
    overflow: 'hidden',
  },
  visualRowLive: {
    backgroundColor: '#FFFFFF',
    borderColor: 'rgba(19, 136, 8, 0.18)',
  },
  visualRowTutorCompact: {
    minHeight: 0,
    paddingVertical: 6,
  },
  visualRowLoading: {
    backgroundColor: '#F8FAFC',
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  visualRowDimmed: {
    opacity: 0.56,
  },
  visualRowWriting: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  visualRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  visualRowTopMath: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 3,
  },
  visualRowTopTutor: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    gap: 2,
  },
  visualRowLabel: {
    fontSize: 11,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    minWidth: 0,
    flex: 1,
    flexShrink: 1,
    lineHeight: 15,
  },
  visualRowLabelMath: {
    width: '100%',
    flex: 0,
  },
  visualRowLabelTutor: {
    width: '100%',
    flex: 0,
  },
  visualRowValue: {
    fontSize: 10,
    fontFamily: 'Inter-Bold',
    color: '#138808',
    flexShrink: 0,
    flexWrap: 'wrap',
    lineHeight: 14,
  },
  visualRowValueMath: {
    width: '100%',
    flexShrink: 1,
    flexWrap: 'wrap',
    color: '#0F172A',
    fontSize: 11,
    lineHeight: 15,
    fontFamily: 'Inter-SemiBold',
  },
  visualRowValueTutor: {
    width: '100%',
    flexShrink: 1,
    color: '#138808',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: 'Inter-Bold',
  },
  visualRowNote: {
    marginTop: 3,
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#64748B',
    lineHeight: 13,
  },
  visualBullets: {
    marginTop: 8,
    gap: 3,
  },
  visualBullet: {
    fontSize: 10,
    fontFamily: 'Inter-SemiBold',
    color: '#334155',
    lineHeight: 14,
  },

  // Subtitle
  subtitleContainer: {
    position: 'absolute',
    alignSelf: 'center',
    width: '92%',
    maxWidth: 520,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  subtitleContainerBoardAware: {
    width: '92%',
  },
  subtitleContainerMathMode: {
    maxHeight: 210,
  },
  subtitleBlur: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
  },
  subtitleText: {
    color: '#0F172A',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    fontFamily: 'Inter-SemiBold'
  },

  // Choices
  choicesWrap: {
    position: 'absolute',
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: 8, paddingHorizontal: 20,
  },
  choicePill: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.9)', borderWidth: 1, borderColor: 'rgba(236, 253, 245, 0.24)',
    ...V2026.shadows.milky,
  },
  choiceText: { color: '#0F172A', fontSize: 13, fontFamily: 'Poppins-Bold' },

  // Floating Dock Redesign
  floatingDockWrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    alignItems: 'center',
    zIndex: 100,
  },
  phaseContainer: { marginBottom: 16, alignItems: 'center' },
  phaseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  phaseBadgeActive: { borderColor: 'rgba(19, 136, 8, 0.24)', backgroundColor: 'rgba(236, 253, 245, 0.95)' },
  phaseLabel: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#0F172A' },
  mathContextActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  mathContextChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  mathContextChipActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  mathContextText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  mathContextTextActive: {
    color: '#FFFFFF',
  },
  pauseBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  pauseBannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#0F172A',
  },
  pauseBannerBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: '#0F172A',
  },
  pauseBannerBtnText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
  },
  mathDock: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    borderRadius: 28,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 10,
    ...V2026.shadows.milky,
  },
  mathSolveActions: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  mathSolveLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  mathSolveLoadingText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  mathSolveActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  mathSolveActionBtnPrimary: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  mathSolveActionText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  mathSolveActionTextPrimary: {
    color: '#FFFFFF',
  },
  mathDockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  mathActionBtn: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
  },
  mathActionBtnScan: {
    borderColor: 'rgba(14, 165, 233, 0.18)',
  },
  mathActionBtnAttach: {
    borderColor: 'rgba(251, 146, 60, 0.18)',
  },
  mathActionBtnFill: {
    minHeight: 54,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  mathActionBtnIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  mathActionBtnIconScan: {
    shadowColor: '#0EA5E9',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  mathActionBtnIconAttach: {
    shadowColor: '#F59E0B',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  mathActionBtnText: {
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  mathPromptRail: {
    paddingBottom: 2,
  },
  mathPromptChip: {
    marginRight: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    minHeight: 58,
    justifyContent: 'center',
  },
  mathPromptChipText: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Inter-SemiBold',
    color: '#0F172A',
    maxWidth: 150,
  },
  mathHintRow: {
    marginTop: 8,
    alignItems: 'center',
  },
  mathHintText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#64748B',
    fontFamily: 'Inter-Medium',
  },
  storyStopBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EF4444',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.24)',
    marginRight: 6,
    ...V2026.shadows.milky,
  },

  floatingInputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderRadius: 26,
    paddingLeft: 7,
    paddingRight: 6,
    height: 56,
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
  },
  floatingActionBtn: {
    marginRight: 10,
  },
  premiumInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 15,
    fontFamily: 'Inter-Medium',
    height: '100%',
    paddingHorizontal: 10,
  },
  inputActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  premiumMicBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#EEF7F2',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(19, 136, 8, 0.14)',
  },
  premiumMicBtnActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
    ...V2026.shadows.primary,
  },
  premiumSendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#063F33',
    alignItems: 'center', justifyContent: 'center',
  },
  premiumSendBtnDisabled: { backgroundColor: '#CBD5D1' },

  // Sheet
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 36, borderTopRightRadius: 36,
    paddingHorizontal: 28, paddingTop: 16,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 22 },
  sheetTitle: { fontSize: 20, fontFamily: 'Poppins-Bold', color: '#0F172A', marginBottom: 16 },
  langRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 15, paddingHorizontal: 16, borderRadius: 16, marginBottom: 6,
    backgroundColor: '#F8FAFC',
  },
  langRowOn: { backgroundColor: 'rgba(0,212,199,0.08)' },
  langRowText: { fontSize: 15, fontFamily: 'Inter-Medium', color: '#0F172A' },
  langRowTextOn: { fontFamily: 'Poppins-SemiBold', color: '#00D4C7' },
  suggestionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    justifyContent: 'center',
    width: '100%',
  },
  suggestionsRowSingle: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 10,
    width: '100%',
  },
  suggestionBtn: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  suggestionBtnText: {
    fontSize: 12,
    fontFamily: 'Inter-SemiBold',
    color: '#0F172A',
    marginLeft: 6,
  },
  fingerTrace: {
    position: 'absolute',
    zIndex: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 212, 199, 0.24)',
    borderWidth: 1,
    borderColor: 'rgba(0, 212, 199, 0.45)',
  },
  fingerTraceCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00D4C7',
  },
  topActionsHeader: {
    position: 'absolute',
    top: 44,
    left: 14,
    right: 14,
    zIndex: 120,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBrandCenter: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: -1,
  },
  headerBrandText: {
    fontSize: 18,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    letterSpacing: 0.5,
  },
  headerBrandBolt: {
    width: 20,
    height: 20,
    borderRadius: 7,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F766E',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
    transform: [{ translateY: -7 }, { rotate: '10deg' }],
    shadowColor: '#0F766E',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 3,
  },
  headerRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sessionPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
    gap: 5,
    height: 42,
  },
  actionPillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    ...V2026.shadows.milky,
    gap: 5,
    height: 42,
  },
  actionPillBtnActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
    ...V2026.shadows.primary,
  },
  newSessionBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#0F172A',
  },
  actionPillText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  actionPillTextActive: {
    color: '#FFFFFF',
  },
  sessionSheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sessionNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
  },
  sessionNewBtnText: {
    fontSize: 12,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
    marginBottom: 8,
  },
  sessionRowActive: {
    borderColor: 'rgba(0, 175, 165, 0.28)',
    backgroundColor: 'rgba(0, 175, 165, 0.06)',
  },
  sessionRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sessionBadge: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sessionBadgeTutor: {
    backgroundColor: '#0F172A',
  },
  sessionBadgeStory: {
    backgroundColor: '#138808',
  },
  sessionRowTitle: {
    fontSize: 13,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  sessionRowMeta: {
    fontSize: 11,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    marginTop: 2,
  },
  emptySessionBox: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 18,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.06)',
  },
  emptySessionText: {
    fontSize: 13,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
  },
});
