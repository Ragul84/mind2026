import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, KeyboardAvoidingView, Platform, Alert,
  StatusBar, Share, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import { QuizRoomsService, QuizQuestion } from '@/utils/quizRoomsService';
import HapticService from '@/utils/hapticService';
import { showAILimitPrompt } from '@/utils/aiLimitPrompt';

const STEPS = ['Topic', 'Settings', 'Prizes', 'Launch'] as const;
type Step = 0 | 1 | 2 | 3;

const QUESTION_COUNTS = [5, 10, 15, 20];
const TIME_OPTIONS = [3, 5, 10, 20];

const EXAM_CATEGORIES = [
  'UPSC', 'JEE Main', 'JEE Advanced', 'NEET', 'NCERT Class 10',
  'NCERT Class 11', 'NCERT Class 12', 'SSC CGL', 'IBPS', 'CAT', 'Custom',
];

export default function CreateQuizRoom() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(0);
  const [creating, setCreating] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<any>(null);

  // Step 0 — Topic
  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [examCategory, setExamCategory] = useState('');
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);

  // Step 1 — Settings
  const [questionCount, setQuestionCount] = useState(10);
  const [timePerQuestion, setTimePerQuestion] = useState(10); // default to 10s
  const [customCount, setCustomCount] = useState('');
  const [isCustomCount, setIsCustomCount] = useState(false);
  const [customTime, setCustomTime] = useState('');
  const [isCustomTime, setIsCustomTime] = useState(false);

  // Step 2 — Prizes
  const [prizeEnabled, setPrizeEnabled] = useState(false);
  const [prizePool, setPrizePool] = useState('100');
  const [winnerCount, setWinnerCount] = useState<3 | 5>(3);

  const effectiveCount = isCustomCount ? (parseInt(customCount) || 10) : questionCount;
  const effectiveTime = isCustomTime ? (parseInt(customTime) || 10) : timePerQuestion;

  const canNext = () => {
    if (step === 0) return topic.trim().length > 2;
    if (step === 1) return effectiveCount >= 1 && effectiveCount <= 50 && effectiveTime >= 3 && effectiveTime <= 300;
    return true;
  };

  const handleNext = () => {
    if (!canNext()) return;
    HapticService.medium();
    if (step < 3) setStep((s) => (s + 1) as Step);
    else handleCreate();
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      // Generate questions. On failure this throws (GENERATION_FAILED:/LIMIT_REACHED:)
      // rather than returning [] — a failed room used to silently ship fake
      // "Sample question about X" placeholders with no indication anything
      // had gone wrong, which is worse than telling the user to retry.
      const questions: QuizQuestion[] = await QuizRoomsService.generateQuestions(
        `${topic} ${examCategory ? `(${examCategory})` : ''}`.trim(),
        effectiveCount
      );

      const room = await QuizRoomsService.createRoom({
        title: title.trim() || `${topic.trim()} Quiz`,
        topic: topic.trim(),
        examCategory: examCategory || undefined,
        questionCount: effectiveCount,
        timePerQuestion: effectiveTime,
        prizePool: prizeEnabled ? parseInt(prizePool) || 0 : 0,
        winnerCount,
        questions,
      });

      setCreatedRoom(room);
      HapticService.success();
    } catch (e: any) {
      const msg = String(e.message || '');
      if (msg.startsWith('LIMIT_REACHED:')) {
        showAILimitPrompt(msg.replace('LIMIT_REACHED:', ''));
        return;
      }
      if (msg.startsWith('GENERATION_FAILED:')) {
        Alert.alert('Couldn\'t generate questions', 'Our AI couldn\'t generate questions for this topic right now. Please try again in a moment.');
        return;
      }
      Alert.alert('Failed', msg || 'Could not create the room. Try again.');
    } finally {
      setCreating(false);
    }
  };

  const handleShare = async () => {
    if (!createdRoom) return;
    HapticService.selection();
    const msg = QuizRoomsService.getShareMessage(createdRoom);
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync('', { dialogTitle: 'Share Quiz Room', mimeType: 'text/plain' });
      } else {
        Alert.alert('Share Link', msg);
      }
    } catch {
      Alert.alert('Share Link', msg);
    }
  };

  // ── If room created — show success screen ──────────────────────────────────
  if (createdRoom) {
    const splits = QuizRoomsService.calculatePrizeSplits(
      prizeEnabled ? parseInt(prizePool) || 0 : 0,
      winnerCount
    );
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" />
        <LinearGradient colors={['#F8FAFC', '#FFFFFF']} style={StyleSheet.absoluteFill} />
        <View style={styles.glow1} />

        <View style={[styles.successWrap, { paddingTop: insets.top + 20 }]}>
          <View style={styles.successIcon}>
            <Ionicons name="rocket" size={40} color="#8B5CF6" />
          </View>
          <View>
            <Text style={styles.successTitle}>Room is LIVE! 🎉</Text>
            <Text style={styles.successSub}>{createdRoom.title}</Text>
          </View>

          <View style={styles.codeCard}>
            <Text style={styles.codeLabel}>JOIN CODE</Text>
            <Text style={styles.codeValue}>{createdRoom.join_code}</Text>
            <Text style={styles.codeHint}>Share this code or the link below</Text>
          </View>

          <View style={styles.successMeta}>
            {prizeEnabled && parseInt(prizePool) > 0 && (
              <View style={styles.metaRow}>
                <FontAwesome5 name="coins" size={14} color="#F59E0B" />
                <Text style={styles.metaText}>
                  Top {winnerCount} win: {splits.map((s, i) => `${s}🪙`).join(' / ')}
                </Text>
              </View>
            )}
          </View>

          <View style={styles.successActions}>
            <TouchableOpacity 
              style={styles.shareBtn} 
              onPress={async () => {
                if (!createdRoom) return;
                HapticService.selection();
                const shareMsg = QuizRoomsService.getShareMessage(createdRoom);
                const url = `whatsapp://send?text=${encodeURIComponent(shareMsg)}`;
                try {
                  const supported = await Linking.canOpenURL(url);
                  if (supported) {
                    await Linking.openURL(url);
                  } else {
                    await Share.share({ message: shareMsg });
                  }
                } catch {
                  await Share.share({ message: shareMsg });
                }
              }} 
              activeOpacity={0.85}
            >
              <LinearGradient colors={['#25D366', '#128C7E']} style={styles.shareBtnGrad}>
                <Ionicons name="logo-whatsapp" size={18} color="#FFFFFF" />
                <Text style={styles.shareBtnText}>Share via WhatsApp</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dashBtn}
              onPress={() => router.replace(`/quiz-rooms/dashboard/${createdRoom.id}`)}
              activeOpacity={0.85}
            >
              <Ionicons name="stats-chart" size={18} color="#8B5CF6" />
              <Text style={styles.dashBtnText}>Open Dashboard</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  // ── Wizard ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient colors={['#F8FAFC', '#FFFFFF']} style={StyleSheet.absoluteFill} />
      <View style={styles.glow1} />

      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => step === 0 ? router.back() : setStep((s) => (s - 1) as Step)} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={20} color="#0F172A" />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.headerTitle}>Create Quiz Room</Text>
          <Text style={styles.headerSub}>Step {step + 1} of {STEPS.length}: {STEPS[step]}</Text>
        </View>
      </View>

      {/* Progress bar */}
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          {/* ── Step 0: Topic ─────────────────────────────────────────────── */}
            {step === 0 && (
              <View style={styles.stepContent}>
                <Text style={styles.stepLabel}>📚 What's the quiz about?</Text>
                <Text style={styles.stepDesc}>Give it a catchy title and a specific topic — AI will generate questions.</Text>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>QUIZ TITLE *</Text>
                  <TextInput style={styles.input} placeholder="Ex: Polity PYQ Battle" placeholderTextColor="#94A3B8" value={title} onChangeText={setTitle} />
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>TOPIC / SUBJECT *</Text>
                  <TextInput style={styles.input} placeholder="Ex: Fundamental Rights" placeholderTextColor="#94A3B8" value={topic} onChangeText={setTopic} />
                </View>

                <View style={styles.fieldWrap}>
                  <Text style={styles.fieldLabel}>EXAM CATEGORY (optional)</Text>
                  <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowCategoryPicker(v => !v)} activeOpacity={0.8}>
                    <Text style={[styles.pickerText, !examCategory && { color: '#94A3B8' }]}>
                      {examCategory || 'Select category…'}
                    </Text>
                    <Ionicons name={showCategoryPicker ? 'chevron-up' : 'chevron-down'} size={16} color="#64748B" />
                  </TouchableOpacity>
                  {showCategoryPicker && (
                    <View style={styles.dropdown}>
                      {EXAM_CATEGORIES.map((cat) => (
                        <TouchableOpacity key={cat} style={[styles.dropItem, examCategory === cat && styles.dropItemActive]} onPress={() => { setExamCategory(cat === 'Custom' ? '' : cat); setShowCategoryPicker(false); }}>
                          <Text style={[styles.dropText, examCategory === cat && styles.dropTextActive]}>{cat}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* ── Step 1: Settings ─────────────────────────────────────────── */}
            {step === 1 && (
              <View style={styles.stepContent}>
                <Text style={styles.stepLabel}>⚙️ Quiz Settings</Text>
                <Text style={styles.stepDesc}>How many questions and how much time per question?</Text>

                <Text style={styles.fieldLabel}>QUESTION COUNT</Text>
                <View style={styles.chipRow}>
                  {QUESTION_COUNTS.map((n) => (
                    <TouchableOpacity key={n} style={[styles.chip, !isCustomCount && questionCount === n && styles.chipActive]} onPress={() => { setIsCustomCount(false); setQuestionCount(n); HapticService.selection(); }}>
                      <Text style={[styles.chipText, !isCustomCount && questionCount === n && styles.chipTextActive]}>{n}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.chip, isCustomCount && styles.chipActive]} onPress={() => { setIsCustomCount(true); HapticService.selection(); }}>
                    <Text style={[styles.chipText, isCustomCount && styles.chipTextActive]}>Custom</Text>
                  </TouchableOpacity>
                </View>
                {isCustomCount && (
                  <TextInput style={[styles.input, { marginTop: 10 }]} placeholder="20" placeholderTextColor="#94A3B8" value={customCount} onChangeText={setCustomCount} keyboardType="numeric" maxLength={2} />
                )}

                <Text style={[styles.fieldLabel, { marginTop: 24 }]}>TIME PER QUESTION</Text>
                <View style={styles.chipRow}>
                  {TIME_OPTIONS.map((t) => (
                    <TouchableOpacity key={t} style={[styles.chip, !isCustomTime && timePerQuestion === t && styles.chipActive]} onPress={() => { setIsCustomTime(false); setTimePerQuestion(t); HapticService.selection(); }}>
                      <Text style={[styles.chipText, !isCustomTime && timePerQuestion === t && styles.chipTextActive]}>{t}s</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity style={[styles.chip, isCustomTime && styles.chipActive]} onPress={() => { setIsCustomTime(true); HapticService.selection(); }}>
                    <Text style={[styles.chipText, isCustomTime && styles.chipTextActive]}>Custom</Text>
                  </TouchableOpacity>
                </View>
                {isCustomTime && (
                  <TextInput style={[styles.input, { marginTop: 10 }]} placeholder="30" placeholderTextColor="#94A3B8" value={customTime} onChangeText={setCustomTime} keyboardType="numeric" maxLength={3} />
                )}
              </View>
            )}

            {/* ── Step 2: Prizes ───────────────────────────────────────────── */}
            {step === 2 && (
              <View style={styles.stepContent}>
                <Text style={styles.stepLabel}>🏆 Reward Winners</Text>
                <Text style={styles.stepDesc}>Quizzes with prizes get 10× more engagement!</Text>

                <TouchableOpacity style={[styles.toggleRow, prizeEnabled && styles.toggleRowActive]} onPress={() => { setPrizeEnabled(v => !v); HapticService.selection(); }} activeOpacity={0.8}>
                  <View style={styles.toggleLeft}>
                    <FontAwesome5 name="coins" size={18} color={prizeEnabled ? '#F59E0B' : '#94A3B8'} />
                    <Text style={[styles.toggleText, prizeEnabled && styles.toggleTextActive]}>Add coin prize pool</Text>
                  </View>
                  <View style={[styles.togglePill, prizeEnabled && styles.togglePillActive]}>
                    <View style={[styles.toggleThumb, prizeEnabled && styles.toggleThumbActive]} />
                  </View>
                </TouchableOpacity>

                {prizeEnabled && (
                  <View style={styles.prizeSection}>
                    {/* Spinning gold card */}
                    <View style={styles.prizeCardWrap}>
                      <View style={styles.prizeGlowBorder}>
                        <LinearGradient colors={['#FBBF24', 'transparent', '#D97706', 'transparent', '#FBBF24']} style={StyleSheet.absoluteFill} />
                      </View>
                      <View style={styles.prizeCardInner}>
                        <FontAwesome5 name="coins" size={28} color="#F59E0B" />
                        <View style={{ flex: 1, marginLeft: 16 }}>
                          <Text style={styles.prizeCardLabel}>TOTAL PRIZE POOL</Text>
                          <TextInput
                            style={styles.prizeInput}
                            keyboardType="numeric"
                            value={prizePool}
                            onChangeText={setPrizePool}
                            placeholder="0"
                            placeholderTextColor="rgba(15,23,42,0.2)"
                          />
                        </View>
                        <Text style={styles.prizeCoinLabel}>coins</Text>
                      </View>
                    </View>

                    <Text style={[styles.fieldLabel, { marginTop: 20 }]}>WINNER DISTRIBUTION</Text>
                    <View style={styles.chipRow}>
                      {([3, 5] as const).map((n) => (
                        <TouchableOpacity key={n} style={[styles.chip, winnerCount === n && styles.chipActive]} onPress={() => { setWinnerCount(n); HapticService.selection(); }}>
                          <Text style={[styles.chipText, winnerCount === n && styles.chipTextActive]}>Top {n}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* Split preview */}
                    <View style={styles.splitPreview}>
                      {QuizRoomsService.calculatePrizeSplits(parseInt(prizePool) || 0, winnerCount).map((coins, i) => (
                        <View key={i} style={styles.splitRow}>
                          <Text style={styles.splitRank}>{['🥇', '🥈', '🥉', '4th', '5th'][i]}</Text>
                          <View style={styles.splitBar}>
                            <View style={[styles.splitBarFill, { width: `${(coins / (parseInt(prizePool) || 1)) * 100}%` }]} />
                          </View>
                          <Text style={styles.splitCoins}>{coins} 🪙</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* ── Step 3: Confirm ───────────────────────────────────────────── */}
            {step === 3 && (
              <View style={styles.stepContent}>
                <Text style={styles.stepLabel}>🚀 Ready to Launch?</Text>
                <Text style={styles.stepDesc}>Review your quiz room before going live.</Text>

                <LinearGradient colors={['#0F172A', '#1E293B']} style={styles.reviewCard}>
                  <Text style={styles.reviewTitle}>{title || 'Untitled Quiz'}</Text>
                  <Text style={styles.reviewTopic}>{topic}{examCategory ? ` · ${examCategory}` : ''}</Text>
                  <View style={styles.reviewDivider} />
                  {[
                    { icon: 'timer-outline', label: `${effectiveTime}s per question` },
                    { icon: 'trophy-outline', label: prizeEnabled && parseInt(prizePool) > 0 ? `${prizePool} coins prize pool` : 'No prize' },
                    { icon: 'people-outline', label: prizeEnabled ? `Top ${winnerCount} win` : 'For fun' },
                  ].map((row) => (
                    <View key={row.label} style={styles.reviewRow}>
                      <Ionicons name={row.icon as any} size={16} color="#64748B" />
                      <Text style={styles.reviewRowText}>{row.label}</Text>
                    </View>
                  ))}
                </LinearGradient>

                {prizeEnabled && parseInt(prizePool) > 0 && (
                  <View style={styles.escrowNote}>
                    <Ionicons name="information-circle" size={16} color="#F59E0B" />
                    <Text style={styles.escrowText}>
                      {prizePool} coins will be escrowed from your wallet and auto-distributed to winners.
                    </Text>
                  </View>
                )}
              </View>
            )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Footer CTA */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, !canNext() && { opacity: 0.45 }]}
          onPress={handleNext}
          disabled={!canNext() || creating}
          activeOpacity={0.85}
        >
          <LinearGradient colors={['#8B5CF6', '#6D28D9']} style={styles.nextGrad}>
            <Text style={styles.nextBtnText}>
              {creating ? 'Creating Room…' : step === 3 ? '🚀 Launch Room' : 'Continue'}
            </Text>
            {!creating && <Ionicons name={step === 3 ? 'flash' : 'chevron-forward'} size={18} color="#FFFFFF" style={{ marginLeft: 6 }} />}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  glow1: { position: 'absolute', top: -60, right: -60, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(139,92,246,0.08)' },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(15,23,42,0.07)' },
  headerTitle: { fontSize: 18, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  headerSub: { fontSize: 12, fontFamily: 'Inter-Medium', color: '#8B5CF6' },
  usageChipWrap: { marginTop: 14, marginBottom: 18 },

  progressTrack: { height: 4, backgroundColor: 'rgba(15,23,42,0.06)', marginHorizontal: 20, borderRadius: 2, overflow: 'hidden', marginBottom: 4 },
  progressFill: { height: '100%', backgroundColor: '#8B5CF6', borderRadius: 2 },

  scroll: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  stepContent: {},
  stepLabel: { fontSize: 22, fontFamily: 'Poppins-Bold', color: '#0F172A', marginBottom: 6 },
  stepDesc: { fontSize: 14, fontFamily: 'Inter-Medium', color: '#64748B', lineHeight: 21 },

  fieldWrap: { marginBottom: 18 },
  fieldLabel: { fontSize: 11, fontFamily: 'Poppins-SemiBold', color: '#64748B', letterSpacing: 1, marginBottom: 8 },
  input: { height: 56, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 18, fontSize: 15, fontFamily: 'Inter-SemiBold', color: '#0F172A', borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)' },

  pickerBtn: { height: 56, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)' },
  pickerText: { fontSize: 15, fontFamily: 'Inter-SemiBold', color: '#0F172A' },
  dropdown: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)', marginTop: 4, overflow: 'hidden' },
  dropItem: { paddingHorizontal: 18, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(15,23,42,0.04)' },
  dropItemActive: { backgroundColor: '#F3E8FF' },
  dropText: { fontSize: 14, fontFamily: 'Inter-SemiBold', color: '#0F172A' },
  dropTextActive: { color: '#7C3AED' },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  chip: { paddingHorizontal: 18, paddingVertical: 12, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)' },
  chipActive: { backgroundColor: '#8B5CF6', borderColor: '#8B5CF6' },
  chipText: { fontSize: 14, fontFamily: 'Poppins-SemiBold', color: '#64748B' },
  chipTextActive: { color: '#FFFFFF' },

  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, backgroundColor: '#FFFFFF', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(15,23,42,0.07)', marginBottom: 16 },
  toggleRowActive: { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  toggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  toggleText: { fontSize: 15, fontFamily: 'Poppins-SemiBold', color: '#64748B' },
  toggleTextActive: { color: '#B45309' },
  togglePill: { width: 48, height: 28, borderRadius: 14, backgroundColor: '#E2E8F0', justifyContent: 'center', paddingHorizontal: 3 },
  togglePillActive: { backgroundColor: '#F59E0B' },
  toggleThumb: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF', alignSelf: 'flex-start' },
  toggleThumbActive: { alignSelf: 'flex-end' },

  prizeSection: {},
  prizeCardWrap: { borderRadius: 24, padding: 1.5, overflow: 'hidden', backgroundColor: 'rgba(251,191,36,0.12)', marginBottom: 4 },
  prizeGlowBorder: { position: 'absolute', width: '300%', height: '300%', top: '-100%', left: '-100%' },
  prizeCardInner: { borderRadius: 22, padding: 20, backgroundColor: '#FFFFFF', flexDirection: 'row', alignItems: 'center' },
  prizeCardLabel: { fontSize: 10, fontFamily: 'Poppins-SemiBold', color: '#94A3B8', letterSpacing: 1 },
  prizeInput: { fontSize: 32, fontFamily: 'Poppins-Bold', color: '#0F172A', marginTop: -2 },
  prizeCoinLabel: { fontSize: 13, fontFamily: 'Poppins-SemiBold', color: '#94A3B8' },

  splitPreview: { backgroundColor: '#FFFBEB', borderRadius: 16, padding: 16, marginTop: 16, gap: 10, borderWidth: 1, borderColor: '#FEF3C7' },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  splitRank: { fontSize: 16, width: 32 },
  splitBar: { flex: 1, height: 6, backgroundColor: '#FEF3C7', borderRadius: 3, overflow: 'hidden' },
  splitBarFill: { height: '100%', backgroundColor: '#F59E0B', borderRadius: 3 },
  splitCoins: { fontSize: 13, fontFamily: 'Poppins-Bold', color: '#B45309', width: 60, textAlign: 'right' },

  reviewCard: { borderRadius: 24, padding: 24, marginBottom: 16 },
  reviewTitle: { fontSize: 20, fontFamily: 'Poppins-Bold', color: '#FFFFFF', marginBottom: 4 },
  reviewTopic: { fontSize: 13, fontFamily: 'Inter-Medium', color: 'rgba(255,255,255,0.6)', marginBottom: 16 },
  reviewDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.08)', marginBottom: 16 },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  reviewRowText: { fontSize: 14, fontFamily: 'Inter-SemiBold', color: 'rgba(255,255,255,0.85)' },

  escrowNote: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#FFFBEB', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#FEF3C7' },
  escrowText: { flex: 1, fontSize: 12, fontFamily: 'Inter-Medium', color: '#92400E', lineHeight: 18 },

  footer: { paddingHorizontal: 20, paddingTop: 12, backgroundColor: 'transparent' },
  nextBtn: { borderRadius: 20, overflow: 'hidden' },
  nextGrad: { height: 58, flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  nextBtnText: { fontSize: 16, fontFamily: 'Poppins-Bold', color: '#FFFFFF' },

  // Success screen
  successWrap: { flex: 1, alignItems: 'center', paddingHorizontal: 24 },
  successIcon: { width: 90, height: 90, borderRadius: 30, backgroundColor: '#F3E8FF', justifyContent: 'center', alignItems: 'center', marginBottom: 20 },
  successTitle: { fontSize: 26, fontFamily: 'Poppins-Bold', color: '#0F172A', textAlign: 'center' },
  successSub: { fontSize: 15, fontFamily: 'Inter-Medium', color: '#64748B', textAlign: 'center', marginTop: 4, marginBottom: 28 },
  codeCard: { backgroundColor: '#0F172A', borderRadius: 24, padding: 28, alignItems: 'center', width: '100%', marginBottom: 20 },
  codeLabel: { fontSize: 11, fontFamily: 'Poppins-SemiBold', color: 'rgba(255,255,255,0.5)', letterSpacing: 2, marginBottom: 10 },
  codeValue: { fontSize: 40, fontFamily: 'Poppins-Bold', color: '#FFFFFF', letterSpacing: 6 },
  codeHint: { fontSize: 12, fontFamily: 'Inter-Medium', color: 'rgba(255,255,255,0.4)', marginTop: 10 },
  successMeta: { width: '100%', gap: 8, marginBottom: 28 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaText: { fontSize: 13, fontFamily: 'Inter-SemiBold', color: '#475569' },
  successActions: { width: '100%', gap: 12 },
  shareBtn: { borderRadius: 18, overflow: 'hidden' },
  shareBtnGrad: { height: 56, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10 },
  shareBtnText: { fontSize: 16, fontFamily: 'Poppins-Bold', color: '#FFFFFF' },
  dashBtn: { height: 56, borderRadius: 18, backgroundColor: '#F3E8FF', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: '#E9D5FF' },
  dashBtnText: { fontSize: 15, fontFamily: 'Poppins-SemiBold', color: '#7C3AED' },
});

