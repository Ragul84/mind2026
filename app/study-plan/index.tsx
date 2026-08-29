import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import HapticService from '@/utils/hapticService';
import { weakAreasService, WeakTopic } from '@/services/weakAreasService';
import { getIndiaDateKey } from '@/utils/redisService';
import { EXAM_CALENDAR, getExam, getBranch, daysUntil } from '@/utils/examCalendar';

const SEL_KEY = 'study_plan_exam';       // { examId, branchId }
const checkedKey = (d: string) => `study_plan_checked:${d}`;

type Task = { id: string; icon: string; color: string; title: string; sub: string; route: string };
const baseTasks = (topWeak: WeakTopic | null): Task[] => [
  { id: 'revise', icon: 'bullseye', color: '#EF4444', title: 'Revise your weak areas', sub: topWeak ? `Start with ${topWeak.topic}` : 'Re-attempt what you missed', route: '/quiz/mistakes' },
  { id: 'mock', icon: 'stopwatch', color: '#00B4A6', title: 'Take a mock test', sub: 'Timed, exam-pattern, ranked', route: '/mock' },
  { id: 'pyq', icon: 'history', color: '#0EA5E9', title: 'Practice a previous paper', sub: 'Verified previous-year questions', route: '/pyq' },
  { id: 'answer', icon: 'feather-alt', color: '#7C3AED', title: 'Write one answer', sub: 'MIGA scores it on a rubric', route: '/answer-eval' },
  { id: 'sprint', icon: 'bolt', color: '#FF9600', title: 'Quick sprint', sub: '10 rapid questions', route: '/quiz/reader?mode=quick-sprint' },
];

export default function StudyPlan() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = getIndiaDateKey();

  const [loading, setLoading] = useState(true);
  const [weak, setWeak] = useState<WeakTopic[]>([]);
  const [sel, setSel] = useState<{ examId: string; branchId: string } | null>(null);
  const [pickerExam, setPickerExam] = useState<string | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [due, selStr, chk] = await Promise.all([
      weakAreasService.getDueTopics(4).catch(() => []),
      AsyncStorage.getItem(SEL_KEY),
      AsyncStorage.getItem(checkedKey(today)),
    ]);
    setWeak(due);
    const parsed = selStr ? JSON.parse(selStr) : null;
    setSel(parsed);
    // Onboarding sets only the exam — pre-open its branches so it's a one-tap finish.
    if (parsed && !parsed.branchId) setPickerExam(parsed.examId);
    setChecked(new Set(chk ? JSON.parse(chk) : []));
    setLoading(false);
  }, [today]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggle = async (id: string) => {
    HapticService.selection();
    const next = new Set(checked);
    next.has(id) ? next.delete(id) : next.add(id);
    setChecked(next);
    await AsyncStorage.setItem(checkedKey(today), JSON.stringify([...next]));
  };

  const pick = async (examId: string, branchId: string) => {
    HapticService.medium();
    const v = { examId, branchId };
    setSel(v); setPickerExam(null);
    await AsyncStorage.setItem(SEL_KEY, JSON.stringify(v));
  };
  const clearSel = async () => { setSel(null); await AsyncStorage.removeItem(SEL_KEY); };

  const branch = sel ? getBranch(sel.examId, sel.branchId) : undefined;
  const exam = sel ? getExam(sel.examId) : undefined;
  const dLeft = daysUntil(branch?.date);
  const tasks = baseTasks(weak[0] ?? null);
  const doneCount = tasks.filter((t) => checked.has(t.id)).length;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.circleClose} onPress={() => router.back()}><Ionicons name="chevron-back" size={20} color="#475569" /></TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Study Plan</Text>
          <Text style={styles.headerSub}>Your plan for today</Text>
        </View>
        <View style={styles.headerMark}><FontAwesome5 name="calendar-check" size={15} color="#FFFFFF" /></View>
      </View>
      <View style={styles.headerSep} />

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]} showsVerticalScrollIndicator={false}>
        {/* Exam + countdown */}
        {sel && branch ? (
          <View style={styles.countCard}>
            <View style={styles.countLeft}>
              <Text style={styles.countBig}>{dLeft != null ? dLeft : '—'}</Text>
              <Text style={styles.countUnit}>{dLeft != null ? 'days' : 'TBA'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.countTitle}>{exam?.name}</Text>
              <Text style={styles.countSub}>
                {branch.label}
                {dLeft != null ? ` · ${new Date(branch.date! + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : ' · date not announced yet'}
                {branch.tentative && branch.date ? ' (tentative)' : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={clearSel} hitSlop={8}><Ionicons name="pencil" size={15} color="#94A3B8" /></TouchableOpacity>
          </View>
        ) : (
          <View style={styles.setCard}>
            <Text style={styles.setLabel}>Which exam are you preparing for?</Text>
            <View style={styles.chipRow}>
              {EXAM_CALENDAR.map((e) => (
                <TouchableOpacity key={e.id} style={[styles.chip, pickerExam === e.id && styles.chipOn]} onPress={() => { HapticService.selection(); setPickerExam(pickerExam === e.id ? null : e.id); }}>
                  <FontAwesome5 name={e.icon} size={12} color={pickerExam === e.id ? '#0F766E' : e.color} />
                  <Text style={[styles.chipText, pickerExam === e.id && styles.chipTextOn]}>{e.name.split(' ')[0]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {pickerExam && (
              <>
                <Text style={styles.branchLabel}>Pick your paper</Text>
                <View style={styles.chipRow}>
                  {getExam(pickerExam)?.branches.map((b) => (
                    <TouchableOpacity key={b.id} style={styles.branchChip} onPress={() => pick(pickerExam, b.id)}>
                      <Text style={styles.branchChipText}>{b.label}</Text>
                      {b.date && <Text style={styles.branchChipDate}>{new Date(b.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}{b.tentative ? '*' : ''}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {/* Today's plan */}
        <View style={styles.planHead}>
          <Text style={styles.sectionLabel}>TODAY'S PLAN</Text>
          <Text style={styles.progress}>{doneCount}/{tasks.length} done</Text>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#00AFA5" style={{ marginTop: 30 }} />
        ) : (
          tasks.map((t, i) => {
            const done = checked.has(t.id);
            return (
              <MotiView key={t.id} from={{ opacity: 0, translateY: 8 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 200, delay: i * 40 }}>
                <View style={[styles.task, done && styles.taskDone]}>
                  <TouchableOpacity onPress={() => toggle(t.id)} hitSlop={8}>
                    <View style={[styles.check, done && styles.checkOn]}>{done && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}</View>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.taskBody} activeOpacity={0.8} onPress={() => { HapticService.medium(); router.push(t.route as any); }}>
                    <View style={[styles.taskIcon, { backgroundColor: t.color + '18' }]}><FontAwesome5 name={t.icon} size={15} color={t.color} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.taskTitle, done && styles.taskTitleDone]}>{t.title}</Text>
                      <Text style={styles.taskSub}>{t.sub}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color="#CBD5E1" />
                  </TouchableOpacity>
                </View>
              </MotiView>
            );
          })
        )}

        {/* Weak-area focus */}
        {weak.length > 0 && (
          <View style={styles.focusCard}>
            <View style={styles.focusHead}><Ionicons name="flame" size={14} color="#EF4444" /><Text style={styles.focusTitle}>Focus areas</Text></View>
            <View style={styles.focusChips}>
              {weak.map((w) => (
                <View key={w.id} style={styles.focusChip}><Text style={styles.focusChipText}>{w.topic}</Text></View>
              ))}
            </View>
            <TouchableOpacity style={styles.focusBtn} onPress={() => router.push('/quiz/mistakes')}>
              <Text style={styles.focusBtnText}>Revise these now</Text><Ionicons name="arrow-forward" size={14} color="#0F766E" />
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
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
  headerMark: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#0F766E', alignItems: 'center', justifyContent: 'center' },
  headerSep: { height: 1, backgroundColor: '#EBEFF4', marginHorizontal: 16, marginBottom: 4 },

  scroll: { paddingHorizontal: 18, paddingTop: 16 },

  countCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#F0FDFC', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#CCFBF1', marginBottom: 20 },
  countLeft: { alignItems: 'center', minWidth: 52 },
  countBig: { fontSize: 30, fontFamily: 'Poppins-Bold', color: '#0F766E', letterSpacing: -1, lineHeight: 33 },
  countUnit: { fontSize: 11, fontFamily: 'Poppins-Bold', color: '#0F766E', opacity: 0.7 },
  countTitle: { fontSize: 14.5, fontFamily: 'Poppins-Bold', color: '#0B2540' },
  countSub: { fontSize: 11.5, fontFamily: 'Inter-Medium', color: '#64748B', marginTop: 2 },

  setCard: { backgroundColor: '#F8FAFC', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#E7EEF4', marginBottom: 20 },
  setLabel: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#0F172A', marginBottom: 12 },
  branchLabel: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#64748B', marginTop: 14, marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E7EEF4' },
  chipOn: { backgroundColor: '#F0FDFC', borderColor: '#00D4C7' },
  chipText: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#334155' },
  chipTextOn: { color: '#0F766E' },
  branchChip: { alignItems: 'center', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E7EEF4' },
  branchChipText: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#0B2540' },
  branchChipDate: { fontSize: 10, fontFamily: 'Inter-SemiBold', color: '#94A3B8', marginTop: 1 },

  planHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  sectionLabel: { fontSize: 12.5, fontFamily: 'Poppins-Bold', color: '#334155', letterSpacing: 1.35, textTransform: 'uppercase', opacity: 0.92, marginLeft: 4 },
  progress: { fontSize: 12, fontFamily: 'Poppins-Bold', color: '#94A3B8' },

  task: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 16, padding: 13, marginBottom: 10, borderWidth: 1.5, borderColor: '#E7EEF4', borderBottomWidth: 4, borderBottomColor: '#DCE5EE' },
  taskDone: { backgroundColor: '#F8FAFC', borderBottomColor: '#E7EEF4' },
  check: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#10B981', borderColor: '#10B981' },
  taskBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  taskIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  taskTitle: { fontSize: 14.5, fontFamily: 'Poppins-Bold', color: '#0B2540' },
  taskTitleDone: { color: '#94A3B8', textDecorationLine: 'line-through' },
  taskSub: { fontSize: 11.5, fontFamily: 'Inter-Medium', color: '#64748B', marginTop: 1 },

  focusCard: { backgroundColor: '#FEF7F7', borderRadius: 16, padding: 15, borderWidth: 1, borderColor: '#FEE2E2', marginTop: 12 },
  focusHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  focusTitle: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#B91C1C' },
  focusChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  focusChip: { backgroundColor: '#FFFFFF', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6, borderWidth: 1, borderColor: '#FECACA' },
  focusChipText: { fontSize: 11.5, fontFamily: 'Poppins-SemiBold', color: '#B91C1C' },
  focusBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, height: 42, borderRadius: 12, backgroundColor: '#F0FDFC', borderWidth: 1, borderColor: '#CCFBF1' },
  focusBtnText: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#0F766E' },
});
