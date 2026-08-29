// Universal branded alert/confirm dialog — replaces the native Alert.alert
// (plain black-and-white system sheet) with the app's own milky-white/teal
// language everywhere it's used. Imperative API on purpose: Alert.alert call
// sites are scattered across the codebase and are not JSX, so this mirrors
// that same "call it from anywhere" shape instead of forcing every call site
// into a controlled-modal rewrite. Mount <BrandAlertHost /> once near the
// app root; call showBrandAlert(...) from anywhere after that.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from '@/utils/reanimated';
import { V2026 } from '@/theme/v2026-tokens';

export type BrandAlertButtonStyle = 'default' | 'cancel' | 'destructive';

export interface BrandAlertButton {
  text: string;
  style?: BrandAlertButtonStyle;
  onPress?: () => void;
}

export interface BrandAlertOptions {
  title: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  buttons?: BrandAlertButton[];
}

type Listener = (options: BrandAlertOptions | null) => void;
let listener: Listener | null = null;

export function showBrandAlert(options: BrandAlertOptions) {
  listener?.(options);
}

function AlertCard({ options, onDismiss }: { options: BrandAlertOptions; onDismiss: () => void }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSpring(1, { damping: 18, stiffness: 210 });
  }, []);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }, { translateY: (1 - progress.value) * 12 }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const buttons: BrandAlertButton[] = options.buttons?.length ? options.buttons : [{ text: 'OK', style: 'default' }];
  // Dismiss immediately rather than waiting on a worklet completion callback
  // (which needs runOnJS to touch React state safely) — simpler and avoids a
  // whole class of thread-boundary bugs for a dialog that's already snappy.
  const dismiss = (btn: BrandAlertButton) => {
    onDismiss();
    btn.onPress?.();
  };

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFillObject, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={() => dismiss(buttons.find((b) => b.style === 'cancel') || buttons[buttons.length - 1])} />
      </Animated.View>
      <Animated.View style={[styles.card, cardStyle]}>
        {options.icon ? (
          <View style={styles.iconWrap}>
            <Ionicons name={options.icon} size={22} color={V2026.colors.primaryDeep} />
          </View>
        ) : null}
        <Text style={styles.title}>{options.title}</Text>
        {options.message ? <Text style={styles.message}>{options.message}</Text> : null}
        <View style={[styles.buttonRow, buttons.length > 2 && styles.buttonColumn]}>
          {buttons.map((btn, i) => {
            const isDestructive = btn.style === 'destructive';
            const isCancel = btn.style === 'cancel';
            return (
              <Pressable
                key={`${btn.text}-${i}`}
                onPress={() => dismiss(btn)}
                style={({ pressed }) => [
                  styles.button,
                  isCancel ? styles.buttonCancel : isDestructive ? styles.buttonDestructive : styles.buttonPrimary,
                  pressed && { opacity: 0.85 },
                ]}
              >
                <Text style={[
                  styles.buttonText,
                  isCancel ? styles.buttonTextCancel : isDestructive ? styles.buttonTextDestructive : styles.buttonTextPrimary,
                ]}>
                  {btn.text}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
}

export function BrandAlertHost() {
  const [options, setOptions] = useState<BrandAlertOptions | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    listener = (next) => { if (mounted.current) setOptions(next); };
    return () => { mounted.current = false; listener = null; };
  }, []);

  const close = useCallback(() => setOptions(null), []);

  if (!options) return null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent onRequestClose={close}>
      <AlertCard options={options} onDismiss={close} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  scrim: { backgroundColor: 'rgba(15, 23, 42, 0.45)' },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: V2026.colors.surface,
    borderRadius: V2026.radius.lg,
    paddingTop: 24,
    paddingBottom: 18,
    paddingHorizontal: 22,
    alignItems: 'center',
    ...V2026.shadows.milky,
  },
  iconWrap: {
    width: 44, height: 44, borderRadius: V2026.radius.sm,
    backgroundColor: 'rgba(0, 212, 199, 0.12)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 12,
  },
  title: { fontFamily: 'Poppins-SemiBold', fontSize: 17, color: V2026.colors.text, textAlign: 'center' },
  message: { fontFamily: 'Inter-Regular', fontSize: 14, lineHeight: 20, color: V2026.colors.textMuted, textAlign: 'center', marginTop: 8 },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 20, width: '100%' },
  buttonColumn: { flexDirection: 'column' },
  button: { flex: 1, height: 46, borderRadius: V2026.radius.full, alignItems: 'center', justifyContent: 'center' },
  buttonPrimary: { backgroundColor: V2026.colors.primary },
  buttonCancel: { backgroundColor: V2026.colors.background },
  buttonDestructive: { backgroundColor: 'rgba(229, 72, 77, 0.10)' },
  buttonText: { fontFamily: 'Poppins-SemiBold', fontSize: 14.5 },
  buttonTextPrimary: { color: V2026.colors.surface },
  buttonTextCancel: { color: V2026.colors.textMuted },
  buttonTextDestructive: { color: V2026.colors.error },
});
