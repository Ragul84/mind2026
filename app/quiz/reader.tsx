import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, MotiText, AnimatePresence } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { supabase } from '../../utils/supabaseService';
import { SupabaseService } from '../../utils/supabaseService';
import HapticService from '../../utils/hapticService';
import { MissionQuizQuestion } from '../../utils/protocolService';
import { useAuthContext } from '@/components/AuthProvider';
import LottieView from 'lottie-react-native';
import { XPService } from '@/utils/xpService';
import UnifiedLoader from '@/components/ui/UnifiedLoader';
import RedisService from '@/utils/redisService';
import { SecureRewardsService } from '@/services/secureRewardsService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QuizMistakeNotebook } from '@/utils/quizMistakeNotebook';
import QuestionRenderer from '@/components/quiz/QuestionRenderer';
import {
  QuizEvaluation,
  QuizQuestionEnvelope,
  QuizQuestionResponse,
  normalizeQuizQuestion,
} from '@/utils/quizQuestionTypes';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const TIMER_SECONDS = 10;
const XP_PER_CORRECT = 10;
const QUICK_SPRINT_RECENT_KEY = 'quick_sprint_recent_question_ids_v1';
const QUICK_SPRINT_REDIS_KEYS = ['polity', 'history', 'geography', 'science', 'economics', 'maths', 'physics', 'chemistry', 'biology', 'english', 'tamil'];

type QuizQuestion = QuizQuestionEnvelope;

type QuizResultEntry = {
  id?: string;
  question: string;
  question_type?: string;
  options: string[];
  explanation?: string;
  is_correct: boolean;
  selected_index: number;
  correct_index: number;
  difficulty?: string;
  timed_out?: boolean;
  response_summary?: string;
  answer_summary?: string;
};

const getBetterExplanation = (question: QuizQuestion | undefined) => {
  if (!question) return '';
  const raw = String(question.explanation || '').trim();
  const q = String(question.question || '').toLowerCase();
  const generic = !raw || /use the simple interest formula/i.test(raw) || /use the formula/i.test(raw) || /review this concept again/i.test(raw);

  if (q.includes('simple interest') && /becomes\s+(\d+)\s+times?\s+in\s+(\d+)\s+years?/i.test(q)) {
    const match = q.match(/becomes\s+(\d+)\s+times?\s+in\s+(\d+)\s+years?/i);
    const times = match ? Number(match[1]) : NaN;
    const years = match ? Number(match[2]) : NaN;
    if (Number.isFinite(times) && Number.isFinite(years) && times > 1 && years > 0) {
      const simpleInterestMultiple = times - 1;
      const rate = (simpleInterestMultiple * 100) / years;
      return [
        `Simple interest means interest is added only on the original principal.`,
        `If the amount becomes ${times} times, then the interest earned is ${simpleInterestMultiple} times the principal.`,
        `Using SI = PRT/100, we get ${simpleInterestMultiple}P = P × R × ${years} / 100.`,
        `So R = ${(rate % 1 === 0 ? rate.toFixed(0) : rate.toFixed(1))}% per annum.`,
      ].join(' ');
    }
  }

  return generic ? raw || 'Review the worked steps carefully.' : raw;
};

export default function QuizPlayerScreen() {
  const { track, day, mode, topicId, subjectId, topicName, subjectName, questionCount, redisKey, difficulty, sourceType } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const normalizedTopicName = typeof topicName === 'string' ? topicName : '';
  const normalizedSubjectName = typeof subjectName === 'string' ? subjectName : '';
  
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [complete, setComplete] = useState(false);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(TIMER_SECONDS);
  const [resultEntries, setResultEntries] = useState<QuizResultEntry[]>([]);
  const [lastEvaluation, setLastEvaluation] = useState<QuizEvaluation | null>(null);
  
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const quizStartedAtRef = useRef(Date.now());

  useEffect(() => {
    loadQuestions();
  }, [track, day, mode, topicId, subjectId, redisKey]);

  const normalizeQuestions = (items: any[]): QuizQuestion[] => {
    return (items || [])
      .map((item) => normalizeQuizQuestion(item))
      .filter(Boolean)
      .map((item) => ({
        ...(item as QuizQuestionEnvelope),
        explanation: (item as QuizQuestionEnvelope).explanation || 'Perfectly explained in your study materials!',
      }));
  };

  const shuffleAndLimitQuestions = (items: QuizQuestion[], limit: number) => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, limit);
  };

  const getQuestionStableId = (question: QuizQuestion) => {
    return String(question.id || question.question || '').trim().toLowerCase();
  };

  const selectWithRecentAvoidance = async (items: QuizQuestion[], limit: number) => {
    const normalized = normalizeQuestions(items);
    const uniqueMap = new Map<string, QuizQuestion>();
    normalized.forEach((question) => {
      const key = getQuestionStableId(question);
      if (key && !uniqueMap.has(key)) uniqueMap.set(key, question);
    });
    const unique = [...uniqueMap.values()];
    let recentIds: string[] = [];
    try {
      recentIds = JSON.parse(await AsyncStorage.getItem(QUICK_SPRINT_RECENT_KEY) || '[]');
    } catch {
      recentIds = [];
    }
    const recentSet = new Set(recentIds);
    const fresh = unique.filter((question) => !recentSet.has(getQuestionStableId(question)));
    const selected = shuffleAndLimitQuestions(fresh.length >= limit ? fresh : unique, limit);
    try {
      const nextRecent = [
        ...selected.map(getQuestionStableId).filter(Boolean),
        ...recentIds,
      ].slice(0, 80);
      await AsyncStorage.setItem(QUICK_SPRINT_RECENT_KEY, JSON.stringify([...new Set(nextRecent)]));
    } catch {}
    return selected;
  };

  const loadQuickSprintQuestions = async (requestedCount: number) => {
    try {
      const perKeyCount = Math.max(4, Math.ceil((requestedCount * 3) / QUICK_SPRINT_REDIS_KEYS.length));
      const redisBatches = await Promise.all(
        QUICK_SPRINT_REDIS_KEYS.map((key) => RedisService.getQuestions(key, perKeyCount).catch(() => []))
      );
      const redisPool = redisBatches.flat() as QuizQuestion[];
      if (redisPool.length >= requestedCount) {
        return selectWithRecentAvoidance(redisPool, requestedCount);
      }
    } catch (err) {
      console.warn('[QuizReader] Quick Sprint Redis pool failed:', err);
    }

    const { data, error } = await supabase
      .from('questions')
      .select('id, question_text, options, correct_answer, explanation, difficulty')
      .eq('is_active', true)
      .limit(200);

    if (error) {
      console.error("Error loading Quick Sprint questions directly:", error);
    }

    if (data && data.length > 0) {
      return selectWithRecentAvoidance(normalizeQuestions(data), requestedCount);
    }

    const { data: vaultData } = await supabase.from('master_content_vault').select('content_json').limit(20);
    let allQuestions: MissionQuizQuestion[] = [];
    if (vaultData) {
      vaultData.forEach(item => {
        const p = typeof item.content_json === 'string' ? JSON.parse(item.content_json) : item.content_json;
        if (p?.quiz?.questions?.length) {
          allQuestions = [...allQuestions, ...p.quiz.questions];
        } else if (p?.pyq_quiz?.length) {
          allQuestions = [...allQuestions, ...p.pyq_quiz];
        }
      });
    }
    return selectWithRecentAvoidance(allQuestions as QuizQuestion[], requestedCount);
  };

  useEffect(() => {
    // Timer logic
    if (!loading && !complete && !showResult && questions.length > 0) {
      startTimer();
    }
    return () => stopTimer();
  }, [loading, complete, showResult, currentIndex, questions]);

  const startTimer = () => {
    stopTimer();
    setTimeLeft(TIMER_SECONDS);
    progressAnim.setValue(1);
    
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: TIMER_SECONDS * 1000,
      useNativeDriver: false,
    }).start();

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopTimer();
          handleTimeout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    progressAnim.stopAnimation();
  };

  const getQuestionLabel = (question?: QuizQuestion) => {
    if (!question) return 'Question';
    return String(question.question || question.question_text || question.prompt || 'Question').trim();
  };

  const handleTimeout = () => {
    const currentQ = questions[currentIndex];
    HapticService.error();
    setShowResult(true);
    setLastEvaluation({
      isCorrect: false,
      selectedIndex: -1,
      correctIndex: currentQ?.answer_index ?? 0,
      responseSummary: 'Timed out',
      answerSummary: currentQ?.options?.[currentQ?.answer_index ?? 0] || '',
    });
    if (currentQ) {
      setResultEntries((prev) => [
        ...prev,
        {
          question: getQuestionLabel(currentQ),
          id: currentQ.id,
          question_type: currentQ.question_type,
          options: currentQ.options || [],
          explanation: currentQ.explanation,
          is_correct: false,
          selected_index: -1,
          correct_index: currentQ.answer_index ?? 0,
          difficulty: currentQ.difficulty,
          timed_out: true,
          response_summary: 'Timed out',
          answer_summary: currentQ.options?.[currentQ.answer_index ?? 0] || '',
        },
      ]);
    }
  };

  const loadQuestions = async () => {
    try {
      setLoading(true);
      setCurrentIndex(0);
      setShowResult(false);
      setComplete(false);
      setScore(0);
      setResultEntries([]);
      setLastEvaluation(null);
      quizStartedAtRef.current = Date.now();
      const requestedCount = Number(questionCount || (mode === 'quick-sprint' ? 15 : 15)) || 15;

      // 0. Redis path — used by Quiz Hub (always preferred)
      if (redisKey) {
        const key = typeof redisKey === 'string' ? redisKey : redisKey[0];
        const diff = typeof difficulty === 'string' && difficulty ? difficulty : undefined;
        const qs = await RedisService.getQuestions(key, requestedCount, diff, typeof sourceType === 'string' ? sourceType : undefined);
        setQuestions(qs as QuizQuestion[]);
        return;
      }

      // 1. Topic/Subject Database Fetch (legacy Supabase)
      if (topicId || subjectId) {
        if (topicId) {
          const subtopics = await SupabaseService.getSubtopicsByTopic(String(topicId));
          const subtopicIds = subtopics.map((subtopic: any) => subtopic.id).filter(Boolean);

          let topicQuestions: any[] = [];

          if (subtopicIds.length > 0) {
            const { data, error } = await supabase
              .from('questions')
              .select('question_text, question, options, correct_answer, explanation')
              .in('subtopic_id', subtopicIds)
              .eq('is_active', true)
              .limit(Math.max(requestedCount * 2, 20));

            if (error) throw error;
            topicQuestions = data || [];
          }

          if (topicQuestions.length === 0 && subjectId) {
            const subjectQuestions = await SupabaseService.getQuestionsBySubject(String(subjectId), Math.max(requestedCount * 2, 20));
            setQuestions(shuffleAndLimitQuestions(normalizeQuestions(subjectQuestions), requestedCount));
          } else {
            setQuestions(shuffleAndLimitQuestions(normalizeQuestions(topicQuestions), requestedCount));
          }
        } else if (subjectId) {
          const subjectQuestions = await SupabaseService.getQuestionsBySubject(String(subjectId), Math.max(requestedCount * 2, 20));
          setQuestions(shuffleAndLimitQuestions(normalizeQuestions(subjectQuestions), requestedCount));
        }
      } 
      // 2. Quick Sprint (Direct Supabase random questions fetch)
      else if (mode === 'quick-sprint') {
        setQuestions(await loadQuickSprintQuestions(requestedCount));
      } 
      // 3. Track/Topic (Vault Fetch)
      else if (track && (day || topicName)) {
        try {
          let query = supabase
            .from('master_content_vault')
            .select('content_json, topic_title')
            .eq('track_id', track);
          
          if (day) {
            query = query.eq('day_number', day);
          } else if (topicName) {
            query = query.eq('topic_title', topicName);
          }

          let { data, error } = await query.limit(1).maybeSingle();
          
          // Fuzzy matching fallback if exact topicName match fails
          if (!data && !day && topicName) {
            console.log(`🔍 [QuizReader] Exact match failed for "${topicName}", trying fuzzy...`);
            const { data: fuzzyData } = await supabase
              .from('master_content_vault')
              .select('content_json, topic_title')
              .eq('track_id', track)
              .ilike('topic_title', `%${topicName}%`)
              .limit(1)
              .maybeSingle();
            
            if (fuzzyData) {
              console.log(`✅ [QuizReader] Fuzzy match found: "${fuzzyData.topic_title}"`);
              data = fuzzyData;
            }
          }

          if (error) {
            console.error('Error fetching topic-vault:', error);
          }

          if (data) {
            const p = typeof data.content_json === 'string' ? JSON.parse(data.content_json) : data.content_json;
            if (p?.quiz?.questions) setQuestions(shuffleAndLimitQuestions(p.quiz.questions, requestedCount));
            else if (p?.pyq_quiz) setQuestions(shuffleAndLimitQuestions(p.pyq_quiz, requestedCount));
          } else {
            console.warn('No vault data found for:', { track, day, topicName });
          }
        } catch (err) {
          console.error('Vault fetch exception:', err);
        }
      }
    } catch (e) {
      console.warn('Error loading quiz', e);
    } finally {
      setLoading(false);
    }
  };

  const handleMoreQuizzes = async () => {
    HapticService.selection();
    await loadQuestions();
  };

  const handleAnswerSubmission = (evaluation: QuizEvaluation, _response: QuizQuestionResponse) => {
    if (showResult) return;
    stopTimer();
    setShowResult(true);
    setLastEvaluation(evaluation);

    if (evaluation.isCorrect) {
      HapticService.success();
      setScore((s) => s + 1);
    } else {
      HapticService.error();
    }

    const currentQ = questions[currentIndex];
    if (currentQ) {
      setResultEntries((prev) => [
        ...prev,
        {
          question: getQuestionLabel(currentQ),
          id: currentQ.id,
          question_type: currentQ.question_type,
          options: currentQ.options || [],
          explanation: currentQ.explanation,
          is_correct: evaluation.isCorrect,
          selected_index: typeof evaluation.selectedIndex === 'number' ? evaluation.selectedIndex : -1,
          correct_index: typeof evaluation.correctIndex === 'number' ? evaluation.correctIndex : (currentQ.answer_index ?? 0),
          difficulty: currentQ.difficulty,
          response_summary: evaluation.responseSummary,
          answer_summary: evaluation.answerSummary,
        },
      ]);
    }

    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 150);
  };

  const handleNext = async () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setShowResult(false);
      setLastEvaluation(null);
    } else {
      finishQuiz();
    }
  };

  const finishQuiz = async () => {
    setComplete(true);
    const xpEarned = score * XP_PER_CORRECT;
    const totalTimeSeconds = Math.max(1, Math.floor((Date.now() - quizStartedAtRef.current) / 1000));
    const finalScorePercentage = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
    const weakAreas = resultEntries
      .filter((entry) => !entry.is_correct)
      .map((entry) => entry.difficulty || 'revision')
      .filter(Boolean);
    const strongAreas = resultEntries
      .filter((entry) => entry.is_correct)
      .map((entry) => entry.difficulty || 'core')
      .filter(Boolean);

    if (user) {
      try {
        const quizClaimId = [
          mode === 'quick-sprint' ? 'quick-sprint' : 'quiz',
          typeof topicId === 'string' ? topicId : 'general',
          quizStartedAtRef.current,
        ].join(':');

        const rewardResult = await SecureRewardsService.adjustBalance({
          amount: xpEarned,
          reason: 'quiz_completion',
          claimKey: SecureRewardsService.claimKey(['quiz-reader', user.id, quizClaimId]),
          metadata: {
            quizType: mode === 'quick-sprint' ? 'quick-sprint' : 'topic',
            topicId: typeof topicId === 'string' ? topicId : undefined,
            score,
            totalQuestions: questions.length,
            xpEarned,
          },
        });

        if (!rewardResult.success) {
          console.warn('Secure quiz XP award failed:', rewardResult.error);
        }

        try {
          await SupabaseService.ensureDailyStreak(user.id);
          await AsyncStorage.setItem('mindgains:stats_dirty_at', String(Date.now()));
        } catch (streakError) {
          console.warn('Quiz streak refresh failed:', streakError);
        }

        // 2. Record quiz history
        await XPService.recordQuizHistory(user.id, {
          quizType: mode === 'quick-sprint' ? 'quick-sprint' : 'topic',
          score,
          totalQuestions: questions.length,
          timeTaken: totalTimeSeconds,
          subjectName: normalizedSubjectName || undefined,
          topicId: typeof topicId === 'string' ? topicId : undefined,
        }, xpEarned);

        if (typeof topicId === 'string' && topicId) {
          await supabase
            .from('user_topic_progress')
            .upsert({
              user_id: user.id,
              topic_id: topicId,
              questions_attempted: questions.length,
              questions_correct: score,
              best_score: finalScorePercentage,
              total_time_spent: totalTimeSeconds,
              last_attempted: new Date().toISOString(),
              proficiency_level: finalScorePercentage >= 90
                ? 'expert'
                : finalScorePercentage >= 75
                  ? 'advanced'
                  : finalScorePercentage >= 60
                    ? 'intermediate'
                    : 'beginner',
              weak_areas: [...new Set(weakAreas)],
              strong_areas: [...new Set(strongAreas)],
              updated_at: new Date().toISOString(),
            }, {
              onConflict: 'user_id,topic_id',
            });
        }

        if (normalizedTopicName && normalizedSubjectName) {
          await SupabaseService.updateUserMemory(user.id, normalizedTopicName, normalizedSubjectName, {
            score: finalScorePercentage,
            correctAnswers: score,
            totalQuestions: questions.length,
            weakAreas: [...new Set(weakAreas)],
            strongAreas: [...new Set(strongAreas)],
            difficulty: 'mixed',
          });
        }
      } catch (e) {
        console.warn('Failed to persist quiz progress', e);
      }
    }
  };

  const openMistakeRevision = async () => {
    const mistakes = resultEntries.filter((entry) => !entry.is_correct);
    if (!mistakes.length) return;
    const sessionId = `mistakes_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    await QuizMistakeNotebook.saveSession({
      userId: user?.id,
      sessionId,
      sourceType: mode === 'quick-sprint' ? 'quick-sprint' : 'quiz',
      title: mode === 'quick-sprint' ? 'Quick Sprint mistakes' : `${normalizedTopicName || normalizedSubjectName || 'Quiz'} mistakes`,
      mistakes,
    });
    router.push({ pathname: '/quiz/revise', params: { sessionId } } as any);
  };

  if (loading) {
    return <UnifiedLoader context="quiz" message="Loading your quiz…" />;
  }

  if (questions.length === 0) {
    return (
      <View style={[styles.container, styles.center]}>
        <Ionicons name="help-circle-outline" size={52} color="#CBD5E1" />
        <Text style={styles.loadingText}>No questions found for this topic.</Text>
        <TouchableOpacity style={styles.exitBtn} activeOpacity={0.8} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}>
          <Text style={styles.exitBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (complete) {
    const xpEarned = score * XP_PER_CORRECT;
    const weakCount = resultEntries.filter((entry) => !entry.is_correct).length;
    const pct = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;
    return (
      <View style={styles.container}>
        {/* Confetti */}
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 10, pointerEvents: 'none' }]}>
          <LottieView
            source={require('../../assets/animations/confetti.json')}
            autoPlay loop={false}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
        </View>

        <View style={[styles.completeCenter, { paddingTop: insets.top + 16 }]}>
          <MotiView
            from={{ opacity: 0, scale: 0.88, translateY: 24 }}
            animate={{ opacity: 1, scale: 1, translateY: 0 }}
            transition={{ type: 'spring', damping: 16, stiffness: 140 }}
            style={styles.completedCard}
          >
            {/* Trophy ring */}
            <View style={styles.trophyRing}>
              <View style={styles.trophyInner}>
                <Ionicons name="trophy" size={40} color="#F59E0B" />
              </View>
            </View>

            <Text style={styles.completedTitle}>Quiz Complete!</Text>

            {/* Score ring */}
            <View style={styles.scoreRow}>
              <View style={styles.scoreStat}>
                <Text style={styles.scoreStatNum}>{score}</Text>
                <Text style={styles.scoreStatLabel}>Correct</Text>
              </View>
              <View style={styles.scoreStatDivider} />
              <View style={styles.scoreStat}>
                <Text style={[styles.scoreStatNum, { color: '#F59E0B' }]}>{pct}%</Text>
                <Text style={styles.scoreStatLabel}>Score</Text>
              </View>
              <View style={styles.scoreStatDivider} />
              <View style={styles.scoreStat}>
                <Text style={[styles.scoreStatNum, { color: weakCount > 0 ? '#EF4444' : '#10B981' }]}>{weakCount}</Text>
                <Text style={styles.scoreStatLabel}>Missed</Text>
              </View>
            </View>

            {/* XP chip */}
            <View style={styles.xpBadge}>
              <Ionicons name="flash" size={15} color="#00D4C7" />
              <Text style={styles.xpText}>+{xpEarned} XP earned</Text>
            </View>

            {weakCount > 0 && (
              <TouchableOpacity style={styles.reviseMistakesBtn} activeOpacity={0.85} onPress={openMistakeRevision}>
                <Ionicons name="book-outline" size={16} color="#475569" />
                <Text style={styles.reviseMistakesText}>Review mistakes</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={styles.moreQuizzesBtn} activeOpacity={0.85} onPress={handleMoreQuizzes}>
              <LinearGradient colors={['#0EA5E9', '#00D4C7']} style={styles.moreQuizzesGrad} start={{x:0,y:0}} end={{x:1,y:1}}>
                <Ionicons name="refresh" size={16} color="#FFFFFF" />
                <Text style={styles.moreQuizzesText}>More quizzes</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtn} activeOpacity={0.9}
              onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}>
              <LinearGradient colors={['#00D4C7', '#0EA5E9']} style={styles.actionGradient} start={{x:0,y:0}} end={{x:1,y:1}}>
                <Text style={styles.actionBtnText}>Done</Text>
              </LinearGradient>
            </TouchableOpacity>
          </MotiView>
        </View>
      </View>
    );
  }

  const currentQ = questions[currentIndex];
  
  // Interpolations for timer
  const timerWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });
  const timerColor = progressAnim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: ['#F43F5E', '#F59E0B', '#00D4C7'],
  });

  return (
    <View style={styles.container}>
      {/* Soft ambient tint */}
      <View style={styles.ambientTint1} pointerEvents="none" />
      <View style={styles.ambientTint2} pointerEvents="none" />

      {/* ── HEADER ── */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/home')}
          style={styles.circleClose}
        >
          <Ionicons name="close" size={18} color="#475569" />
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitleSmall} numberOfLines={1}>
            {mode === 'quick-sprint' ? 'Quick Sprint' : (topicName || subjectName || 'Quiz')}
          </Text>
          <Text style={styles.stepIndicator}>{currentIndex + 1} / {questions.length}</Text>
        </View>

        <View style={styles.scoreBadgeV2}>
          <Ionicons name="flame" size={14} color="#F59E0B" />
          <Text style={styles.scoreTextV2}>{score}</Text>
        </View>
      </View>

      {/* ── TIMER BAR ── */}
      <View style={styles.timerTrackV2}>
        <Animated.View style={[styles.timerFillV2, { width: timerWidth, backgroundColor: timerColor }]} />
      </View>

      {/* ── QUESTION + OPTIONS ── */}
      <MotiView
        key={currentIndex}
        from={{ opacity: 0, translateY: 12 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 300 }}
        style={styles.questionSection}
      >
        {/* Question card */}
        <View style={styles.questionCard}>
          <View style={styles.questionNumRow}>
            <Text style={styles.questionNumText}>Q{currentIndex + 1}</Text>
            {currentQ.difficulty && (
              <View style={[
                styles.diffChip,
                currentQ.difficulty === 'easy' && { backgroundColor: 'rgba(16,185,129,0.1)' },
                currentQ.difficulty === 'medium' && { backgroundColor: 'rgba(245,158,11,0.1)' },
                currentQ.difficulty === 'hard' && { backgroundColor: 'rgba(239,68,68,0.1)' },
              ]}>
                <Text style={[
                  styles.diffChipText,
                  currentQ.difficulty === 'easy' && { color: '#10B981' },
                  currentQ.difficulty === 'medium' && { color: '#F59E0B' },
                  currentQ.difficulty === 'hard' && { color: '#EF4444' },
                ]}>{currentQ.difficulty}</Text>
              </View>
            )}
          </View>
          <Text style={styles.questionTextV2}>{currentQ.question}</Text>
        </View>

        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.optionsListV2}
          showsVerticalScrollIndicator={false}
        >
          <QuestionRenderer
            question={currentQ}
            revealAnswer={showResult}
            onSubmit={handleAnswerSubmission}
          />

          {/* ── EXPLANATION PANEL ── */}
          {showResult && (
            <MotiView
              from={{ opacity: 0, translateY: 16 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 280 }}
              style={styles.explanationPanel}
            >
              <View style={styles.explanationHeader}>
                <Ionicons name="bulb-outline" size={15} color="#00B8B0" />
                <Text style={styles.explanationLabel}>Explanation</Text>
              </View>
              {(() => {
                const explanation = getBetterExplanation(currentQ);
                const fallback = lastEvaluation?.isCorrect
                  ? 'Correct!'
                  : lastEvaluation?.answerSummary
                    ? `The correct answer is ${lastEvaluation.answerSummary}`
                    : currentQ.answer_index !== undefined && currentQ.options?.[currentQ.answer_index]
                      ? `The correct answer is ${String.fromCharCode(65 + currentQ.answer_index)}: ${currentQ.options[currentQ.answer_index || 0]}`
                      : 'Review the lesson again for the correct pattern.';
                return <Text style={styles.explanationText}>{explanation || fallback}</Text>;
              })()}

              <TouchableOpacity style={styles.nextBtn} activeOpacity={0.9} onPress={handleNext}>
                <LinearGradient
                  colors={['#00D4C7', '#0EA5E9']}
                  style={styles.nextGradient}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                >
                  <Text style={styles.nextBtnText}>
                    {currentIndex === questions.length - 1 ? 'Finish' : 'Next Question'}
                  </Text>
                  <Ionicons name="arrow-forward" size={16} color="#FFF" />
                </LinearGradient>
              </TouchableOpacity>
            </MotiView>
          )}
        </ScrollView>
      </MotiView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Ambient tints (soft colour wash, no dark)
  ambientTint1: {
    position: 'absolute', top: -120, right: -120,
    width: 280, height: 280, borderRadius: 140,
    backgroundColor: 'rgba(0,212,199,0.07)',
  },
  ambientTint2: {
    position: 'absolute', bottom: -80, left: -80,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(14,165,233,0.06)',
  },

  // ── HEADER ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  circleClose: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#F8FAFC',
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: '#E8EEF6',
  },
  headerInfo: { flex: 1 },
  headerTitleSmall: {
    fontSize: 13, fontFamily: 'Poppins-Bold',
    color: '#1E293B',
  },
  stepIndicator: {
    fontSize: 11, fontFamily: 'Inter-Medium',
    color: '#94A3B8', marginTop: 1,
  },
  scoreBadgeV2: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FEF9EC',
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 20, gap: 4,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  scoreTextV2: {
    color: '#D97706', fontSize: 13,
    fontFamily: 'Poppins-Bold',
  },

  // ── TIMER ──
  timerTrackV2: {
    height: 4,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 16,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: 16,
  },
  timerFillV2: { height: '100%', borderRadius: 2 },

  // ── QUESTION ──
  questionSection: { flex: 1, paddingHorizontal: 16 },
  questionCard: {
    backgroundColor: '#F8FAFF',
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E8EEFF',
  },
  questionNumRow: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 10, gap: 8,
  },
  questionNumText: {
    fontSize: 11, fontFamily: 'Poppins-Bold',
    color: '#00B8B0', letterSpacing: 0.5,
  },
  diffChip: {
    paddingHorizontal: 8, paddingVertical: 2,
    borderRadius: 20,
  },
  diffChipText: { fontSize: 10, fontFamily: 'Poppins-Bold' },
  questionTextV2: {
    fontSize: 17, fontFamily: 'Poppins-SemiBold',
    color: '#0F172A', lineHeight: 26,
  },

  // ── OPTIONS ──
  optionsListV2: { gap: 9, paddingBottom: 36 },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    gap: 12,
  },
  optionAlpha: {
    width: 30, height: 30, borderRadius: 9,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  optionAlphaText: {
    fontSize: 13, fontFamily: 'Poppins-Bold',
  },
  optionText: {
    fontSize: 14, fontFamily: 'Inter-Medium',
    flex: 1, lineHeight: 21,
  },

  // ── EXPLANATION ──
  explanationPanel: {
    backgroundColor: '#F0FDFC',
    borderRadius: 16,
    padding: 16,
    marginTop: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#00D4C7',
  },
  explanationHeader: {
    flexDirection: 'row', alignItems: 'center',
    marginBottom: 8, gap: 6,
  },
  explanationLabel: {
    fontSize: 12, fontFamily: 'Poppins-SemiBold',
    color: '#00B8B0',
  },
  explanationText: {
    fontSize: 13, fontFamily: 'Inter-Medium',
    color: '#475569', lineHeight: 20,
    marginBottom: 14,
  },
  nextBtn: { borderRadius: 12, overflow: 'hidden', marginTop: 4 },
  nextGradient: {
    flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 13, gap: 8,
  },
  nextBtnText: {
    fontSize: 14, fontFamily: 'Poppins-Bold',
    color: '#FFFFFF', letterSpacing: 0.3,
  },

  // ── COMPLETION ──
  completeCenter: { flex: 1, justifyContent: 'center', padding: 20 },
  completedCard: {
    backgroundColor: '#FFFFFF',
    padding: 28, borderRadius: 28,
    alignItems: 'center',
    borderWidth: 1, borderColor: '#E8EEFF',
  },
  trophyRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#FFFBEB',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2, borderColor: '#FDE68A',
  },
  trophyInner: { justifyContent: 'center', alignItems: 'center' },
  completedTitle: {
    fontSize: 22, fontFamily: 'Poppins-Bold',
    color: '#0F172A', marginBottom: 20,
  },
  scoreRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F8FAFF',
    borderRadius: 16, padding: 14,
    width: '100%', marginBottom: 18,
  },
  scoreStat: { flex: 1, alignItems: 'center' },
  scoreStatNum: {
    fontSize: 22, fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  scoreStatLabel: {
    fontSize: 11, fontFamily: 'Inter-Medium',
    color: '#94A3B8', marginTop: 2,
  },
  scoreStatDivider: {
    width: 1, height: 36, backgroundColor: '#E2E8F0',
  },
  xpBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#F0FDFC',
    paddingHorizontal: 16, paddingVertical: 9,
    borderRadius: 20, gap: 6, marginBottom: 16,
    borderWidth: 1, borderColor: '#CCFBF1',
  },
  xpText: {
    fontSize: 13, fontFamily: 'Poppins-Bold',
    color: '#0D9488',
  },
  reviseMistakesBtn: {
    width: '100%', flexDirection: 'row',
    alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 14,
    backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  reviseMistakesText: {
    fontSize: 13, fontFamily: 'Poppins-SemiBold',
    color: '#475569',
  },
  moreQuizzesBtn: {
    width: '100%',
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: 10,
  },
  moreQuizzesGrad: {
    minHeight: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  moreQuizzesText: {
    fontSize: 14,
    fontFamily: 'Poppins-Bold',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  actionBtn: { width: '100%' },
  actionGradient: {
    paddingVertical: 15, borderRadius: 14,
    alignItems: 'center',
  },
  actionBtnText: {
    fontSize: 15, fontFamily: 'Poppins-Bold',
    color: '#FFFFFF', letterSpacing: 0.5,
  },

  // misc
  loadingText: {
    marginTop: 16, color: '#64748B',
    fontFamily: 'Inter-Medium', fontSize: 14,
  },
  exitBtn: {
    marginTop: 20, paddingHorizontal: 28,
    paddingVertical: 12, backgroundColor: '#F1F5F9',
    borderRadius: 14,
  },
  exitBtnText: {
    color: '#475569', fontFamily: 'Poppins-SemiBold', fontSize: 13,
  },
});
