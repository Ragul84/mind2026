// 🔐 Auth — MindGains
// Three intentional vertical blocks, each with its own reserved space (not
// stacked in the same paint layer): header -> hero text -> Miga block ->
// sheet. Only the Miga block is allowed to physically overlap the sheet
// (the platform, ~20% of the image), and that overlap is a fixed, small
// negative margin sized to the image's own aspect ratio — never covering
// the welcome text or the "Login with Mobile" row. Keyboard-open animates
// real block HEIGHTS (which reclaims layout space), not just a cosmetic
// transform:scale — that was the bug in the previous pass: scaling doesn't
// shrink the space an element occupies, so the composition just visually
// squashed instead of making room.
// Built against DESIGN.md / theme/v2026-tokens.ts. Auth logic (Supabase
// phone OTP / Google) is unchanged — presentation only.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, StatusBar, Platform,
  Dimensions, ActivityIndicator, Image, KeyboardAvoidingView, ScrollView, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import FontAwesome5 from 'react-native-vector-icons/FontAwesome5';
import { Ionicons } from '@expo/vector-icons';
import LottieView from 'lottie-react-native';
import { SupabaseService, supabase } from '@/utils/supabaseService';
import { getUserProtocol } from '@/utils/protocolService';
import { useAuthContext } from '@/components/AuthProvider';
import { signInWithGoogle } from '@/utils/googleAuth';
import { router } from 'expo-router';
import HapticService from '@/utils/hapticService';
import { V2026 } from '@/theme/v2026-tokens';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withSpring, withSequence,
  withDelay, withRepeat, interpolate, Easing,
} from '@/utils/reanimated';

const { width, height } = Dimensions.get('window');
const PRIMARY_CONTAINER = 'rgba(0, 212, 199, 0.12)';
const ATMOSPHERE_GRAD = ['#EAFBFA', '#D3F3F1', '#BDECEA'] as const;
const MIGA_ASPECT = 1536 / 1024; // source PNG's real pixel aspect ratio
// Fraction of Miga's own height allowed to cross into the sheet (the
// platform only) — per spec, 15-25%.
const PLATFORM_OVERLAP = 0.2;
type AuthStep = 'entry' | 'otp';

function Reveal({ delay, children, style }: { delay: number; children: React.ReactNode; style?: any }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(delay, withSpring(1, { damping: 16, stiffness: 140 })); }, []);
  const revealStyle = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 16 }] }));
  return <Animated.View style={[style, revealStyle]}>{children}</Animated.View>;
}

function SheetEntrance({ children, style }: { children: React.ReactNode; style?: any }) {
  const p = useSharedValue(0);
  useEffect(() => { p.value = withDelay(120, withSpring(1, { damping: 18, stiffness: 120 })); }, []);
  const enterStyle = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateY: (1 - p.value) * 28 }] }));
  return <Animated.View style={[style, enterStyle]}>{children}</Animated.View>;
}

// Extremely slight idle float — not a bounce, a breathing motion.
function MigaHero({ style, size }: { style?: any; size: { width: number; height: number } }) {
  const breathe = useSharedValue(0);
  useEffect(() => {
    breathe.value = withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, []);
  const breatheStyle = useAnimatedStyle(() => ({ transform: [{ translateY: breathe.value * -5 }] }));
  return (
    <Animated.View style={[breatheStyle, style]}>
      <Image source={require('@/assets/mascot/auth-hero-glow.png')} resizeMode="contain" style={size} />
    </Animated.View>
  );
}

function PillButton({ label, icon, onPress, disabled, loading }: {
  label: string; icon?: React.ReactNode; onPress: () => void; disabled?: boolean; loading?: boolean;
}) {
  const press = useSharedValue(0);
  const scale = useAnimatedStyle(() => ({ transform: [{ scale: 1 - press.value * 0.03 }] }));
  const isInteractive = !disabled && !loading;
  return (
    <Pressable
      onPressIn={() => { if (isInteractive) { press.value = withTiming(1, { duration: 60 }); void HapticService.light(); } }}
      onPressOut={() => { press.value = withTiming(0, { duration: 120 }); }}
      onPress={onPress} disabled={!isInteractive} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !isInteractive, busy: loading }}
    >
      <Animated.View style={scale}>
        {disabled && !loading ? (
          <View style={[styles.pillBtn, styles.pillBtnDisabled]}>
            <Text style={styles.pillBtnText}>{label}</Text>
          </View>
        ) : (
          <LinearGradient colors={['#00D4C7', '#22B8F0']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.pillBtn}>
            {loading ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={styles.pillBtnText}>{label}</Text>
                {icon}
              </>
            )}
          </LinearGradient>
        )}
      </Animated.View>
    </Pressable>
  );
}

// One OTP digit box: pops on fill, glows while focused, rides the parent
// row's shake on a wrong code.
function OtpBox({ digit, autoFocus, inputRef, onChangeText, onKeyPress }: {
  digit: string; autoFocus: boolean; inputRef: (r: TextInput | null) => void;
  onChangeText: (v: string) => void; onKeyPress: (e: any) => void;
}) {
  const pop = useSharedValue(1);
  const focusGlow = useSharedValue(0);
  const prevFilled = useRef(false);
  useEffect(() => {
    const filled = digit !== '';
    if (filled && !prevFilled.current) {
      pop.value = withSequence(withTiming(1.18, { duration: 90 }), withSpring(1, { damping: 9, stiffness: 260 }));
      void HapticService.light();
    }
    prevFilled.current = filled;
  }, [digit]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }], shadowOpacity: focusGlow.value * 0.35 }));
  return (
    <Animated.View style={[styles.otpBoxShadow, style]}>
      <TextInput
        ref={inputRef}
        style={[styles.otpBox, digit !== '' && styles.otpBoxFilled]}
        keyboardType="number-pad" maxLength={6} value={digit}
        onChangeText={onChangeText} onKeyPress={onKeyPress}
        onFocus={() => { focusGlow.value = withTiming(1, { duration: 180 }); }}
        onBlur={() => { focusGlow.value = withTiming(0, { duration: 180 }); }}
        autoFocus={autoFocus} textContentType="oneTimeCode" autoComplete="sms-otp" selectTextOnFocus
      />
    </Animated.View>
  );
}

export default function Auth() {
  const isMounted = useRef(true);
  const [step, setStep] = useState<AuthStep>('entry');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [celebrating, setCelebrating] = useState(false);
  const { isAuthenticated, loading: authLoading, initialized } = useAuthContext();
  const otpRefs = useRef<(TextInput | null)[]>([]);
  const redirectHandled = useRef(false);
  const pendingRouteRef = useRef<{ needsOnboarding: boolean } | null>(null);
  const otpShake = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const topBarHeight = insets.top + 26; // fixed pinned back-button row; content clears this, never the reverse
  const entryScrollRef = useRef<ScrollView>(null);
  const otpScrollRef = useRef<ScrollView>(null);
  const stepRef = useRef<AuthStep>('entry');
  useEffect(() => { stepRef.current = step; }, [step]);

  // A single one-shot scroll on keyboard-show — not a continuous animated
  // reaction — so it can't feed back into itself the way the old
  // height-driven hero shrink did. This is what actually lifts the phone
  // field / Send OTP button (or the OTP boxes) above the keyboard.
  useEffect(() => {
    const sub = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => {
      const ref = stepRef.current === 'otp' ? otpScrollRef : entryScrollRef;
      ref.current?.scrollToEnd({ animated: true });
    });
    return () => sub.remove();
  }, []);

  // ── Responsive Miga sizing (real formula, not a hardcoded device size) ──
  const migaWidth = Math.min(width * 0.72, 280);
  const migaHeight = migaWidth * MIGA_ASPECT;
  const migaBlockHeight = migaHeight * (1 - PLATFORM_OVERLAP); // reserved space; the rest is the intentional platform overlap
  const migaSmallWidth = Math.min(width * 0.36, 150);
  const migaSmallHeight = migaSmallWidth * MIGA_ASPECT;
  const migaSmallBlockHeight = migaSmallHeight * (1 - PLATFORM_OVERLAP);
  const heroTextHeight = 64;

  // The hero used to also shrink itself via a keyboard-open listener,
  // stacked on top of KeyboardAvoidingView's own push + the ScrollView's
  // own content-size recalculation. All three fighting over the same
  // layout on every keyboard frame caused a feedback loop (each one's
  // adjustment retriggered the others) that showed up as an infinite
  // flicker the moment an input was focused. KeyboardAvoidingView +
  // ScrollView alone are enough to keep the focused field visible, so the
  // hero now stays a fixed size and doesn't react to keyboard state at all.
  const heroTextAnimStyle = { height: heroTextHeight };
  const migaBlockAnimStyle = { height: migaBlockHeight };
  const migaImageAnimStyle = undefined;

  // Matches the app's own stack push/pop feel (slide_from_right) instead of
  // a flat crossfade: entry eases out to the left as OTP slides in from the
  // right, and reverses symmetrically on the way back.
  const stepProgress = useSharedValue(0); // 0 = entry, 1 = otp
  useEffect(() => {
    stepProgress.value = withTiming(step === 'otp' ? 1 : 0, { duration: 340, easing: Easing.out(Easing.cubic) });
  }, [step]);
  const entryStyle = useAnimatedStyle(() => ({
    opacity: interpolate(stepProgress.value, [0, 1], [1, 0]),
    transform: [{ translateX: interpolate(stepProgress.value, [0, 1], [0, -width * 0.18]) }],
    display: stepProgress.value > 0.98 ? 'none' : 'flex',
  }));
  const otpStyle = useAnimatedStyle(() => ({
    opacity: interpolate(stepProgress.value, [0, 1], [0, 1]),
    transform: [{ translateX: interpolate(stepProgress.value, [0, 1], [width * 0.35, 0]) + otpShake.value }],
    display: stepProgress.value < 0.02 ? 'none' : 'flex',
  }));

  useEffect(() => { isMounted.current = true; return () => { isMounted.current = false; }; }, []);

  const resolveRoute = async (userId?: string) => {
    const id = userId || (await supabase.auth.getUser()).data.user?.id;
    if (!id) return;
    const [profile, protocol] = await Promise.all([SupabaseService.getUserProfile(id), getUserProtocol(id)]);
    const needsOnboarding = !profile?.full_name || !protocol?.track_id;
    pendingRouteRef.current = { needsOnboarding };
  };

  const goToResolvedRoute = () => {
    const target = pendingRouteRef.current;
    if (!target) return;
    router.replace(target.needsOnboarding ? '/profile-setup' : '/home');
  };

  useEffect(() => {
    if (!initialized || authLoading || !isAuthenticated || redirectHandled.current) return;
    redirectHandled.current = true;
    resolveRoute().then(goToResolvedRoute).catch(() => router.replace('/home'));
  }, [initialized, authLoading, isAuthenticated]);

  useEffect(() => {
    if (countdown > 0) { const t = setTimeout(() => setCountdown(countdown - 1), 1000); return () => clearTimeout(t); }
  }, [countdown]);

  const handleGoogle = async () => {
    void HapticService.light();
    setGoogleLoading(true); setError('');
    const res = await signInWithGoogle();
    if (!res.ok) {
      if (!res.cancelled) { setError(res.error || 'Google sign-in failed.'); void HapticService.error(); }
      if (isMounted.current) setGoogleLoading(false);
      return;
    }
    try {
      await resolveRoute();
      if (isMounted.current) { setGoogleLoading(false); goToResolvedRoute(); }
    } catch {
      router.replace('/home');
    }
  };

  const handlePhoneSubmit = async () => {
    if (phone.length < 10) { setError('Please enter a valid 10-digit number.'); void HapticService.error(); return; }
    Keyboard.dismiss();
    setLoading(true); setError('');
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: `+91${phone}` });
      if (error) throw error;
      setStep('otp'); setCountdown(60); setOtp(['', '', '', '', '', '']);
    } catch (err: any) {
      setError(err.message || 'Failed to send OTP. Please try again.');
      void HapticService.error();
    } finally { if (isMounted.current) setLoading(false); }
  };

  const handleOtpChange = (value: string, index: number) => {
    const clean = value.replace(/[^0-9]/g, '');
    if (clean.length === 6) { setOtp(clean.split('')); otpRefs.current[5]?.focus(); verifyOtp(clean); return; }
    const next = [...otp]; next[index] = clean.slice(-1); setOtp(next);
    if (clean && index < 5) otpRefs.current[index + 1]?.focus();
    if (next.join('').length === 6) verifyOtp(next.join(''));
  };
  const handleOtpKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otp[index] && index > 0) otpRefs.current[index - 1]?.focus();
  };

  const verifyOtp = async (code: string) => {
    setLoading(true); setError('');
    try {
      const { data, error } = await supabase.auth.verifyOtp({ phone: `+91${phone}`, token: code, type: 'sms' });
      if (error) throw error;
      if (data.user) {
        await supabase.from('user_profiles').upsert(
          { id: data.user.id, phone_number: `+91${phone}`, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      }
      await resolveRoute(data.user?.id);
      if (!isMounted.current) return;
      setLoading(false);
      void HapticService.success();
      setCelebrating(true);
      setTimeout(() => { if (isMounted.current) goToResolvedRoute(); }, 1050);
    } catch (err: any) {
      setError(err.message || 'Invalid OTP. Please try again.');
      setOtp(['', '', '', '', '', '']); otpRefs.current[0]?.focus();
      void HapticService.error();
      otpShake.value = withSequence(
        withTiming(-10, { duration: 55 }), withTiming(10, { duration: 55 }),
        withTiming(-8, { duration: 55 }), withTiming(8, { duration: 55 }),
        withTiming(0, { duration: 55 }),
      );
      if (isMounted.current) setLoading(false);
    }
  };

  const resendOtp = async () => { if (countdown === 0) await handlePhoneSubmit(); };
  const canSubmit = phone.length === 10 && !loading;

  if (celebrating) {
    return (
      <View style={styles.root}>
        <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
        <View style={styles.celebrateWrap}>
          <LottieView source={require('@/assets/lotties/success-check.json')} autoPlay loop={false} style={styles.celebrateCheck} />
          <Text style={styles.title}>You're in!</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />
      <SafeAreaView style={styles.safe} edges={['bottom']}>
          <View style={styles.content}>
            {/* Full-bleed atmosphere — runs from the very top of the screen
                (under the status bar) down past the header/hero text, so
                the mascot's backdrop color isn't boxed into just its own
                block. Sits behind everything else (first sibling = painted
                first = behind later siblings). */}
            <LinearGradient
              colors={ATMOSPHERE_GRAD}
              style={[
                styles.topAtmosphere,
                { height: topBarHeight + heroTextHeight + migaBlockHeight + 32 },
              ]}
            />

            {/* Pinned back button — its own layer, above everything, never
                affected by keyboard state or the hero collapse below it. */}
            <View style={[styles.topRow, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
              <Pressable
                onPress={() => { void HapticService.light(); if (step === 'otp') { setStep('entry'); } else { router.replace('/onboarding'); } }}
                hitSlop={12} style={styles.backBtn}
              >
                <FontAwesome5 name="arrow-left" size={16} color="#334155" />
              </Pressable>
            </View>

            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? -40 : -40}>
            {/* ── Entry step ───────────────────────────────────────────── */}
            <Animated.View style={[{ flex: 1 }, entryStyle]} pointerEvents={step === 'entry' ? 'auto' : 'none'}>
            <ScrollView
              ref={entryScrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1, paddingTop: topBarHeight }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {/* Welcome text — its OWN reserved space, entirely above and
                  outside the Miga block below. Collapses on keyboard open
                  (real height, not a scale transform). */}
              <Animated.View style={[styles.heroTextBlock, heroTextAnimStyle]}>
                <Reveal delay={0}>
                  <Text style={styles.title}>
                    Welcome <Text style={styles.titleAccent}>back!</Text>
                  </Text>
                </Reveal>
              </Animated.View>

              {/* Block B: Miga. Reserved height = 80% of the image's own
                  height; the remaining 20% (the platform) is allowed to
                  visually spill past this block's bottom edge into the
                  sheet below — that overlap is the only intentional
                  collision in this screen. overflow:visible so the spill
                  isn't clipped; zIndex 4 so it paints in front of the sheet. */}
              <Animated.View style={[styles.heroAtmosphereWrap, migaBlockAnimStyle, { marginTop: -22 }]}>
                <View style={styles.heroMigaWrap}>
                  <MigaHero style={migaImageAnimStyle} size={{ width: migaWidth, height: migaHeight }} />
                </View>
              </Animated.View>

              {/* Block C: the sheet. Small negative margin equal to exactly
                  the platform overlap fraction — never enough to reach the
                  welcome text above. zIndex 3, above the atmosphere but the
                  Miga image (zIndex 4) still paints in front of its edge. */}
              <SheetEntrance style={[styles.sheet, { flex: 1, marginTop: -migaHeight * PLATFORM_OVERLAP + 16 }]}>
                <Reveal delay={90}>
                  <View style={styles.introRow}>
                    <View style={styles.introIcon}><Ionicons name="phone-portrait-outline" size={18} color={V2026.colors.primaryDeep} /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.introTitle}>Login with Mobile</Text>
                      <Text style={styles.introSub}>We'll send you an OTP to verify</Text>
                    </View>
                  </View>

                  <View style={styles.phoneRow}>
                    <View style={styles.codeBox}><Text style={styles.codeText}>🇮🇳 +91</Text></View>
                    <TextInput
                      style={styles.phoneInput} placeholder="Phone number" placeholderTextColor={V2026.colors.textFaint}
                      keyboardType="phone-pad" maxLength={10} value={phone}
                      onChangeText={(t) => { setPhone(t.replace(/[^0-9]/g, '')); setError(''); }}
                    />
                  </View>
                  {error ? <Text style={styles.errorText}>{error}</Text> : null}
                  <View style={{ marginTop: 14 }}>
                    <PillButton
                      label="Send OTP"
                      icon={<Ionicons name="send" size={16} color="#FFFFFF" style={{ marginLeft: 8 }} />}
                      onPress={handlePhoneSubmit} disabled={!canSubmit} loading={loading}
                    />
                  </View>
                </Reveal>

                <Reveal delay={160}>
                  <Text style={styles.orText}>or continue with</Text>
                  <Pressable onPress={handleGoogle} disabled={googleLoading} style={({ pressed }) => [styles.google, pressed && { opacity: 0.9 }]}>
                    {googleLoading ? <ActivityIndicator color={V2026.colors.text} /> : (
                      <><FontAwesome5 name="google" size={16} color="#EA4335" /><Text style={styles.googleText}>Continue with Google</Text></>
                    )}
                  </Pressable>
                </Reveal>

                <Reveal delay={220} style={{ marginTop: 'auto' }}>
                  <Text style={styles.footer}>
                    By continuing, you agree to MindGains'{' '}
                    <Text style={styles.footerLink}>Terms of Service</Text> and <Text style={styles.footerLink}>Privacy Policy</Text>.
                  </Text>
                </Reveal>
              </SheetEntrance>
            </ScrollView>
            </Animated.View>

            {/* ── OTP step ─────────────────────────────────────────────── */}
            <Animated.View style={[{ flex: 1 }, otpStyle]} pointerEvents={step === 'otp' ? 'auto' : 'none'}>
            <ScrollView
              ref={otpScrollRef}
              style={{ flex: 1 }}
              contentContainerStyle={{ flexGrow: 1, paddingTop: topBarHeight }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <Text style={styles.navTitle}>MindGains</Text>

              <View style={[styles.heroAtmosphereWrap, { height: migaSmallBlockHeight, marginTop: 6 }]}>
                <View style={styles.heroMigaWrap}>
                  <MigaHero size={{ width: migaSmallWidth, height: migaSmallHeight }} />
                </View>
                <View style={[styles.floatBadge, styles.floatBadgeLeft]}><Ionicons name="lock-closed" size={14} color={V2026.colors.primaryDeep} /></View>
                <View style={[styles.floatBadge, styles.floatBadgeRight]}><Ionicons name="checkmark" size={14} color={V2026.colors.primaryDeep} /></View>
              </View>

              <SheetEntrance style={[styles.sheet, { flex: 1, marginTop: -migaSmallHeight * PLATFORM_OVERLAP + 16 }]}>
                <Text style={[styles.title, { fontSize: 21, marginTop: 0 }]}>Verify your number</Text>
                <View style={styles.editPhoneRow}>
                  <Text style={styles.subtitleInline}>Code sent to </Text>
                  <Text style={styles.phoneHi}>+91 {phone}</Text>
                  <Pressable onPress={() => setStep('entry')} hitSlop={10}>
                    <Ionicons name="pencil" size={13} color={V2026.colors.primaryDeep} style={{ marginLeft: 6 }} />
                  </Pressable>
                </View>

                <View style={styles.otpRow}>
                  {otp.map((digit, i) => (
                    <OtpBox
                      key={i} digit={digit} autoFocus={i === 0}
                      inputRef={(r) => { otpRefs.current[i] = r; }}
                      onChangeText={(v) => handleOtpChange(v, i)}
                      onKeyPress={(e) => handleOtpKeyPress(e, i)}
                    />
                  ))}
                </View>
                {error ? <Text style={styles.errorText}>{error}</Text> : null}

                {loading ? <View style={styles.verifyRow}><ActivityIndicator color={V2026.colors.primary} /><Text style={styles.verifyText}>Verifying…</Text></View> : (
                  <Text style={styles.resendText}>
                    {countdown > 0 ? <>Resend code in <Text style={styles.resendCount}>{countdown}s</Text></> : (
                      <Text onPress={resendOtp} style={styles.resendLink}>Resend OTP</Text>
                    )}
                  </Text>
                )}

                <View style={styles.helpCard}>
                  <Ionicons name="phone-portrait-outline" size={18} color={V2026.colors.textMuted} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.helpTitle}>Didn't get the code?</Text>
                    <Text style={styles.helpSub}>Check your messages or try again.</Text>
                  </View>
                </View>

                <View style={[styles.safeRow, { marginTop: 'auto' }]}>
                  <Ionicons name="shield-outline" size={13} color={V2026.colors.textMuted} />
                  <Text style={styles.safeText}>Your number is safe with us.</Text>
                </View>
              </SheetEntrance>
            </ScrollView>
            </Animated.View>
            </KeyboardAvoidingView>
          </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: V2026.colors.background },
  safe: { flex: 1 },
  content: { flex: 1 },

  // Pinned above everything else, permanently — physically cannot be
  // pushed off-screen by the keyboard because nothing here ever animates.
  topRow: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 20, zIndex: 10 },
  backBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.85)', ...V2026.shadows.milky },
  navTitle: { fontFamily: 'Poppins-Bold', fontSize: 15, color: V2026.colors.textMuted, textAlign: 'center', letterSpacing: 0.2 },

  // Own block, own space — never shares paint order with Miga.
  heroTextBlock: { justifyContent: 'flex-start', zIndex: 2, overflow: 'hidden' },
  title: { fontFamily: 'Poppins-Bold', fontSize: 26, color: V2026.colors.text, textAlign: 'center', letterSpacing: -0.5, lineHeight: 30 },
  titleAccent: { color: V2026.colors.primaryDeep },
  subtitle: { fontFamily: 'Inter-Regular', fontSize: 13.5, color: V2026.colors.textMuted, textAlign: 'center', marginTop: 2, lineHeight: 18, paddingHorizontal: 32 },
  subtitleInline: { fontFamily: 'Inter-Regular', fontSize: 13, color: V2026.colors.textMuted },

  // Block B: atmosphere + Miga. overflow:visible (default) so the platform
  // can spill past this block's own bottom edge into the sheet on purpose.
  heroAtmosphereWrap: { position: 'relative', zIndex: 0 },
  topAtmosphere: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 0,
    borderBottomLeftRadius: V2026.radius.xl, borderBottomRightRadius: V2026.radius.xl,
  },
  heroMigaWrap: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', zIndex: 4 },
  floatBadge: { position: 'absolute', bottom: 4, width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, zIndex: 4 },
  floatBadgeLeft: { left: '26%' },
  floatBadgeRight: { right: '26%' },

  sheet: {
    backgroundColor: V2026.colors.surface,
    borderTopLeftRadius: V2026.radius.lg,
    borderTopRightRadius: V2026.radius.lg,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 16,
    zIndex: 3,
    shadowColor: V2026.shadows.milky.shadowColor,
    shadowOpacity: V2026.shadows.milky.shadowOpacity,
    shadowRadius: V2026.shadows.milky.shadowRadius,
    shadowOffset: { width: 0, height: -8 },
    elevation: V2026.shadows.milky.elevation,
  },
  otpStepAbsolute: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 0 },

  introRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  introIcon: { width: 36, height: 36, borderRadius: V2026.radius.sm, backgroundColor: PRIMARY_CONTAINER, alignItems: 'center', justifyContent: 'center' },
  introTitle: { fontFamily: 'Poppins-SemiBold', fontSize: 14, color: V2026.colors.text },
  introSub: { fontFamily: 'Inter-Regular', fontSize: 11.5, color: V2026.colors.textMuted, marginTop: 1 },

  phoneRow: {
    flexDirection: 'row', alignItems: 'center', height: 52, borderRadius: V2026.radius.md, backgroundColor: V2026.colors.background,
    ...V2026.shadows.milky,
  },
  codeBox: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 13, height: '100%', justifyContent: 'center' },
  codeText: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: V2026.colors.text },
  phoneInput: { flex: 1, height: '100%', paddingHorizontal: 13, fontFamily: 'Inter-SemiBold', fontSize: 16, color: V2026.colors.text, letterSpacing: 1 },

  orText: { textAlign: 'center', fontFamily: 'Inter-Regular', fontSize: 12, color: V2026.colors.textFaint, marginVertical: 10 },
  google: {
    height: 48, borderRadius: V2026.radius.full, backgroundColor: V2026.colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    ...V2026.shadows.milky,
  },
  googleText: { fontFamily: 'Poppins-SemiBold', fontSize: 14, color: V2026.colors.text },

  footer: { fontFamily: 'Inter-Regular', fontSize: 11, lineHeight: 15, color: V2026.colors.textFaint, textAlign: 'center', marginTop: 14 },
  footerLink: { color: V2026.colors.textMuted, fontFamily: 'Inter-SemiBold' },
  errorText: { color: V2026.colors.error, fontFamily: 'Inter-SemiBold', fontSize: 13, textAlign: 'center', marginTop: 10 },

  editPhoneRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 4, marginBottom: 18 },
  phoneHi: { fontFamily: 'Poppins-SemiBold', fontSize: 15, color: V2026.colors.text },
  otpRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  otpBoxShadow: { shadowColor: V2026.colors.primary, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0 },
  otpBox: {
    width: (width - 48 - 40) / 6, height: 58, borderRadius: V2026.radius.md, backgroundColor: V2026.colors.background, borderWidth: 1.5, borderColor: 'transparent',
    textAlign: 'center', fontFamily: 'Poppins-SemiBold', fontSize: 22, color: V2026.colors.text,
    ...V2026.shadows.milky,
  },
  otpBoxFilled: { borderColor: V2026.colors.primary, backgroundColor: PRIMARY_CONTAINER },
  verifyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18 },
  verifyText: { fontFamily: 'Inter-Medium', fontSize: 13, color: V2026.colors.textMuted },
  resendText: { textAlign: 'center', fontFamily: 'Inter-Regular', fontSize: 13.5, color: V2026.colors.textMuted, marginTop: 18 },
  resendCount: { fontFamily: 'Inter-Bold', color: V2026.colors.primaryDeep },
  resendLink: { fontFamily: 'Inter-SemiBold', color: V2026.colors.primaryDeep },

  helpCard: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: V2026.colors.background, borderRadius: V2026.radius.md, padding: 14, marginTop: 18 },
  helpTitle: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: V2026.colors.text },
  helpSub: { fontFamily: 'Inter-Regular', fontSize: 12, color: V2026.colors.textMuted, marginTop: 2 },
  safeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14 },
  safeText: { fontFamily: 'Inter-Regular', fontSize: 12, color: V2026.colors.textMuted },

  celebrateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  celebrateCheck: { width: 160, height: 160 },

  pillBtn: { height: 56, borderRadius: V2026.radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', ...V2026.shadows.primary },
  pillBtnDisabled: { backgroundColor: '#CBD5E1' },
  pillBtnText: { fontFamily: 'Poppins-SemiBold', fontSize: 16, color: V2026.colors.surface, letterSpacing: 0.2 },
});
