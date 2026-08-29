import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Share,
  StatusBar,
  Animated,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Audio } from 'expo-av';
import LottieView from 'lottie-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { supabase, SupabaseService } from '@/utils/supabaseService';
import { Aurora } from '@/theme/aurora-tokens';

import { mascotApi } from '@/services/mascotApi';
import {
  getDailyLocalizedThirukkural,
  getThirukkuralMeaningText,
  getThirukkuralVerseText,
  splitThirukkuralLines,
  type LocalizedThirukkural,
  type ThirukkuralLanguage,
} from '@/utils/thirukkuralService';

// --- TYPES ---
type ThirukkuralData = LocalizedThirukkural;

const LANGUAGES: Array<{ label: string; native: string; code: ThirukkuralLanguage; sarvam: string }> = [
  { label: 'Tamil', native: 'தமிழ்', code: 'ta', sarvam: 'ta-IN' },
  { label: 'English', native: 'English', code: 'en', sarvam: 'en-IN' },
  { label: 'Hindi', native: 'हिन्दी', code: 'hi', sarvam: 'hi-IN' },
  { label: 'Telugu', native: 'తెలుగు', code: 'te', sarvam: 'te-IN' },
  { label: 'Kannada', native: 'ಕನ್ನಡ', code: 'kn', sarvam: 'kn-IN' },
  { label: 'Malayalam', native: 'മലയാളം', code: 'ml', sarvam: 'ml-IN' },
];

// --- MAIN SCREEN ---
export default function ThirukkuralScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [data, setData] = useState<ThirukkuralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<ThirukkuralLanguage>('en');
  const [kuralOffset, setKuralOffset] = useState(0);
  const [isTranslating, setIsTranslating] = useState(false);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [liked, setLiked] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [showLangPicker, setShowLangPicker] = useState(false);

  // Animations
  const heroRise = useRef(new Animated.Value(24)).current;
  const heroOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Enable audio playback in silent mode (iOS)
    async function configureAudio() {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: false,
          playsInSilentModeIOS: true, // Critical for iOS
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });
      } catch (e) {
        console.error('Failed to set audio mode', e);
      }
    }
    configureAudio();

    loadDailyThirukkural();

    Animated.parallel([
      Animated.spring(heroRise, { toValue: 0, ...Aurora.motion.spring.gentle, useNativeDriver: true }),
      Animated.timing(heroOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
    ]).start();

    return () => { if (sound) sound.unloadAsync(); };
  }, []);

  // Auto-play on load
  useEffect(() => {
    if (data && !loading) {
      setTimeout(() => {
        handleAudio();
      }, 500);
    }
  }, [data, loading]);

  const loadDailyThirukkural = async (
    overrideOffset?: number,
    overrideLanguage?: ThirukkuralLanguage,
  ) => {
    try {
      setLoading(true);
      const offset = overrideOffset ?? kuralOffset;
      const language = overrideLanguage ?? selectedLanguage;
      const result = await getDailyLocalizedThirukkural(language, offset);
      setData(result);
      checkIfLiked(result.kural_number);
      trackInteraction('viewed', result.kural_number);
    } catch (error) {
      console.warn(`[Thirukkural] Stored ${overrideLanguage ?? selectedLanguage} localization unavailable`, error);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (kuralOffset !== 0) {
      loadDailyThirukkural(kuralOffset);
    }
  }, [kuralOffset]);

  const handleNextKural = async () => {
    if (sound) {
      await sound.stopAsync();
      await sound.unloadAsync();
      setSound(null);
    }
    setIsPlaying(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextOffset = kuralOffset + 1;
    setKuralOffset(nextOffset);
  };

  const checkIfLiked = async (kuralId: number) => {
    try {
      const user = await SupabaseService.getCurrentUser();
      if (!user) return;
      const { data } = await supabase.from('thirukkural_interactions').select('*')
        .eq('user_id', user.id).eq('kural_id', kuralId).eq('interaction_type', 'liked').single();
      if (data) setLiked(true);
    } catch {}
  };

  const trackInteraction = async (type: string, kuralId?: number) => {
    try {
      const user = await SupabaseService.getCurrentUser();
      if (!user) return;
      await supabase.from('thirukkural_interactions').upsert({
        user_id: user.id, kural_id: kuralId || data?.kural_number, interaction_type: type
      }, { onConflict: 'user_id,kural_id,interaction_type' });
    } catch {}
  };

  const handleLike = () => {
    setLiked(!liked);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    trackInteraction(!liked ? 'liked' : 'viewed');
  };

  const handleShare = async () => {
    if (!data || isSharing) return;

    setIsSharing(true);

    const verseText = getThirukkuralVerseText(data);
    const meaningText = getThirukkuralMeaningText(data);

    const shareMessage = `Thirukkural #${data.kural_number}
━━━━━━━━━━━━━━━━━━

*Verse:*
${verseText}

*Meaning:*
${meaningText}

━━━━━━━━━━━━━━━━━━
MindGains - Daily Wisdom
mindgains.app`;

    try {
      const result = await Share.share({
        message: shareMessage,
        title: `Thirukkural #${data.kural_number}`
      });

      if (result.action === Share.sharedAction) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        trackInteraction('shared');
      }
    } catch (error) {
      console.error('Share error:', error);
    } finally {
      setIsSharing(false);
    }
  };

  const handleAudio = async () => {
    if (!data) return;

    // If playing, stop it
    if (isPlaying) {
      if (sound) {
        await sound.stopAsync();
        await sound.unloadAsync();
        setSound(null);
      }
      setIsPlaying(false);
      return;
    }

    setIsPlaying(true);

    try {
      const textToSpeak = getThirukkuralVerseText(data)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ... ');

      const audioFilePath = await mascotApi.getTTS(textToSpeak);

      if (audioFilePath) {
        if (sound) await sound.unloadAsync();

        const { sound: newSound } = await Audio.Sound.createAsync(
          { uri: audioFilePath },
          { shouldPlay: true, rate: 1.0, volume: 1.0 }
        );

        setSound(newSound);
        newSound.setOnPlaybackStatusUpdate((status) => {
          if (status.isLoaded && status.didJustFinish) {
            setIsPlaying(false);
            newSound.unloadAsync();
            setSound(null);
          }
        });
      } else {
        setIsPlaying(false);
      }
    } catch (e) {
      console.error('Audio error:', e);
      setIsPlaying(false);
    }
  };

  const handleLanguageChange = async (langCode: ThirukkuralLanguage) => {
    setSelectedLanguage(langCode);
    setShowLangPicker(false);
    try {
      setIsTranslating(true);
      await loadDailyThirukkural(kuralOffset, langCode);
    } catch (err) {
      console.error('Stored localization load failed', err);
    } finally {
      setIsTranslating(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.stateContainer}>
        <AmbientBackground />
        <ActivityIndicator size="large" color={Aurora.color.indigo} />
        <Text style={styles.stateText}>
          {selectedLanguage === 'ta' ? 'இன்றைய குறள் தயாராகிறது…' : 'Preparing today’s wisdom…'}
        </Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.stateContainer}>
        <AmbientBackground />
        <Ionicons name="cloud-offline-outline" size={40} color={Aurora.color.inkMuted} />
        <Text style={styles.stateText}>
          {selectedLanguage === 'ta' ? 'குறளை ஏற்ற முடியவில்லை' : 'Couldn’t load today’s kural'}
        </Text>
        <TouchableOpacity
          onPress={() => loadDailyThirukkural()}
          style={styles.retryButton}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry loading"
        >
          <Text style={styles.retryText}>{selectedLanguage === 'ta' ? 'மீண்டும் முயற்சி' : 'Try again'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const displayChapter = data.chapter_title || (selectedLanguage === 'ta' ? data.chapter_tamil : data.chapter_english);
  const currentMeaning = getThirukkuralMeaningText(data);
  const currentLifeApp = data.life_application || currentMeaning;
  const currentModern = data.explanation_modern || currentMeaning;
  const currentVerse = getThirukkuralVerseText(data);
  const currentVerseLines = splitThirukkuralLines(currentVerse);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <AmbientBackground />

      {/* Header — wayfinding only, no decoration */}
      <View style={[styles.header, { marginTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.headerButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={22} color={Aurora.color.ink} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{selectedLanguage === 'ta' ? 'தினசரி அறிவுரை' : 'Daily Wisdom'}</Text>
        <TouchableOpacity
          onPress={() => setShowLangPicker(true)}
          style={styles.headerButton}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Change language"
        >
          {isTranslating ? (
            <ActivityIndicator size="small" color={Aurora.color.indigo} />
          ) : (
            <MaterialIcons name="translate" size={20} color={Aurora.color.ink} />
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 56 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Mascot — the friendly, human moment */}
        <View style={styles.mascotContainer}>
          <LottieView
            source={require('@/assets/animations/mascot/thiruvalluvar.json')}
            autoPlay
            loop
            style={styles.mascot}
            renderMode="SOFTWARE"
            cacheComposition={false}
          />
        </View>

        {/* Hero — the verse floats directly on the canvas, no container */}
        <Animated.View style={[styles.hero, { opacity: heroOpacity, transform: [{ translateY: heroRise }] }]}>
          <Text style={styles.overline}>
            {selectedLanguage === 'ta' ? `குறள் ${data.kural_number}` : `Kural ${data.kural_number}`}
          </Text>

          <View style={styles.verseBlock}>
            {currentVerseLines.length === 0 ? (
              <Text style={styles.verseTranslating}>
                {selectedLanguage === 'ta' ? 'மொழிபெயர்க்கப்படுகிறது…' : 'Translating verse…'}
              </Text>
            ) : (
              currentVerseLines.map((line, idx) => (
                <Text
                  key={idx}
                  style={styles.verseLine}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.6}
                >
                  {line.trim()}
                </Text>
              ))
            )}
          </View>

          {!!displayChapter && <Text style={styles.chapterAttribution}>— {displayChapter}</Text>}
        </Animated.View>

        {/* Actions — one clear primary, quiet secondaries */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            onPress={handleLike}
            style={styles.quietButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={liked ? 'Unlike this kural' : 'Like this kural'}
          >
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={19} color={liked ? Aurora.color.rose : Aurora.color.inkSecondary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleAudio}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Stop audio' : 'Listen to this kural'}
          >
            <LinearGradient
              colors={[...Aurora.gradient.intelligence]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.listenButton}
            >
              <Ionicons name={isPlaying ? 'stop' : 'play'} size={18} color={Aurora.color.onPrimary} />
              <Text style={styles.listenText}>
                {isPlaying
                  ? (selectedLanguage === 'ta' ? 'நிறுத்து' : 'Stop')
                  : (selectedLanguage === 'ta' ? 'கேளுங்கள்' : 'Listen')}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleShare}
            disabled={isSharing}
            style={styles.quietButton}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Share this kural"
          >
            <Ionicons name="share-social-outline" size={21} color={Aurora.color.inkSecondary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={handleNextKural}
          style={styles.nextLink}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Show another kural"
        >
          <Text style={styles.nextLinkText}>
            {selectedLanguage === 'ta' ? 'மற்றொரு குறள்' : 'Show me another'}
          </Text>
          <Ionicons name="arrow-forward" size={15} color={Aurora.color.royal} />
        </TouchableOpacity>

        {/* Insight — soft borderless surfaces, generous spacing */}
        <View style={styles.infoContainer}>
          <Text style={styles.sectionHeader}>{selectedLanguage === 'ta' ? 'அறிவுரை' : 'Go deeper'}</Text>
          <InsightCard
            title={selectedLanguage === 'ta' ? 'பொருள்' : 'Meaning'}
            icon="menu-book"
            content={currentMeaning}
            color={Aurora.color.indigo}
          />
          <InsightCard
            title={selectedLanguage === 'ta' ? 'வாழ்க்கை பயன்பாடு' : 'Life Application'}
            icon="lightbulb"
            content={currentLifeApp}
            color={Aurora.color.amber}
          />
          <InsightCard
            title={selectedLanguage === 'ta' ? 'நவீன சூழல்' : 'Modern Context'}
            icon="trending-up"
            content={currentModern}
            color={Aurora.color.cyan}
          />
        </View>
      </ScrollView>

      {/* Language Picker — bottom sheet */}
      <Modal visible={showLangPicker} transparent animationType="slide" onRequestClose={() => setShowLangPicker(false)}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowLangPicker(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.modalContent} onPress={() => {}}>
            <View style={styles.grabber} />
            <Text style={styles.modalTitle}>Language</Text>
            {LANGUAGES.map(lang => {
              const active = selectedLanguage === lang.code;
              return (
                <TouchableOpacity
                  key={lang.code}
                  style={[styles.langOption, active && styles.langOptionActive]}
                  activeOpacity={0.7}
                  onPress={() => handleLanguageChange(lang.code)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Switch to ${lang.label}`}
                >
                  <View>
                    <Text style={[styles.langNative, active && styles.langNativeActive]}>{lang.native}</Text>
                    {lang.native !== lang.label && <Text style={styles.langLabel}>{lang.label}</Text>}
                  </View>
                  {active && (
                    <View style={styles.checkCircle}>
                      <Ionicons name="checkmark" size={14} color={Aurora.color.onPrimary} />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// Ambient canvas — a single soft indigo-tinted wash, no decoration.
const AmbientBackground = () => (
  <LinearGradient
    colors={[...Aurora.gradient.canvas]}
    style={StyleSheet.absoluteFill}
    pointerEvents="none"
  />
);

const InsightCard = ({ title, icon, content, color }: {
  title: string; icon: keyof typeof MaterialIcons.glyphMap; content: string; color: string;
}) => (
  <View style={[styles.infoCard, { backgroundColor: `${color}0D` }]}>
    <View style={styles.infoHeader}>
      <View style={[styles.iconBadge, { backgroundColor: `${color}1A` }]}>
        <MaterialIcons name={icon} size={14} color={color} />
      </View>
      <Text style={[styles.infoTitle, { color }]}>{title}</Text>
    </View>
    <Text style={styles.infoContent}>{content}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Aurora.color.background },

  // Loading / error states
  stateContainer: {
    flex: 1,
    backgroundColor: Aurora.color.background,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Aurora.space.md,
    padding: Aurora.space.xl,
  },
  stateText: { ...Aurora.type.label, color: Aurora.color.inkMuted, textAlign: 'center' },
  retryButton: {
    marginTop: Aurora.space.sm,
    paddingHorizontal: Aurora.space.lg,
    paddingVertical: 12,
    borderRadius: Aurora.radius.full,
    backgroundColor: Aurora.color.surfaceTint,
  },
  retryText: { ...Aurora.type.label, color: Aurora.color.indigo },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Aurora.space.md,
    zIndex: 10,
  },
  headerButton: {
    width: 44,
    height: 44,
    borderRadius: Aurora.radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Aurora.color.surface,
  },
  headerTitle: { ...Aurora.type.title, fontSize: 15, letterSpacing: 0.2 },

  scrollContent: { paddingTop: Aurora.space.sm },

  // Mascot
  mascotContainer: { height: 118, justifyContent: 'center', alignItems: 'center' },
  mascot: { width: 100, height: 100 },

  // Hero verse — floats on the canvas
  hero: {
    paddingHorizontal: Aurora.space.lg,
    paddingTop: Aurora.space.sm,
    alignItems: 'center',
  },
  overline: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 10.5,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: Aurora.color.indigo,
    backgroundColor: Aurora.color.surfaceTint,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Aurora.radius.full,
    overflow: 'hidden',
    marginBottom: Aurora.space.md,
  },
  verseBlock: { gap: 4, alignSelf: 'stretch' },
  verseLine: {
    fontFamily: 'Poppins-SemiBold',
    fontSize: 20,
    lineHeight: 31,
    letterSpacing: -0.2,
    color: Aurora.color.ink,
    textAlign: 'center',
  },
  verseTranslating: { ...Aurora.type.body, fontSize: 14, textAlign: 'center', color: Aurora.color.inkMuted },
  chapterAttribution: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    letterSpacing: 0.3,
    color: Aurora.color.inkMuted,
    marginTop: Aurora.space.sm + 4,
  },

  // Actions
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Aurora.space.md + 4,
    marginTop: Aurora.space.lg,
  },
  listenButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Aurora.space.sm,
    paddingHorizontal: 22,
    height: 44,
    borderRadius: Aurora.radius.full,
  },
  listenText: { fontFamily: 'Poppins-SemiBold', fontSize: 13, letterSpacing: 0.3, color: Aurora.color.onPrimary },
  quietButton: {
    width: 42,
    height: 42,
    borderRadius: Aurora.radius.full,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Aurora.color.surface,
  },
  nextLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    alignSelf: 'center',
    paddingVertical: Aurora.space.sm + 4,
    paddingHorizontal: Aurora.space.md,
    marginTop: Aurora.space.xs,
  },
  nextLinkText: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, letterSpacing: 0.2, color: Aurora.color.royal },

  // Insight section — compact tinted accent cards, flat
  infoContainer: {
    paddingHorizontal: Aurora.space.lg,
    gap: 10,
    marginTop: Aurora.space.lg,
  },
  sectionHeader: { ...Aurora.type.overline, fontSize: 11, letterSpacing: 1.4, marginBottom: 4, paddingLeft: 2 },
  infoCard: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  iconBadge: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoTitle: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 11.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  infoContent: {
    fontFamily: 'Inter-Regular',
    fontSize: 13.5,
    lineHeight: 21,
    letterSpacing: 0.1,
    color: Aurora.color.inkSecondary,
  },

  // Language sheet
  modalOverlay: { flex: 1, backgroundColor: Aurora.color.scrim, justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: Aurora.color.surface,
    borderTopLeftRadius: Aurora.radius.xl,
    borderTopRightRadius: Aurora.radius.xl,
    paddingHorizontal: Aurora.space.lg,
    paddingTop: Aurora.space.sm,
    paddingBottom: Aurora.space.xxl,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Aurora.color.hairline,
    marginBottom: Aurora.space.md,
  },
  modalTitle: { ...Aurora.type.title, marginBottom: Aurora.space.md },
  langOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: Aurora.space.md,
    borderRadius: Aurora.radius.md,
    marginBottom: 6,
  },
  langOptionActive: { backgroundColor: Aurora.color.surfaceTint },
  langNative: { ...Aurora.type.body, color: Aurora.color.ink, fontFamily: 'Inter-Medium' },
  langNativeActive: { color: Aurora.color.indigo, fontFamily: 'Inter-SemiBold' },
  langLabel: { ...Aurora.type.label, fontSize: 12, color: Aurora.color.inkMuted, marginTop: 1 },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Aurora.color.indigo,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
