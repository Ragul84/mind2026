// Shared design + motion kit for the entry flow (splash · welcome · onboarding ·
// auth). One palette, one tactile button, one animated "aurora" background, one
// entrance motion — so the four screens read as a single, world-class flow.
// Direction: Duolingo warmth + Cal AI / Rise motion polish, on the milky turquoise
// brand (canonical primary = V2026 #00D4C7).
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle, StyleProp, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withDelay, withSpring, withRepeat,
  interpolate, Easing,
} from '@/utils/reanimated';

// ---- Palette (single source of truth for the entry flow) --------------------
export const ONB = {
  turq: '#00D4C7',
  turqDeep: '#03A99E',      // 3D button edge / shadow
  turqInk: '#0A7A72',       // accent text on light
  blue: '#22B8F0',
  ink: '#0F172A',
  muted: '#64748B',
  faint: '#94A3B8',
  line: '#E7EEF2',
  tint: '#E6F9F7',
  tintBorder: '#BEEDE8',
  bg: ['#FFFFFF', '#F1FBFB', '#F3F8FF'] as const,
  grad: ['#00D4C7', '#22B8F0'] as const,
};

// ---- Motion ------------------------------------------------------------------
export const SPRING = { damping: 16, stiffness: 150, mass: 0.9 } as const;
export const SPRING_SOFT = { damping: 18, stiffness: 120, mass: 1 } as const;
export const EMPHASIZED = Easing.bezier(0.05, 0.7, 0.1, 1);

export const haptic = {
  light: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  medium: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}); },
  success: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); },
};

/** Fade + rise + slight scale entrance. Returns an animated style; pass a delay. */
export function useEntrance(delay = 0, active = true) {
  const v = useSharedValue(0);
  useEffect(() => {
    if (active) v.value = withDelay(delay, withSpring(1, SPRING_SOFT));
    else v.value = 0;
  }, [active, delay]);
  return useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [
      { translateY: interpolate(v.value, [0, 1], [18, 0]) },
      { scale: interpolate(v.value, [0, 1], [0.98, 1]) },
    ],
  }));
}

// ---- Sky background (dreamy gradient + clouds + night moon/stars) ------------
// Matches the design reference: a soft sky that fades top→bottom into white
// clouds. `variant='night'` (Welcome) deepens the top to indigo and adds a moon +
// stars; `day` is the lighter blue used everywhere else. Clouds/moon/stars are
// faked with gradients + dots so it reads right BEFORE the illustrated cloud/sky
// art lands — swap those in later without changing anything else.
const SKY_DAY = ['#8496E8', '#A9C1EF', '#CBE0F6', '#E9F3FC', '#FFFFFF'] as const;
const SKY_NIGHT = ['#2C2B6E', '#41439A', '#6E7CC9', '#A7C1E9', '#E4F0FB', '#FFFFFF'] as const;

function useDrift(range: number, duration: number, delay = 0) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true));
  }, []);
  return useAnimatedStyle(() => ({ transform: [{ translateX: interpolate(t.value, [0, 1], [-range, range]) }] }));
}

// Soft white cloud puff.
function Cloud({ size, left, bottom, duration, delay = 0, opacity = 0.9 }: {
  size: number; left: number; bottom: number; duration: number; delay?: number; opacity?: number;
}) {
  const drift = useDrift(14, duration, delay);
  return (
    <Animated.View style={[{ position: 'absolute', left, bottom, width: size, height: size * 0.62 }, drift]} pointerEvents="none">
      <LinearGradient
        colors={[`rgba(255,255,255,${opacity})`, 'rgba(255,255,255,0)']}
        start={{ x: 0.5, y: 0.2 }} end={{ x: 0.5, y: 1 }}
        style={{ width: '100%', height: '100%', borderRadius: size / 2 }}
      />
    </Animated.View>
  );
}

// Faint brand glow so the sky isn't flat.
function Glow({ colors, size, left, top }: { colors: readonly [string, string]; size: number; left: number; top: number }) {
  return (
    <View style={{ position: 'absolute', left, top, width: size, height: size }} pointerEvents="none">
      <LinearGradient colors={colors} start={{ x: 0.3, y: 0.2 }} end={{ x: 0.8, y: 0.9 }} style={{ width: '100%', height: '100%', borderRadius: size / 2 }} />
    </View>
  );
}

const STARS = [
  { top: 60, left: 40, s: 3 }, { top: 90, left: 300, s: 2 }, { top: 130, left: 120, s: 2.5 },
  { top: 40, left: 220, s: 2 }, { top: 160, left: 260, s: 3 }, { top: 200, left: 60, s: 2 },
  { top: 110, left: 190, s: 2 }, { top: 70, left: 150, s: 2.5 },
];
function Star({ top, left, s, delay }: { top: number; left: number; s: number; delay: number }) {
  const t = useSharedValue(0);
  useEffect(() => { t.value = withDelay(delay, withRepeat(withTiming(1, { duration: 1600 }), -1, true)); }, []);
  const st = useAnimatedStyle(() => ({ opacity: interpolate(t.value, [0, 1], [0.35, 1]) }));
  return <Animated.View style={[{ position: 'absolute', top, left, width: s, height: s, borderRadius: s, backgroundColor: '#fff' }, st]} pointerEvents="none" />;
}

// Full-bleed illustrated sky backgrounds (generated art in assets/onboarding/bg).
// Night = Welcome (indigo, moon, stars, clouds); Day = onboarding/auth (blue +
// clouds). A slow Ken-Burns drift keeps it alive without the procedural fakes.
const BG_NIGHT = require('@/assets/onboarding/bg/welcome-bg.jpg');
const BG_DAY = require('@/assets/onboarding/bg/day-sky.png');

export function AuroraBackground({ variant = 'day', style }: { variant?: 'day' | 'night'; style?: StyleProp<ViewStyle> }) {
  const drift = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: 16000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, []);
  const kb = useAnimatedStyle(() => ({
    transform: [
      { scale: interpolate(drift.value, [0, 1], [1.04, 1.12]) },
      { translateY: interpolate(drift.value, [0, 1], [-6, 6]) },
    ],
  }));
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: variant === 'night' ? '#0B0E28' : '#EAF3FC' }, style]} pointerEvents="none">
      <Animated.Image
        source={variant === 'night' ? BG_NIGHT : BG_DAY}
        style={[StyleSheet.absoluteFill, { width: undefined, height: undefined }, kb]}
        resizeMode="cover"
      />
      {/* Twinkling stars overlay on the night sky (animated in UI). */}
      {variant === 'night' && STARS.map((s, i) => <Star key={i} top={s.top} left={s.left} s={s.s} delay={i * 180} />)}
    </View>
  );
}

// ---- Asset placeholder -------------------------------------------------------
// Every illustration / Lottie slot renders as one of these until the real asset
// is dropped in. `slot` is the intended asset path (e.g. "miga/miga-wave") so it's
// obvious what to replace and where. `kind='lottie'` adds a gentle pulse so motion
// slots read as animated. Swap a Placeholder for <Image>/<LottieView> later — the
// layout box stays the same size.
export function Placeholder({ slot, kind = 'image', emoji = '🖼️', height, radius = 20, style }: {
  slot: string; kind?: 'image' | 'lottie'; emoji?: string;
  height?: number; radius?: number; style?: StyleProp<ViewStyle>;
}) {
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (kind === 'lottie') pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, []);
  const st = useAnimatedStyle(() => ({ opacity: kind === 'lottie' ? interpolate(pulse.value, [0, 1], [0.6, 1]) : 1 }));
  return (
    <Animated.View style={[ph.box, { borderRadius: radius }, height ? { height } : null, st, style]}>
      <Text style={ph.emoji}>{emoji}</Text>
      <Text style={ph.slot}>{slot}</Text>
      <View style={[ph.tag, kind === 'lottie' && ph.tagLottie]}>
        <Text style={[ph.tagText, kind === 'lottie' && { color: ONB.blue }]}>{kind === 'lottie' ? 'LOTTIE' : 'IMAGE'}</Text>
      </View>
    </Animated.View>
  );
}

const ph = StyleSheet.create({
  box: {
    alignItems: 'center', justifyContent: 'center', gap: 6, padding: 14,
    backgroundColor: 'rgba(0,212,199,0.05)', borderWidth: 1.5, borderColor: ONB.tintBorder, borderStyle: 'dashed',
  },
  emoji: { fontSize: 30 },
  slot: { fontFamily: 'Inter-SemiBold', fontSize: 11, color: ONB.turqInk, letterSpacing: 0.2, textAlign: 'center' },
  tag: { position: 'absolute', top: 8, right: 8, backgroundColor: ONB.tint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  tagLottie: { backgroundColor: 'rgba(34,184,240,0.12)' },
  tagText: { fontFamily: 'Poppins-Bold', fontSize: 8, color: ONB.turqInk, letterSpacing: 0.5 },
});

// ---- Tactile 3D button (Duolingo-style) with haptics -------------------------
export function DuoButton({ label, onPress, disabled, loading, hidden, icon, style }: {
  label: string; onPress: () => void; disabled?: boolean; loading?: boolean;
  hidden?: boolean; icon?: React.ReactNode; style?: StyleProp<ViewStyle>;
}) {
  const down = useSharedValue(0);
  const face = useAnimatedStyle(() => ({ transform: [{ translateY: down.value * 5 }] }));
  const wrap = useAnimatedStyle(() => ({
    opacity: withTiming(hidden ? 0 : 1, { duration: 240 }),
    transform: [{ translateY: withTiming(hidden ? 14 : 0, { duration: 240 }) }],
  }));
  return (
    <Animated.View style={[wrap, style]} pointerEvents={hidden ? 'none' : 'auto'}>
      <Pressable
        onPressIn={() => { if (!disabled) { down.value = withTiming(1, { duration: 60 }); haptic.light(); } }}
        onPressOut={() => { down.value = withTiming(0, { duration: 120 }); }}
        onPress={() => { if (!disabled && !loading) onPress(); }}
        accessibilityRole="button" accessibilityLabel={label}
      >
        <View style={btn.wrap}>
          <View style={[btn.edge, disabled && btn.edgeOff]} />
          <Animated.View style={[btn.face, face, (disabled || loading) && { opacity: 0.85 }]}>
            <LinearGradient
              colors={disabled ? ['#CBD5E1', '#CBD5E1'] : ONB.grad}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={btn.grad}
            >
              {loading ? <ActivityDot /> : (
                <View style={btn.row}>
                  {icon}
                  <Text style={btn.text}>{label}</Text>
                </View>
              )}
            </LinearGradient>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Small three-dot loader so the button doesn't need ActivityIndicator import churn.
function ActivityDot() {
  return (
    <View style={btn.row}>
      {[0, 1, 2].map((i) => <Dot key={i} i={i} />)}
    </View>
  );
}
function Dot({ i }: { i: number }) {
  const v = useSharedValue(0);
  useEffect(() => { v.value = withDelay(i * 160, withRepeat(withTiming(1, { duration: 520 }), -1, true)); }, []);
  const st = useAnimatedStyle(() => ({ opacity: interpolate(v.value, [0, 1], [0.35, 1]), transform: [{ translateY: interpolate(v.value, [0, 1], [0, -3]) }] }));
  return <Animated.View style={[{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff', marginHorizontal: 3 }, st]} />;
}

// ---- Progress dots -----------------------------------------------------------
export function ProgressDots({ count, index }: { count: number; index: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 7, justifyContent: 'center' }}>
      {Array.from({ length: count }).map((_, d) => <DotBar key={d} on={d === index} done={d < index} />)}
    </View>
  );
}
function DotBar({ on, done }: { on: boolean; done: boolean }) {
  const st = useAnimatedStyle(() => ({
    width: withSpring(on ? 22 : 7, SPRING),
    backgroundColor: withTiming(on || done ? ONB.turq : '#D8E0E8', { duration: 220 }),
  }));
  return <Animated.View style={[{ height: 7, borderRadius: 4 }, st]} />;
}

const btn = StyleSheet.create({
  wrap: { height: 58, borderRadius: 18 },
  edge: { position: 'absolute', left: 0, right: 0, top: 5, bottom: 0, borderRadius: 18, backgroundColor: ONB.turqDeep },
  edgeOff: { backgroundColor: '#AEBAC8' },
  face: { position: 'absolute', left: 0, right: 0, top: 0, height: 53, borderRadius: 18, overflow: 'hidden' },
  grad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  text: { fontFamily: 'Poppins-SemiBold', fontSize: 16.5, color: '#fff', letterSpacing: 0.3 },
});
