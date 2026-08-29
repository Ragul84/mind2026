import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { MotiView } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import HapticService from '@/utils/hapticService';
import { MOCK_CONFIGS, MockConfig } from '@/utils/mockConfig';

// Exam metadata (icon + colour) mirrors utils/redisService DEFAULT_EXAMS so the
// mock list reads as part of the same product. Banking is intentionally omitted
// while its exam is gated "Coming soon".
const EXAM_META: Record<string, { icon: string; strong: string; soft: string }> = {
  upsc: { icon: 'landmark', strong: '#8B5CF6', soft: '#EDE9FE' },
  ssc: { icon: 'gavel', strong: '#F59E0B', soft: '#FEF3C7' },
  rrb: { icon: 'train', strong: '#F43F5E', soft: '#FFE4E6' },
  tnpsc: { icon: 'university', strong: '#0F766E', soft: '#CCFBF1' },
};
const LIST: MockConfig[] = ['tnpsc', 'upsc', 'ssc', 'rrb'].map((id) => MOCK_CONFIGS[id]).filter(Boolean);

function totalQuestions(c: MockConfig) {
  return c.sections.reduce((n, s) => n + s.count, 0);
}
function patternLine(c: MockConfig) {
  const q = totalQuestions(c);
  const neg = c.negativeMark > 0 ? `−${c.negativeMark} negative` : 'no negative';
  return `${q} questions · ${c.durationMin} min · ${neg}`;
}

export default function MockList() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <View style={styles.bandTop} pointerEvents="none" />
      <View style={styles.bandBottom} pointerEvents="none" />

      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.circleClose} onPress={() => { HapticService.selection(); router.back(); }}>
          <Ionicons name="chevron-back" size={20} color="#475569" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Mock Tests</Text>
          <Text style={styles.headerSub}>Full-length, exam-pattern &amp; ranked</Text>
        </View>
        <View style={styles.headerMark}><Ionicons name="timer-outline" size={18} color="#FFFFFF" /></View>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={styles.intro}>
          <Text style={styles.introTitle}>Take a real mock</Text>
          <Text style={styles.introCopy}>Exact exam pattern — timed, sectioned and negative-marked. Submit to see your section-wise score.</Text>
        </View>

        <View style={styles.list}>
          {LIST.map((c, index) => {
            const meta = EXAM_META[c.examId];
            return (
              <MotiView key={c.examId} from={{ opacity: 0, translateY: 10 }} animate={{ opacity: 1, translateY: 0 }} transition={{ type: 'timing', duration: 240, delay: index * 40 }}>
                <TouchableOpacity
                  style={[styles.card, { borderBottomColor: `${meta.strong}40` }]}
                  activeOpacity={0.78}
                  onPress={() => { HapticService.medium(); router.push(`/mock/${c.examId}`); }}
                >
                  <View style={[styles.iconWrap, { backgroundColor: meta.soft }]}>
                    <FontAwesome5 name={meta.icon} size={18} color={meta.strong} />
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={styles.cardName}>{c.name}</Text>
                    <Text style={styles.cardPattern}>{patternLine(c)}</Text>
                    <View style={styles.tagRow}>
                      {c.sections.map((s) => (
                        <View key={s.id} style={styles.tag}><Text style={styles.tagText}>{s.name.split(' ')[0]} {s.count}</Text></View>
                      ))}
                    </View>
                  </View>
                  <View style={[styles.startBtn, { backgroundColor: meta.strong }]}>
                    <Ionicons name="play" size={13} color="#FFFFFF" style={{ marginLeft: 2 }} />
                  </View>
                </TouchableOpacity>
              </MotiView>
            );
          })}
        </View>

        <Text style={styles.footNote}>Patterns follow the standard form of each exam. Questions are drawn live from our verified pools.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  bandTop: { position: 'absolute', top: -105, left: -45, right: -45, height: 215, backgroundColor: 'rgba(0,212,199,0.06)', transform: [{ rotate: '-7deg' }] },
  bandBottom: { position: 'absolute', bottom: -100, left: -50, right: -50, height: 210, backgroundColor: 'rgba(139,92,246,0.05)', transform: [{ rotate: '6deg' }] },

  header: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 16, paddingBottom: 8 },
  circleClose: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#F8FAFC', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E8EEF6' },
  headerInfo: { flex: 1 },
  headerTitle: { fontSize: 18, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  headerSub: { fontSize: 11.5, fontFamily: 'Inter-Medium', color: '#94A3B8', marginTop: -1 },
  headerMark: { width: 38, height: 38, borderRadius: 14, backgroundColor: '#00AFA5', alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 16, paddingTop: 14 },
  intro: { marginBottom: 20, paddingHorizontal: 3 },
  introTitle: { fontFamily: 'Poppins-Bold', fontSize: 26, lineHeight: 32, color: '#0F172A', letterSpacing: -0.5 },
  introCopy: { marginTop: 6, maxWidth: 340, fontFamily: 'Inter-Medium', fontSize: 13, lineHeight: 19, color: '#64748B' },

  list: { gap: 11 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 13, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#DCE5EE', borderBottomWidth: 3 },
  iconWrap: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  cardBody: { flex: 1 },
  cardName: { fontSize: 15, lineHeight: 20, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  cardPattern: { marginTop: 2, fontSize: 11, fontFamily: 'Inter-SemiBold', color: '#64748B' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  tag: { backgroundColor: '#F1F5F9', borderRadius: 7, paddingHorizontal: 7, paddingVertical: 3 },
  tagText: { fontSize: 9.5, fontFamily: 'Poppins-SemiBold', color: '#64748B' },
  startBtn: { width: 36, height: 36, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },

  footNote: { marginTop: 22, fontSize: 11, fontFamily: 'Inter-Medium', color: '#94A3B8', lineHeight: 16, paddingHorizontal: 3 },
});
