import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import HapticService from '@/utils/hapticService';
import { TEXTBOOK_BOARDS, TEXTBOOK_CLASSES, type TextbookScope } from '@/utils/textbookScope';

type Props = {
  value: TextbookScope;
  onChange: (next: TextbookScope) => void;
  title?: string;
  hint?: string;
};

/** Board + class chips. Used in profile setup and the MIGA textbook-mode sheet. */
export function TextbookScopePicker({ value, onChange, title = 'YOUR TEXTBOOKS', hint }: Props) {
  const pickBoard = (id: string) => {
    HapticService.selection();
    onChange({ ...value, board: value.board === id ? null : id });
  };
  const pickClass = (c: number | null) => {
    HapticService.selection();
    onChange({ ...value, classLevel: c });
  };
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{title}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {TEXTBOOK_BOARDS.map((b) => {
          const on = value.board === b.id;
          return (
            <TouchableOpacity key={b.id} onPress={() => pickBoard(b.id)} activeOpacity={0.85}
              style={[styles.chip, on && styles.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{b.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <TouchableOpacity onPress={() => pickClass(null)} activeOpacity={0.85}
          style={[styles.chip, value.classLevel == null && styles.chipOn]}>
          <Text style={[styles.chipText, value.classLevel == null && styles.chipTextOn]}>All (6-12)</Text>
        </TouchableOpacity>
        {TEXTBOOK_CLASSES.map((c) => {
          const on = value.classLevel === c;
          return (
            <TouchableOpacity key={c} onPress={() => pickClass(c)} activeOpacity={0.85}
              style={[styles.chip, on && styles.chipOn]}>
              <Text style={[styles.chipText, on && styles.chipTextOn]}>Class {c}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 16 },
  label: { fontSize: 12, fontWeight: '700', color: '#475569', letterSpacing: 0.8, marginBottom: 4 },
  hint: { fontSize: 12, color: '#64748B', marginBottom: 6 },
  row: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#FFFFFF' },
  chipOn: { borderColor: '#0F766E', backgroundColor: 'rgba(0, 212, 199, 0.12)' },
  chipText: { fontSize: 13, color: '#334155', fontWeight: '600' },
  chipTextOn: { color: '#0F766E' },
});

export default TextbookScopePicker;
