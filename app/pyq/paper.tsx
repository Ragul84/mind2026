import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticService from '@/utils/hapticService';
import { PyqService, PyqQuestion } from '@/utils/pyqService';
import ExplainWithMiga from '@/components/ExplainWithMiga';
import { QuizMistakeNotebook } from '@/utils/quizMistakeNotebook';
import { useAuthContext } from '@/components/AuthProvider';

const alpha = (i: number) => String.fromCharCode(65 + i);

// Resolve which option is the verified correct one from answer_text
// (handles "A"/"(b)" letters as well as full-text answers).
function correctIndexOf(options: string[], answer: string): number {
  if (!answer || !options?.length) return -1;
  const a = String(answer).trim();
  const letter = a.match(/^\(?([A-Da-d])\)?[.)]?$/);
  if (letter) return letter[1].toUpperCase().charCodeAt(0) - 65;
  const norm = (s: string) => String(s).toLowerCase().replace(/^[([]?[a-d][)\].]\s*/i, '').replace(/[^a-z0-9]/g, '');
  const na = norm(a);
  let idx = options.findIndex((o) => norm(o) === na);
  if (idx >= 0) return idx;
  idx = options.findIndex((o) => norm(o) && (norm(o).includes(na) || na.includes(norm(o))));
  return idx;
}

// The full set of option indices TNPSC accepts as correct. For a normal question
// that's one index; for a nullified question it's every accepted option (or all,
// for a grace/ALL question). Drives multi-answer strict scoring + green marking.
function acceptedIndicesOf(options: string[], accepted: string[]): Set<number> {
  const set = new Set<number>();
  (accepted || []).forEach((a) => {
    const i = correctIndexOf(options, a);
    if (i >= 0) set.add(i);
  });
  return set;
}

export default function PyqPaper() {
  const { exam, year } = useLocalSearchParams<{ exam: string; year: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [questions, setQuestions] = useState<PyqQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuthContext();
  const [current, setCurrent] = useState(0);
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const wrongsRef = useRef<any[]>([]);

  useEffect(() => {
    let alive = true;
    PyqService.getPaper(String(exam), Number(year)).then((q) => { if (alive) { setQuestions(q); setLoading(false); } });
    return () => { alive = false; };
  }, [exam, year]);

  // On leaving, feed accumulated wrong answers into the adaptive weak-areas
  // engine + mistake notebook (single call via saveSession).
  useEffect(() => () => {
    const w = wrongsRef.current;
    if (w.length) void QuizMistakeNotebook.saveSession({
      userId: user?.id, sessionId: `pyq-${exam}-${year}-${Date.now()}`,
      title: `${exam} ${year}`, sourceType: 'pyq', mistakes: w,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = questions[current];
  const correctIdx = useMemo(() => (q ? correctIndexOf(q.options, q.answer_text) : -1), [q]);
  const acceptedSet = useMemo(() => (q ? acceptedIndicesOf(q.options, q.accepted_answers) : new Set<number>()), [q]);
  const isGrace = !!q && q.nullified && acceptedSet.size >= q.options.length;
  const isRevealed = !!revealed[current];
  const pick = picked[current];

  const choose = (i: number) => {
    if (isRevealed) return;
    HapticService.selection();
    setPicked((p) => ({ ...p, [current]: i }));
    setRevealed((r) => ({ ...r, [current]: true }));
    // Multi-answer strict: a pick is correct if it is any accepted option.
    const isRight = acceptedSet.size ? acceptedSet.has(i) : i === correctIdx;
    if (!isRight && q) {
      wrongsRef.current.push({ id: q.id, question: q.question_text, options: q.options, selected_index: i, correct_index: correctIdx });
    }
  };
  const go = (i: number) => { if (i >= 0 && i < questions.length) setCurrent(i); };

  if (loading) return <View style={[styles.container, styles.center]}><ActivityIndicator size="large" color="#00AFA5" /></View>;
  if (!q) return (
    <View style={[styles.container, styles.center]}>
      <Ionicons name="document-outline" size={44} color="#CBD5E1" />
      <Text style={styles.emptyText}>No verified questions for this paper yet.</Text>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}><Text style={styles.backBtnText}>Go back</Text></TouchableOpacity>
    </View>
  );

  const progress = (current + 1) / questions.length;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.circleClose} onPress={() => router.back()}><Ionicons name="close" size={18} color="#475569" /></TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>{exam} {year}</Text>
          <Text style={styles.stepIndicator}>Q {current + 1} of {questions.length}{q.subject ? ` · ${q.subject}` : ''}</Text>
        </View>
        <View style={styles.verifiedChip}><Ionicons name="shield-checkmark" size={12} color="#0F766E" /><Text style={styles.verifiedText}>Verified</Text></View>
      </View>

      <View style={styles.track}><View style={[styles.trackFill, { width: `${progress * 100}%` }]} /></View>

      <ScrollView style={styles.body} contentContainerStyle={{ paddingBottom: insets.bottom + 20 }} showsVerticalScrollIndicator={false}>
        <View style={styles.questionCard}>
          <Text style={styles.qNum}>QUESTION {q.question_number ?? current + 1}</Text>
          <Text style={styles.questionText}>{q.question_text}</Text>
        </View>

        <View style={styles.options}>
          {q.options.map((opt, i) => {
            const accepted = acceptedSet.size ? acceptedSet.has(i) : i === correctIdx;
            const showCorrect = isRevealed && accepted;
            const showWrong = isRevealed && i === pick && !accepted;
            return (
              <TouchableOpacity key={i} activeOpacity={0.85} disabled={isRevealed} onPress={() => choose(i)}
                style={[styles.optionCard, showCorrect ? styles.optCorrect : showWrong ? styles.optWrong : styles.optOff]}>
                <View style={[styles.optAlpha, showCorrect ? styles.optAlphaCorrect : showWrong ? styles.optAlphaWrong : styles.optAlphaOff]}>
                  <Text style={[styles.optAlphaText, { color: showCorrect || showWrong ? '#FFFFFF' : '#64748B' }]}>{alpha(i)}</Text>
                </View>
                <Text style={[styles.optText, showCorrect && { color: '#15803D' }, showWrong && { color: '#DC2626' }]}>{opt}</Text>
                {showCorrect && <Ionicons name="checkmark-circle" size={18} color="#10B981" />}
                {showWrong && <Ionicons name="close-circle" size={18} color="#EF4444" />}
              </TouchableOpacity>
            );
          })}
        </View>

        {isRevealed && q.nullified && (
          <View style={styles.nullBanner}>
            <Ionicons name="alert-circle" size={16} color="#B45309" />
            <Text style={styles.nullBannerText}>
              {isGrace
                ? 'TNPSC officially nullified this question — a grace mark was awarded, so every option counts as correct.'
                : 'TNPSC officially nullified this question — more than one answer was accepted (all correct options are marked green).'}
            </Text>
          </View>
        )}

        {isRevealed && !acceptedSet.size && correctIdx < 0 && (
          <View style={styles.answerFallback}>
            <Text style={styles.answerFallbackLabel}>Verified answer</Text>
            <Text style={styles.answerFallbackText}>{q.answer_text}</Text>
          </View>
        )}

        {isRevealed && (
          <ExplainWithMiga
            key={q.id}
            question={q.question_text}
            options={q.options}
            correctText={q.nullified ? q.accepted_answers.join(' / ') : (correctIdx >= 0 ? q.options[correctIdx] : q.answer_text)}
            userPickText={pick != null && !(acceptedSet.size ? acceptedSet.has(pick) : pick === correctIdx) ? q.options[pick] : undefined}
            context={`${exam} ${year}${q.subject ? ' · ' + q.subject : ''}${q.nullified ? ' · (question officially nullified by TNPSC)' : ''}`}
          />
        )}

        {!isRevealed && (
          <TouchableOpacity style={styles.revealBtn} onPress={() => { HapticService.light?.(); setRevealed((r) => ({ ...r, [current]: true })); }}>
            <Ionicons name="eye-outline" size={16} color="#0F766E" />
            <Text style={styles.revealText}>Show answer</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
        <TouchableOpacity style={styles.navBtn} disabled={current === 0} onPress={() => go(current - 1)}>
          <Ionicons name="chevron-back" size={20} color={current === 0 ? '#CBD5E1' : '#475569'} />
          <Text style={[styles.navText, current === 0 && { color: '#CBD5E1' }]}>Prev</Text>
        </TouchableOpacity>
        <Text style={styles.footCount}>{current + 1} / {questions.length}</Text>
        <TouchableOpacity style={styles.navBtn} disabled={current === questions.length - 1} onPress={() => go(current + 1)}>
          <Text style={[styles.navText, current === questions.length - 1 && { color: '#CBD5E1' }]}>Next</Text>
          <Ionicons name="chevron-forward" size={20} color={current === questions.length - 1 ? '#CBD5E1' : '#475569'} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  center: { justifyContent: 'center', alignItems: 'center', gap: 14 },
  emptyText: { fontFamily: 'Inter-Medium', fontSize: 14, color: '#64748B' },
  backBtn: { backgroundColor: '#F1F5F9', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  backBtnText: { fontFamily: 'Poppins-Bold', fontSize: 13, color: '#475569' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10, gap: 10 },
  circleClose: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF6' },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#1E293B' },
  stepIndicator: { fontSize: 11, fontFamily: 'Inter-Medium', color: '#94A3B8', marginTop: 1 },
  verifiedChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F0FDFC', borderWidth: 1, borderColor: '#CCFBF1', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 },
  verifiedText: { fontSize: 10.5, fontFamily: 'Poppins-Bold', color: '#0F766E' },

  track: { height: 4, backgroundColor: '#F1F5F9', marginHorizontal: 16, borderRadius: 2, overflow: 'hidden', marginBottom: 14 },
  trackFill: { height: '100%', borderRadius: 2, backgroundColor: '#00D4C7' },

  body: { flex: 1, paddingHorizontal: 16 },
  questionCard: { backgroundColor: '#F8FAFF', borderRadius: 18, padding: 18, marginBottom: 12, borderWidth: 1, borderColor: '#E8EEFF' },
  qNum: { fontSize: 11, fontFamily: 'Poppins-Bold', color: '#00B8B0', letterSpacing: 0.5, marginBottom: 8 },
  questionText: { fontSize: 16.5, fontFamily: 'Poppins-SemiBold', color: '#0F172A', lineHeight: 25 },

  options: { gap: 9, paddingBottom: 6 },
  optionCard: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 14, borderWidth: 1.5, gap: 12 },
  optOff: { borderColor: '#E8EEF6', backgroundColor: '#FFFFFF' },
  optCorrect: { borderColor: '#86EFAC', backgroundColor: '#F0FDF4' },
  optWrong: { borderColor: '#FECACA', backgroundColor: '#FEF2F2' },
  optAlpha: { width: 30, height: 30, borderRadius: 9, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },
  optAlphaOff: { backgroundColor: '#F1F5F9' },
  optAlphaCorrect: { backgroundColor: '#10B981' },
  optAlphaWrong: { backgroundColor: '#EF4444' },
  optAlphaText: { fontSize: 13, fontFamily: 'Poppins-Bold' },
  optText: { fontSize: 14, fontFamily: 'Inter-Medium', flex: 1, lineHeight: 20, color: '#334155' },

  nullBanner: { marginTop: 10, flexDirection: 'row', gap: 9, alignItems: 'flex-start', backgroundColor: '#FFFBEB', borderRadius: 14, padding: 13, borderWidth: 1, borderColor: '#FDE68A' },
  nullBannerText: { flex: 1, fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#92400E', lineHeight: 18 },

  answerFallback: { marginTop: 10, backgroundColor: '#F0FDF4', borderRadius: 14, padding: 14, borderLeftWidth: 3, borderLeftColor: '#10B981' },
  answerFallbackLabel: { fontSize: 11, fontFamily: 'Poppins-Bold', color: '#15803D', letterSpacing: 0.4, marginBottom: 4 },
  answerFallbackText: { fontSize: 14, fontFamily: 'Inter-SemiBold', color: '#166534', lineHeight: 20 },

  revealBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 12, height: 46, borderRadius: 13, backgroundColor: '#F0FDFC', borderWidth: 1, borderColor: '#CCFBF1' },
  revealText: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#0F766E' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  navBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 44, paddingHorizontal: 12 },
  navText: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#475569' },
  footCount: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#94A3B8', fontVariant: ['tabular-nums'] },
});
