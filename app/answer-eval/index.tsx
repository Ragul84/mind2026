import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mascotApi } from '@/services/mascotApi';
import { MainsReferenceService } from '@/utils/mainsReferenceService';
import { useAuthContext } from '@/components/AuthProvider';
import HapticService from '@/utils/hapticService';

const EXAMS = [
  { id: 'UPSC', label: 'UPSC Mains' },
  { id: 'TNPSC', label: 'TNPSC Mains' },
  { id: 'Banking', label: 'IBPS Descriptive' },
  { id: 'SSC', label: 'SSC Descriptive' },
];

function clean(s: string): string {
  return s.replace(/```[\s\S]*?```/g, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

export default function AnswerEval() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();

  const [exam, setExam] = useState('UPSC');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState(false);

  const canEval = question.trim().length > 8 && answer.trim().length > 20 && !evaluating;

  const evaluate = async () => {
    if (!canEval) return;
    HapticService.medium();
    setEvaluating(true); setResult(''); setError(false);

    const examLabel = EXAMS.find((e) => e.id === exam)?.label || exam;
    // Grade against a curated reference answer when one exists; else rely on RAG.
    const ref = await MainsReferenceService.findReference(exam, question.trim());
    const refBlock = ref
      ? `\n\nGOLD-STANDARD REFERENCE (a verified model answer — grade the student's content against it):\nMust-cover points: ${ref.key_points.join('; ')}\nModel answer: ${ref.model_answer.slice(0, 1200)}`
      : '';
    const prompt =
      `You are a strict ${examLabel} examiner. Ground your evaluation in the retrieved textbook/syllabus material — judge the CONTENT for factual accuracy and coverage against what the topic actually requires, not just writing style. Be specific and reference the actual concepts; never give vague praise.` + refBlock + `\n\n` +
      `Score each out of 10:\n1) Relevance & understanding of the demand of the question\n2) Content accuracy & coverage (were the key facts, dimensions, examples, data present and correct?)\n3) Structure (intro → body → conclusion, logical flow)\n4) Expression & language\n\n` +
      `Return, concisely:\n• Overall band like "6.5 / 10"\n• The four rubric scores\n• 2–3 concrete strengths (name the exact points that worked)\n• 2–3 specific improvements (name what was missing or wrong)\n• "Should have covered:" 3–4 specific points/keywords the ideal answer needed, drawn from the reference/source material\n\n` +
      `QUESTION:\n${question.trim()}\n\nSTUDENT'S ANSWER:\n${answer.trim()}`;

    let acc = '';
    mascotApi.streamChat(
      user?.id || 'anon',
      [{ role: 'user', content: prompt }],
      'study',
      (tok) => { acc += tok; setResult(clean(acc)); },
      (full) => { setResult(clean(full || acc)); setEvaluating(false); },
      () => { setError(true); setEvaluating(false); },
      { languageCode: 'en-IN', languageLabel: 'English' },
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.circleClose} onPress={() => router.back()}><Ionicons name="chevron-back" size={20} color="#475569" /></TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Answer Writing</Text>
          <Text style={styles.headerSub}>Write it — MIGA scores it like an examiner</Text>
        </View>
        <View style={styles.headerMark}><FontAwesome5 name="feather-alt" size={16} color="#FFFFFF" /></View>
      </View>
      <View style={styles.headerSep} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Exam</Text>
          <View style={styles.chipRow}>
            {EXAMS.map((e) => {
              const on = e.id === exam;
              return (
                <TouchableOpacity key={e.id} onPress={() => { HapticService.selection(); setExam(e.id); }} style={[styles.chip, on && styles.chipOn]}>
                  <Text style={[styles.chipText, on && styles.chipTextOn]}>{e.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Question / prompt</Text>
          <TextInput
            style={styles.qInput}
            placeholder="Paste the exam question or essay prompt…"
            placeholderTextColor="#94A3B8"
            value={question}
            onChangeText={setQuestion}
            multiline
          />

          <View style={styles.answerLabelRow}>
            <Text style={styles.label}>Your answer</Text>
            <Text style={styles.wordCount}>{wordCount(answer)} words</Text>
          </View>
          <TextInput
            style={styles.aInput}
            placeholder="Write your answer here…"
            placeholderTextColor="#94A3B8"
            value={answer}
            onChangeText={setAnswer}
            multiline
            textAlignVertical="top"
          />

          <TouchableOpacity style={[styles.evalBtn, !canEval && { opacity: 0.5 }]} onPress={evaluate} disabled={!canEval} activeOpacity={0.85}>
            {evaluating && !result ? <ActivityIndicator size="small" color="#fff" /> : (<><FontAwesome5 name="feather-alt" size={14} color="#FFFFFF" /><Text style={styles.evalBtnText}>Evaluate with MIGA</Text></>)}
          </TouchableOpacity>

          {(result || error) && (
            <MotiView from={{ opacity: 0, translateY: 8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 220 }} style={styles.resultCard}>
              <View style={styles.resultHeader}>
                <View style={styles.migaBadge}><Ionicons name="school" size={13} color="#FFFFFF" /></View>
                <Text style={styles.resultHeaderText}>MIGA's evaluation</Text>
              </View>
              {error ? (
                <Text style={styles.errorText}>Couldn't evaluate right now. Try again in a moment.</Text>
              ) : (
                <Text style={styles.resultBody}>{result}{evaluating ? ' ▍' : ''}</Text>
              )}
            </MotiView>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingBottom: 8 },
  circleClose: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF6' },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 18, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  headerSub: { fontSize: 11.5, fontFamily: 'Inter-Medium', color: '#94A3B8', marginTop: -1 },
  headerMark: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' },
  headerSep: { height: 1, backgroundColor: '#EBEFF4', marginHorizontal: 16, marginBottom: 4 },

  scroll: { paddingHorizontal: 18, paddingTop: 16 },
  label: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#334155', letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.9, marginBottom: 9, marginTop: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E7EEF4' },
  chipOn: { backgroundColor: '#F0FDFC', borderColor: '#00D4C7' },
  chipText: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#64748B' },
  chipTextOn: { color: '#0F766E' },

  qInput: { backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1.5, borderColor: '#E7EEF4', padding: 14, fontSize: 14, fontFamily: 'Inter-Medium', color: '#0F172A', minHeight: 70, lineHeight: 20 },
  answerLabelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  wordCount: { fontSize: 11.5, fontFamily: 'Poppins-SemiBold', color: '#94A3B8' },
  aInput: { backgroundColor: '#F8FAFC', borderRadius: 14, borderWidth: 1.5, borderColor: '#E7EEF4', padding: 14, fontSize: 14.5, fontFamily: 'Inter-Medium', color: '#0F172A', minHeight: 200, lineHeight: 22 },

  evalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: 15, backgroundColor: '#7C3AED', borderBottomWidth: 4, borderBottomColor: 'rgba(0,0,0,0.2)', marginTop: 16 },
  evalBtnText: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#FFFFFF', letterSpacing: 0.3 },

  resultCard: { marginTop: 18, backgroundColor: '#F7F5FF', borderRadius: 16, padding: 16, borderLeftWidth: 3, borderLeftColor: '#7C3AED' },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  migaBadge: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#7C3AED', alignItems: 'center', justifyContent: 'center' },
  resultHeaderText: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#6D28D9' },
  resultBody: { fontSize: 13.5, fontFamily: 'Inter-Medium', color: '#334155', lineHeight: 21 },
  errorText: { fontSize: 13, fontFamily: 'Inter-Medium', color: '#94A3B8', lineHeight: 19 },
});
