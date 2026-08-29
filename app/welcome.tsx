// Welcome · MindGains
// The emblem->mascot Lottie plays once and FREEZES on Miga (frames 0..150, the
// mascot's landing) instead of running to the end where it drops. Milky theme,
// tight vertical rhythm, tactile teal button.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Dimensions, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import LottieView from 'lottie-react-native';
import { router } from 'expo-router';
import Animated, {
  useAnimatedStyle, useSharedValue, withTiming, withDelay, withSpring, interpolate, Easing,
} from '@/utils/reanimated';

const { width } = Dimensions.get('window');
const BG = ['#FFFFFF', '#F1FBFB', '#F5F9FF'] as const;
const INK = '#12203B';
const TEAL = '#0E9488';
const TEAL_DEEP = '#0A7568';
const FREEZE_FRAME = 150; // mascot fully landed (of 169). Tune if it stops early/late.

function DuoButton({ label, onPress }: { label: string; onPress: () => void }) {
  const down = useSharedValue(0);
  const face = useAnimatedStyle(() => ({ transform: [{ translateY: down.value * 5 }] }));
  return (
    <Pressable
      onPressIn={() => { down.value = withTiming(1, { duration: 60 }); }}
      onPressOut={() => { down.value = withTiming(0, { duration: 120 }); }}
      onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
    >
      <View style={styles.btnWrap}>
        <View style={styles.btnEdge} />
        <Animated.View style={[styles.btnFace, face]}>
          <LinearGradient colors={[TEAL, TEAL]} style={styles.btnGrad}><Text style={styles.btnText}>{label}</Text></LinearGradient>
        </Animated.View>
      </View>
    </Pressable>
  );
}

export default function Welcome() {
  const lottieRef = useRef<LottieView>(null);
  const copy = useSharedValue(0);

  useEffect(() => {
    const t = setTimeout(() => lottieRef.current?.play(0, FREEZE_FRAME), 60);
    copy.value = withDelay(700, withSpring(1, { damping: 14, stiffness: 120 }));
    return () => clearTimeout(t);
  }, []);

  const copyStyle = useAnimatedStyle(() => ({
    opacity: copy.value,
    transform: [{ translateY: interpolate(copy.value, [0, 1], [16, 0]) }],
  }));

  return (
    <View style={styles.root}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <LinearGradient colors={BG} style={StyleSheet.absoluteFill} />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.artArea}>
          <LottieView
            ref={lottieRef}
            source={require('@/assets/lotties/welcomescreen.json')}
            autoPlay={false}
            loop={false}
            resizeMode="contain"
            style={styles.lottie}
          />
        </View>

        <Animated.View style={[styles.copy, copyStyle]}>
          <View style={styles.brandRow}>
            <Text style={styles.brand}>Mind</Text>
            <Text style={[styles.brand, styles.brandAccent]}>Gains</Text>
          </View>
          <Text style={styles.headline}>Make Learning a Daily Habit</Text>

          <View style={styles.ctaArea}>
            <DuoButton label="Get Started" onPress={() => router.push('/onboarding')} />
            <Pressable onPress={() => router.replace('/auth')} hitSlop={12} style={styles.secondary}>
              <Text style={styles.secondaryText}>I already have an account  <Text style={styles.secondaryLink}>Sign in</Text></Text>
            </Pressable>
          </View>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  safe: { flex: 1, paddingHorizontal: 24 },
  artArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lottie: { width: Math.min(width * 0.96, 430), height: Math.min(width * 0.96, 430) },
  copy: { alignItems: 'center', paddingBottom: 24 },
  brandRow: { flexDirection: 'row', alignItems: 'baseline' },
  brand: { fontFamily: 'Poppins-Bold', fontSize: 34, letterSpacing: -1.1, lineHeight: 40, color: INK },
  brandAccent: { color: TEAL },
  headline: { fontFamily: 'Poppins-Bold', fontSize: 20, lineHeight: 27, color: INK, textAlign: 'center', marginTop: 8, letterSpacing: -0.3 },
  ctaArea: { width: '100%', marginTop: 26 },
  secondary: { alignItems: 'center', marginTop: 16, paddingVertical: 8 },
  secondaryText: { fontFamily: 'Inter-Regular', fontSize: 14, color: '#8593A8' },
  secondaryLink: { fontFamily: 'Inter-SemiBold', color: TEAL },

  btnWrap: { height: 60, borderRadius: 18 },
  btnEdge: { position: 'absolute', left: 0, right: 0, top: 5, bottom: 0, borderRadius: 18, backgroundColor: TEAL_DEEP },
  btnFace: { position: 'absolute', left: 0, right: 0, top: 0, height: 55, borderRadius: 18, overflow: 'hidden' },
  btnGrad: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Poppins-SemiBold', fontSize: 17, color: '#FFFFFF', letterSpacing: 0.3 },
});
