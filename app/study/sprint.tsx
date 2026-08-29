import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
  StatusBar, ActivityIndicator, Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { MotiView, AnimatePresence } from 'moti';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { weakAreasService, WeakTopic, SprintContent } from '@/services/weakAreasService';
import { showAILimitPrompt } from '@/utils/aiLimitPrompt';

const { width: W } = Dimensions.get('window');
const CARD_SECONDS = 25;
const CHECK_SECONDS = 30;

type Phase = 'loading' | 'topic-entry' | 'preparing' | 'sprint' | 'done';

export default function SprintSession({ embedded = false, onClose, topic: topicProp }: { embedded?: boolean; onClose?: () => void; topic?: string } = {}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ topic?: string }>();
  const routeTopic = topicProp ?? params.topic;

  const [phase, setPhase] = useState<Phase>('loading');
  const [topics, setTopics] = useState<WeakTopic[]>([]);
  const [ti, setTi] = useState(0);                 // topic index
  const [si, setSi] = useState(0);                 // step index within topic
  const [content, setContent] = useState<SprintContent | null>(null);
  const [manualTopic, setManualTopic] = useState('');
  const [timeLeft, setTimeLeft] = useState(CARD_SECONDS);

  // checkpoint state
  const [picked, setPicked] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revisedCount, setRevisedCount] = useState(0);
  const timerRef = useRef<any>(null);

  const topic = topics[ti];
  const cards = content?.cards ?? [];
  const checkpoint = content?.checkpoint ?? null;
  const totalSteps = cards.length + (checkpoint ? 1 : 0);
  const onCheckpoint = si >= cards.length && !!checkpoint;

  // ── Load due topics on mount ────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      if (routeTopic && String(routeTopic).trim()) {
        await weakAreasService.addManual(String(routeTopic).trim());
      }
      const due = await weakAreasService.getDueTopics(6);
      if (due.length === 0) { setPhase('topic-entry'); return; }
      setTopics(due);
      setPhase('preparing');
    })();
  }, []);

  // ── Generate content when the topic changes ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'preparing' || !topics[ti]) return;
    let alive = true;
    (async () => {
      try {
        const c = await weakAreasService.generateSprint(topics[ti].topic, topics[ti].reason, topics[ti].subject || 'UPSC');
        if (!alive) return;
        if (!c) { advanceTopic(); return; }   // skip a topic that failed to generate
        setContent(c);
        setSi(0); setPicked(null); setRevealed(false);
        setPhase('sprint');
      } catch (e: any) {
        if (!alive) return;
        const msg = String(e?.message || '');
        if (msg.startsWith('LIMIT_REACHED:')) {
          showAILimitPrompt(msg.replace('LIMIT_REACHED:', ''));
          if (embedded && onClose) onClose(); else router.back();
          return;
        }
        advanceTopic();
      }
    })();
    return () => { alive = false; };
  }, [phase, ti]);

  // ── Per-step countdown ──────────────────────────────────────────────────────
  const stopTimer = () => { if (timerRef.current) clearInterval(timerRef.current); timerRef.current = null; };
  useEffect(() => {
    if (phase !== 'sprint') return;
    stopTimer();
    setTimeLeft(onCheckpoint ? CHECK_SECONDS : CARD_SECONDS);
    timerRef.current = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          stopTimer();
          if (onCheckpoint) { if (!revealed) revealCheckpoint(-1); }
          else nextStep();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return stopTimer;
  }, [phase, si, ti]);

  const nextStep = useCallback(() => {
    stopTimer();
    Haptics.selectionAsync().catch(() => {});
    if (si < totalSteps - 1) setSi((s) => s + 1);
    else advanceTopic();
  }, [si, totalSteps]);

  const advanceTopic = useCallback(() => {
    stopTimer();
    if (ti < topics.length - 1) { setTi((x) => x + 1); setContent(null); setPhase('preparing'); }
    else { setPhase('done'); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }
  }, [ti, topics.length]);

  const revealCheckpoint = useCallback((idx: number) => {
    if (revealed || !checkpoint || !topic) return;
    stopTimer();
    setPicked(idx);
    setRevealed(true);
    const correct = idx === checkpoint.answerIndex;
    if (correct) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (topic.id) { weakAreasService.markRevised(topic.id); setRevisedCount((c) => c + 1); }
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      // still weak — reinforce so it resurfaces
      weakAreasService.recordWrong(topic.topic, topic.subject, 'Missed the sprint checkpoint', 'sprint');
    }
  }, [revealed, checkpoint, topic]);

  const exit = () => { stopTimer(); if (onClose) onClose(); else router.back(); };

  // ── LOADING ─────────────────────────────────────────────────────────────────
  if (phase === 'loading' || phase === 'preparing') {
    return (
      <View style={[styles.root, styles.center]}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator color="#8B5CF6" size="large" />
        <Text style={styles.dim}>{phase === 'preparing' ? `Preparing “${topics[ti]?.topic ?? ''}”…` : 'Loading your weak areas…'}</Text>
      </View>
    );
  }

  // ── TOPIC ENTRY (nothing due) ───────────────────────────────────────────────
  if (phase === 'topic-entry') {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 30, paddingHorizontal: 24 }]}>
        <StatusBar barStyle="light-content" />
        <TouchableOpacity onPress={exit} style={styles.exitBtn}><Ionicons name="close" size={22} color="#E2E8F0" /></TouchableOpacity>
        <View style={styles.center2}>
          <View style={styles.trophyWrap}><Ionicons name="sparkles" size={30} color="#FBBF24" /></View>
          <Text style={styles.entryTitle}>All caught up!</Text>
          <Text style={styles.dim}>No weak areas are due right now. Pick any topic to sprint on.</Text>
          <TextInput
            style={styles.entryInput}
            placeholder="e.g. Fundamental Rights"
            placeholderTextColor="#64748B"
            value={manualTopic}
            onChangeText={setManualTopic}
            autoFocus
          />
          <TouchableOpacity
            style={[styles.primaryBtn, !manualTopic.trim() && { opacity: 0.4 }]}
            disabled={!manualTopic.trim()}
            onPress={async () => {
              const t = manualTopic.trim();
              await weakAreasService.addManual(t);
              const due = await weakAreasService.getDueTopics(6);
              setTopics(due.length ? due : [{ id: '', subject: 'General', topic: t, reason: null, strength: 0, times_wrong: 1, times_revised: 0, status: 'active', last_wrong_at: '', next_due_at: '' }]);
              setTi(0); setPhase('preparing');
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="flash" size={18} color="#fff" style={{ marginRight: 8 }} />
            <Text style={styles.primaryBtnText}>Start Sprint</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── DONE ────────────────────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <View style={[styles.root, styles.center, { paddingHorizontal: 24 }]}>
        <StatusBar barStyle="light-content" />
        <MotiView from={{ scale: 0.7, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring' }} style={styles.doneRing}>
          <Text style={styles.doneNum}>{revisedCount}</Text>
        </MotiView>
        <Text style={styles.entryTitle}>Sprint complete</Text>
        <Text style={styles.dim}>You revised {revisedCount} of {topics.length} weak {topics.length === 1 ? 'area' : 'areas'}. Mastered ones won't come back until they're due.</Text>
        <TouchableOpacity style={[styles.primaryBtn, { marginTop: 26 }]} onPress={exit} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── SPRINT ──────────────────────────────────────────────────────────────────
  const card = cards[si];
  const timerPct = Math.max(0, timeLeft / (onCheckpoint ? CHECK_SECONDS : CARD_SECONDS));

  return (
    <View style={[styles.root, { paddingTop: insets.top + 6 }]}>
      <StatusBar barStyle="light-content" />

      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={exit} style={styles.exitBtn}><Ionicons name="close" size={20} color="#94A3B8" /></TouchableOpacity>
        <View style={styles.stepDots}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <View key={i} style={[styles.dot, i === si && styles.dotActive, i < si && styles.dotDone]} />
          ))}
        </View>
        <View style={styles.timerPill}>
          <Ionicons name="time-outline" size={13} color={timeLeft <= 5 ? '#F87171' : '#A78BFA'} />
          <Text style={[styles.timerText, timeLeft <= 5 && { color: '#F87171' }]}>{timeLeft}</Text>
        </View>
      </View>
      <View style={styles.timerTrack}><View style={[styles.timerFill, { width: `${timerPct * 100}%` }]} /></View>

      <Text style={styles.topicLabel}>{topic?.topic?.toUpperCase()} · TOPIC {ti + 1}/{topics.length}</Text>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
        <AnimatePresence exitBeforeEnter>
          {!onCheckpoint && card ? (
            <MotiView
              key={`c-${ti}-${si}`}
              from={{ opacity: 0, translateY: 26 }}
              animate={{ opacity: 1, translateY: 0 }}
              exit={{ opacity: 0, translateY: -18 }}
              transition={{ type: 'timing', duration: 320 }}
              style={styles.card}
            >
              <Text style={styles.cardHeading}>{card.heading}</Text>
              {card.points.map((p, i) => (
                <View key={i} style={styles.pointRow}>
                  <View style={styles.pointDot} />
                  <Text style={styles.pointText}>{p}</Text>
                </View>
              ))}
              {!!card.insight && (
                <View style={styles.insightBox}>
                  <Ionicons name="bulb" size={14} color="#FBBF24" />
                  <Text style={styles.insightText}>{card.insight}</Text>
                </View>
              )}
            </MotiView>
          ) : checkpoint ? (
            <MotiView
              key={`q-${ti}`}
              from={{ opacity: 0, translateY: 26 }}
              animate={{ opacity: 1, translateY: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: 'timing', duration: 320 }}
              style={styles.card}
            >
              <Text style={styles.checkLabel}>QUICK CHECK</Text>
              <Text style={styles.checkQ}>{checkpoint.question}</Text>
              {checkpoint.options.map((opt, i) => {
                const isCorrect = revealed && i === checkpoint.answerIndex;
                const isWrong = revealed && i === picked && i !== checkpoint.answerIndex;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[styles.opt, isCorrect && styles.optCorrect, isWrong && styles.optWrong]}
                    disabled={revealed}
                    onPress={() => revealCheckpoint(i)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.optText, (isCorrect || isWrong) && { color: '#0F172A', fontFamily: 'Poppins-SemiBold' }]}>{opt}</Text>
                    {isCorrect && <Ionicons name="checkmark-circle" size={18} color="#059669" />}
                    {isWrong && <Ionicons name="close-circle" size={18} color="#DC2626" />}
                  </TouchableOpacity>
                );
              })}
              {revealed && !!checkpoint.explanation && (
                <View style={styles.explainBox}><Text style={styles.explainText}>{checkpoint.explanation}</Text></View>
              )}
            </MotiView>
          ) : null}
        </AnimatePresence>
      </ScrollView>

      {/* Bottom action */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}>
        {!onCheckpoint ? (
          <TouchableOpacity style={styles.nextBtn} onPress={nextStep} activeOpacity={0.9}>
            <Text style={styles.nextText}>{si === totalSteps - 1 ? 'Finish topic' : 'Next'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        ) : revealed ? (
          <TouchableOpacity style={styles.nextBtn} onPress={advanceTopic} activeOpacity={0.9}>
            <Text style={styles.nextText}>{ti === topics.length - 1 ? 'Finish sprint' : 'Next topic'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        ) : (
          <Text style={styles.tapHint}>Tap an answer</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B0B14' },
  center: { justifyContent: 'center', alignItems: 'center', gap: 14 },
  center2: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  dim: { fontSize: 14, fontFamily: 'Inter-Medium', color: '#94A3B8', textAlign: 'center', lineHeight: 20 },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 10 },
  exitBtn: { width: 38, height: 38, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  stepDots: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.16)' },
  dotActive: { backgroundColor: '#A78BFA', width: 20 },
  dotDone: { backgroundColor: '#8B5CF6' },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(167,139,250,0.14)', paddingHorizontal: 10, height: 32, borderRadius: 12 },
  timerText: { fontSize: 14, fontFamily: 'Poppins-Bold', color: '#A78BFA', minWidth: 18, textAlign: 'center' },
  timerTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.08)', marginHorizontal: 16, borderRadius: 2, overflow: 'hidden' },
  timerFill: { height: '100%', backgroundColor: '#8B5CF6', borderRadius: 2 },
  topicLabel: { fontSize: 10.5, fontFamily: 'Poppins-Bold', color: '#64748B', letterSpacing: 1.2, marginTop: 14, marginLeft: 22 },

  card: { backgroundColor: '#15151F', borderRadius: 24, padding: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginTop: 10 },
  cardHeading: { fontSize: 20, fontFamily: 'Poppins-Bold', color: '#F8FAFC', marginBottom: 16, lineHeight: 27 },
  pointRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  pointDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#8B5CF6', marginTop: 8 },
  pointText: { flex: 1, fontSize: 15, fontFamily: 'Inter-Medium', color: '#CBD5E1', lineHeight: 22 },
  insightBox: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: 'rgba(251,191,36,0.08)', borderRadius: 14, padding: 12, marginTop: 8 },
  insightText: { flex: 1, fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#FCD34D', lineHeight: 19 },

  checkLabel: { fontSize: 10, fontFamily: 'Poppins-Bold', color: '#A78BFA', letterSpacing: 1.5, marginBottom: 10 },
  checkQ: { fontSize: 17, fontFamily: 'Poppins-SemiBold', color: '#F8FAFC', marginBottom: 18, lineHeight: 24 },
  opt: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.07)' },
  optCorrect: { backgroundColor: '#D1FAE5', borderColor: '#059669' },
  optWrong: { backgroundColor: '#FEE2E2', borderColor: '#DC2626' },
  optText: { flex: 1, fontSize: 15, fontFamily: 'Inter-Medium', color: '#E2E8F0' },
  explainBox: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 14, padding: 14, marginTop: 6, borderLeftWidth: 3, borderLeftColor: '#8B5CF6' },
  explainText: { fontSize: 13, fontFamily: 'Inter-Medium', color: '#CBD5E1', lineHeight: 20 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, backgroundColor: 'rgba(11,11,20,0.9)' },
  nextBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, borderRadius: 16, backgroundColor: '#7C3AED' },
  nextText: { fontSize: 16, fontFamily: 'Poppins-Bold', color: '#fff' },
  tapHint: { textAlign: 'center', fontSize: 13, fontFamily: 'Inter-Medium', color: '#64748B', paddingVertical: 18 },

  // entry / done
  trophyWrap: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(251,191,36,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  entryTitle: { fontSize: 24, fontFamily: 'Poppins-Bold', color: '#F8FAFC', textAlign: 'center' },
  entryInput: { width: '100%', height: 54, backgroundColor: '#15151F', borderRadius: 16, paddingHorizontal: 18, fontSize: 16, fontFamily: 'Poppins-SemiBold', color: '#F8FAFC', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginTop: 18, marginBottom: 14 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 54, borderRadius: 16, backgroundColor: '#7C3AED', paddingHorizontal: 40 },
  primaryBtnText: { fontSize: 16, fontFamily: 'Poppins-Bold', color: '#fff' },
  doneRing: { width: 120, height: 120, borderRadius: 60, borderWidth: 3, borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  doneNum: { fontSize: 48, fontFamily: 'Poppins-Bold', color: '#F8FAFC' },
});
