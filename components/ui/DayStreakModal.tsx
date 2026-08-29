import React, { useEffect, useMemo, useRef } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import LottieView from 'lottie-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

import { V2026 } from '@/theme/v2026-tokens';

type DayStreakMode = 'prompt' | 'celebration';

interface DayStreakModalProps {
  visible: boolean;
  mode: DayStreakMode;
  currentStreak: number;
  needsDailyDose?: boolean;
  needsDailySnack?: boolean;
  onClose: () => void;
  onCtaPress?: () => void;
}

// Recolored from a user-supplied LottieFiles "interactive streak" asset — the
// original baked a near-black background and neon-green accent (button,
// checkmark, "Streak" text) directly into its vector shapes, so every one of
// those fills was rewritten in place to this app's white/flame-orange palette
// (see the one-off script that produced this file; the flame gradients
// themselves were already correct and left untouched). It has two named
// segments: "Idle" (frames 0-90, flame flicker, unchecked button) and
// "On Click" (91-299, button flips to checked with a burst) — no editable
// text layer either, so the day number is still a separate Text overlay.
const streakAnimation = require('@/assets/mascot/streak-interactive.json');
const IDLE_SEGMENT: [number, number] = [0, 90];
const ON_CLICK_SEGMENT: [number, number] = [91, 299];

const FLAME_ORANGE = '#F97316';
const FLAME_GLOW_START = '#FFF7ED';
const FLAME_GLOW_END = '#FFE4CC';

export function DayStreakModal({
  visible,
  mode,
  currentStreak,
  needsDailyDose = false,
  needsDailySnack = false,
  onClose,
  onCtaPress,
}: DayStreakModalProps) {
  const animationRef = useRef<LottieView>(null);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        overlay: {
          flex: 1,
          backgroundColor: 'rgba(15, 23, 42, 0.55)',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 24,
        },
        card: {
          width: '100%',
          maxWidth: 340,
          borderRadius: V2026.radius.lg,
          paddingBottom: 22,
          backgroundColor: V2026.colors.surface,
          alignItems: 'center',
          overflow: 'hidden',
          ...V2026.shadows.milky,
        },
        closeBtn: {
          position: 'absolute',
          top: 12,
          right: 12,
          zIndex: 2,
          width: 30,
          height: 30,
          borderRadius: 15,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(255,255,255,0.7)',
        },
        glowBand: {
          width: '100%',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 30,
          paddingBottom: 6,
        },
        flameStack: {
          alignItems: 'center',
          justifyContent: 'center',
        },
        animation: {
          width: 210,
          height: 210,
        },
        // The asset's own composition puts its button/checkmark graphic in the
        // lower portion of the frame, so the number sits in the upper third to
        // stay clear of it rather than fighting for the same space — unverified
        // until this is actually seen on a device, may need repositioning.
        numberOverlay: {
          position: 'absolute',
          top: 14,
          left: 0,
          right: 0,
          alignItems: 'center',
        },
        numberText: {
          fontSize: 44,
          fontWeight: '900',
          color: FLAME_ORANGE,
          letterSpacing: -1,
          textShadowColor: 'rgba(255,255,255,0.9)',
          textShadowRadius: 6,
        },
        body: {
          width: '100%',
          paddingHorizontal: 24,
          alignItems: 'center',
          marginTop: 14,
        },
        headline: {
          fontSize: 18,
          fontWeight: '800',
          color: V2026.colors.text,
          textAlign: 'center',
          marginBottom: 18,
        },
        primaryButton: {
          width: '100%',
          borderRadius: V2026.radius.md,
          paddingVertical: 15,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: V2026.colors.primary,
          ...V2026.shadows.primary,
        },
        primaryLabel: {
          fontWeight: '800',
          fontSize: 16,
          color: '#FFFFFF',
          letterSpacing: 0.2,
        },
      }),
    []
  );

  useEffect(() => {
    if (!visible) return;
    if (mode === 'celebration') {
      // Streak is already secured for today — show the checked/burst state
      // right away instead of an idle loop, and hold on the final frame.
      animationRef.current?.play(ON_CLICK_SEGMENT[0], ON_CLICK_SEGMENT[1]);
    } else {
      animationRef.current?.play(IDLE_SEGMENT[0], IDLE_SEGMENT[1]);
    }
  }, [visible, mode]);

  const handleCtaPress = () => {
    if (mode === 'prompt') {
      // Play the satisfying checked/burst segment before the modal closes,
      // instead of just vanishing on tap.
      animationRef.current?.play(ON_CLICK_SEGMENT[0], ON_CLICK_SEGMENT[1]);
      setTimeout(() => {
        onCtaPress?.();
        onClose();
      }, 650);
    } else {
      onCtaPress?.();
      onClose();
    }
  };

  const streakDay = Math.max(currentStreak || 0, 1);

  // One line only, no separate chip + headline + paragraph repeating the same
  // information three ways.
  const headline = useMemo(() => {
    if (mode === 'celebration') return "Streak secured! See you tomorrow.";
    const pending: string[] = [];
    if (needsDailyDose) pending.push('Daily Dose');
    if (needsDailySnack) pending.push('Daily Snack');
    if (!pending.length) return "Finish today to keep your streak alive.";
    return `Finish ${pending.join(' & ')} to keep your streak.`;
  }, [mode, needsDailyDose, needsDailySnack]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={16} color={V2026.colors.textMuted} />
          </TouchableOpacity>

          <LinearGradient colors={[FLAME_GLOW_START, FLAME_GLOW_END]} style={styles.glowBand}>
            <View style={styles.flameStack}>
              <LottieView ref={animationRef} source={streakAnimation} loop={mode !== 'celebration'} style={styles.animation} />
              <View style={styles.numberOverlay} pointerEvents="none">
                <Text style={styles.numberText}>{streakDay}</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.body}>
            <Text style={styles.headline}>{headline}</Text>

            <TouchableOpacity
              style={styles.primaryButton}
              activeOpacity={0.9}
              onPress={handleCtaPress}
            >
              <Text style={styles.primaryLabel}>
                {mode === 'celebration' ? 'Nice!' : "I'll finish now"}
              </Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export type { DayStreakMode, DayStreakModalProps };
