import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthContext } from '@/components/AuthProvider';
import { QuizMistakeEntry, QuizMistakeNotebook } from '@/utils/quizMistakeNotebook';

const optionLetter = (idx: number) => (idx >= 0 ? String.fromCharCode(65 + idx) : '-');

export default function MistakeNotebookScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuthContext();
  const [loading, setLoading] = useState(true);
  const [mistakes, setMistakes] = useState<QuizMistakeEntry[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setMistakes(await QuizMistakeNotebook.getNotebook(user?.id));
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const clearNotebook = () => {
    Alert.alert('Clear notebook?', 'This removes saved wrong-answer practice from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await QuizMistakeNotebook.clearNotebook(user?.id);
          setMistakes([]);
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={['#FFFFFF', '#F8FAFC', '#EEF2FF']} style={StyleSheet.absoluteFillObject} />
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>PERSONAL WEAKNESS BANK</Text>
          <Text style={styles.title}>Mistake Notebook</Text>
        </View>
        {mistakes.length > 0 && (
          <TouchableOpacity style={styles.clearBtn} onPress={clearNotebook} activeOpacity={0.85}>
            <Ionicons name="trash-outline" size={17} color="#FB7185" />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#00D4C7" />
          <Text style={styles.loadingText}>Loading your weak questions...</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.summaryCard}>
            <View>
              <Text style={styles.summaryValue}>{mistakes.length}</Text>
              <Text style={styles.summaryLabel}>Questions to master</Text>
            </View>
            <View style={styles.summaryIcon}>
              <Ionicons name="school" size={24} color="#00D4C7" />
            </View>
          </View>

          {mistakes.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="checkmark-circle" size={44} color="#10B981" />
              <Text style={styles.emptyTitle}>No saved mistakes yet</Text>
              <Text style={styles.emptyText}>Finish Quick Sprint or topic quizzes. Wrong answers will collect here automatically.</Text>
            </View>
          ) : (
            mistakes.map((item, index) => {
              const selectedText = item.selected_index >= 0 ? item.options[item.selected_index] : 'Timed out';
              const correctText = item.options[item.correct_index] || '';
              return (
                <View key={`${item.id || item.question}-${index}`} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Text style={styles.sourceText}>{item.sourceTitle || 'Quiz mistake'}</Text>
                    <Text style={styles.attempts}>{item.attempts || 1}x missed</Text>
                  </View>
                  <Text style={styles.question}>{item.question}</Text>
                  <View style={styles.answerRow}>
                    <Text style={styles.wrongText}>You: {optionLetter(item.selected_index)}. {selectedText}</Text>
                    <Text style={styles.correctText}>Correct: {optionLetter(item.correct_index)}. {correctText}</Text>
                  </View>
                  <View style={styles.explainBox}>
                    <Text style={styles.explainText}>
                      {item.explanation || `Revise why option ${optionLetter(item.correct_index)} is correct.`}
                    </Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 12, fontFamily: 'Inter-Medium', color: '#64748B' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingBottom: 14 },
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
  clearBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFF1F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCopy: { flex: 1 },
  kicker: { fontSize: 10, fontFamily: 'Poppins-Bold', color: '#00AFA3', letterSpacing: 1.1 },
  title: { fontSize: 22, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  content: { padding: 18, paddingBottom: 42, gap: 14 },
  summaryCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  summaryValue: { fontSize: 30, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  summaryLabel: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#64748B' },
  summaryIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: '#E0FDFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCard: {
    alignItems: 'center',
    padding: 24,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  emptyTitle: { marginTop: 10, fontSize: 18, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  emptyText: { marginTop: 4, fontSize: 13, lineHeight: 19, fontFamily: 'Inter-Medium', color: '#64748B', textAlign: 'center' },
  card: {
    padding: 15,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.22)',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8 },
  sourceText: { flex: 1, fontSize: 11, fontFamily: 'Poppins-Bold', color: '#00AFA3', textTransform: 'uppercase' },
  attempts: { fontSize: 11, fontFamily: 'Inter-Bold', color: '#FB7185' },
  question: { fontSize: 15, lineHeight: 22, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  answerRow: { gap: 5, marginTop: 12 },
  wrongText: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter-SemiBold', color: '#BE123C' },
  correctText: { fontSize: 12, lineHeight: 18, fontFamily: 'Inter-SemiBold', color: '#047857' },
  explainBox: { marginTop: 12, padding: 12, borderRadius: 15, backgroundColor: '#F8FAFC' },
  explainText: { fontSize: 12, lineHeight: 19, fontFamily: 'Inter-Medium', color: '#475569' },
});
