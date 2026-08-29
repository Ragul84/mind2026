import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticService from '@/utils/hapticService';
import { PyqService, PyqExam, PyqYear } from '@/utils/pyqService';

const META: Record<string, { icon: string; strong: string; soft: string }> = {
  UPSC:  { icon: 'landmark',       strong: '#2563EB', soft: '#DBEAFE' },
  SSC:   { icon: 'file-signature', strong: '#D97706', soft: '#FEF3C7' },
  TNPSC: { icon: 'graduation-cap', strong: '#0F766E', soft: '#CCFBF1' },
  JEE:   { icon: 'atom',           strong: '#7C3AED', soft: '#EDE9FE' },
  NEET:  { icon: 'heartbeat',      strong: '#DC2626', soft: '#FEE2E2' },
};
const metaFor = (e: string) => META[e?.toUpperCase()] || { icon: 'book', strong: '#0F766E', soft: '#CCFBF1' };

// SSC and NEET currently have too few verified years to feel like a real
// practice tool (1 year each) — show them as "coming soon" instead of a
// thin, disappointing category until more years are ingested.
const COMING_SOON_EXAMS = ['SSC', 'NEET'];

export default function PyqHub() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'exam' | 'year'>('exam');
  const [exams, setExams] = useState<PyqExam[]>([]);
  const [exam, setExam] = useState<PyqExam | null>(null);
  const [years, setYears] = useState<PyqYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearLoading, setYearLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    PyqService.getExams().then((e) => {
      if (alive) { setExams(e.filter((x) => !COMING_SOON_EXAMS.includes(x.exam?.toUpperCase()))); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  const openExam = useCallback(async (e: PyqExam) => {
    HapticService.selection();
    setExam(e); setStep('year'); setYearLoading(true);
    const y = await PyqService.getYears(e.exam);
    setYears(y); setYearLoading(false);
  }, []);

  const back = () => {
    if (step === 'year') { setStep('exam'); setExam(null); setYears([]); }
    else router.back();
  };

  return (
    <View style={styles.container}>
      <View style={styles.bandTop} pointerEvents="none" />
      <View style={styles.bandBottom} pointerEvents="none" />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.circleClose} onPress={back}><Ionicons name="chevron-back" size={20} color="#475569" /></TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Verified PYQs</Text>
          <Text style={styles.headerSub}>{step === 'exam' ? 'Verified previous-year questions' : `${exam?.exam} · pick a year`}</Text>
        </View>
        <View style={styles.headerMark}><Ionicons name="ribbon-outline" size={18} color="#FFFFFF" /></View>
      </View>
      <View style={styles.headerSep} />

      <ScrollView style={styles.scrollFlex} contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator size="large" color="#00AFA5" style={{ marginTop: 40 }} />
        ) : exams.length === 0 ? (
          <View style={styles.emptyBox}>
            <Ionicons name="construct-outline" size={34} color="#CBD5E1" />
            <Text style={styles.emptyText}>Previous papers are being prepared</Text>
            <Text style={styles.emptySub}>Verified questions will appear here as they're added.</Text>
          </View>
        ) : step === 'exam' ? (
          <View style={styles.list}>
            {exams.map((e, i) => {
              const m = metaFor(e.exam);
              return (
                <MotiView key={e.exam} from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 220, delay: i * 40 }}>
                  <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={() => openExam(e)}>
                    <View style={[styles.coin, { backgroundColor: m.soft }]}><FontAwesome5 name={m.icon} size={17} color={m.strong} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{e.exam}</Text>
                      <Text style={styles.cardMeta}>{e.total_questions} verified Qs · {e.from_year}–{e.to_year} · {e.years_covered} years</Text>
                    </View>
                    <View style={[styles.go, { backgroundColor: m.strong }]}><Ionicons name="chevron-forward" size={15} color="#FFFFFF" /></View>
                  </TouchableOpacity>
                </MotiView>
              );
            })}
            {COMING_SOON_EXAMS.map((exName, i) => {
              const m = metaFor(exName);
              return (
                <MotiView key={exName} from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 220, delay: (exams.length + i) * 40 }}>
                  <View style={[styles.card, styles.cardDisabled]}>
                    <View style={[styles.coin, { backgroundColor: m.soft, opacity: 0.6 }]}><FontAwesome5 name={m.icon} size={17} color={m.strong} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.cardTitle, styles.cardTitleDisabled]}>{exName}</Text>
                      <Text style={styles.cardMeta}>Verified questions coming soon</Text>
                    </View>
                    <View style={styles.comingSoonPill}><Text style={styles.comingSoonPillText}>Soon</Text></View>
                  </View>
                </MotiView>
              );
            })}
          </View>
        ) : yearLoading ? (
          <ActivityIndicator size="large" color="#00AFA5" style={{ marginTop: 40 }} />
        ) : years.length === 0 ? (
          <View style={styles.emptyBox}><Ionicons name="calendar-outline" size={32} color="#CBD5E1" /><Text style={styles.emptyText}>No papers yet for {exam?.exam}</Text></View>
        ) : (
          <View style={styles.list}>
            {years.map((y, i) => {
              const m = metaFor(exam!.exam);
              return (
                <MotiView key={y.year} from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 220, delay: i * 35 }}>
                  <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={() => { HapticService.medium(); router.push(`/pyq/paper?exam=${encodeURIComponent(exam!.exam)}&year=${y.year}`); }}>
                    <View style={[styles.yearCoin, { backgroundColor: m.soft }]}><FontAwesome5 name={m.icon} size={18} color={m.strong} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{exam!.exam} {y.year}</Text>
                      <Text style={styles.cardMeta}>{y.question_count} verified question{y.question_count === 1 ? '' : 's'}</Text>
                    </View>
                    <View style={[styles.play, { backgroundColor: m.strong }]}><Ionicons name="play" size={12} color="#FFFFFF" style={{ marginLeft: 2 }} /></View>
                  </TouchableOpacity>
                </MotiView>
              );
            })}
          </View>
        )}
      </ScrollView>
      <View style={[styles.bottomGuard, { height: Math.max(insets.bottom, 16) }]} pointerEvents="none" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  bandTop: { position: 'absolute', top: -105, left: -45, right: -45, height: 215, backgroundColor: 'rgba(14,165,233,0.06)', transform: [{ rotate: '-7deg' }] },
  bandBottom: { position: 'absolute', bottom: -100, left: -50, right: -50, height: 210, backgroundColor: 'rgba(0,212,199,0.05)', transform: [{ rotate: '6deg' }] },

  header: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingBottom: 8 },
  circleClose: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF6' },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 18, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  headerSub: { fontSize: 11.5, fontFamily: 'Inter-Medium', color: '#94A3B8', marginTop: -1 },
  headerMark: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#00AFA5', alignItems: 'center', justifyContent: 'center' },
  headerSep: { height: 1, backgroundColor: '#EBEFF4', marginHorizontal: 16, marginBottom: 4 },

  scrollFlex: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 16 },
  bottomGuard: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF' },
  list: { gap: 11 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, borderWidth: 1.5, borderColor: '#E7EEF4', borderBottomWidth: 5, borderBottomColor: '#D6E0EA' },
  coin: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  yearCoin: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 15.5, fontFamily: 'Poppins-Bold', color: '#0B2540', letterSpacing: -0.2 },
  cardMeta: { marginTop: 2, fontSize: 11.5, fontFamily: 'Inter-Medium', color: '#64748B' },
  go: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  play: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardDisabled: { opacity: 0.6, borderStyle: 'dashed' },
  cardTitleDisabled: { color: '#64748B' },
  comingSoonPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: '#F1F5F9' },
  comingSoonPillText: { fontSize: 10.5, fontFamily: 'Inter-Bold', color: '#94A3B8' },

  emptyBox: { alignItems: 'center', gap: 8, marginTop: 50, paddingHorizontal: 30 },
  emptyText: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#64748B', textAlign: 'center' },
  emptySub: { fontSize: 12.5, fontFamily: 'Inter-Medium', color: '#94A3B8', textAlign: 'center' },
});
