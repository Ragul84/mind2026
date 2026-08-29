import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  StatusBar,
  ActivityIndicator,
  Image,
  ScrollView,
  TextInput,
} from 'react-native';
// @ts-ignore
import headImage from '@/assets/images/head.png';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MotiView } from 'moti';
import { FontAwesome5 } from '@expo/vector-icons';
import { Ionicons } from '@expo/vector-icons';
import { useAuthContext } from '@/components/AuthProvider';
import { SupabaseService, supabase } from '@/utils/supabaseService';
import { studyContextForOnboardingTrack } from '@/utils/studyContext';
import HapticService from '@/utils/hapticService';
import { V2026 } from '@/theme/v2026-tokens';

const { width } = Dimensions.get('window');

type ExamTrack = 'upsc_ecosystem' | 'ssc_ecosystem' | 'tnpsc_ecosystem' | 'ncert_ecosystem' | 'samacheer_ecosystem' | 'other';
type Step = 1 | 2 | 3;

interface TrackOption {
  id: ExamTrack;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  gradient: [string, string];
}

const TRACKS: TrackOption[] = [
  {
    id: 'upsc_ecosystem',
    title: 'UPSC Ecosystem',
    subtitle: 'Prelims, Mains & State PCS Foundation',
    icon: 'landmark',
    color: '#00D4C7',
    gradient: ['#00D4C7', '#009B91'],
  },
  {
    id: 'ssc_ecosystem',
    title: 'SSC Ecosystem',
    subtitle: 'CGL, CHSL, MTS, CPO & GD',
    icon: 'graduation-cap',
    color: '#8B5CF6',
    gradient: ['#8B5CF6', '#7C3AED'],
  },
  {
    id: 'tnpsc_ecosystem',
    title: 'TNPSC Ecosystem',
    subtitle: 'Group 1, 2, 2A, 4 & VAO',
    icon: 'fort-awesome',
    color: '#F59E0B',
    gradient: ['#F59E0B', '#D97706'],
  },
  {
    id: 'ncert_ecosystem',
    title: 'NCERT Foundation',
    subtitle: 'CBSE / NCERT books — UPSC-aligned path',
    icon: 'book',
    color: '#0EA5E9',
    gradient: ['#0EA5E9', '#0369A1'],
  },
  {
    id: 'samacheer_ecosystem',
    title: 'Samacheer Kalvi',
    subtitle: 'Tamil Nadu board — TNPSC-aligned path',
    icon: 'book-open',
    color: '#10B981',
    gradient: ['#10B981', '#059669'],
  },
  {
    id: 'other',
    title: 'Other Exams',
    subtitle: 'Curating the best path for you',
    icon: 'compass',
    color: '#64748B',
    gradient: ['#64748B', '#475569'],
  },
];

const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand',
  'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman & Nicobar', 'Chandigarh', 'Dadra & Nagar Haveli', 'Daman & Diu',
  'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

const AVATAR_STYLES = [
  { id: 'adventurer', name: 'Adventurer', logo: 'https://api.dicebear.com/7.x/adventurer/png?seed=Felix&backgroundColor=b4f4f0' },
  { id: 'bottts', name: 'Robots', logo: 'https://api.dicebear.com/7.x/bottts/png?seed=Bleep&backgroundColor=ffd1dc' },
  { id: 'lorelei', name: 'Chibi', logo: 'https://api.dicebear.com/7.x/lorelei/png?seed=Lily&backgroundColor=dbeafe' },
  { id: 'avataaars', name: 'Persona', logo: 'https://api.dicebear.com/7.x/avataaars/png?seed=Tom&backgroundColor=ffedd5' },
  { id: 'pixel-art', name: 'Retro Pixel', logo: 'https://api.dicebear.com/7.x/pixel-art/png?seed=Mario&backgroundColor=e2e8f0' },
];

const STYLE_SEEDS: Record<string, string[]> = {
  adventurer: ['Felix', 'Jasmine', 'Leo', 'Mia', 'Oliver', 'Sophia', 'Jack', 'Aneka'],
  bottts: ['Bleep', 'Bloop', 'Robo', 'Rusty', 'Sparky', 'Gear', 'Bolt', 'Widget'],
  lorelei: ['Lily', 'Sakura', 'Chibi', 'Momo', 'Yuki', 'Koko', 'Hana', 'Rin'],
  avataaars: ['Tom', 'Jane', 'Alex', 'Sarah', 'Mike', 'Emma', 'David', 'Olivia'],
  'pixel-art': ['Mario', 'Zelda', 'Link', 'Cloud', 'Peach', 'Yoshi', 'Sonic', 'Samus'],
};

const getAvatarUrl = (style: string, seed: string) =>
  `https://api.dicebear.com/7.x/${style}/png?seed=${seed}&backgroundColor=b4f4f0,dbeafe,ffedd5,ffd1dc,e2e8f0`;

export default function ProfileSetup() {
  const { user } = useAuthContext();
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<ExamTrack | null>(null);
  const [otherExam, setOtherExam] = useState('');
  const [loading, setLoading] = useState(false);

  // Step 2 — Name & State
  const [fullName, setFullName] = useState('');
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [originalFullName, setOriginalFullName] = useState('');
  const [checkingName, setCheckingName] = useState(false);
  const [nameError, setNameError] = useState('');

  // Step 3 — Avatar
  const [selectedStyle, setSelectedStyle] = useState('adventurer');
  const [currentSeed, setCurrentSeed] = useState('Felix');

  useEffect(() => {
    let active = true;

    const loadExistingProfile = async () => {
      if (!user?.id) return;

      try {
        const { data } = await supabase
          .from('user_profiles')
          .select('full_name, state')
          .eq('id', user.id)
          .maybeSingle();

        if (!active || !data) return;

        const existingName = data.full_name?.trim().replace(/\s+/g, ' ') || '';
        const existingState = data.state || null;

        if (existingName) {
          setFullName((current) => current.trim() ? current : existingName);
          setOriginalFullName(existingName);
        }

        if (existingState) {
          setSelectedState((current) => current ?? existingState);
        }
      } catch (error) {
        console.error('Failed to load existing profile setup data:', error);
      }
    };

    loadExistingProfile();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const handleShuffle = () => {
    HapticService.selection();
    const randomSeed = Math.random().toString(36).substring(7);
    setCurrentSeed(randomSeed);
  };

  const handleContinue = async () => {
    if (step === 1) {
      if (!selected) return;
      HapticService.success();
      setStep(2);
      return;
    }

    if (step === 2) {
      const normalizedName = fullName.trim().replace(/\s+/g, ' ');
      if (!normalizedName || !selectedState) return;

      if (originalFullName && normalizedName.toLowerCase() === originalFullName.toLowerCase()) {
        setFullName(normalizedName);
        HapticService.success();
        setStep(3);
        return;
      }

      setCheckingName(true);
      setNameError('');

      try {
        const isAvailable = await SupabaseService.isProfileNameAvailable(normalizedName, user?.id);
        if (!isAvailable) {
          setNameError('That profile name is already taken. Choose a unique name.');
          return;
        }

        setFullName(normalizedName);
        setOriginalFullName(normalizedName);
      } catch (error) {
        console.error('Failed to validate profile name:', error);
        setNameError('Could not verify this name right now. Try again.');
        return;
      } finally {
        setCheckingName(false);
      }

      HapticService.success();
      setStep(3);
      return;
    }

    // Step 3 — Save everything
    if (!user?.id) return;
    setLoading(true);

    try {
      let finalTrack: string = selected!;
      if (selected === 'other') finalTrack = 'upsc_ecosystem';
      // NCERT board maps to the UPSC path, Samacheer to the TNPSC path — this
      // drives both the daily dose and the textbook grounding board preference.
      if (selected === 'ncert_ecosystem') finalTrack = 'upsc_ecosystem';
      if (selected === 'samacheer_ecosystem') finalTrack = 'tnpsc_ecosystem';
      const studyContext = studyContextForOnboardingTrack(selected!);

      // Save the durable context, Daily Mission protocol, and basic profile in
      // one authenticated database transaction. The local study-plan value below
      // remains only a UI convenience, never MIGA's source of truth.
      const { error: onboardingError } = await supabase.rpc('complete_study_context_onboarding', {
        p_full_name: fullName.trim().replace(/\s+/g, ' '),
        p_state: selectedState,
        p_avatar_url: getAvatarUrl(selectedStyle, currentSeed),
        p_primary_exam: studyContext.primaryExam,
        p_primary_curriculum: studyContext.primaryCurriculum,
        p_class_level: null,
        p_protocol_track_id: finalTrack,
      });
      if (onboardingError) throw onboardingError;

      // Keep the auth avatar metadata in sync with the profile written above.
      const avatarUrl = getAvatarUrl(selectedStyle, currentSeed);
      await supabase.auth.updateUser({ data: { avatar_url: avatarUrl } });

      // Seed the Study Plan's exam so it shows a real countdown from the
      //    official calendar (the specific branch is confirmed in the Study Plan).
      const CAL: Record<string, string> = { upsc: 'upsc', tnpsc: 'tnpsc', ssc: 'ssc', rrb: 'rrb' };
      const calId = studyContext.primaryExam ? CAL[studyContext.primaryExam] : undefined;
      try {
        if (calId) await AsyncStorage.setItem('study_plan_exam', JSON.stringify({ examId: calId }));
        else await AsyncStorage.removeItem('study_plan_exam');
      } catch {}

      HapticService.success();
      router.replace('/home');
    } catch (error) {
      console.error('Failed to save profile setup:', error);
    } finally {
      setLoading(false);
    }
  };

  const canContinue = () => {
    if (step === 1) return !!selected && (selected !== 'other' || otherExam.trim().length >= 2);
    if (step === 2) return fullName.trim().length >= 2 && !!selectedState;
    return true;
  };

  // ── Step 1: Choose Exam Track ──────────────────────────────────────────────
  const renderStep1 = () => (
    <MotiView
      from={{ opacity: 0, translateY: -20 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 700 }}
      style={{ flex: 1, justifyContent: 'center' }}
    >
      <View style={styles.header}>
        <View style={styles.mascotRow}>
          <View style={styles.mascotWrapper}>
            <Image source={headImage} style={styles.mascotImage} resizeMode="contain" />
            <View style={styles.mascotGlow} />
          </View>
        </View>
        <Text style={styles.title}>Choose Your Goal</Text>
        <Text style={styles.subtitle}>Choose your target exam to personalize your daily study plan.</Text>
      </View>

      <View style={styles.tracksGrid}>
        {TRACKS.map((track) => (
          <TouchableOpacity
            key={track.id}
            activeOpacity={0.9}
            onPress={() => { setSelected(track.id); HapticService.medium(); }}
            style={[
              styles.trackCard,
              selected === track.id && { borderColor: track.color, borderWidth: 1.5, ...styles.trackSelectedShadow },
            ]}
          >
            <LinearGradient
              colors={selected === track.id ? track.gradient : ['rgba(248,250,252,0.8)', 'rgba(241,245,249,0.5)']}
              style={styles.trackIconBg}
            >
              <FontAwesome5 name={track.icon} size={22} color={selected === track.id ? '#FFFFFF' : '#64748B'} />
            </LinearGradient>
            <View style={styles.trackInfo}>
              <Text style={[styles.trackTitle, selected === track.id && { color: track.color }]}>{track.title}</Text>
              <Text style={styles.trackSubtitle}>{track.subtitle}</Text>
            </View>
            {selected === track.id && (
              <View style={[styles.checkCircle, { backgroundColor: track.color }]}>
                <Ionicons name="checkmark" size={16} color="#FFFFFF" />
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {selected === 'other' && (
        <MotiView
          from={{ opacity: 0, translateY: 8 }}
          animate={{ opacity: 1, translateY: 0 }}
          transition={{ type: 'timing', duration: 260 }}
          style={styles.otherExamWrap}
        >
          <Text style={styles.otherExamLabel}>Which exam or class are you preparing for?</Text>
          <TextInput
            style={styles.otherExamInput}
            value={otherExam}
            onChangeText={setOtherExam}
            placeholder="e.g. Kerala PSC, RRB NTPC, Class 9"
            placeholderTextColor="#94A3B8"
            maxLength={60}
            returnKeyType="done"
            autoCapitalize="words"
          />
          <Text style={styles.otherExamHint}>We will tailor your answers to NCERT for this.</Text>
        </MotiView>
      )}
    </MotiView>
  );

  // ── Step 2: Name & State ───────────────────────────────────────────────────
  const renderStep2 = () => (
    <MotiView
      from={{ opacity: 0, translateX: 40 }}
      animate={{ opacity: 1, translateX: 0 }}
      transition={{ type: 'timing', duration: 600 }}
      style={{ flex: 1, paddingTop: 20 }}
    >
      {/* Back */}
      <TouchableOpacity onPress={() => setStep(1)} style={styles.backButton} activeOpacity={0.8}>
        <Ionicons name="arrow-back" size={20} color="#475569" />
      </TouchableOpacity>

      <Text style={styles.title}>About You</Text>
      <Text style={styles.subtitle}>This helps us personalize your experience and rank you on the State Leaderboard.</Text>

      {/* Name input */}
      <View style={styles.inputGroup}>
        <Text style={styles.inputLabel}>YOUR NAME</Text>
        <View style={styles.inputWrapper}>
          <Ionicons name="person-outline" size={18} color="#94A3B8" style={{ marginRight: 10 }} />
          <TextInput
            style={styles.textInput}
            placeholder="Ragul S"
            placeholderTextColor="#94A3B8"
            value={fullName}
            onChangeText={(text) => {
              setFullName(text);
              if (nameError) setNameError('');
            }}
            maxLength={40}
            autoCapitalize="words"
            autoFocus
          />
        </View>
        <Text style={styles.inputHint}>Profile names are public and must be unique.</Text>
        {nameError ? <Text style={styles.inputError}>{nameError}</Text> : null}
      </View>

      {/* State selector */}
      <Text style={[styles.inputLabel, { marginBottom: 10, marginTop: 20 }]}>YOUR STATE</Text>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.statesGrid}>
        {INDIAN_STATES.map((state) => {
          const isSelected = selectedState === state;
          return (
            <TouchableOpacity
              key={state}
              activeOpacity={0.85}
              onPress={() => { setSelectedState(state); HapticService.selection(); }}
              style={[styles.stateChip, isSelected && styles.stateChipActive]}
            >
              <Text style={[styles.stateChipText, isSelected && styles.stateChipTextActive]}>
                {state}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </MotiView>
  );

  // ── Step 3: Avatar ─────────────────────────────────────────────────────────
  const renderStep3 = () => (
    <MotiView
      from={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'timing', duration: 600 }}
      style={{ flex: 1, paddingTop: 20 }}
    >
      <View style={styles.stepHeaderRow}>
        <TouchableOpacity onPress={() => setStep(2)} style={styles.backButton} activeOpacity={0.8}>
          <Ionicons name="arrow-back" size={20} color="#475569" />
        </TouchableOpacity>
        <Text style={[styles.stepTitle]}>Choose Avatar</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={handleShuffle} style={styles.compactShuffleBtn}>
          <Ionicons name="shuffle" size={14} color="#0D9488" />
          <Text style={styles.compactShuffleText}>Shuffle</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.previewContainer}>
        <LinearGradient colors={['#EFF6FF', '#DBEAFE']} style={styles.previewGradient}>
          <Image source={{ uri: getAvatarUrl(selectedStyle, currentSeed) }} style={styles.previewImage} />
        </LinearGradient>
        <Text style={styles.previewName}>{fullName}</Text>
        <View style={styles.stateBadge}>
          <Ionicons name="location-sharp" size={11} color="#00D4C7" />
          <Text style={styles.stateBadgeText}>{selectedState}</Text>
        </View>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        <Text style={styles.customSectionLabel}>AVATAR COLLECTION</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesRow}>
          {AVATAR_STYLES.map((style) => {
            const isSelected = selectedStyle === style.id;
            return (
              <TouchableOpacity
                key={style.id}
                activeOpacity={0.82}
                onPress={() => { HapticService.selection(); setSelectedStyle(style.id); setCurrentSeed(STYLE_SEEDS[style.id][0]); }}
                style={[styles.styleChip, isSelected && styles.styleChipActive]}
              >
                <Image source={{ uri: style.logo }} style={styles.styleChipLogo} />
                <Text style={[styles.styleChipText, isSelected && styles.styleChipTextActive]}>{style.name}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <Text style={styles.customSectionLabel}>POPULAR PICKS</Text>
        <View style={styles.seedsGrid}>
          {STYLE_SEEDS[selectedStyle]?.map((seed) => {
            const isSelected = currentSeed === seed;
            return (
              <TouchableOpacity
                key={seed}
                activeOpacity={0.8}
                onPress={() => { HapticService.selection(); setCurrentSeed(seed); }}
                style={[styles.seedCard, isSelected && styles.seedCardActive]}
              >
                <Image source={{ uri: getAvatarUrl(selectedStyle, seed) }} style={styles.seedThumbnail} />
                <Text style={[styles.seedCardText, isSelected && styles.seedCardTextActive]} numberOfLines={1}>{seed}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </MotiView>
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <View style={styles.ambientGlow1} pointerEvents="none" />
      <View style={styles.ambientGlow2} pointerEvents="none" />

      {/* Progress dots */}
      <View style={styles.progressRow}>
        {[1, 2, 3].map((s) => (
          <View key={s} style={[styles.progressDot, step >= s && styles.progressDotActive]} />
        ))}
      </View>

      <View style={styles.content}>
        {step === 1 && renderStep1()}
        {step === 2 && renderStep2()}
        {step === 3 && renderStep3()}

        {/* Footer CTA */}
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.continueButton, (!canContinue() || checkingName) && styles.disabledButton]}
            onPress={handleContinue}
            disabled={!canContinue() || loading || checkingName}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={canContinue() ? ['#00D4C7', '#009B91'] : ['#E2E8F0', '#CBD5E1']}
              style={styles.continueGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading || checkingName ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Text style={[styles.continueText, !canContinue() && { color: '#94A3B8' }]}>
                    {step === 3 ? 'COMPLETE SETUP ✨' : 'CONTINUE'}
                  </Text>
                  <Ionicons name="arrow-forward" size={20} color={canContinue() ? '#FFFFFF' : '#94A3B8'} />
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  ambientGlow1: {
    position: 'absolute', top: -60, right: -80,
    width: 260, height: 260, borderRadius: 130,
    backgroundColor: '#00D4C7', opacity: 0.05,
  },
  ambientGlow2: {
    position: 'absolute', bottom: 80, left: -100,
    width: 220, height: 220, borderRadius: 110,
    backgroundColor: '#7C3AED', opacity: 0.03,
  },
  progressRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 8,
    paddingTop: 56, paddingBottom: 8,
  },
  progressDot: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#E2E8F0',
  },
  progressDotActive: {
    width: 24, backgroundColor: '#00D4C7',
  },
  content: { flex: 1, paddingHorizontal: 24, justifyContent: 'center' },
  header: { marginBottom: 28 },
  mascotRow: { alignItems: 'center', marginBottom: 16 },
  mascotWrapper: { width: 90, height: 90, justifyContent: 'center', alignItems: 'center', position: 'relative' },
  mascotImage: { width: 82, height: 82 },
  mascotGlow: {
    position: 'absolute', bottom: -6, left: '50%', marginLeft: -24,
    width: 48, height: 16, borderRadius: 24, backgroundColor: '#00D4C7', opacity: 0.2,
  },
  title: {
    fontSize: 28, fontFamily: 'Poppins-Bold', color: '#0F172A',
    letterSpacing: -0.5, textAlign: 'center',
  },
  subtitle: {
    fontSize: 14, fontFamily: 'Inter-Medium', color: '#64748B',
    marginTop: 8, lineHeight: 20, textAlign: 'center',
  },
  tracksGrid: { gap: 12 },
  otherExamWrap: { marginTop: 16, gap: 8 },
  otherExamLabel: { fontSize: 13.5, fontFamily: 'Inter-SemiBold', color: '#334155' },
  otherExamInput: {
    height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF', paddingHorizontal: 16, fontSize: 15,
    fontFamily: 'Inter-Medium', color: '#0F172A',
  },
  otherExamHint: { fontSize: 11.5, fontFamily: 'Inter-Medium', color: '#94A3B8' },
  trackCard: {
    flexDirection: 'row', alignItems: 'center', padding: 16,
    borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1.5,
    borderColor: '#EEF2F7', gap: 14, ...V2026.shadows.milky,
  },
  trackSelectedShadow: { shadowColor: '#00D4C7', shadowOpacity: 0.2, shadowRadius: 12, elevation: 6 },
  trackIconBg: { width: 50, height: 50, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  trackInfo: { flex: 1 },
  trackTitle: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#334155' },
  trackSubtitle: { fontSize: 12, fontFamily: 'Inter-Medium', color: '#64748B', marginTop: 2 },
  checkCircle: { width: 26, height: 26, borderRadius: 13, justifyContent: 'center', alignItems: 'center' },
  // Step 2 styles
  backButton: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF',
    borderWidth: 1, borderColor: '#EEF2F7', alignItems: 'center',
    justifyContent: 'center', marginBottom: 16, ...V2026.shadows.milky,
  },
  inputGroup: { marginTop: 20 },
  inputLabel: {
    fontSize: 11, fontFamily: 'Poppins-Bold', color: '#64748B',
    letterSpacing: 0.8, marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 16,
    borderWidth: 1.5, borderColor: '#E2E8F0',
    paddingHorizontal: 16, height: 56, ...V2026.shadows.milky,
  },
  inputHint: {
    marginTop: 8,
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#64748B',
  },
  inputError: {
    marginTop: 6,
    fontSize: 12,
    fontFamily: 'Inter-Medium',
    color: '#EF4444',
  },
  textInput: {
    flex: 1, fontSize: 16, fontFamily: 'Poppins-Medium',
    color: '#0F172A',
  },
  statesGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 120,
  },
  stateChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E2E8F0',
  },
  stateChipActive: {
    backgroundColor: 'rgba(0, 212, 199, 0.1)', borderColor: '#00D4C7',
  },
  stateChipText: { fontSize: 13, fontFamily: 'Poppins-Medium', color: '#475569' },
  stateChipTextActive: { color: '#00D4C7', fontFamily: 'Poppins-Bold' },
  // Step 3 styles
  stepHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  stepTitle: { fontSize: 20, fontFamily: 'Poppins-Bold', color: '#0F172A' },
  previewContainer: { alignItems: 'center', marginBottom: 16 },
  previewGradient: {
    width: 120, height: 120, borderRadius: 60, alignItems: 'center',
    justifyContent: 'center', borderWidth: 3, borderColor: '#00D4C7', ...V2026.shadows.milky,
  },
  previewImage: { width: 106, height: 106, borderRadius: 53 },
  previewName: {
    marginTop: 10, fontSize: 16, fontFamily: 'Poppins-Bold', color: '#0F172A',
  },
  stateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginTop: 4, backgroundColor: 'rgba(0,212,199,0.08)',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20,
  },
  stateBadgeText: { fontSize: 12, fontFamily: 'Poppins-Medium', color: '#00D4C7' },
  compactShuffleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F0FDFA', borderWidth: 1.2, borderColor: '#99F6E4',
    borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4.5,
  },
  compactShuffleText: { fontSize: 11, fontFamily: 'Poppins-Bold', color: '#0D9488' },
  customSectionLabel: {
    fontSize: 11, fontFamily: 'Poppins-Bold', color: '#64748B',
    letterSpacing: 0.8, marginTop: 14, marginBottom: 10,
  },
  categoriesRow: { gap: 8, paddingBottom: 4 },
  styleChip: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
    paddingVertical: 8, borderRadius: 12, backgroundColor: '#FFFFFF',
    borderWidth: 1.5, borderColor: '#EEF2F7',
  },
  styleChipActive: { backgroundColor: 'rgba(0, 212, 199, 0.12)', borderColor: '#00D4C7' },
  styleChipLogo: { width: 22, height: 22, borderRadius: 11, marginRight: 6 },
  styleChipText: { fontSize: 12, fontFamily: 'Poppins-Medium', color: '#475569' },
  styleChipTextActive: { fontFamily: 'Poppins-Bold', color: '#00D4C7' },
  seedsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between' },
  seedCard: {
    width: '22%', backgroundColor: '#FFFFFF', borderWidth: 1.5,
    borderColor: '#EEF2F7', borderRadius: 14, padding: 6,
    alignItems: 'center', ...V2026.shadows.milky,
  },
  seedCardActive: { backgroundColor: 'rgba(0, 212, 199, 0.12)', borderColor: '#00D4C7' },
  seedThumbnail: { width: 50, height: 50, borderRadius: 25, marginBottom: 6 },
  seedCardText: { fontSize: 10, fontFamily: 'Inter-Medium', color: '#475569', textAlign: 'center' },
  seedCardTextActive: { fontFamily: 'Inter-Bold', color: '#00D4C7' },
  footer: { marginTop: 16, marginBottom: 20 },
  continueButton: { height: 56, borderRadius: 28, overflow: 'hidden', ...V2026.shadows.primary },
  disabledButton: { opacity: 0.6, shadowOpacity: 0, elevation: 0 },
  continueGradient: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  continueText: { fontSize: 15, fontFamily: 'Poppins-Bold', color: '#FFFFFF', letterSpacing: 0.8 },
});
