import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, StatusBar, Platform } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withDelay,
  Easing,
} from '@/utils/reanimated';
import { useAuthContext } from '@/components/AuthProvider';
import { SupabaseService, supabase } from '@/utils/supabaseService';
import { getUserProtocol } from '@/utils/protocolService';
import LottieView from 'lottie-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

function NativeLaunchScreen() {
  const { isAuthenticated, loading, initialized } = useAuthContext();
  const lottieRef = useRef<LottieView>(null);
  const hasNavigatedRef = useRef(false);
  const [splashFinished, setSplashFinished] = useState(false);
  const [destination, setDestination] = useState<string | null>(null);

  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(1.08);
  const wordmarkOpacity = useSharedValue(0);
  const wordmarkY = useSharedValue(12);
  const taglineOpacity = useSharedValue(0);
  const screenOpacity = useSharedValue(1);
  const screenScale = useSharedValue(1);

  // Work out where we're going WHILE the Lottie is still animating, so the fade
  // only fires once the target route is known. Navigation is then synchronous —
  // no window where the screen has faded but the async auth check is still running.
  const resolveDestination = async (): Promise<string> => {
    // Brand-new / signed-out users: welcome + onboarding the first time, then auth.
    if (!isAuthenticated) {
      try {
        const seen = await AsyncStorage.getItem('hasSeenOnboarding');
        return seen ? '/auth' : '/welcome';
      } catch {
        return '/welcome';
      }
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return '/auth';

      const [profile, protocol] = await Promise.all([
        SupabaseService.getUserProfile(user.id),
        getUserProtocol(user.id),
      ]);

      const needsOnboarding = !profile?.full_name || !protocol?.track_id;
      return needsOnboarding ? '/profile-setup' : '/home';
    } catch {
      return '/home';
    }
  };

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    logoScale.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });

    wordmarkOpacity.value = withDelay(360, withTiming(1, { duration: 620, easing: Easing.out(Easing.cubic) }));
    wordmarkY.value = withDelay(360, withTiming(0, { duration: 620, easing: Easing.out(Easing.cubic) }));

    taglineOpacity.value = withDelay(820, withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) }));

    // The Lottie loops so it never freezes on an empty frame while auth resolves.
    // After a short minimum it navigates the instant auth is ready — no bare-bg pause.
    const finishTimer = setTimeout(() => {
      setSplashFinished(true);
    }, 1500);

    return () => clearTimeout(finishTimer);
  }, []);

  // As soon as auth is ready, start resolving the destination in the background.
  useEffect(() => {
    if (!initialized || loading) return;
    let cancelled = false;
    void (async () => {
      const dest = await resolveDestination();
      if (!cancelled) setDestination(dest);
    })();
    return () => { cancelled = true; };
  }, [initialized, loading]);

  // Fade out and navigate only once BOTH the minimum splash time has elapsed and
  // the destination is known. The route swap is synchronous at the end of the
  // fade, so there's no bare-background pause between splash and the next screen.
  useEffect(() => {
    if (splashFinished && destination && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      screenScale.value = withTiming(1.03, { duration: 170, easing: Easing.in(Easing.cubic) });
      screenOpacity.value = withTiming(0, { duration: 160, easing: Easing.in(Easing.cubic) });
      const timer = setTimeout(() => {
        router.replace(destination as any);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [splashFinished, destination]);

  const screenStyle = useAnimatedStyle(() => ({
    opacity: screenOpacity.value,
    transform: [{ scale: screenScale.value }],
  }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const wordmarkAnim = useAnimatedStyle(() => ({
    opacity: wordmarkOpacity.value,
    transform: [{ translateY: wordmarkY.value }],
  }));
  const taglineAnim = useAnimatedStyle(() => ({
    opacity: taglineOpacity.value,
  }));

  return (
    <View style={styles.nativeContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />
      <LinearGradient
        colors={['#FFFFFF', '#F3F7F8', '#E9F1F2', '#E2ECEE']}
        locations={[0, 0.45, 0.78, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={styles.splashHairline} pointerEvents="none" />
      <Animated.View style={[styles.splashCenter, screenStyle]} pointerEvents="none">
        <Animated.View style={[styles.nativeLottieWrap, logoStyle]}>
          <LottieView
            ref={lottieRef}
            source={require('@/assets/lotties/loadingTransparent.json')}
            autoPlay
            loop
            style={styles.nativeLottie}
            resizeMode="contain"
          />
        </Animated.View>

        <Animated.View style={[styles.splashBrandRow, wordmarkAnim]}>
          <Text style={styles.splashWordmark}>Mind</Text>
          <Text style={[styles.splashWordmark, styles.splashWordmarkAccent]}>Gains</Text>
        </Animated.View>

        <Animated.Text style={[styles.splashTagline, taglineAnim]}>
          India's daily learning habit
        </Animated.Text>
      </Animated.View>
    </View>
  );
}

export default function HomeEntry() {
  return <NativeLaunchScreen />;
}

const styles = StyleSheet.create({
  nativeContainer: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    overflow: 'hidden',
  },
  splashCenter: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  splashBrandRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    overflow: 'visible',
    marginTop: 4,
  },
  splashWordmark: {
    fontFamily: 'Poppins-Bold',
    fontSize: 40,
    letterSpacing: -1.4,
    lineHeight: 48,
    color: '#0F172A',
  },
  splashWordmarkAccent: {
    color: '#0F766E',
  },
  splashTagline: {
    fontFamily: 'Inter-Medium',
    fontSize: 13,
    color: '#64748B',
    letterSpacing: 0.4,
    textAlign: 'center',
    marginTop: 12,
  },
  nativeLottieWrap: {
    width: width * 1.3,
    height: width * 1.3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -30,
  },
  nativeLottie: {
    width: '100%',
    height: '100%',
  },
  splashHairline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: '#0F766E',
    opacity: 0.9,
  },
});
