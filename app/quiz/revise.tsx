import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuizMistakeNotebook } from '@/utils/quizMistakeNotebook';

type MistakeEntry = {
  id?: string;
  question: string;
  options: string[];
  explanation?: string;
  selected_index: number;
  correct_index: number;
  difficulty?: string;
  timed_out?: boolean;
};

type StoredMistakes = {
  title?: string;
  mistakes: MistakeEntry[];
};

const optionLetter = (idx: number) => (idx >= 0 ? String.fromCharCode(65 + idx) : '-');

export default function QuizMistakeRevisionScreen() {
  const { sessionId } = useLocalSearchParams();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StoredMistakes | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const id = typeof sessionId === 'string' ? sessionId : '';
        const session = id ? await QuizMistakeNotebook.getSession(id) : null;
        setData(session);
      } catch {
        setData(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  const mistakes = useMemo(() => data?.mistakes || [], [data]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#00D4C7" />
        <Text style={styles.loadingText}>Opening your mistake notebook...</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#FFFFFF', '#F8FAFC', '#EEF2FF']} style={StyleSheet.absoluteFillObject} />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>MISTAKE NOTEBOOK</Text>
          <Text style={styles.title}>{data?.title || 'Revise wrong answers'}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {mistakes.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="checkmark-circle" size={44} color="#10B981" />
            <Text style={styles.emptyTitle}>No mistakes to revise</Text>
            <Text style={styles.emptyText}>Your wrong-answer notebook is empty for this session.</Text>
          </View>
        ) : (
          mistakes.map((item, index) => {
            const selectedText = item.selected_index >= 0 ? item.options[item.selected_index] : 'Timed out';
            const correctText = item.options[item.correct_index] || '';
            return (
              <View key={`${item.id || item.question}-${index}`} style={styles.card}>
                <View style={styles.cardTop}>
                  <Text style={styles.questionNo}>QUESTION {index + 1}</Text>
                  {!!item.difficulty && <Text style={styles.difficulty}>{item.difficulty}</Text>}
                </View>
                <Text style={styles.question}>{item.question}</Text>
                <View style={styles.answerGrid}>
                  <View style={[styles.answerBox, styles.wrongBox]}>
                    <Text style={styles.answerLabel}>Your answer</Text>
                    <Text style={styles.answerText}>{optionLetter(item.selected_index)}. {selectedText}</Text>
                  </View>
                  <View style={[styles.answerBox, styles.correctBox]}>
                    <Text style={styles.answerLabel}>Correct answer</Text>
                    <Text style={styles.answerText}>{optionLetter(item.correct_index)}. {correctText}</Text>
                  </View>
                </View>
                <View style={styles.explainBox}>
                  <View style={styles.explainHeader}>
                    <Ionicons name="bulb" size={16} color="#00D4C7" />
                    <Text style={styles.explainLabel}>Why this is correct</Text>
                  </View>
                  <Text style={styles.explainText}>
                    {item.explanation || `The correct answer is ${optionLetter(item.correct_index)} because it matches the tested concept.`}
                  </Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 12,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 14,
    gap: 12,
  },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  headerCopy: {
    flex: 1,
  },
  kicker: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#00AFA3',
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 20,
    lineHeight: 25,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  content: {
    padding: 18,
    paddingBottom: 42,
    gap: 14,
  },
  emptyCard: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 18,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  emptyText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
    textAlign: 'center',
  },
  card: {
    borderRadius: 24,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.22)',
    shadowColor: '#64748B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  questionNo: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#00AFA3',
    letterSpacing: 1,
  },
  difficulty: {
    fontSize: 10,
    fontFamily: 'Inter-Bold',
    color: '#64748B',
    textTransform: 'uppercase',
  },
  question: {
    fontSize: 16,
    lineHeight: 23,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
  },
  answerGrid: {
    gap: 10,
    marginTop: 14,
  },
  answerBox: {
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
  },
  wrongBox: {
    backgroundColor: '#FFF1F2',
    borderColor: '#FDA4AF',
  },
  correctBox: {
    backgroundColor: '#ECFDF5',
    borderColor: '#86EFAC',
  },
  answerLabel: {
    fontSize: 10,
    fontFamily: 'Poppins-Bold',
    color: '#64748B',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  answerText: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Inter-SemiBold',
    color: '#0F172A',
  },
  explainBox: {
    marginTop: 14,
    padding: 13,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  explainHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  explainLabel: {
    fontSize: 11,
    fontFamily: 'Poppins-Bold',
    color: '#0F172A',
    textTransform: 'uppercase',
  },
  explainText: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: 'Inter-Medium',
    color: '#475569',
  },
});
