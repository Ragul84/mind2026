// Duolingo-style primitives for the entry flow, matched to real Duolingo onboarding
// screenshots: flat dark background, green pill progress bar, bold rounded headlines,
// tappable option rows with a blue selected outline, and the signature chunky 3D
// button. Brandized to MindGains turquoise (swap PRIMARY for green if desired).
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ViewStyle, StyleProp } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, withSpring, interpolate } from '@/utils/reanimated';

// Light theme — matches the app's milky-white look (Duolingo light mode).
export const DUO = {
  bg: '#FFFFFF',          // milky white background
  border: '#E5E8EC',      // light grey — row/card border + progress track
  card: '#FFFFFF',
  primary: '#00D4C7',     // MindGains brand turquoise (Duo uses #58CC02 green)
  primaryEdge: '#06B3A8', // darker bottom edge for the 3D button
  primaryText: '#043D38', // dark teal — reads clean on the bright turquoise
  blue: '#00D4C7',        // selected accent = brand turquoise (app never uses blue)
  blueSoft: 'rgba(0,212,199,0.10)',
  text: '#2B2E33',        // near-black body/headings
  muted: '#98A2AE',
  disabled: '#E5E8EC',
};

export const hap = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  med: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {}),
  ok: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
};

// Chunky 3D button (Duolingo signature). tone: primary | secondary | disabled.
export function DuoButton({ label, onPress, disabled, tone = 'primary', textColor: textColorProp, style }: {
  label: string; onPress: () => void; disabled?: boolean; tone?: 'primary' | 'secondary'; textColor?: string; style?: StyleProp<ViewStyle>;
}) {
  const down = useSharedValue(0);
  const face = useAnimatedStyle(() => ({ transform: [{ translateY: interpolate(down.value, [0, 1], [0, 4]) }] }));
  const secondary = tone === 'secondary';
  const faceBg = disabled ? DUO.disabled : secondary ? '#FFFFFF' : DUO.primary;
  const edgeBg = disabled ? '#D1D6DC' : secondary ? DUO.border : DUO.primaryEdge;
  const textColor = disabled ? DUO.muted : textColorProp ?? (secondary ? DUO.blue : DUO.primaryText);
  return (
    <Pressable
      onPressIn={() => { if (!disabled) { down.value = withTiming(1, { duration: 60 }); hap.light(); } }}
      onPressOut={() => { down.value = withTiming(0, { duration: 110 }); }}
      onPress={() => { if (!disabled) onPress(); }}
      accessibilityRole="button" accessibilityLabel={label}
      style={style}
    >
      <View style={s.btnWrap}>
        <View style={[s.btnEdge, { backgroundColor: edgeBg }]} />
        <Animated.View style={[s.btnFace, { backgroundColor: faceBg, borderWidth: secondary ? 2 : 0, borderColor: DUO.border }, face]}>
          <Text style={[s.btnText, { color: textColor }]}>{label}</Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

// Green pill progress bar with a light top highlight.
export function ProgressBar({ value }: { value: number }) {
  const w = useSharedValue(value);
  useEffect(() => { w.value = withSpring(value, { damping: 18, stiffness: 120 }); }, [value]);
  const st = useAnimatedStyle(() => ({ width: `${Math.max(0.05, Math.min(1, w.value)) * 100}%` }));
  return (
    <View style={s.track}>
      <Animated.View style={[s.fill, st]}>
        <View style={s.fillHi} />
      </Animated.View>
    </View>
  );
}

// Tappable option row — icon + label, blue outline when selected (spring pop).
export function OptionRow({ icon, label, sub, selected, onPress }: {
  icon?: React.ReactNode; label: string; sub?: string; selected?: boolean; onPress: () => void;
}) {
  const p = useSharedValue(0);
  const onIn = () => { p.value = withTiming(1, { duration: 60 }); };
  const onOut = () => { p.value = withTiming(0, { duration: 110 }); };
  const st = useAnimatedStyle(() => ({ transform: [{ scale: interpolate(p.value, [0, 1], [1, 0.98]) }] }));
  return (
    <Pressable onPress={() => { hap.light(); onPress(); }} onPressIn={onIn} onPressOut={onOut}>
      <Animated.View style={[s.row, selected && s.rowSel, st]}>
        {icon ? <View style={s.rowIcon}>{icon}</View> : null}
        <View style={{ flex: 1 }}>
          <Text style={[s.rowLabel, selected && { color: DUO.blue }]}>{label}</Text>
          {sub ? <Text style={s.rowSub}>{sub}</Text> : null}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btnWrap: { height: 54 },
  btnEdge: { position: 'absolute', left: 0, right: 0, top: 4, bottom: 0, borderRadius: 16 },
  btnFace: { position: 'absolute', left: 0, right: 0, top: 0, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Poppins-Bold', fontSize: 15.5, letterSpacing: 0.8 },

  track: { height: 16, borderRadius: 8, backgroundColor: DUO.border, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 8, backgroundColor: DUO.primary, justifyContent: 'flex-start', paddingHorizontal: 4, paddingTop: 3 },
  fillHi: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 2, borderColor: DUO.border, borderRadius: 16, paddingHorizontal: 14, minHeight: 66, backgroundColor: 'transparent' },
  rowSel: { borderColor: DUO.blue, backgroundColor: DUO.blueSoft },
  rowIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.04)' },
  rowLabel: { fontFamily: 'Poppins-Bold', fontSize: 15.5, color: DUO.text },
  rowSub: { fontFamily: 'Inter-Regular', fontSize: 12.5, color: DUO.muted, marginTop: 2 },
});
