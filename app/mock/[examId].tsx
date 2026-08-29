import React, { useEffect, useRef, useState, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, AnimatePresence } from 'moti';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import UnifiedLoader from '@/components/ui/UnifiedLoader';
import HapticService from '@/utils/hapticService';
import { assembleMock, scoreMock, MockPaper, MockResult, MockAnswers } from '@/utils/mockService';
import { submitMockAttempt, MockRank } from '@/utils/mockRankService';
import ExplainWithMiga from '@/components/ExplainWithMiga';
import { QuizMistakeNotebook } from '@/utils/quizMistakeNotebook';
import { useAuthContext } from '@/components/AuthProvider';

const alpha = (i: number) => String.fromCharCode(65 + i);
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const DIFF: Record<string, { c: string; bg: string; label: string }> = {
  easy: { c: '#10B981', bg: '#DCFCE7', label: 'Easy' },
  medium: { c: '#F59E0B', bg: '#FEF3C7', label: 'Medium' },
  hard: { c: '#EF4444', bg: '#FEE2E2', label: 'Hard' },
};

export default function MockRunner() {
  const { examId } = useLocalSearchParams<{ examId: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<'loading' | 'error' | 'running' | 'result'>('loading');
  const [paper, setPaper] = useState<MockPaper | null>(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<MockAnswers>({});
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [timeLeft, setTimeLeft] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [result, setResult] = useState<MockResult | null>(null);
  const [durationTaken, setDurationTaken] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAt = useRef(0);
  // Keep the latest answers reachable from the timer's auto-submit closure.
  const answersRef = useRef<MockAnswers>({});
  useEffect(() => { answersRef.current = answers; }, [answers]);

  // ── assemble ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const p = await assembleMock(String(examId));
        if (!alive) return;
        if (!p || p.totalQuestions === 0) { setPhase('error'); return; }
        setPaper(p);
        setTimeLeft(p.config.durationMin * 60);
        startedAt.current = Date.now();
        setPhase('running');
      } catch { if (alive) setPhase('error'); }
    })();
    return () => { alive = false; };
  }, [examId]);

  // ── overall timer ──
  useEffect(() => {
    if (phase !== 'running') return;
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) { clearInterval(timerRef.current!); submit(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const q = paper?.questions[current];
  const sectionName = useMemo(() => paper?.sections.find((s) => s.id === q?.sectionId)?.name ?? '', [paper, q]);
  const answeredCount = useMemo(() => Object.values(answers).filter((v) => v !== null && v !== undefined).length, [answers]);

  const select = (idx: number) => {
    HapticService.selection();
    setAnswers((a) => ({ ...a, [current]: a[current] === idx ? null : idx }));
  };
  const toggleMark = () => {
    HapticService.selection();
    setMarked((m) => { const n = new Set(m); n.has(current) ? n.delete(current) : n.add(current); return n; });
  };
  const go = (i: number) => { if (paper && i >= 0 && i < paper.totalQuestions) { setCurrent(i); setPaletteOpen(false); } };

  const submit = (auto = false) => {
    if (!paper) return;
    const finish = () => {
      if (timerRef.current) clearInterval(timerRef.current);
      HapticService.success?.();
      const taken = Math.min(paper.config.durationMin * 60, Math.round((Date.now() - startedAt.current) / 1000));
      setDurationTaken(taken);
      setResult(scoreMock(paper, answersRef.current));
      setPhase('result');
    };
    if (auto) return finish();
    const left = paper.totalQuestions - answeredCount;
    Alert.alert('Submit test?', left > 0 ? `${answeredCount} answered, ${left} unanswered.` : `All ${answeredCount} answered.`, [
      { text: 'Keep going', style: 'cancel' },
      { text: 'Submit', style: 'destructive', onPress: finish },
    ]);
  };

  // ── loading / error ──
  if (phase === 'loading') return <View style={styles.container}><UnifiedLoader context="quiz" message="Assembling your mock..." /></View>;
  if (phase === 'error' || !paper) return (
    <View style={[styles.container, styles.center]}>
      <Ionicons name="cloud-offline-outline" size={44} color="#CBD5E1" />
      <Text style={styles.errText}>Couldn't build this mock. Try again.</Text>
      <TouchableOpacity style={styles.errBtn} onPress={() => router.back()}><Text style={styles.errBtnText}>Go back</Text></TouchableOpacity>
    </View>
  );

  // ── results ──
  if (phase === 'result' && result) {
    return <MockResultView result={result} paper={paper} answers={answers} insets={insets} examId={String(examId)} durationSec={durationTaken}
      onRetake={() => { setAnswers({}); setMarked(new Set()); setCurrent(0); setResult(null); setPhase('loading'); setPaper(null);
        assembleMock(String(examId)).then((p) => { if (p) { setPaper(p); setTimeLeft(p.config.durationMin * 60); startedAt.current = Date.now(); setPhase('running'); } else setPhase('error'); }); }}
      onDone={() => router.back()} />;
  }

  // ── running ──
  const low = timeLeft <= 60;
  const diff = q?.difficulty ? DIFF[q.difficulty] : null;
  const timeFrac = timeLeft / (paper.config.durationMin * 60);

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.circleClose} onPress={() => Alert.alert('Leave mock?', 'Your progress will be lost.', [{ text: 'Stay', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => router.back() }])}>
          <Ionicons name="close" size={18} color="#475569" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitleSmall} numberOfLines={1}>{paper.config.name}</Text>
          <Text style={styles.stepIndicator}>Q {current + 1} of {paper.totalQuestions} · {sectionName}</Text>
        </View>
        <View style={[styles.timerChip, low && styles.timerChipLow]}>
          <Ionicons name="time-outline" size={14} color={low ? '#DC2626' : '#0F766E'} />
          <Text style={[styles.timerText, low && { color: '#DC2626' }]}>{fmt(timeLeft)}</Text>
        </View>
      </View>

      <View style={styles.timerTrack}>
        <View style={[styles.timerFill, { width: `${Math.max(0, timeFrac) * 100}%`, backgroundColor: low ? '#EF4444' : '#00D4C7' }]} />
      </View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: 20 }} showsVerticalScrollIndicator={false}>
        <View style={styles.questionCard}>
          <View style={styles.qNumRow}>
            <Text style={styles.qNumText}>QUESTION {current + 1}</Text>
            {diff && <View style={[styles.diffChip, { backgroundColor: diff.bg }]}><Text style={[styles.diffChipText, { color: diff.c }]}>{diff.label}</Text></View>}
            {marked.has(current) && <View style={styles.markFlag}><Ionicons name="bookmark" size={11} color="#D97706" /><Text style={styles.markFlagText}>Marked</Text></View>}
          </View>
          <Text style={styles.questionText}>{q?.question || q?.question_text || q?.prompt}</Text>
        </View>

        <View style={styles.options}>
          {(q?.options || []).map((opt, i) => {
            const on = answers[current] === i;
            return (
              <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => select(i)}
                style={[styles.optionCard, on ? styles.optionOn : styles.optionOff]}>
                <View style={[styles.optAlpha, on ? styles.optAlphaOn : styles.optAlphaOff]}>
                  <Text style={[styles.optAlphaText, { color: on ? '#FFFFFF' : '#64748B' }]}>{alpha(i)}</Text>
                </View>
                <Text style={[styles.optText, on && { color: '#0F766E' }]}>{opt}</Text>
                {on && <Ionicons name="checkmark-circle" size={18} color="#00AFA5" />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* footer controls */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity style={styles.footBtn} onPress={toggleMark}>
          <Ionicons name={marked.has(current) ? 'bookmark' : 'bookmark-outline'} size={18} color={marked.has(current) ? '#D97706' : '#64748B'} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.footBtn} onPress={() => setPaletteOpen(true)}>
          <Ionicons name="grid-outline" size={18} color="#64748B" />
          <Text style={styles.footBtnText}>{answeredCount}/{paper.totalQuestions}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.navBtn} disabled={current === 0} onPress={() => go(current - 1)}>
          <Ionicons name="chevron-back" size={20} color={current === 0 ? '#CBD5E1' : '#475569'} />
        </TouchableOpacity>
        {current < paper.totalQuestions - 1 ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => go(current + 1)}>
            <LinearGradient colors={['#00D4C7', '#0EA5E9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryGrad}>
              <Text style={styles.primaryText}>Next</Text><Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => submit(false)}>
            <LinearGradient colors={['#10B981', '#00D4C7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryGrad}>
              <Text style={styles.primaryText}>Submit</Text><Ionicons name="checkmark" size={17} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>

      {/* question palette */}
      <AnimatePresence>
        {paletteOpen && (
          <MotiView from={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={styles.paletteBackdrop}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPaletteOpen(false)} />
            <MotiView from={{ translateY: 40, opacity: 0 }} animate={{ translateY: 0, opacity: 1 }} exit={{ translateY: 40, opacity: 0 }} transition={{ type: 'timing', duration: 220 }} style={[styles.paletteSheet, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.paletteHandle} />
              <View style={styles.legendRow}>
                <Legend color="#00AFA5" label="Answered" />
                <Legend color="#F59E0B" label="Marked" />
                <Legend color="#E2E8F0" label="Skipped" dark />
              </View>
              <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
                {paper.sections.map((sec) => (
                  <View key={sec.id} style={{ marginBottom: 14 }}>
                    <Text style={styles.paletteSectionLabel}>{sec.name}</Text>
                    <View style={styles.paletteGrid}>
                      {sec.questions.map((mq) => {
                        const ans = answers[mq.index] !== null && answers[mq.index] !== undefined;
                        const mk = marked.has(mq.index);
                        const isCur = mq.index === current;
                        const bg = ans ? '#00AFA5' : mk ? '#F59E0B' : '#F1F5F9';
                        const fg = ans || mk ? '#FFFFFF' : '#64748B';
                        return (
                          <TouchableOpacity key={mq.index} onPress={() => go(mq.index)}
                            style={[styles.paletteCell, { backgroundColor: bg }, isCur && styles.paletteCellCur]}>
                            <Text style={[styles.paletteCellText, { color: fg }]}>{mq.index + 1}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.paletteSubmit} onPress={() => { setPaletteOpen(false); submit(false); }}>
                <LinearGradient colors={['#10B981', '#00D4C7']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryGrad}>
                  <Text style={styles.primaryText}>Submit test</Text><Ionicons name="checkmark" size={17} color="#FFFFFF" />
                </LinearGradient>
              </TouchableOpacity>
            </MotiView>
          </MotiView>
        )}
      </AnimatePresence>
    </View>
  );
}

function Legend({ color, label, dark }: { color: string; label: string; dark?: boolean }) {
  return (
    <View style={styles.legend}>
      <View style={[styles.legendDot, { backgroundColor: color, borderWidth: dark ? 1 : 0, borderColor: '#CBD5E1' }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

// ── Results ──────────────────────────────────────────────────────────────
function MockResultView({ result, paper, answers, insets, examId, durationSec, onRetake, onDone }: {
  result: MockResult; paper: MockPaper; answers: MockAnswers; insets: { top: number; bottom: number }; examId: string; durationSec: number; onRetake: () => void; onDone: () => void;
}) {
  const { user } = useAuthContext();
  const pct = Math.round(result.percentage * 100);
  const acc = Math.round(result.accuracy * 100);
  const [showReview, setShowReview] = useState(false);
  const [rank, setRank] = useState<MockRank | null>(null);
  const [rankLoading, setRankLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    submitMockAttempt(examId, paper.config.name, result, durationSec)
      .then((r) => { if (alive) { setRank(r); setRankLoading(false); } })
      .catch(() => { if (alive) setRankLoading(false); });

    // Feed the adaptive weak-areas engine (+ mistake notebook), grouped by section.
    try {
      const secName: Record<string, string> = {};
      paper.sections.forEach((s) => { secName[s.id] = s.name; });
      const bySec: Record<string, any[]> = {};
      paper.questions.forEach((mq) => {
        const given = answers[mq.index];
        const correct = mq.answer_index ?? -1;
        if (given != null && given !== correct) {
          (bySec[mq.sectionId] ||= []).push({
            id: mq.id, question: mq.question || mq.question_text || '',
            options: mq.options || [], explanation: mq.explanation,
            selected_index: given, correct_index: correct, difficulty: mq.difficulty,
          });
        }
      });
      Object.entries(bySec).forEach(([sid, items]) => {
        if (items.length) void QuizMistakeNotebook.saveSession({
          userId: user?.id, sessionId: `mock-${examId}-${sid}-${Date.now()}`,
          title: secName[sid] || paper.config.name, sourceType: 'mock', mistakes: items,
        });
      });
    } catch { /* non-fatal */ }

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.circleClose} onPress={onDone}><Ionicons name="close" size={18} color="#475569" /></TouchableOpacity>
        <View style={styles.headerInfo}><Text style={styles.headerTitleSmall}>{paper.config.name}</Text><Text style={styles.stepIndicator}>Result</Text></View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
        <MotiView from={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'timing', duration: 300 }} style={styles.scoreCard}>
          <View style={styles.trophyRing}>
            <Ionicons name="ribbon" size={30} color="#00AFA5" />
          </View>
          <Text style={styles.scoreBig}>{result.score % 1 === 0 ? result.score : result.score.toFixed(2)}<Text style={styles.scoreMax}> / {result.maxMarks}</Text></Text>
          <Text style={styles.scoreSub}>Net score after negative marking</Text>
          <View style={styles.scoreRow}>
            <View style={styles.scoreStat}><Text style={[styles.scoreStatNum, { color: '#00AFA5' }]}>{pct}%</Text><Text style={styles.scoreStatLabel}>Score</Text></View>
            <View style={styles.scoreDivider} />
            <View style={styles.scoreStat}><Text style={[styles.scoreStatNum, { color: '#0EA5E9' }]}>{acc}%</Text><Text style={styles.scoreStatLabel}>Accuracy</Text></View>
            <View style={styles.scoreDivider} />
            <View style={styles.scoreStat}><Text style={[styles.scoreStatNum, { color: '#10B981' }]}>{result.correct}</Text><Text style={styles.scoreStatLabel}>Correct</Text></View>
            <View style={styles.scoreDivider} />
            <View style={styles.scoreStat}><Text style={[styles.scoreStatNum, { color: '#EF4444' }]}>{result.wrong}</Text><Text style={styles.scoreStatLabel}>Wrong</Text></View>
          </View>
        </MotiView>

        <MotiView from={{ opacity: 0, translateY: 8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 300, delay: 120 }} style={styles.rankCard}>
          {rankLoading ? (
            <View style={styles.rankRow}><ActivityIndicator color="#00AFA5" size="small" /><Text style={styles.rankNote}>Computing your All-India Rank…</Text></View>
          ) : rank ? (
            <>
              <View style={styles.rankLeft}>
                <View style={styles.rankIcon}><Ionicons name="podium" size={20} color="#FFFFFF" /></View>
                <View>
                  <Text style={styles.rankLabel}>ALL-INDIA RANK</Text>
                  <Text style={styles.rankBig}>#{rank.rank}<Text style={styles.rankOf}>  of {rank.total}</Text></Text>
                </View>
              </View>
              <View style={styles.rankPill}><Text style={styles.rankPillText}>Ahead of {rank.percentile}%</Text></View>
            </>
          ) : (
            <View style={styles.rankRow}><Ionicons name="cloud-offline-outline" size={16} color="#94A3B8" /><Text style={styles.rankNote}>Sign in to see your All-India Rank.</Text></View>
          )}
        </MotiView>

        {result.wrong > 0 && (
          <TouchableOpacity style={styles.planNote} activeOpacity={0.85} onPress={() => { onDone(); }}>
            <Ionicons name="calendar-outline" size={15} color="#0F766E" />
            <Text style={styles.planNoteText}>Your weak areas were added to your <Text style={{ fontFamily: 'Poppins-Bold' }}>Study Plan</Text> — revise them tomorrow.</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.sectionHead}>Section breakdown</Text>
        {result.sections.map((s) => {
          const sp = s.maxMarks > 0 ? Math.max(0, s.score) / s.maxMarks : 0;
          return (
            <View key={s.id} style={styles.secCard}>
              <View style={styles.secTop}>
                <Text style={styles.secName}>{s.name}</Text>
                <Text style={styles.secScore}>{s.score % 1 === 0 ? s.score : s.score.toFixed(2)}<Text style={styles.secScoreMax}> / {s.maxMarks}</Text></Text>
              </View>
              <View style={styles.secBarTrack}><View style={[styles.secBarFill, { width: `${sp * 100}%` }]} /></View>
              <View style={styles.secMeta}>
                <Text style={[styles.secMetaItem, { color: '#10B981' }]}>{s.correct} correct</Text>
                <Text style={[styles.secMetaItem, { color: '#EF4444' }]}>{s.wrong} wrong</Text>
                <Text style={[styles.secMetaItem, { color: '#94A3B8' }]}>{s.skipped} skipped</Text>
              </View>
            </View>
          );
        })}

        <TouchableOpacity style={styles.reviewToggle} onPress={() => setShowReview((v) => !v)}>
          <Ionicons name="reader-outline" size={16} color="#475569" />
          <Text style={styles.reviewToggleText}>{showReview ? 'Hide' : 'Review'} all questions &amp; answers</Text>
          <Ionicons name={showReview ? 'chevron-up' : 'chevron-down'} size={16} color="#94A3B8" />
        </TouchableOpacity>

        {showReview && paper.questions.map((mq) => {
          const given = answers[mq.index];
          const correct = mq.answer_index ?? -1;
          const isCorrect = given === correct;
          const skipped = given === null || given === undefined;
          return (
            <View key={mq.index} style={styles.reviewCard}>
              <View style={styles.reviewNumRow}>
                <Text style={styles.reviewNum}>Q{mq.index + 1}</Text>
                <View style={[styles.reviewTag, { backgroundColor: skipped ? '#F1F5F9' : isCorrect ? '#DCFCE7' : '#FEE2E2' }]}>
                  <Text style={[styles.reviewTagText, { color: skipped ? '#94A3B8' : isCorrect ? '#15803D' : '#DC2626' }]}>{skipped ? 'Skipped' : isCorrect ? 'Correct' : 'Wrong'}</Text>
                </View>
              </View>
              <Text style={styles.reviewQ}>{mq.question || mq.question_text}</Text>
              {(mq.options || []).map((opt, i) => {
                const isAns = i === correct;
                const isGiven = i === given;
                return (
                  <View key={i} style={[styles.reviewOpt, isAns && styles.reviewOptCorrect, isGiven && !isAns && styles.reviewOptWrong]}>
                    <Text style={[styles.reviewOptText, (isAns || (isGiven && !isAns)) && { fontFamily: 'Poppins-SemiBold' }]}>{alpha(i)}. {opt}</Text>
                    {isAns && <Ionicons name="checkmark-circle" size={15} color="#10B981" />}
                    {isGiven && !isAns && <Ionicons name="close-circle" size={15} color="#EF4444" />}
                  </View>
                );
              })}
              {!!mq.explanation && <Text style={styles.reviewExp}>{mq.explanation}</Text>}
              {!isCorrect && (
                <ExplainWithMiga
                  question={mq.question || mq.question_text || ''}
                  options={mq.options || []}
                  correctText={(mq.options || [])[correct] ?? ''}
                  userPickText={!skipped ? (mq.options || [])[given as number] : undefined}
                  context={paper.config.name}
                />
              )}
            </View>
          );
        })}

        <View style={styles.resultActions}>
          <TouchableOpacity style={styles.retakeBtn} onPress={onRetake}>
            <Ionicons name="refresh" size={16} color="#0F766E" /><Text style={styles.retakeText}>Retake</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
            <LinearGradient colors={['#00D4C7', '#0EA5E9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.primaryGrad}>
              <Text style={styles.primaryText}>Done</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { justifyContent: 'center', alignItems: 'center', gap: 14 },
  errText: { fontFamily: 'Inter-Medium', fontSize: 14, color: '#64748B' },
  errBtn: { backgroundColor: '#F1F5F9', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  errBtnText: { fontFamily: 'Poppins-Bold', fontSize: 13, color: '#475569' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  circleClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF6' },
  headerInfo: { flex: 1 },
  headerTitleSmall: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#1E293B' },
  stepIndicator: { fontSize: 11, fontFamily: 'Inter-Medium', color: '#94A3B8', marginTop: 1 },
  timerChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F0FDFC', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#CCFBF1' },
  timerChipLow: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  timerText: { color: '#0F766E', fontSize: 13, fontFamily: 'Poppins-Bold', fontVariant: ['tabular-nums'] },

  timerTrack: { height: 4, backgroundColor: '#F1F5F9', marginHorizontal: 16, borderRadius: 2, overflow: 'hidden', marginBottom: 14 },
  timerFill: { height: '100%', borderRadius: 2 },

  body: { flex: 1, paddingHorizontal: 16 },
  questionCard: { backgroundColor: '#F8FAFF', borderRadius: 18, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E8EEFF' },
  qNumRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, gap: 8 },
  qNumText: { fontSize: 11, fontFamily: 'Poppins-Bold', color: '#00B8B0', letterSpacing: 0.5 },
  diffChip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  diffChipText: { fontSize: 10, fontFamily: 'Poppins-Bold' },
  markFlag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FEF9EC', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 20 },
  markFlagText: { fontSize: 10, fontFamily: 'Poppins-Bold', color: '#D97706' },
  questionText: { fontSize: 17, fontFamily: 'Poppins-SemiBold', color: '#0F172A', lineHeight: 26 },

  options: { gap: 9, paddingBottom: 8 },
  optionCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1.5, gap: 12 },
  optionOff: { borderColor: '#E8EEF6', backgroundColor: '#FFFFFF' },
  optionOn: { borderColor: '#00D4C7', backgroundColor: '#F0FDFC' },
  optAlpha: { width: 30, height: 30, borderRadius: 9, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  optAlphaOff: { backgroundColor: '#F1F5F9' },
  optAlphaOn: { backgroundColor: '#00AFA5' },
  optAlphaText: { fontSize: 13, fontFamily: 'Poppins-Bold' },
  optText: { fontSize: 14, fontFamily: 'Inter-Medium', flex: 1, lineHeight: 21, color: '#334155' },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  footBtn: { height: 46, minWidth: 46, paddingHorizontal: 10, borderRadius: 13, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E8EEF6', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 },
  footBtnText: { fontSize: 11, fontFamily: 'Poppins-Bold', color: '#64748B', fontVariant: ['tabular-nums'] },
  navBtn: { height: 46, width: 46, borderRadius: 13, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E8EEF6', alignItems: 'center', justifyContent: 'center' },
  primaryBtn: { flex: 1, borderRadius: 13, overflow: 'hidden' },
  primaryGrad: { height: 46, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 7 },
  primaryText: { fontSize: 14.5, fontFamily: 'Poppins-Bold', color: '#FFFFFF', letterSpacing: 0.3 },

  // palette
  paletteBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.4)', justifyContent: 'flex-end' },
  paletteSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 10 },
  paletteHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', marginBottom: 14 },
  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 14 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 12, height: 12, borderRadius: 4 },
  legendText: { fontSize: 11.5, fontFamily: 'Inter-SemiBold', color: '#64748B' },
  paletteSectionLabel: { fontSize: 11, fontFamily: 'Poppins-Bold', color: '#94A3B8', letterSpacing: 0.4, marginBottom: 8, textTransform: 'uppercase' },
  paletteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  paletteCell: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  paletteCellCur: { borderWidth: 2, borderColor: '#0F172A' },
  paletteCellText: { fontSize: 12.5, fontFamily: 'Poppins-Bold', fontVariant: ['tabular-nums'] },
  paletteSubmit: { borderRadius: 14, overflow: 'hidden', marginTop: 14 },

  // results
  scoreCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 22, alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF6', borderBottomWidth: 3 },
  trophyRing: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F0FDFC', alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 1.5, borderColor: '#CCFBF1' },
  scoreBig: { fontSize: 38, fontFamily: 'Poppins-Bold', color: '#0F172A', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  scoreMax: { fontSize: 20, color: '#94A3B8', fontFamily: 'Poppins-SemiBold' },
  scoreSub: { fontSize: 12, fontFamily: 'Inter-Medium', color: '#94A3B8', marginTop: 2 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, alignSelf: 'stretch' },
  scoreStat: { flex: 1, alignItems: 'center' },
  scoreStatNum: { fontSize: 20, fontFamily: 'Poppins-Bold', fontVariant: ['tabular-nums'] },
  scoreStatLabel: { fontSize: 10.5, fontFamily: 'Inter-Medium', color: '#94A3B8', marginTop: 2 },
  scoreDivider: { width: 1, height: 30, backgroundColor: '#F1F5F9' },

  rankCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, backgroundColor: '#F0FDFC', borderRadius: 18, padding: 16, marginTop: 12, borderWidth: 1, borderColor: '#CCFBF1' },
  rankLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  rankIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#00AFA5', alignItems: 'center', justifyContent: 'center' },
  rankLabel: { fontSize: 10, fontFamily: 'Poppins-Bold', color: '#0F766E', letterSpacing: 0.6 },
  rankBig: { fontSize: 24, fontFamily: 'Poppins-Bold', color: '#0F172A', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  rankOf: { fontSize: 13, fontFamily: 'Poppins-SemiBold', color: '#94A3B8' },
  rankPill: { backgroundColor: '#00AFA5', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  rankPillText: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#FFFFFF' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  rankNote: { fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#64748B' },

  planNote: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#F0FDFC', borderRadius: 13, padding: 13, marginTop: 16, borderWidth: 1, borderColor: '#CCFBF1' },
  planNoteText: { flex: 1, fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#0F766E', lineHeight: 18 },
  sectionHead: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#0F172A', marginTop: 24, marginBottom: 10 },
  secCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 14, marginBottom: 9, borderWidth: 1, borderColor: '#E8EEF6' },
  secTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 },
  secName: { fontSize: 13.5, fontFamily: 'Poppins-SemiBold', color: '#1E293B', flex: 1 },
  secScore: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#0F172A', fontVariant: ['tabular-nums'] },
  secScoreMax: { fontSize: 11.5, color: '#94A3B8', fontFamily: 'Poppins-SemiBold' },
  secBarTrack: { height: 6, backgroundColor: '#F1F5F9', borderRadius: 3, overflow: 'hidden' },
  secBarFill: { height: '100%', borderRadius: 3, backgroundColor: '#00D4C7' },
  secMeta: { flexDirection: 'row', gap: 12, marginTop: 9 },
  secMetaItem: { fontSize: 11.5, fontFamily: 'Poppins-SemiBold' },

  reviewToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8FAFC', borderRadius: 13, paddingVertical: 13, paddingHorizontal: 15, marginTop: 18, borderWidth: 1, borderColor: '#E8EEF6' },
  reviewToggleText: { flex: 1, fontSize: 13.5, fontFamily: 'Poppins-Bold', color: '#475569' },
  reviewCard: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 15, marginTop: 10, borderWidth: 1, borderColor: '#E8EEF6' },
  reviewNumRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  reviewNum: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#00B8B0' },
  reviewTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
  reviewTagText: { fontSize: 10, fontFamily: 'Poppins-Bold' },
  reviewQ: { fontSize: 14.5, fontFamily: 'Poppins-SemiBold', color: '#0F172A', lineHeight: 21, marginBottom: 10 },
  reviewOpt: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 11, borderRadius: 10, marginBottom: 6, borderWidth: 1, borderColor: '#F1F5F9' },
  reviewOptCorrect: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  reviewOptWrong: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  reviewOptText: { flex: 1, fontSize: 13, fontFamily: 'Inter-Medium', color: '#334155', lineHeight: 19 },
  reviewExp: { fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#475569', lineHeight: 19, marginTop: 6, backgroundColor: '#F0FDFC', borderRadius: 10, padding: 11, borderLeftWidth: 3, borderLeftColor: '#00D4C7' },

  resultActions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  retakeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, height: 50, paddingHorizontal: 22, borderRadius: 14, backgroundColor: '#F0FDFC', borderWidth: 1, borderColor: '#CCFBF1' },
  retakeText: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#0F766E' },
  doneBtn: { flex: 1, borderRadius: 14, overflow: 'hidden' },
});
