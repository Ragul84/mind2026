import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { FontAwesome5, Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { UnifiedLoader } from '@/components/ui/UnifiedLoader';
import { HapticService } from '@/utils/hapticService';
import { QuizExam, QuizSubject, QuizTopic, RedisService } from '@/utils/redisService';

type Step = 'exam' | 'subject' | 'topic';

const DIFF_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  easy: { label: 'Easy', color: '#10B981', bg: 'rgba(16,185,129,0.1)' },
  medium: { label: 'Medium', color: '#D97706', bg: 'rgba(245,158,11,0.12)' },
  hard: { label: 'Hard', color: '#DC2626', bg: 'rgba(239,68,68,0.1)' },
};

const SUBJECT_PALETTES = [
  { strong: '#0F766E', soft: '#CCFBF1' },
  { strong: '#2563EB', soft: '#DBEAFE' },
  { strong: '#D97706', soft: '#FEF3C7' },
  { strong: '#7C3AED', soft: '#EDE9FE' },
  { strong: '#DC2626', soft: '#FEE2E2' },
  { strong: '#15803D', soft: '#DCFCE7' },
  { strong: '#C2410C', soft: '#FFEDD5' },
  { strong: '#475569', soft: '#E2E8F0' },
] as const;

function FadeItem({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <MotiView
      from={{ opacity: 0, translateY: 10 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 220, delay: index * 30 }}
    >
      {children}
    </MotiView>
  );
}

export default function QuizHub() {
  const router = useRouter();
  const params = useLocalSearchParams<{ exam?: string; subject?: string }>();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('exam');
  const [exam, setExam] = useState<QuizExam | null>(null);
  const [subject, setSubject] = useState<QuizSubject | null>(null);
  const [exams, setExams] = useState<QuizExam[]>([]);
  const [subjects, setSubjects] = useState<(QuizSubject & { topicCount?: number })[]>([]);
  const [topics, setTopics] = useState<QuizTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [subLoading, setSubLoading] = useState(false);
  const breadcrumbOpacity = useRef(new Animated.Value(0)).current;
  // Deep-link (from the home Quick Practice carousel): jump straight to a subject.
  const deepLinkedRef = useRef(false);
  const pendingSubjectRef = useRef<string | null>(null);

  useEffect(() => {
    Animated.timing(breadcrumbOpacity, {
      toValue: exam ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [breadcrumbOpacity, exam]);

  useEffect(() => {
    let mounted = true;
    RedisService.getExams()
      .then((data) => {
        if (mounted) setExams(data);
      })
      .catch((error) => console.warn('[QuizHub] Failed to load exams:', error))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleSelectExam = useCallback(async (nextExam: QuizExam) => {
    HapticService.selection();
    setExam(nextExam);
    setSubject(null);
    setStep('subject');
    setSubLoading(true);
    try {
      const data = await RedisService.getSubjects(nextExam.id);
      const dataWithCounts = await Promise.all(
        data.map(async (item) => {
          const topicList = await RedisService.getTopics(nextExam.id, item.id);
          return { ...item, topicCount: topicList.length };
        }),
      );
      setSubjects(dataWithCounts);
    } catch (error) {
      console.warn('[QuizHub] Failed to load subjects:', error);
    } finally {
      setSubLoading(false);
    }
  }, []);

  const handleSelectSubject = useCallback(async (nextSubject: QuizSubject) => {
    if (!exam) return;
    HapticService.selection();
    setSubject(nextSubject);
    setStep('topic');
    setSubLoading(true);
    try {
      const topicList = await RedisService.getTopics(exam.id, nextSubject.id);
      const topicsWithCounts = await Promise.all(
        topicList.map(async (topic) => {
          const isSchoolExam = exam.id === 'ncert' || exam.id === 'samacheer';
          const subjectKey = isSchoolExam
            ? (topic.redisKey ?? topic.id)
            : (nextSubject.redisKey ?? topic.redisKey ?? topic.id);
          const finalKey = isSchoolExam
            ? `${subjectKey}:${exam.id}:${nextSubject.id}`
            : `${subjectKey}:${exam.id}:${topic.id}`;
          const questionCount = await RedisService.getQuestionCount(finalKey);
          return {
            ...topic,
            questionCount: questionCount > 0 ? questionCount : topic.questionCount,
          };
        }),
      );
      setTopics(topicsWithCounts);
    } catch (error) {
      console.warn('[QuizHub] Failed to load topics:', error);
    } finally {
      setSubLoading(false);
    }
  }, [exam]);

  // Once exams are loaded, if we arrived with ?exam=&subject=, select the exam
  // and remember the subject to pick as soon as that exam's subjects load.
  useEffect(() => {
    if (deepLinkedRef.current || loading || !exams.length) return;
    const exId = String(params.exam || '');
    const subId = String(params.subject || '');
    if (!exId || !subId) return;
    const targetExam = exams.find((e) => e.id === exId);
    if (!targetExam) return;
    deepLinkedRef.current = true;
    pendingSubjectRef.current = subId;
    void handleSelectExam(targetExam);
  }, [loading, exams, params.exam, params.subject, handleSelectExam]);

  // When the deep-linked exam's subjects arrive, advance into the subject.
  useEffect(() => {
    const subId = pendingSubjectRef.current;
    if (!subId || !exam || !subjects.length) return;
    const targetSub = subjects.find((s) => s.id === subId);
    pendingSubjectRef.current = null;
    if (targetSub) void handleSelectSubject(targetSub);
  }, [subjects, exam, handleSelectSubject]);

  const handleSelectTopic = useCallback((topic: QuizTopic) => {
    HapticService.medium();
    const isSchoolExam = exam?.id === 'ncert' || exam?.id === 'samacheer';
    const subjectKey = isSchoolExam
      ? (topic.redisKey ?? topic.id)
      : (subject?.redisKey ?? topic.redisKey ?? topic.id);
    const isFullRedisKey = String(subjectKey).startsWith('quiz:subject:');
    const finalKey = isSchoolExam
      ? (isFullRedisKey ? subjectKey : `${subjectKey}:${exam?.id}:${subject?.id}`)
      : `${subjectKey}:${exam?.id}:${topic.id}`;

    router.push({
      pathname: '/quiz/reader',
      params: {
        topicName: topic.name,
        subjectName: subject?.name,
        redisKey: finalKey,
        questionCount: String(topic.questionCount ?? 25),
        difficulty: topic.difficulty ?? '',
        sourceType: topic.sourceType ?? '',
      },
    });
  }, [exam, router, subject]);

  const goBack = useCallback(() => {
    HapticService.selection();
    if (step === 'topic') {
      setStep('subject');
      setTopics([]);
      setSubject(null);
    } else if (step === 'subject') {
      setStep('exam');
      setSubjects([]);
      setExam(null);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)');
    }
  }, [router, step]);

  const isSchool = exam?.id === 'ncert' || exam?.id === 'samacheer';
  const accentColor = exam?.color ?? '#00AFA5';
  const stepLabel =
    step === 'exam'
      ? 'Choose your exam'
      : step === 'subject'
        ? (isSchool ? 'Choose your class' : 'Choose a subject')
        : (isSchool ? `${subject?.name} · Choose a topic` : 'Choose a topic');
  const stepCopy =
    step === 'exam'
      ? 'Pick your exam, subject and topic.'
      : step === 'subject'
        ? (isSchool ? 'Your class sets the syllabus and question level.' : `Explore the complete ${exam?.name ?? ''} syllabus.`)
        : 'Tap a topic to start.';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.bandTop} pointerEvents="none" />
      <View style={styles.bandMiddle} pointerEvents="none" />
      <View style={styles.bandBottom} pointerEvents="none" />

      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <View style={styles.headerSurface}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn} activeOpacity={0.7}>
            <Ionicons name="arrow-back" size={19} color="#0F172A" />
          </TouchableOpacity>
          <View style={styles.headerMid}>
            <Text style={styles.headerTitle}>Quiz Hub</Text>
            {exam ? (
              <Animated.View style={{ opacity: breadcrumbOpacity }}>
                <Text style={[styles.breadcrumbText, { color: accentColor }]} numberOfLines={1}>
                  {exam.name}{subject ? ` / ${subject.name}` : ''}
                </Text>
              </Animated.View>
            ) : (
              <Text style={styles.headerSub}>Practice library</Text>
            )}
          </View>
          <View style={styles.headerMark}>
            <Ionicons name="sparkles" size={17} color="#FFFFFF" />
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scrollFlex}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {loading ? (
          <UnifiedLoader context="quiz" message="Loading quiz hub..." />
        ) : (
          <MotiView key={step} from={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 180 }}>
            <View style={styles.intro}>
              <Text style={styles.introTitle}>{stepLabel}</Text>
              <Text style={styles.introCopy}>{stepCopy}</Text>
            </View>

            {step === 'exam' && (
              <View style={styles.examList}>
                {exams.map((item, index) => (
                  <FadeItem key={item.id} index={index}>
                    <TouchableOpacity
                      style={[styles.examCard, { borderBottomColor: `${item.color}4D` }]}
                      onPress={() => handleSelectExam(item)}
                      activeOpacity={0.76}
                    >
                      <View style={[styles.examIconWrap, { backgroundColor: `${item.color}16` }]}>
                        <FontAwesome5 name={item.icon} size={19} color={item.color} />
                      </View>
                      <View style={styles.examBody}>
                        <Text style={styles.examName}>{item.name}</Text>
                        <Text style={styles.examDesc} numberOfLines={2}>{item.desc}</Text>
                      </View>
                      <View style={styles.examArrow}>
                        <Ionicons name="chevron-forward" size={18} color="#64748B" />
                      </View>
                    </TouchableOpacity>
                  </FadeItem>
                ))}
              </View>
            )}

            {step === 'subject' && (
              <View style={isSchool ? styles.classGrid : styles.subjectList}>
                {subLoading ? (
                  <UnifiedLoader context="quiz" message="Loading subjects..." />
                ) : subjects.map((item, index) => {
                  const palette = SUBJECT_PALETTES[index % SUBJECT_PALETTES.length];
                  const classNumber = item.name.match(/\d+/)?.[0];
                  return (
                    <FadeItem key={item.id} index={index}>
                      <TouchableOpacity
                        style={[
                          isSchool ? styles.classTile : styles.subjectRow,
                          { borderBottomColor: `${palette.strong}40` },
                        ]}
                        onPress={() => handleSelectSubject(item)}
                        activeOpacity={0.76}
                      >
                        {isSchool ? (
                          <>
                            <LinearGradient
                              colors={['#FFFFFF', palette.soft, '#FFFFFF']}
                              style={StyleSheet.absoluteFillObject}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                            />
                            <Text style={[styles.classNumber, { color: palette.strong }]}>{classNumber}</Text>
                            <Text style={styles.classLabel}>CLASS</Text>
                            <View style={styles.classFooter}>
                              <Text style={styles.classMeta}>Open syllabus</Text>
                              <Ionicons name="arrow-forward" size={15} color={palette.strong} />
                            </View>
                          </>
                        ) : (
                          <>
                            <View style={[styles.subjectIcon, { backgroundColor: palette.soft }]}>
                              <FontAwesome5 name={item.icon} size={17} color={palette.strong} />
                            </View>
                            <View style={styles.subjectBody}>
                              <Text style={styles.subjectName}>{item.name}</Text>
                              {typeof item.topicCount === 'number' && item.topicCount > 0 && (
                                <Text style={styles.subjectMeta}>{item.topicCount} topics</Text>
                              )}
                            </View>
                            <View style={styles.rowChevron}>
                              <Ionicons name="chevron-forward" size={18} color="#64748B" />
                            </View>
                          </>
                        )}
                      </TouchableOpacity>
                    </FadeItem>
                  );
                })}
              </View>
            )}

            {step === 'topic' && (
              <View style={styles.topicList}>
                {subLoading ? (
                  <UnifiedLoader context="quiz" message="Loading topics..." />
                ) : topics.length === 0 ? (
                  <View style={styles.emptyState}>
                    <View style={styles.emptyIcon}>
                      <Ionicons name="folder-open-outline" size={30} color="#64748B" />
                    </View>
                    <Text style={styles.emptyText}>No topics found</Text>
                  </View>
                ) : topics.map((item, index) => {
                  const diff = item.difficulty ? DIFF_CONFIG[item.difficulty] : null;
                  const palette = SUBJECT_PALETTES[index % SUBJECT_PALETTES.length];
                  const locked = !!item.comingSoon;
                  return (
                    <FadeItem key={item.id} index={index}>
                      <TouchableOpacity
                        style={[
                          styles.topicRow,
                          { borderBottomColor: `${palette.strong}40` },
                          locked && { opacity: 0.5 },
                        ]}
                        onPress={() => { if (!locked) handleSelectTopic(item); }}
                        activeOpacity={locked ? 1 : 0.76}
                        disabled={locked}
                      >
                        <View style={[styles.topicIcon, { backgroundColor: palette.soft }]}>
                          <Ionicons name="reader-outline" size={18} color={palette.strong} />
                        </View>
                        <View style={styles.topicLeft}>
                          <Text style={styles.topicName} numberOfLines={2}>{item.name}</Text>
                          <View style={styles.topicMeta}>
                            {locked ? (
                              <View style={[styles.diffBadge, { backgroundColor: '#F1F5F9' }]}>
                                <Text style={[styles.diffText, { color: '#64748B' }]}>Coming soon</Text>
                              </View>
                            ) : (
                              <>
                                {typeof item.questionCount === 'number' && item.questionCount > 0 && (
                                  <Text style={styles.topicSource}>{item.questionCount} questions</Text>
                                )}
                                {diff && (
                                  <View style={[styles.diffBadge, { backgroundColor: diff.bg }]}>
                                    <Text style={[styles.diffText, { color: diff.color }]}>{diff.label}</Text>
                                  </View>
                                )}
                              </>
                            )}
                          </View>
                        </View>
                        {!locked && (
                          <View style={[styles.playBtn, { backgroundColor: palette.strong }]}>
                            <Ionicons name="play" size={12} color="#FFFFFF" style={{ marginLeft: 2 }} />
                          </View>
                        )}
                      </TouchableOpacity>
                    </FadeItem>
                  );
                })}
              </View>
            )}
          </MotiView>
        )}
      </ScrollView>
      <View style={[styles.bottomGuard, { height: Math.max(insets.bottom, 16) }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  bandTop: {
    position: 'absolute', top: -105, left: -45, right: -45, height: 215,
    backgroundColor: 'rgba(255,153,51,0.075)', transform: [{ rotate: '-7deg' }],
  },
  bandMiddle: {
    position: 'absolute', top: '38%', left: -60, right: -60, height: 130,
    backgroundColor: 'rgba(14,165,233,0.042)', transform: [{ rotate: '5deg' }],
  },
  bandBottom: {
    position: 'absolute', bottom: -100, left: -50, right: -50, height: 210,
    backgroundColor: 'rgba(19,136,8,0.06)', transform: [{ rotate: '6deg' }],
  },
  header: { paddingHorizontal: 16, paddingBottom: 8 },
  headerSurface: {
    flexDirection: 'row', alignItems: 'center', gap: 11, padding: 7, borderRadius: 24,
    backgroundColor: 'rgba(248,250,252,0.94)', borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0',
  },
  headerMid: { flex: 1 },
  headerTitle: { fontSize: 16, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  headerSub: { fontSize: 10.5, fontFamily: 'Inter-Medium', color: '#64748B', marginTop: -2 },
  breadcrumbText: { fontSize: 11, fontFamily: 'Poppins-SemiBold', marginTop: -1 },
  headerMark: {
    width: 38, height: 38, borderRadius: 14, backgroundColor: '#00AFA5',
    alignItems: 'center', justifyContent: 'center',
  },
  scrollFlex: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 14 },
  // Anchored strip matching the screen background, always covering the true
  // bottom edge (Android system nav / gesture bar area). Content padding alone
  // only helps once a screen actually scrolls; this guarantees a clean solid
  // backdrop even on short, non-scrolling screens (e.g. the NCERT class grid).
  bottomGuard: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF' },
  intro: { marginBottom: 22, paddingHorizontal: 3 },
  introTitle: {
    fontFamily: 'Poppins-Bold', fontSize: 28, lineHeight: 34,
    color: '#0F172A', letterSpacing: -0.5,
  },
  introCopy: {
    marginTop: 6, maxWidth: 340, fontFamily: 'Inter-Medium',
    fontSize: 13, lineHeight: 19, color: '#64748B',
  },
  examList: { gap: 11 },
  examCard: {
    minHeight: 94, flexDirection: 'row', alignItems: 'center', gap: 13,
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14,
    borderWidth: 1, borderColor: '#DCE5EE', borderBottomWidth: 3,
  },
  examBody: { flex: 1 },
  examIconWrap: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  examName: { fontSize: 15, lineHeight: 20, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  examDesc: { marginTop: 2, fontSize: 10.5, lineHeight: 15, fontFamily: 'Inter-Medium', color: '#64748B' },
  examArrow: {
    width: 34, height: 34, borderRadius: 12, justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#E2E8F0',
  },
  classGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  classTile: {
    width: '48.4%', minHeight: 160, borderRadius: 24, padding: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: '#DCE5EE', borderBottomWidth: 3,
  },
  classNumber: { fontFamily: 'Poppins-Bold', fontSize: 54, lineHeight: 62, letterSpacing: -2 },
  classLabel: { marginTop: -5, fontFamily: 'Poppins-Bold', fontSize: 10, color: '#64748B', letterSpacing: 1.4 },
  classFooter: {
    marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: 12, borderTopWidth: 1, borderTopColor: 'rgba(15,23,42,0.07)',
  },
  classMeta: { fontFamily: 'Inter-SemiBold', fontSize: 10.5, color: '#475569' },
  subjectList: { gap: 10 },
  subjectRow: {
    minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 12, borderRadius: 20, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#DCE5EE', borderBottomWidth: 3,
  },
  subjectBody: { flex: 1 },
  subjectName: { fontFamily: 'Poppins-SemiBold', fontSize: 14, lineHeight: 19, color: '#0F172A' },
  subjectMeta: { marginTop: 3, fontFamily: 'Inter-Medium', fontSize: 10.5, color: '#94A3B8' },
  subjectIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rowChevron: {
    width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#F1F5F9',
  },
  topicList: { gap: 9 },
  topicRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74,
    backgroundColor: '#FFFFFF', borderRadius: 20, padding: 11,
    borderWidth: 1, borderColor: '#DCE5EE', borderBottomWidth: 3,
  },
  topicIcon: { width: 42, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  topicLeft: { flex: 1, paddingRight: 6 },
  topicName: { fontSize: 13.5, lineHeight: 18, fontFamily: 'Poppins-SemiBold', color: '#0F172A', marginBottom: 5 },
  topicMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  topicSource: { fontSize: 10.5, fontFamily: 'Inter-Medium', color: '#94A3B8' },
  diffBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 7 },
  diffText: { fontSize: 10, fontFamily: 'Poppins-Bold' },
  playBtn: { width: 34, height: 34, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyIcon: {
    width: 64, height: 64, borderRadius: 22, backgroundColor: '#F1F5F9',
    alignItems: 'center', justifyContent: 'center',
  },
  emptyText: { fontSize: 14, fontFamily: 'Poppins-SemiBold', color: '#64748B' },
});
